---
name: release-apk
description: Build a launcher-free standalone release APK of jarvis-app locally (JS embedded, no Metro), install and verify it on the phone, then restore the dev-client setup. Use when the user wants a build that works without the dev server.
disable-model-invocation: true
---

# Standalone release APK

`npx expo run:android --variant release` alone still boots into the dev launcher (expo-dev-client).

1. Back up `package.json`. Add to `expo.autolinking` (keep `buildFromSource`):
   `"exclude": ["expo-dev-client", "expo-dev-launcher", "expo-dev-menu"]`.
2. `npx expo prebuild --platform android --clean`. Check
   `npx expo-modules-autolinking resolve -p android --json`: only `expo-dev-menu-interface` may remain.
3. Build (8–12 min, run in background, no other Gradle daemon running):
   ```sh
   cd android && JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=$HOME/Android/Sdk \
     ./gradlew :app:assembleRelease --no-daemon
   ```
   APK: `android/app/build/outputs/apk/release/app-release.apk` (~300 MB, Piper voices inside).
4. Install: `adb install -r <apk>` (same debug keystore as debug builds, so it upgrades in place).
   `INSTALL_FAILED_VERSION_DOWNGRADE` or a signature mismatch means an EAS build is installed:
   **ask the user** before uninstalling, because that wipes the Telegram session.
5. Verify: `dumpsys package com.az11k.jarvisapp | grep flags` has no `DEBUGGABLE`; with Metro
   stopped and `adb reverse --remove-all`, launch `am start -n com.az11k.jarvisapp/.MainActivity`.
   It must boot to the HUD; `pidof` stays alive for 20 s; logcat has no FATAL/SIGABRT
   (an R8-stripped JNI class shows up here; fix it with a keep rule in the module's consumer-rules.pro).
6. Restore `package.json` and run `npx expo prebuild --platform android --clean` again, so the
   dev-client workflow works. Note: `__DEV__` is false in this build, so the `?ask=` debug bridge is off.
