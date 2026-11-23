#!/usr/bin/env node
/**
 * JARVIS relay: the gateway between the phone and the laptop, and JARVIS's
 * hands on this server.
 *
 *   phone ──POST /v1/run──▶ relay ──(long poll)──▶ laptop agent
 *                            └─ target "server": runs here
 *
 * The laptop only makes outgoing HTTPS requests (GET /v1/agent/poll holds
 * until a job arrives), so it needs no open port and works from any network.
 * Zero dependencies: Node 22+.
 *
 * Env: JARVIS_PHONE_TOKEN, JARVIS_AGENT_TOKEN (≥ 32 chars each),
 *      PORT (3020), HOST (127.0.0.1), JARVIS_SERVER_CWD (/root).
 */
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import { runShell } from '../lib/run.mjs';

const PORT = Number(process.env.PORT || 3020);
const HOST = process.env.HOST || '127.0.0.1';
const PHONE_TOKEN = process.env.JARVIS_PHONE_TOKEN || '';
const AGENT_TOKEN = process.env.JARVIS_AGENT_TOKEN || '';
const SERVER_CWD = process.env.JARVIS_SERVER_CWD || os.homedir();

const POLL_HOLD_MS = 25000; // under Cloudflare's 100 s origin timeout
// The agent re-polls immediately after every answer, so between polls it is
// gone for milliseconds. No open poll and none for this long = offline.
const AGENT_GAP_MS = 8000;
const MAX_JOB_MS = 90000; // longest a phone request waits for a result
const MAX_SHELL_S = 85;
const PHONE_BODY_MAX = 256 * 1024;
const AGENT_BODY_MAX = 12 * 1024 * 1024; // screenshots

if (PHONE_TOKEN.length < 32 || AGENT_TOKEN.length < 32) {
  console.error(
    'JARVIS_PHONE_TOKEN and JARVIS_AGENT_TOKEN must be set (≥ 32 chars).'
  );
  process.exit(1);
}
if (PHONE_TOKEN === AGENT_TOKEN) {
  console.error('The phone and agent tokens must differ.');
  process.exit(1);
}

const log = (entry) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), ...entry }));

// ── auth ────────────────────────────────────────────────────────────────

const digest = (s) => crypto.createHash('sha256').update(s).digest();
const PHONE_DIGEST = digest(PHONE_TOKEN);
const AGENT_DIGEST = digest(AGENT_TOKEN);

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : '';
}

/** 'phone' | 'agent' | null. Constant-time against both tokens. */
function whoIs(req) {
  const d = digest(bearer(req));
  if (crypto.timingSafeEqual(d, PHONE_DIGEST)) return 'phone';
  if (crypto.timingSafeEqual(d, AGENT_DIGEST)) return 'agent';
  return null;
}

const clientIp = (req) =>
  String(
    req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.socket.remoteAddress ||
      ''
  );

// Failed logins per IP: 10 in 10 minutes locks the IP out for 10 minutes.
const failures = new Map();
function lockedOut(ip) {
  const f = failures.get(ip);
  return f && f.count >= 10 && Date.now() - f.since < 10 * 60 * 1000;
}
function noteFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60 * 1000) {
    failures.set(ip, { count: 1, since: Date.now() });
  } else f.count++;
  if (failures.size > 5000) failures.clear();
}

// ── http helpers ────────────────────────────────────────────────────────

function send(res, status, body) {
  if (res.writableEnded) return;
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

function readJson(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// ── laptop agent link ───────────────────────────────────────────────────

const agent = { lastSeen: 0, host: null, waiter: null };
const queue = []; // jobs waiting for the agent's next poll
const inflight = new Map(); // job id → { resolve }

const agentOnline = () =>
  Boolean(agent.waiter) || Date.now() - agent.lastSeen < AGENT_GAP_MS;

function deliver(job) {
  const w = agent.waiter;
  if (w) {
    agent.waiter = null;
    agent.lastSeen = Date.now(); // it re-polls right away
    clearTimeout(w.timer);
    send(w.res, 200, job);
  } else queue.push(job);
}

function runOnLaptop(action, args, waitMs) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      inflight.delete(id);
      const i = queue.findIndex((j) => j.id === id);
      if (i >= 0) queue.splice(i, 1);
      resolve({
        error:
          'The laptop did not answer in time (it may have just gone to sleep or lost internet).',
      });
    }, waitMs);
    // Not picked up by a poll soon: the agent is gone (asleep, offline).
    const pickup = setTimeout(() => {
      const i = queue.findIndex((j) => j.id === id);
      if (i < 0) return;
      queue.splice(i, 1);
      inflight.get(id)?.resolve({ error: 'laptop_offline', last_seen_s: 0 });
    }, AGENT_GAP_MS);
    inflight.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        clearTimeout(pickup);
        inflight.delete(id);
        resolve(result);
      },
    });
    deliver({ id, action, args });
  });
}

function handlePoll(req, res, ip) {
  agent.lastSeen = Date.now();
  const host = String(req.headers['x-agent-host'] || '').slice(0, 64);
  if (host && host !== agent.host) {
    agent.host = host;
    log({ ip, event: 'agent_connected', host });
  }
  if (queue.length) return send(res, 200, queue.shift());
  if (agent.waiter) {
    clearTimeout(agent.waiter.timer);
    send(agent.waiter.res, 204);
  }
  const waiter = {
    res,
    timer: setTimeout(() => {
      if (agent.waiter === waiter) agent.waiter = null;
      agent.lastSeen = Date.now();
      send(res, 204);
    }, POLL_HOLD_MS),
  };
  agent.waiter = waiter;
  res.on('close', () => {
    clearTimeout(waiter.timer);
    if (agent.waiter === waiter) agent.waiter = null;
  });
}

// ── this server ─────────────────────────────────────────────────────────

const SERVER_STATUS = `
echo "host: $(hostname)  up: $(uptime -p)"
echo "load: $(cut -d' ' -f1-3 /proc/loadavg)  cpus: $(nproc)"
free -h | awk '/Mem:/ {print "memory: " $3 " used of " $2 ", " $7 " available"}'
df -h / | awk 'NR==2 {print "disk /: " $3 " used of " $2 " (" $5 ")"}'
echo "failed services: $(systemctl --failed --no-legend --plain | awk '{print $1}' | xargs)"
command -v docker >/dev/null && echo "containers:" && docker ps --format '  {{.Names}}: {{.Status}}'
`;

function clampTimeout(s) {
  const n = Number(s);
  return Math.min(
    Math.max(Number.isFinite(n) && n > 0 ? n : 30, 1),
    MAX_SHELL_S
  );
}

async function runOnServer(action, args) {
  if (action === 'shell') {
    const command = String(args.command || '').trim();
    if (!command) return { error: 'Empty command.' };
    return runShell(command, {
      cwd: args.cwd || SERVER_CWD,
      timeoutMs: clampTimeout(args.timeout_s) * 1000,
    });
  }
  if (action === 'status') {
    const r = await runShell(SERVER_STATUS, { timeoutMs: 15000 });
    return {
      status: r.stdout.trim(),
      ...(r.stderr ? { stderr: r.stderr } : {}),
    };
  }
  return { error: `Unknown server action ${action}.` };
}

// ── routes ──────────────────────────────────────────────────────────────

async function handleRun(req, res, ip) {
  const body = await readJson(req, PHONE_BODY_MAX);
  const target = String(body.target || '');
  const action = String(body.action || '');
  const args = body.args && typeof body.args === 'object' ? body.args : {};
  const started = Date.now();
  let result;
  if (target === 'server') {
    result = await runOnServer(action, args);
  } else if (target === 'laptop') {
    if (!agentOnline()) {
      result = {
        error: 'laptop_offline',
        last_seen_s: agent.lastSeen
          ? Math.round((Date.now() - agent.lastSeen) / 1000)
          : null,
      };
    } else {
      const waitMs = Math.min(
        action === 'shell' ? clampTimeout(args.timeout_s) * 1000 + 5000 : 30000,
        MAX_JOB_MS
      );
      result = await runOnLaptop(action, args, waitMs);
    }
  } else {
    return send(res, 400, { error: 'target must be laptop or server' });
  }
  log({
    ip,
    target,
    action,
    ...(args.command ? { command: String(args.command).slice(0, 500) } : {}),
    ...(args.name ? { name: String(args.name).slice(0, 100) } : {}),
    exit_code: result?.exit_code,
    error: result?.error,
    ms: Date.now() - started,
  });
  send(res, 200, { result });
}

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req);
  try {
    const url = new URL(req.url, 'http://relay');
    if (url.pathname === '/v1/health') return send(res, 200, { ok: true });
    if (lockedOut(ip))
      return send(res, 429, { error: 'Too many failed logins.' });
    const who = whoIs(req);
    if (!who) {
      noteFailure(ip);
      log({ ip, event: 'auth_failed', path: url.pathname });
      return send(res, 401, { error: 'Unauthorized' });
    }

    if (
      who === 'phone' &&
      req.method === 'POST' &&
      url.pathname === '/v1/run'
    ) {
      return await handleRun(req, res, ip);
    }
    if (
      who === 'phone' &&
      req.method === 'GET' &&
      url.pathname === '/v1/status'
    ) {
      return send(res, 200, {
        server: { host: os.hostname() },
        laptop: {
          online: agentOnline(),
          host: agent.host,
          last_seen_s: agent.lastSeen
            ? Math.round((Date.now() - agent.lastSeen) / 1000)
            : null,
        },
      });
    }
    if (
      who === 'agent' &&
      req.method === 'GET' &&
      url.pathname === '/v1/agent/poll'
    ) {
      return handlePoll(req, res, ip);
    }
    if (
      who === 'agent' &&
      req.method === 'POST' &&
      url.pathname === '/v1/agent/result'
    ) {
      const body = await readJson(req, AGENT_BODY_MAX);
      agent.lastSeen = Date.now();
      inflight.get(String(body.id))?.resolve(body.result ?? {});
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

server.requestTimeout = 0; // long polls and long commands
server.headersTimeout = 30000;
server.listen(PORT, HOST, () =>
  log({ event: 'listening', host: HOST, port: PORT })
);
