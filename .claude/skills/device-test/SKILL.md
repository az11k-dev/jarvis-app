---
name: device-test
description: Recipes for running and checking jarvis-app on the user's Android phone — Metro start/reload, ?ask= commands, waiting on logcat, screenshots and taps, reopening after a git checkout, voice tests. Use whenever a change must be seen working on the device.
---

# Testing JARVIS on the phone

Device facts (serial, safe targets) are in `CLAUDE.local.md`. Export the serial first:

```sh
export ANDROID_SERIAL=<wireless serial from CLAUDE.local.md>
ADB=~/Android/Sdk/platform-tools/adb
```

## 1. Metro

```sh
pgrep -af "expo start" || (npx expo start --dev-client < /dev/null > "$SCRATCH/metro.log" 2>&1 &)
$ADB reverse tcp:8081 tcp:8081
```

Never `CI=1` (it turns file watching off). Restart Metro after `.env` changes (`--clear`).
Use the session scratchpad for logs (`$SCRATCH` = scratchpad dir).

## 2. Load new JS (services/core/tools/prompt edits)

Fast Refresh does not reach the running engine. Reload through Metro's websocket:

```sh
node -e "const w=new WebSocket('ws://localhost:8081/message');w.onopen=()=>{w.send(JSON.stringify({version:2,method:'reload'}));setTimeout(()=>w.close(),500)}"
```

Wait for logcat `Running "main"` and then `[jarvis] status=standby`.
**Never `am force-stop`** (it disables the a11y service). `curl :8081/reload` does nothing.

**After a git checkout/merge**: `touch` the new files, then reopen the app instead of reloading:

```sh
$ADB shell am start -a android.intent.action.VIEW -d "exp+jarvis-app://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

## 3. Send a command without speaking

```sh
Q=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "который час?")
$ADB logcat -c
$ADB shell "am start -a android.intent.action.VIEW -d 'exp+jarvis-app://debug?new&ask=$Q'"
timeout 90 sh -c "until $ADB logcat -d -s ReactNativeJS | grep -q '\[jarvis\] jarvis:'; do sleep 3; done"
$ADB logcat -d -s ReactNativeJS | grep -E '\[jarvis\]|\[tool\]|Error' | tail -40
```

- Quote the URL inside `adb shell "…"`, or the device shell eats `&`. Drop `new&` to continue the conversation.
- A cold start eats the deep link (dev launcher): launch first, wait for `status=standby`, then send it.
- `[tool] <name> <args> -> <result>` shows every tool call. Other hooks: `?say=`, `?telemetry=on`,
  `?voice=ru:ruslan`, `?td=<json>`, `?media=…&kind=…&path=…`, `?announce=`, `?voicenote=`.

## 4. See and touch the screen

```sh
$ADB exec-out screencap -p > "$SCRATCH/shot.png"   # then Read it; empty file = phone locked
$ADB shell input tap X Y                           # X,Y = Read coordinates × 1.2
```

`uiautomator dump` fails (the arc reactor never idles). Notification shade: `input swipe 300 0 300 1500`.
Digital assistant: `input keyevent KEYCODE_ASSIST`.

## 5. Voice / wake word / STT

Don't judge STT with `?speak=` (Google TTS clips and garbles Russian). Ask the user to say the
phrases and tail Metro's log for `[speech] stt` lines (logcat formats it differently). Without
the user, an OpenAI TTS mp3 with 1 s leading silence played via
`am start -a android.intent.action.VIEW -d file:///sdcard/Download/q.mp3 -t audio/mpeg -p com.sec.android.app.music` works.

## 6. Release builds

Watch for ~20 s: `$ADB shell pidof com.az11k.jarvisapp` must stay set; `$ADB logcat -d | grep -E 'FATAL|SIGABRT'` must be empty.
