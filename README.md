# 🤖 J.A.R.V.I.S – Just A React Intelligent User System

> Your personal voice assistant powered by React Native, OpenAI, and Expo — designed to listen, think, and respond like a futuristic companion.

---

## 🧠 Overview

**J.A.R.V.I.S** is a smart, lightweight, and extensible voice assistant that runs directly on your phone. Built with React Native and integrated with OpenAI's powerful language model, it listens to your voice commands, understands your intent, and responds using natural-sounding voices.

This is the core version focusing on voice input and intelligent response.

---

## 🚀 Features

- 👂 **Wake word, hands-free** – Just say _«Джарвис, …»_ / _"Jarvis, …"_. No buttons. The command can follow the wake word in the same breath
- 🗨️ **Only when addressed** – JARVIS reacts only to phrases that start with its name, detects when you stop talking and answers. Say just «Джарвис» and it replies «Слушаю, сэр» and takes your next phrase as the command
- ✋ **Interrupt anytime** – Tap the arc reactor to cut JARVIS off, cancel, or start talking
- 🧠 **Tool-calling brain** – OpenAI Responses API with function calling and built-in web search for live facts, weather and news
- 🔊 **Neural JARVIS voice** – On-device Piper voices (Ruslan for Russian, Alan for English), synthesized and played sentence by sentence. Falls back to the device voice while a model is downloading and on iOS
- 👁️ **Vision** – _«Джарвис, что это?»_, _"Jarvis, read this"_, _«переведи табличку»_: JARVIS opens its scanner HUD, takes the shot by itself once the focus settles and reports what it sees — objects, products, plants, text read aloud or translated. Say "from the gallery" to analyse an existing photo
- 🌐 **Actions** – Open YouTube (with search), Telegram, the camera or any website; set reminders that JARVIS reads aloud
- 🔐 **Secure Access** – Face ID, Touch ID or device password before launch
- ⚙️ **Cross-Platform** – Expo SDK 58, iOS and Android (on-device wake word, offline speech and background listening are Android-only for now)

### How it listens

The microphone streams raw 16 kHz PCM (`expo-audio` `useAudioStream`) into an on-device
voice-activity detector (`src/audio/vad.js`) that adapts to room noise. In standby,
each phrase is first checked for the wake word by an on-device recognizer (sherpa-onnx,
NeMo FastConformer, first 3 s only); anything else is dropped on the phone, so TV,
calls and conversations around it never reach OpenAI. A bare «Джарвис» is answered
straight away; a phrase with a command, and everything said while JARVIS is listening
(after the wake word, a tap on the core, or an answer), is transcribed by OpenAI
(`gpt-transcribe`). Without a connection, or if OpenAI takes longer than 8 s, the
on-device recognizer transcribes instead. On Android, voice wake-up needs the on-device
model (downloaded on first launch); until then, tap the core. The screen stays on while
the app is open.

On iOS there is no on-device recognizer yet (`modules/jarvis-speech` is Android-only), so
in standby every phrase the voice detector picks up is sent to OpenAI and the wake word
is looked for in the transcript; phrases that don't start with it are dropped. This costs
more and sends background speech to OpenAI, and without a connection only a tap on the
core works.

On Android JARVIS keeps listening after you leave the app or turn the screen off: a
`microphone` foreground service (`modules/jarvis-background`) shows an ongoing
notification, and tapping **Выключить** there turns the mic off. Some vendors
(Samsung, Xiaomi…) may still kill background apps; set JARVIS's battery usage to
_Unrestricted_ if it stops listening after a while.

All tuning (thresholds, command window, models, voices) lives in `src/config/jarvis.js`.

---

## 🛠️ Tech Stack

- **React Native (Expo)**
- **OpenAI API**
- **Expo Audio & Speech APIs**
- **Custom React Components**

---

## 📦 Installation

Requirements: Node.js 20+, and Android Studio (Android) or Xcode (iOS) for local builds.

```bash
git clone https://github.com/az11k-dev/jarvis-app.git
cd jarvis-app
npm install
cp .env.example .env   # then fill in your keys
```

The app uses native modules (`expo-dev-client`), so it runs as a **development build**, not in Expo Go:

```bash
npm run android   # or: npm run ios
```

`android/` and `ios/` are not committed — they are generated from `app.config.js` by
`npx expo prebuild` (run automatically by `expo run:*` and EAS Build). Change native
settings in `app.config.js`, not in the generated folders.

Cloud builds: `npx eas-cli build --profile development --platform android`

---

## 🔐 Environment Variables

Create a `.env` file (see `.env.example`):

```
EXPO_PUBLIC_OPENAI_API_KEY=your_openai_key
```

> ⚠️ `EXPO_PUBLIC_*` variables are embedded in the app bundle. Don't ship a build with
> personal keys to other people.

---

## 🎯 Roadmap

- ✅ **Voice Input (STT: Speech to Text)**
  Speak directly to J.A.R.V.I.S. using natural language

- ✅ **Intelligent Responses (OpenAI GPT-4)**
  Understands intent and replies with human-like reasoning

- ✅ **Contextual Memory (Session-based, via AsyncStorage)**
  Remembers recent actions and keywords for smarter interaction

- ✅ **App Launching (e.g., Telegram, YouTube, etc.)**
  Opens mobile applications through voice commands

- ✅ **Smart Commands via OpenAI**
  – “Find a guitar tutorial on YouTube”
  – “Generate a login page in React”

- ✅ **Interactive Reminders & Notifications**
  – “Sir, you have a meeting in 10 minutes”
  Powered by `expo-notifications`

- ⏳ **Custom Voice Personality for J.A.R.V.I.S.**
  – Natural-sounding speech with pauses and tone
  – “Good morning, Sir. How are you feeling today?”

---

## 📸 Screenshots

> (Coming soon…)

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

---

## 📄 License

MIT

---

## 🧩 Inspiration

J.A.R.V.I.S is inspired by Marvel’s J.A.R.V.I.S — built with the ambition to bring intelligent interaction into the hands of everyday users.

> “The future is now, old man.” — Tony Stark

---

## 🧬 Author

Azizbek Anarjonov Azimovich
Web & Mobile Developer | Visionary | Code meets character
