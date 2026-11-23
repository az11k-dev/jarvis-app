/**
 * Pure helpers for laptop/server control (no React Native imports, so the
 * tests can load them in Node).
 */

// Shell commands that destroy data, stop things or change who can get in.
// They run only after the user hears them and says yes; everything else
// runs straight away.
const RISKY = [
  [/(^|[\s;&|(`])(sudo|doas|su)(\s|$)/, 'runs as another user'],
  [/(^|[\s;&|(`])(rm|rmdir|shred|unlink|srm)\s/, 'deletes files'],
  [/\bfind\b[^|;&]*\s-(delete|exec\s+rm)\b/, 'deletes files'],
  [
    /\b(shutil\.rmtree|os\.(remove|unlink|rmdir)|fs\.(rm|rmSync|unlink|unlinkSync|rmdir)|Path\([^)]*\)\.unlink)\b|\.unlink\(\)|\b(rmSync|unlinkSync|rmdirSync)\s*\(/,
    'deletes files',
  ],
  [
    /(^|[\s;&|(`])(dd|mkfs(\.\w+)?|wipefs|fdisk|sfdisk|parted|gdisk)\s/,
    'writes to disks',
  ],
  [/(^|[\s;&|(`])(shutdown|reboot|poweroff|halt)\b/, 'turns the machine off'],
  [
    /\b(systemctl|loginctl)\s+(poweroff|reboot|halt|kexec)\b/,
    'turns the machine off',
  ],
  [/(^|[\s;&|(`])init\s+[06]\b/, 'turns the machine off'],
  [/(^|[\s;&|(`])(kill|killall|pkill|xkill)\s/, 'kills processes'],
  [
    /\bsystemctl\s+(--\S+\s+)*(stop|disable|mask|kill|restart|isolate)\b/,
    'stops services',
  ],
  [/\bservice\s+\S+\s+(stop|restart)\b/, 'stops services'],
  [
    /\bdocker(\s+compose|-compose)?\s+(\S+\s+)*(rm|rmi|stop|kill|down|prune)\b/,
    'removes or stops containers',
  ],
  [/\bpm2\s+(delete|stop|kill)\b/, 'stops apps'],
  [/\bnginx\s+-s\s+(stop|quit)\b/, 'stops nginx'],
  [
    /\b(apt|apt-get|dpkg|snap|flatpak|npm|pip3?)\s+(\S+\s+)*(remove|purge|autoremove|uninstall)\b/,
    'uninstalls software',
  ],
  [
    /\b(chmod|chown|chgrp)\s+(\S+\s+)*-[a-zA-Z]*R/,
    'changes permissions recursively',
  ],
  [/\btruncate\s/, 'empties files'],
  [
    /(^|[^>&0-9])>\s*\/(etc|boot|usr|bin|sbin|lib|var|dev\/(sd|nvme|vd))/,
    'overwrites system files',
  ],
  [
    /\bgit\s+(reset\s+--hard|clean\s+-\w*f|push\s+(\S+\s+)*(--force|-f)\b|branch\s+-D)/,
    'discards git work',
  ],
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, 'deletes database data'],
  [/\b(dropDatabase|deleteMany|drop)\s*\(/, 'deletes database data'],
  [/\bflush(all|db)\b/i, 'deletes database data'],
  [
    /\b(ufw\s+(disable|reset|deny|delete)|iptables|nft\s)/,
    'changes the firewall',
  ],
  [/\b(userdel|deluser|passwd|usermod|chpasswd)\b/, 'changes user accounts'],
  [/\bcrontab\s+-r\b/, 'deletes scheduled jobs'],
  [
    /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    'runs a downloaded script',
  ],
  [/:\(\)\s*\{/, 'fork bomb'],
];

/** Why a shell command needs the user's yes, or null if it can just run. */
export function riskOf(command) {
  const c = String(command || '');
  for (const [re, why] of RISKY) if (re.test(c)) return why;
  return null;
}

/** Keeps the end of long output (the end is where results and errors are). */
export function clip(text, max) {
  const t = String(text || '').trimEnd();
  if (t.length <= max) return t;
  return `…${t.slice(-max)}`;
}

/** Shapes a shell result for the model: short, no empty fields. */
export function shellOutput(result, max = 3000) {
  if (!result || result.error) return result || { error: 'No result.' };
  const out = { exit_code: result.exit_code };
  const stdout = clip(result.stdout, max);
  const stderr = clip(result.stderr, Math.round(max / 2));
  if (stdout) out.stdout = stdout;
  if (stderr) out.stderr = stderr;
  if (result.timed_out) {
    out.timed_out = true;
    out.note =
      'Killed at the time limit. For long jobs run them in the background: nohup … > /tmp/job.log 2>&1 & and check the log later.';
  }
  if (!stdout && !stderr && result.exit_code === 0)
    out.note = 'Done, no output.';
  return out;
}

/**
 * Turns the model's laptop_control (action, value) into the agent's
 * [action, args] (see remote/agent/laptop-agent.mjs).
 */
export function laptopAction(action, value) {
  const v = String(value ?? '').trim();
  switch (action) {
    case 'open_app':
    case 'focus':
    case 'close':
      return [action, { name: v }];
    case 'list_apps':
      return ['list_apps', { filter: v }];
    case 'open_url':
      return ['open_url', { url: v }];
    case 'minimize':
    case 'maximize':
    case 'fullscreen':
      return ['window', { op: action, name: v }];
    case 'volume': {
      if (/^\d+\s*%?$/.test(v))
        return ['volume', { op: 'set', level: parseInt(v, 10) }];
      const [op, step] = v.toLowerCase().split(/\s+/);
      return [
        'volume',
        { op: op || 'get', ...(step ? { level: parseInt(step, 10) } : {}) },
      ];
    }
    case 'media':
      return ['media', { op: v.toLowerCase() || 'play_pause' }];
    case 'type':
      return ['type', { text: String(value ?? '') }];
    case 'keys':
      return ['keys', { keys: v }];
    case 'notify':
      return ['notify', { text: v }];
    default:
      // windows, lock, sleep, status; unknown ones are rejected by the agent
      return [action, {}];
  }
}
