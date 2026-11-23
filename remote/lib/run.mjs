import { spawn } from 'node:child_process';

/** Keeps the last `max` characters of `text`, marking the cut. */
export function tail(text, max) {
  if (text.length <= max) return text;
  return `…[${text.length - max} chars cut]…\n${text.slice(-max)}`;
}

/**
 * Runs `command` in a bash login shell. Resolves (never rejects) with
 * { exit_code, stdout, stderr, timed_out, duration_ms }. On timeout the
 * whole process group is killed, so pipelines and children die too.
 */
export function runShell(
  command,
  { cwd, timeoutMs = 30000, maxChars = 20000, env } = {}
) {
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn('bash', ['-lc', command], {
        cwd,
        env: { ...process.env, ...env },
        detached: true, // own process group, so a timeout kills all of it
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ exit_code: -1, stdout: '', stderr: e.message, duration_ms: 0 });
      return;
    }
    // Keep a bounded window: twice the limit, cut to the limit at the end.
    const keep = (buf, chunk) => {
      const next = buf + chunk;
      return next.length > maxChars * 2 ? next.slice(-maxChars * 2) : next;
    };
    child.stdout
      .setEncoding('utf8')
      .on('data', (c) => (stdout = keep(stdout, c)));
    child.stderr
      .setEncoding('utf8')
      .on('data', (c) => (stderr = keep(stderr, c)));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }, timeoutMs);
    child.on('error', (e) => {
      stderr += e.message;
    });
    child.on('close', (code, sig) => {
      clearTimeout(timer);
      resolve({
        exit_code: code ?? (sig ? 128 : -1),
        stdout: tail(stdout, maxChars),
        stderr: tail(stderr, maxChars),
        ...(timedOut ? { timed_out: true } : {}),
        duration_ms: Date.now() - started,
      });
    });
  });
}

/** Starts a GUI program and forgets it (it outlives the agent's request). */
export function launchDetached(cmd, args = [], env) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...env },
      });
    } catch (e) {
      resolve({ error: e.message });
      return;
    }
    child.once('error', (e) => resolve({ error: e.message }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}
