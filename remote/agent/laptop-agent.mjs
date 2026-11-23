#!/usr/bin/env node
/**
 * JARVIS laptop agent (Linux, GNOME on X11). Long-polls the relay for jobs
 * from the phone and runs them as the logged-in user: apps, windows, volume,
 * media, keyboard, screen lock, sleep, screenshots and any shell command.
 * Only outgoing HTTPS, so it works from any network. Zero dependencies.
 *
 * Env: JARVIS_RELAY_URL (https://jarvis.react.uz), JARVIS_AGENT_TOKEN.
 * Needs: xdotool, xprop, pactl, gdbus, gtk-launch, ImageMagick (import).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchDetached, runShell } from '../lib/run.mjs';

const RELAY = (
  process.env.JARVIS_RELAY_URL || 'https://jarvis.react.uz'
).replace(/\/+$/, '');
const TOKEN = process.env.JARVIS_AGENT_TOKEN || '';
const HOME = os.homedir();

const log = (...a) => console.log(new Date().toISOString(), ...a);

/** Runs a short helper command, returning trimmed stdout (throws on failure). */
async function sh(command, timeoutMs = 10000) {
  const r = await runShell(command, { timeoutMs, maxChars: 200000 });
  if (r.exit_code !== 0) {
    throw new Error(
      (r.stderr || r.stdout || `exit ${r.exit_code}`).trim().slice(0, 500)
    );
  }
  return r.stdout.trim();
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // shell-quote

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** 3 exact, 2 starts with, 1 contains, 0 no match. */
function score(query, ...names) {
  const qn = norm(query);
  let best = 0;
  for (const name of names) {
    const n = norm(name);
    if (!n || !qn) continue;
    if (n === qn) return 3;
    if (n.startsWith(qn) || qn.startsWith(n)) best = Math.max(best, 2);
    else if (n.includes(qn) || qn.includes(n)) best = Math.max(best, 1);
  }
  return best;
}

// ── installed apps (.desktop files) ─────────────────────────────────────

const APP_DIRS = [
  path.join(HOME, '.local/share/applications'),
  path.join(HOME, '.local/share/flatpak/exports/share/applications'),
  '/var/lib/flatpak/exports/share/applications',
  '/var/lib/snapd/desktop/applications',
  '/usr/local/share/applications',
  '/usr/share/applications',
];

function listApps() {
  const apps = new Map();
  for (const dir of APP_DIRS) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.desktop'));
    } catch {
      continue;
    }
    for (const file of files) {
      if (apps.has(file)) continue; // user entries override system ones
      let text;
      try {
        text = fs.readFileSync(path.join(dir, file), 'utf8');
      } catch {
        continue;
      }
      const entry = text
        .split(/^\[/m)
        .find((s) => s.startsWith('Desktop Entry]'));
      if (!entry) continue;
      const get = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(entry) || [])[1];
      if (get('Type') !== 'Application') continue;
      if (
        /^true$/i.test(get('NoDisplay') || '') ||
        /^true$/i.test(get('Hidden') || '')
      ) {
        apps.set(file, null);
        continue;
      }
      apps.set(file, {
        id: file.replace(/\.desktop$/, ''),
        name: get('Name') || file,
        localName: get('Name\\[ru\\]') || '',
        generic: get('GenericName') || '',
        keywords: get('Keywords') || '',
        exec: get('Exec') || '',
      });
    }
  }
  return [...apps.values()].filter(Boolean);
}

function findApps(query) {
  return listApps()
    .map((a) => ({
      a,
      s: Math.max(
        score(query, a.name, a.localName, a.id, a.id.split('.').pop()),
        // generic names and keywords ("browser", "terminal") rank lower
        score(query, a.generic, ...a.keywords.split(';')) > 1 ? 1 : 0
      ),
    }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.name.length - y.a.name.length)
    .map((x) => x.a);
}

async function openApp({ name }) {
  const query = String(name || '').trim();
  if (!query) return { error: 'No app name.' };
  const [app, ...others] = findApps(query);
  if (app) {
    const r = await launchDetached('gtk-launch', [app.id]);
    if (r.error) return { error: r.error };
    return {
      status: 'launched',
      app: app.name,
      ...(others.length
        ? { other_matches: others.slice(0, 4).map((a) => a.name) }
        : {}),
    };
  }
  // Not a desktop app: maybe a command in PATH.
  const bin = query.split(/\s+/)[0];
  if (/^[\w.+-]+$/.test(bin)) {
    const found = await runShell(`command -v ${q(bin)}`, { timeoutMs: 5000 });
    if (found.exit_code === 0) {
      const r = await launchDetached('bash', ['-lc', query]);
      if (!r.error) return { status: 'launched', command: query };
    }
  }
  return {
    error: `No installed app matches «${query}».`,
    hint: 'Use list_apps to see installed apps, or laptop_shell to install it.',
  };
}

// ── windows (X11: xprop + xdotool) ──────────────────────────────────────

async function listWindows() {
  const root = await sh('xprop -root _NET_CLIENT_LIST _NET_ACTIVE_WINDOW');
  const ids = (/_NET_CLIENT_LIST\(WINDOW\): window id # (.*)/.exec(root) || [
    ,
    '',
  ])[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const active = (/_NET_ACTIVE_WINDOW\(WINDOW\): window id # (\S+)/.exec(
    root
  ) || [])[1];
  const windows = [];
  for (const id of ids) {
    let props;
    try {
      props = await sh(
        `xprop -id ${id} _NET_WM_NAME WM_CLASS _NET_WM_WINDOW_TYPE _NET_WM_STATE`
      );
    } catch {
      continue;
    }
    const type =
      (/_NET_WM_WINDOW_TYPE\(ATOM\) = (.*)/.exec(props) || [])[1] || '';
    if (
      type &&
      !type.includes('_NET_WM_WINDOW_TYPE_NORMAL') &&
      !type.includes('DIALOG')
    )
      continue;
    const title =
      (/_NET_WM_NAME\(UTF8_STRING\) = "(.*)"/.exec(props) || [])[1] || '';
    const cls = (
      /WM_CLASS\(STRING\) = "(.*?)", "(.*?)"/.exec(props) || []
    ).slice(1);
    windows.push({
      id,
      title: title.replace(/\\"/g, '"'),
      app: cls[1] || cls[0] || '',
      minimized: /_NET_WM_STATE_HIDDEN/.test(props),
      active: parseInt(id, 16) === parseInt(active, 16),
    });
  }
  return windows;
}

async function matchWindows(name) {
  const windows = await listWindows();
  const scored = windows
    .map((w) => ({
      w,
      s: Math.max(score(name, w.app), score(name, w.title) > 0 ? 1 : 0),
    }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return { windows, matches: scored.map((x) => x.w) };
}

const windowInfo = ({ title, app, active, minimized }) => ({
  title,
  app,
  ...(active ? { active } : {}),
  ...(minimized ? { minimized } : {}),
});

async function focusWindow({ name }) {
  const { windows, matches } = await matchWindows(name);
  if (!matches.length) {
    return {
      error: `No open window matches «${name}».`,
      open_windows: windows.map(windowInfo),
    };
  }
  const w = matches[0];
  await sh(`xdotool windowactivate --sync ${parseInt(w.id, 16)}`);
  return { status: 'focused', window: windowInfo(w) };
}

async function closeWindows({ name }) {
  const { windows, matches } = await matchWindows(name);
  if (!matches.length) {
    return {
      error: `No open window matches «${name}».`,
      open_windows: windows.map(windowInfo),
    };
  }
  // Same app as the best match only: "close chrome" closes every Chrome window.
  const targets = matches.filter(
    (w) => w.app === matches[0].app || norm(w.title) === norm(name)
  );
  for (const w of targets) {
    // Ask politely (like clicking ×), so apps can save state.
    await sh(
      `xdotool windowactivate --sync ${parseInt(w.id, 16)} key --clearmodifiers alt+F4`
    ).catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  }
  return { status: 'closed', windows: targets.map(windowInfo) };
}

async function windowCommand({ op, name }) {
  const id = name ? (await matchWindows(name)).matches[0]?.id : null;
  const target = id ? parseInt(id, 16) : '$(xdotool getactivewindow)';
  if (name && !id) return { error: `No open window matches «${name}».` };
  const cmds = {
    minimize: `xdotool windowminimize ${target}`,
    maximize: `xdotool key --clearmodifiers super+Up`,
    fullscreen: `xdotool key --clearmodifiers F11`,
  };
  if (!cmds[op]) return { error: `Unknown window op ${op}.` };
  if (op !== 'minimize' && id)
    await sh(`xdotool windowactivate --sync ${target}`);
  await sh(cmds[op]);
  return { status: 'done', op };
}

// ── sound ───────────────────────────────────────────────────────────────

async function volumeState() {
  const vol = await sh('pactl get-sink-volume @DEFAULT_SINK@');
  const mute = await sh('pactl get-sink-mute @DEFAULT_SINK@');
  return {
    volume_percent: Number((/(\d+)%/.exec(vol) || [])[1]),
    muted: /yes/.test(mute),
  };
}

async function volume({ op, level }) {
  const n = Math.round(Number(level));
  switch (op) {
    case 'get':
      break;
    case 'set':
      if (!Number.isFinite(n))
        return { error: 'level (0-150) is required for set.' };
      await sh(
        `pactl set-sink-mute @DEFAULT_SINK@ 0; pactl set-sink-volume @DEFAULT_SINK@ ${Math.min(Math.max(n, 0), 150)}%`
      );
      break;
    case 'up':
    case 'down': {
      const step = Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 10;
      const cur = (await volumeState()).volume_percent || 0;
      const next =
        op === 'up' ? Math.min(cur + step, 150) : Math.max(cur - step, 0);
      await sh(
        `pactl set-sink-mute @DEFAULT_SINK@ 0; pactl set-sink-volume @DEFAULT_SINK@ ${next}%`
      );
      break;
    }
    case 'mute':
    case 'unmute':
      await sh(`pactl set-sink-mute @DEFAULT_SINK@ ${op === 'mute' ? 1 : 0}`);
      break;
    default:
      return { error: `Unknown volume op ${op}.` };
  }
  return volumeState();
}

// ── media (MPRIS over D-Bus) ────────────────────────────────────────────

async function mprisPlayers() {
  const out = await sh(
    'gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ListNames'
  );
  const names = out.match(/org\.mpris\.MediaPlayer2\.[\w.-]+/g) || [];
  const players = [];
  for (const dest of names) {
    const get = (prop) =>
      sh(
        `gdbus call --session --dest ${dest} --object-path /org/mpris/MediaPlayer2 --method org.freedesktop.DBus.Properties.Get org.mpris.MediaPlayer2.Player ${prop}`,
        3000
      ).catch(() => '');
    const status = (/'(Playing|Paused|Stopped)'/.exec(
      await get('PlaybackStatus')
    ) || [])[1];
    const meta = await get('Metadata');
    const field = (k) =>
      (new RegExp(`'${k}': <\\[?'((?:[^'\\\\]|\\\\.)*)'`).exec(meta) || [])[1];
    players.push({
      dest,
      player: dest.replace('org.mpris.MediaPlayer2.', '').split('.')[0],
      status: status || 'Unknown',
      title: field('xesam:title'),
      artist: field('xesam:artist'),
    });
  }
  return players;
}

const MEDIA_METHODS = {
  play_pause: 'PlayPause',
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  next: 'Next',
  previous: 'Previous',
};

async function media({ op }) {
  const players = await mprisPlayers();
  const describe = (p) => ({
    player: p.player,
    status: p.status,
    ...(p.title ? { title: p.title } : {}),
    ...(p.artist ? { artist: p.artist } : {}),
  });
  if (op === 'status') return { players: players.map(describe) };
  const method = MEDIA_METHODS[op];
  if (!method) return { error: `Unknown media op ${op}.` };
  if (!players.length) {
    // No MPRIS player: the media key still reaches e.g. a focused video page.
    const key = {
      play_pause: 'XF86AudioPlay',
      play: 'XF86AudioPlay',
      pause: 'XF86AudioPause',
      stop: 'XF86AudioStop',
      next: 'XF86AudioNext',
      previous: 'XF86AudioPrev',
    }[op];
    await sh(`xdotool key ${key}`);
    return {
      status: 'media_key_sent',
      note: 'No media player reported itself.',
    };
  }
  const target =
    players.find((p) => p.status === 'Playing') ||
    players.find((p) => p.status === 'Paused') ||
    players[0];
  await sh(
    `gdbus call --session --dest ${target.dest} --object-path /org/mpris/MediaPlayer2 --method org.mpris.MediaPlayer2.Player.${method}`
  );
  await new Promise((r) => setTimeout(r, 400));
  const after = (await mprisPlayers()).find((p) => p.dest === target.dest);
  return { status: 'done', ...describe(after || target) };
}

// ── keyboard, screen, power ─────────────────────────────────────────────

async function typeText({ text }) {
  const t = String(text ?? '');
  if (!t) return { error: 'Nothing to type.' };
  await sh(`xdotool type --clearmodifiers --delay 8 -- ${q(t)}`, 60000);
  return { status: 'typed', chars: t.length };
}

async function pressKeys({ keys }) {
  const k = String(keys || '').trim();
  if (!k || !/^[\w+\s-]+$/.test(k)) {
    return {
      error:
        'keys must look like "ctrl+c", "Return", "super", "alt+Tab ctrl+v".',
    };
  }
  await sh(`xdotool key --clearmodifiers ${k}`);
  return { status: 'pressed', keys: k };
}

async function lockScreen() {
  try {
    await sh(
      'gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.Lock'
    );
  } catch {
    await sh('loginctl lock-sessions || xdg-screensaver lock');
  }
  return { status: 'locked' };
}

async function screenshot() {
  const file = path.join(os.tmpdir(), `jarvis-shot-${process.pid}.jpg`);
  try {
    await sh(
      `import -silent -window root -resize '1600x1600>' -quality 70 ${q(file)}`,
      15000
    );
    const base64 = fs.readFileSync(file).toString('base64');
    let active = '';
    try {
      active = await sh('xdotool getactivewindow getwindowname');
    } catch {
      // no active window (desktop)
    }
    return { mime: 'image/jpeg', base64, active_window: active };
  } finally {
    fs.rm(file, { force: true }, () => {});
  }
}

async function status() {
  const parts = {};
  parts.host = os.hostname();
  parts.uptime_min = Math.round(os.uptime() / 60);
  parts.load = os
    .loadavg()
    .map((n) => n.toFixed(2))
    .join(' ');
  parts.memory = `${((os.totalmem() - os.freemem()) / 2 ** 30).toFixed(1)} of ${(os.totalmem() / 2 ** 30).toFixed(1)} GiB`;
  try {
    parts.disk = await sh(
      `df -h ${q(HOME)} | awk 'NR==2 {print $3 " used of " $2 " (" $5 "), " $4 " free"}'`
    );
  } catch {
    // ignore
  }
  try {
    const bat = await sh(
      `upower -i "$(upower -e | grep -m1 BAT)" | grep -E 'state|percentage|time to'`
    );
    parts.battery = bat.replace(/\s+/g, ' ').trim();
  } catch {
    // no battery
  }
  try {
    parts.active_window = await sh('xdotool getactivewindow getwindowname');
  } catch {
    // ignore
  }
  try {
    const locked = await sh(
      'gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.GetActive'
    );
    parts.screen_locked = /true/.test(locked);
  } catch {
    // ignore
  }
  try {
    Object.assign(parts, await volumeState());
  } catch {
    // ignore
  }
  return parts;
}

async function openUrl({ url }) {
  let u = String(url || '').trim();
  if (!u) return { error: 'No URL.' };
  if (!/^[a-z][\w+.-]*:/i.test(u)) u = `https://${u}`;
  const r = await launchDetached('xdg-open', [u]);
  return r.error ? { error: r.error } : { status: 'opened', url: u };
}

async function notify({ text }) {
  const t = String(text || '').slice(0, 500);
  await sh(
    `gdbus call --session --dest org.freedesktop.Notifications --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify JARVIS 0 '' JARVIS ${q(t)} '[]' '{}' 10000`
  );
  return { status: 'shown' };
}

// ── jobs ────────────────────────────────────────────────────────────────

const ACTIONS = {
  shell: ({ command, cwd, timeout_s }) =>
    runShell(String(command || ''), {
      cwd: cwd || HOME,
      timeoutMs: Math.min(Math.max(Number(timeout_s) || 30, 1), 85) * 1000,
    }),
  open_app: openApp,
  list_apps: ({ filter }) => ({
    apps: (filter ? findApps(filter) : listApps()).map((a) => a.name).sort(),
  }),
  open_url: openUrl,
  windows: async () => ({ windows: (await listWindows()).map(windowInfo) }),
  focus: focusWindow,
  close: closeWindows,
  window: windowCommand,
  volume,
  media,
  type: typeText,
  keys: pressKeys,
  lock: lockScreen,
  sleep: async () => {
    setTimeout(() => runShell('systemctl suspend'), 1500); // answer first
    return { status: 'suspending' };
  },
  screenshot,
  status,
  notify,
};

export async function handle(job) {
  const fn = ACTIONS[job.action];
  const started = Date.now();
  let result;
  try {
    result = fn
      ? await fn(job.args || {})
      : { error: `Unknown action ${job.action}.` };
  } catch (e) {
    result = { error: e.message };
  }
  log(
    job.action,
    job.args?.command || job.args?.name || '',
    `${Date.now() - started}ms`,
    result?.error || ''
  );
  return result;
}

async function post(pathname, body) {
  const res = await fetch(`${RELAY}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
}

async function runJob(job) {
  const result = await handle(job);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await post('/v1/agent/result', { id: job.id, result });
      return;
    } catch (e) {
      log('result upload failed:', e.message);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error('JARVIS_AGENT_TOKEN is not set.');
    process.exit(1);
  }
  log(`agent for ${os.hostname()} → ${RELAY}`);
  let backoff = 1000;
  let wasDown = false;
  for (;;) {
    try {
      const res = await fetch(`${RELAY}/v1/agent/poll`, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'x-agent-host': os.hostname(),
        },
        signal: AbortSignal.timeout(40000),
      });
      if (res.status === 401) throw new Error('relay rejected the agent token');
      if (res.status === 200) runJob(await res.json());
      else if (res.status !== 204) throw new Error(`poll: HTTP ${res.status}`);
      if (wasDown) log('connected');
      wasDown = false;
      backoff = 1000;
    } catch (e) {
      if (!wasDown) log('relay unreachable:', e.message);
      wasDown = true;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
