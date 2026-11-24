# CLAUDE.md — jarvis-app

@AGENTS.md

## Claude workflow

**Loop for any change:** read → edit → `npm test` + `npx expo lint` → reload Metro → try it on the
phone (`?ask=`) → CHANGELOG line → commit only when the user asks.

**The running engine keeps old code.** Fast Refresh does not reach `src/services`, `src/core`,
`tools.js`, `brain.js` or `constants.jsx`. Reload the JS through Metro's websocket
(`/device-test` skill). **Never `am force-stop com.az11k.jarvisapp`**: Android then turns off the
«JARVIS: taxi» accessibility service, and only the user can turn it back on. A hook blocks this.

**After editing `remote/`**, re-run `remote/setup.sh` or the installed agent keeps the old code.

**After `git checkout`/merge with Metro running**, `touch` the added files and reopen the app
via the dev-client URL. A websocket reload then leaves a black screen.

## Toolbox

| Need                                    | Use                                               |
| --------------------------------------- | ------------------------------------------------- |
| Add or change a JARVIS capability       | skill `/add-tool`                                 |
| Run / test on the phone, read logs      | skill `/device-test`, or agent `device-tester`    |
| Kotlin / Expo module / Gradle work      | agent `android-native`                            |
| Review a diff for JARVIS-specific risks | agent `jarvis-reviewer`                           |
| Cheap independent second opinion        | skill `/second-opinion` (agy + codex in parallel) |
| Pre-commit gate                         | skill `/preflight`                                |
| Launcher-free release APK               | skill `/release-apk`                              |

Delegate per the global rules: bulk reading, log digging and second-opinion reviews go to
`agy`/`codex` (read-only), and I verify what they report before I use it.

## Hooks (`.claude/settings.json`)

- Edits are prettier-formatted automatically. Edits to engine-captured code add a reminder to reload Metro.
- Writes into `android/`/`ios/` are blocked. So are `am force-stop` of the app and `adb uninstall`
  of the app (that wipes the Telegram session; ask the user first).

Personal device and server details are in `CLAUDE.local.md` (gitignored) and in memory.
