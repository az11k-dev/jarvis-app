---
name: preflight
description: Pre-commit gate for jarvis-app — tests, lint, secret/personal-data scan of the diff (public repo), CHANGELOG check, generated-folder check, then a proposed Conventional Commit message. Use before every commit or when the user says "commit".
---

# Preflight

Run all of these, then report a short pass/fail table.

1. `npm test` and `npx expo lint` — both must pass.
2. **Public-repo scan** of what would be committed (`git diff HEAD` plus new untracked files):
   - keys/tokens: `sk-`, `api_key`, `TOKEN=`, long hex/base64 strings, `.env` contents
   - personal data: phone numbers (`\+?998\d{9}`), the adb serial, private hostnames other than the
     already public relay docs, real names of contacts
   - `.env`, `CLAUDE.local.md`, `.claude/settings.local.json`, `*.jks`/`*.keystore` must not be staged
     Anything found → stop and tell the user.
3. Nothing staged under `android/`, `ios/`, `node_modules/`; patches only via `patches/`.
4. User-visible change? → a line under `CHANGELOG.md` `[Unreleased]`. New capability → README features.
5. Pure-logic changes in `*Format.js` have matching test changes.
6. Propose the commit message: `type(scope): what the user gets` (types: feat, fix, docs, refactor,
   test, chore; scope = feature: taxi, telegram, wake, speech, remote, tezkor, places, sos, ui, engine…),
   with a short body for the why. End with the Co-Authored-By line from the session's attribution rules.

Commit only if the user asked to commit. Never push unless asked.
