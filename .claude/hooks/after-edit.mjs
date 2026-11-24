#!/usr/bin/env node
// PostToolUse(Edit|Write): prettier-format the file, then remind Claude about
// the reload a change needs to reach the phone.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const file = input.tool_input?.file_path ?? '';
const rel = relative(root, file);
if (!file || rel.startsWith('..') || !existsSync(file)) process.exit(0);

const prettier = join(root, 'node_modules/.bin/prettier');
const isDep = /(^|\/)node_modules\//.test(rel);
if (!isDep && /\.(m?js|jsx|json|md|css)$/.test(file) && existsSync(prettier)) {
  try {
    execFileSync(prettier, ['--write', '--log-level', 'warn', file], {
      cwd: root,
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 15000,
    });
  } catch {
    // A syntax error shows up in lint/tests; don't block the edit here.
  }
}

const notes = [];
if (isDep)
  notes.push(
    'node_modules edit: record it with `npx patch-package <pkg>` or it is lost on the next install. Expo packages with native changes must also be in package.json expo.autolinking.buildFromSource.'
  );
if (
  /^src\/(services|core)\/|^src\/utils\/constants\.jsx$|^src\/config\//.test(
    rel
  )
)
  notes.push(
    'This file is captured by the running JARVIS engine: Fast Refresh will not apply it. Reload JS via Metro’s websocket before testing on the phone (never force-stop).'
  );
if (/^remote\//.test(rel))
  notes.push(
    'remote/ changed: the installed laptop agent/relay keep old code until remote/setup.sh is re-run.'
  );
if (
  /^modules\/.*\.(kt|gradle|xml|pro)$|^app\.config\.js$|^package\.json$/.test(
    rel
  )
)
  notes.push(
    'Native change: needs a rebuild (`npx expo run:android`, prebuild --clean if config changed), not a Metro reload.'
  );

if (notes.length)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: notes.join(' '),
      },
    })
  );
