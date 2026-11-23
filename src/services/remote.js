import { REMOTE } from '../config/jarvis';
import { withTimeout } from '../utils/timeout';
import { analyzeImage } from './openai';
import { riskOf, shellOutput } from './remoteFormat';

/**
 * Laptop and server control through the JARVIS relay (remote/relay on the
 * user's server). The laptop agent keeps a connection to the relay, so this
 * works from any network.
 *
 * Commands run right away. Shell commands that riskOf() flags (deleting,
 * shutting down, killing, sudo…) take two steps like Telegram deletion:
 * prepared and read back, run only in the user's next turn. That check lives
 * here in code, so neither the model nor text in command output can run them
 * without the user hearing it and answering.
 */

const TARGETS = { laptop: 'laptop', server: 'server' };

function configured() {
  return Boolean(REMOTE.url && REMOTE.token);
}

async function call(target, action, args = {}, { signal, timeoutMs } = {}) {
  if (!configured()) {
    return {
      error:
        'Laptop/server control is not set up: EXPO_PUBLIC_JARVIS_REMOTE_URL and EXPO_PUBLIC_JARVIS_REMOTE_TOKEN are missing in .env.',
    };
  }
  const t = withTimeout(signal, timeoutMs || REMOTE.requestTimeoutMs);
  try {
    const res = await fetch(`${REMOTE.url}/v1/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${REMOTE.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target, action, args }),
      signal: t.signal,
    });
    if (res.status === 401) return { error: 'The relay rejected the token.' };
    if (!res.ok) return { error: `Relay error: HTTP ${res.status}` };
    const { result } = await res.json();
    if (result?.error === 'laptop_offline') {
      return {
        error: 'laptop_offline',
        note: 'The laptop is off, asleep or not connected to the internet. JARVIS can’t reach it until it wakes up.',
        last_seen_s: result.last_seen_s,
      };
    }
    return result ?? { error: 'Empty answer from the relay.' };
  } catch (e) {
    signal?.throwIfAborted?.();
    if (t.signal.aborted) return { error: 'The relay did not answer in time.' };
    return { error: `Can't reach the relay: ${e.message}` };
  } finally {
    t.cleanup();
  }
}

const shellTimeout = (s) =>
  Math.min(Math.max(Number(s) || REMOTE.defaultShellTimeoutS, 1), 85);

async function runShellNow(target, command, timeoutS, { signal }) {
  const timeout_s = shellTimeout(timeoutS);
  const result = await call(
    target,
    'shell',
    { command, timeout_s },
    { signal, timeoutMs: (timeout_s + 10) * 1000 }
  );
  return shellOutput(result, REMOTE.outputChars);
}

// ── confirmation for risky commands ───────────────────────────────────────

// The one command waiting for the user's yes: { id, turn, at, target, command, timeoutS }
let pending = null;
let nextId = 1;

/** Drops a prepared command (the user cut JARVIS off mid read-back). */
export function discardRemotePending() {
  pending = null;
}

/** Runs a shell command on the laptop or the server, or prepares it for a yes. */
export async function remoteShell(target, command, timeoutS, { signal, turn }) {
  if (!TARGETS[target]) return { error: `Unknown target ${target}.` };
  const cmd = String(command || '').trim();
  if (!cmd) return { error: 'Empty command.' };
  const risk = riskOf(cmd);
  if (risk) {
    pending = {
      id: String(nextId++),
      turn,
      at: Date.now(),
      target,
      command: cmd,
      timeoutS,
    };
    return {
      action_id: pending.id,
      target,
      command: cmd,
      risk,
      next: 'Not run yet. In one short sentence tell the user what it will do (not the command text itself) and ask to confirm. Call remote_confirm only if their next reply says yes.',
    };
  }
  return runShellNow(target, cmd, timeoutS, { signal });
}

export async function confirmRemote(actionId, { signal, turn }) {
  const action = pending;
  if (!action || action.id !== String(actionId)) {
    return { error: 'Nothing is waiting for confirmation. Prepare it first.' };
  }
  if (turn === action.turn) {
    return {
      error: 'Not confirmed yet. Tell the user and wait for their answer.',
    };
  }
  pending = null;
  if (
    turn !== action.turn + 1 ||
    Date.now() - action.at > REMOTE.confirmTtlMs
  ) {
    return {
      error:
        'Expired: the user did not confirm right after hearing it. Ask whether to prepare it again.',
    };
  }
  return runShellNow(action.target, action.command, action.timeoutS, {
    signal,
  });
}

// ── laptop actions ──────────────────────────────────────────────────────

/** Apps, windows, volume, media, keyboard, lock, sleep… (see laptop-agent.mjs). */
export async function laptopControl(action, args, { signal }) {
  return call('laptop', action, args, { signal });
}

/** Takes a screenshot of the laptop and answers `question` about it. */
export async function laptopScreen(question, { signal }) {
  const shot = await call('laptop', 'screenshot', {}, { signal });
  if (shot.error) return shot;
  signal?.throwIfAborted?.();
  const analysis = await analyzeImage(
    {
      base64: shot.base64,
      mime: shot.mime,
      question: `This is a screenshot of the user's laptop screen (active window: «${shot.active_window || 'none'}»). ${question || 'What is on the screen?'}`,
    },
    { signal }
  );
  return {
    active_window: shot.active_window,
    analysis: analysis || 'Nothing recognised.',
  };
}

export async function serverStatus({ signal }) {
  return call('server', 'status', {}, { signal });
}
