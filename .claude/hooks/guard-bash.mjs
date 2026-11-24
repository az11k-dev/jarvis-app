#!/usr/bin/env node
// PreToolUse(Bash): block commands that break the phone setup in ways only
// the user can repair. Exit 2 = blocked, stderr goes back to Claude.
import { readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const cmd = input.tool_input?.command ?? '';

const rules = [
  {
    re: /am\s+force-stop\s+com\.az11k\.jarvisapp/,
    why: 'force-stop makes Android disable the «JARVIS: taxi» accessibility service, and only the user can turn it back on. Reload JS through Metro instead (see /device-test).',
  },
  {
    re: /\buninstall\b[^|;&]*\bcom\.az11k\.jarvisapp\b/,
    why: 'uninstall wipes app data, including the Telegram session, saved places and SOS contacts. Ask the user first; if they agree, they can run it with `! <command>`.',
  },
  {
    re: /\bpm\s+clear\s+com\.az11k\.jarvisapp/,
    why: 'pm clear wipes app data (Telegram session, places, SOS contacts). Ask the user first.',
  },
  {
    re: /\bgit\s+push\b[^|;&]*\s(--force\b|-f\b)/,
    why: 'force-push rewrites public history. It needs the user’s explicit approval.',
  },
];

for (const { re, why } of rules) {
  if (re.test(cmd)) {
    process.stderr.write(`Blocked by project hook: ${why}\n`);
    process.exit(2);
  }
}
