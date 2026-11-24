# AGENTS.md — jarvis-app

Shared rules for every coding agent in this repo (Claude Code, Codex, Antigravity/agy).
Claude-specific workflow lives in `CLAUDE.md`.

## What this is

JARVIS: a hands-free voice assistant for Android (iOS partly), built with Expo SDK 58 /
React Native 0.88 / React 19, plain JavaScript (no TypeScript). The user speaks Russian,
English or Uzbek. The phone listens for the wake word on the device, sends the command to
the OpenAI Responses API with function calling, runs the tools and answers out loud with
on-device Piper voices.

## Commands

| Task                  | Command                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| Unit tests (node)     | `npm test` (node:test, `tests/*.test.mjs`, ~1 s)                          |
| Lint                  | `npx expo lint`                                                           |
| Format                | `npx prettier --write <files>` (single quotes, 2 spaces, see .prettierrc) |
| Dev server            | `npx expo start --dev-client` (start it with `< /dev/null`; never `CI=1`) |
| Build + install debug | `npx expo run:android`                                                    |
| Regenerate native     | `npx expo prebuild --platform android --clean`                            |

Local Gradle needs `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` and `ANDROID_HOME=$HOME/Android/Sdk`.
A pre-commit hook runs `lint-staged` (eslint --fix + prettier).

## Map

```
App.js → src/screens/Home.jsx            HUD screen
src/core/jarvisEngine.js                 the state machine: mic → VAD → wake word → STT → brain → TTS
src/core/jarvisRuntime.js                engine singleton + background keep-alive
src/services/brain.js                    Responses API tool loop (MAX_TOOL_ROUNDS, history, timeouts)
src/services/tools.js                    TOOL_DEFINITIONS (schemas) + runTool switch: every capability
src/utils/constants.jsx                  JARVIS_INSTRUCTIONS: the system prompt
src/config/jarvis.js                     ALL tuning: models, timeouts, VAD, wake-word regex, limits
src/services/<feature>.js                side effects (RN, native modules, network)
src/services/<feature>Format.js          pure logic, unit-tested under node
src/dev/debugBridge.js                   __DEV__ deep-link hooks (?ask= ?say= ?telemetry= ?td= ?media=)
modules/jarvis-*/                        local Expo modules (Kotlin, Android only)
  jarvis-speech      sherpa-onnx STT/TTS        jarvis-background  mic foreground service
  jarvis-telegram    TDLib (user account)       jarvis-phone       SMS, calls, voice notes
  jarvis-screen      a11y service + HUD cover    jarvis-assistant   digital-assistant role
remote/                                  relay (server) + laptop agent (node .mjs), separate deploy
patches/                                 patch-package patches (expo-audio)
tests/                                   *.test.mjs + fixtures (real taxi screen dumps)
```

## Hard rules

1. **`android/` and `ios/` are generated** (CNG, gitignored). Native settings go in `app.config.js`
   or a local module, never in the generated folders.
2. **Pure logic goes in `*Format.js`** with no React Native imports, and import paths there carry
   the `.js` extension (`./placesFormat.js`) so node can run the tests. Add a test in `tests/`.
3. **Tuning goes in `src/config/jarvis.js`**, not as literals in services.
4. **Patching an Expo package's native code** only works if the package is listed in
   `package.json` → `expo.autolinking.buildFromSource` (SDK 58 ships prebuilt AARs).
5. **New JNI/native libraries** in a local module need an R8 keep rule in that module's
   `android/consumer-rules.pro`, or release builds crash at startup.
6. **Autonomy by default**: JARVIS acts on a request and reports briefly. It asks first only for
   sensitive content (passwords, codes, cards, money, private matters). **Irreversible actions**
   (delete for everyone, place a taxi order, destructive shell commands) use a code-enforced
   confirmation: prepare → `action_id` → separate `*_confirm` tool on the user's _next_ turn →
   TTL expiry (see `telegramSend.js`, `taxi.js`, `remote.js`). Never rely on the prompt alone.
7. **Privacy**: anything a tool returns goes to OpenAI. Don't feed the model more personal data
   than the request needs. Only phrases that start with the wake word may leave the phone (Android).
8. **Secrets**: `.env` holds keys (`EXPO_PUBLIC_*` are embedded in the bundle). Never commit,
   print or paste them. This repo is **public**: no phone numbers, tokens, hostnames of private
   machines or personal data in committed files.
9. Don't use agents/scripts to place real orders, send SMS/Telegram to real contacts, or trigger
   SOS while testing.

## Style

- JS modules, functional, small exported functions; comments explain _why_.
- User-facing strings: what JARVIS says is generated by the model; tool results are short English
  facts plus an instruction for the model when needed (`next: '…'`), not ready-made speech.
- UI text in the app is English only.
- Commits: Conventional Commits with a scope: `feat(taxi): …`, `fix(wake): …`, `docs: …`.
  Subject says what the user gets, in plain words.
- User-visible changes get a line in `CHANGELOG.md` → `[Unreleased]`; new capabilities also in `README.md` features.
