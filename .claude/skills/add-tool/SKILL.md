---
name: add-tool
description: Checklist for adding or changing a JARVIS capability (a model-callable tool) in jarvis-app — schema, runTool case, service + pure *Format.js with tests, confirmation policy, prompt, docs, device check. Use when the user asks JARVIS to "be able to …" or a tool misbehaves.
---

# Adding a JARVIS capability

Work through these in order. Look at a similar existing tool first (`places`, `order_taxi`,
`tg_send_message`, `laptop_control`) and copy its shape.

1. **Design the call.** One tool per user intent; an `action` enum is fine for a family
   (`places`: save/list/remove). Name `snake_case` with a feature prefix (`tg_`, `tezkor_`, `taxi_`).
2. **Schema** in `src/services/tools.js` → `TOOL_DEFINITIONS` via `fn(name, description, properties, required)`.
   The description tells the model _when_ to call it, with example user phrasings in RU/EN.
3. **Dispatch**: add a `case` in `runTool(name, args, { signal, turn })`. Pass `signal` on to
   fetches/waits. If the user takes part or it plays something, add it to `UNTIMED_TOOLS`
   (otherwise it's cut at `TOOL_TIMEOUT_MS`).
4. **Service** `src/services/<feature>.js`: side effects only. **Pure logic** (parsing, matching,
   formatting, link building) goes in `src/services/<feature>Format.js` with no React Native
   imports and `.js` import extensions.
5. **Tests**: `tests/<feature>Format.test.mjs` with `node:test` + `node:assert/strict`. Use real
   captured data as fixtures in `tests/fixtures/<feature>/`. Run `npm test`.
6. **Result shape**: a small JSON object with facts, plus `next: '<instruction to the model>'` when
   it must say or ask something specific. Errors as `{ error: '<reason + what to tell the user>' }`.
   Never return more personal data than the answer needs (it all goes to OpenAI).
7. **Confirmation policy**:
   - Default: act now, report briefly (the user hates «Отправить?» round trips).
   - Sensitive content (codes, passwords, cards, money talk): the model asks first (prompt rule).
   - **Irreversible** (delete for everyone, pay/order, destructive shell): code-enforced.
     `prepare*` stores `pending = { id, at, ... }` and returns `action_id` + `next`; a separate
     `*_confirm(action_id)` tool runs it only on the **next** turn and when the TTL hasn't expired
     (`turn` check). Copy `src/services/remote.js` (`confirmRemote`).
8. **Tuning** (timeouts, limits, patterns) → `src/config/jarvis.js`.
9. **Prompt**: only if the model needs behavior the description can't carry →
   `JARVIS_INSTRUCTIONS` in `src/utils/constants.jsx`. Keep it short.
10. **Native**: needs a permission or Android API? Use the `android-native` agent. Add permissions
    in `app.config.js`, then a rebuild.
11. **Check on the device**: Metro reload + `?new&ask=<phrase>` (skill `/device-test`); confirm the
    `[tool]` line and the spoken answer, in Russian and English.
12. **Docs**: `CHANGELOG.md` → `[Unreleased]` → Added/Fixed; new capability → README features.
13. `npx expo lint`, then the `jarvis-reviewer` agent or `/second-opinion` on the diff.
