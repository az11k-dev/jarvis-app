# 🤖 J.A.R.V.I.S – Just A React Intelligent User System

> Your personal voice assistant powered by React Native, OpenAI, and Expo — designed to listen, think, and respond like a futuristic companion.

---

## 🧠 Overview

**J.A.R.V.I.S** is a smart, lightweight, and extensible voice assistant that runs directly on your phone. Built with React Native and integrated with OpenAI's powerful language model, it listens to your voice commands, understands your intent, and responds using natural-sounding voices.

This is the core version focusing on voice input and intelligent response.

---

## 🚀 Features

- 🎙️ **Voice Command Input** – Speak commands naturally and fluidly
- 🧠 **AI-Powered Brain** – OpenAI GPT handles understanding and dynamic responses
- 🗣️ **Voice Output Selection** – Switch between different system voices on demand
- 🔊 **TTS Integration** – Utilizes `expo-speech` for natural-sounding speech playback
- 📱 **Mobile-Optimized UI** – Clean, responsive interface designed for all screen sizes
- ⚙️ **Cross-Platform Support** – Built with Expo for seamless iOS and Android deployment
- 🔐 **Secure Access** – Prompts for Face ID, Touch ID, or device password before launch
- 🌐 **Smart App Launching** – Open apps like YouTube or Telegram via voice command
- 📺 **YouTube Query Support** – Instantly open YouTube with specific search queries
- 🧭 **Internet-Aware Intelligence** – Fetches real-time information directly from the web

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
EXPO_PUBLIC_GITHUB_TOKEN_KEY=your_github_token
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

- ✅ **Secure Access with Biometric Authentication**
  – “Please confirm your identity: use Face ID or system password”
  Powered by `expo-local-authentication`

- ✅ **GitHub Command Integration**
  Execute developer-oriented voice commands such as:
  • “Create a repository named _uzbekistan_”
  • “Show recent commits”
  • “Delete the repository _uzbekistan_”

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
