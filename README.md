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
- ✈️ **Telegram as you** – Log in with your own account and work with it by voice: _«что нового в Телеграме?»_, _«прочитай рабочую группу»_, _«найди, что Руслан писал про оплату»_, _«ответь ему: буду в пять»_. JARVIS can read out new messages from chats you choose as they arrive. Nothing is sent or deleted until JARVIS reads it back and you say «да» (Android only)
- 🍽️ **Food delivery** – _«Джарвис, хочу плов»_, _«что сейчас открыто?»_, _«что есть в Evos?»_, _"find me a burger"_: JARVIS searches Uzum Tezkor near your saved address and tells you which places are open, with dishes, prices and delivery time. Say «закажи» and it opens Tezkor in the Uzum app for you to finish the order (search and discovery only; JARVIS does not place the order itself)
- 🌐 **Actions** – Open YouTube (with search), Telegram or any website; set reminders that JARVIS reads aloud
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
notification, and tapping **Turn off** there turns the mic off. Some vendors
(Samsung, Xiaomi…) may still kill background apps; set JARVIS's battery usage to
_Unrestricted_ if it stops listening after a while.

All tuning (thresholds, command window, models, voices, Telegram limits) lives in `src/config/jarvis.js`.

### Telegram

JARVIS logs in to Telegram as **you** (not as a bot) through TDLib (`modules/jarvis-telegram`,
Android only). Tap **✈️ Telegram** on the main screen, then enter your phone number, the
login code and, if you use one, your two-step verification password. The session stays on
the phone, in a TDLib database encrypted with a key held by the Android Keystore.
**Выйти из Telegram** in the same window ends it.

What you can say:

|                           | Example                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Unread chats and messages | «что нового в Телеграме?», «прочитай Азамата», «отметь как прочитанное»                                                     |
| Summaries                 | «о чём говорили в рабочей группе?»                                                                                          |
| Search                    | «найди сообщения про отчёт», «что Руслан писал про оплату?»                                                                 |
| Send and reply            | «напиши Руслану: буду через десять минут», «ответь ему: хорошо», «ответь сам» (JARVIS writes and sends a reply)             |
| Undo                      | «удали моё последнее сообщение» (deleted for everyone)                                                                      |
| Announcements             | «озвучивай рабочую группу», «перестань озвучивать Руслана», «хватит озвучивать» / «возобнови», «озвучивай личные сообщения» |

Chats are found by name, including Cyrillic/Latin spellings and names you gave them before
(«рабочая группа»). Announcements are spoken while JARVIS is idle: messages from watched
chats, messages that mention you (on by default) and, if you turn it on, private chats with
people (not bots or muted chats). A burst of messages is announced together, and after an
announcement «ответь ему: …» replies to that exact message.

Messages are sent as soon as you ask, with no «Отправить?» round trip. JARVIS turns what you
said into a clean message (or writes it itself: «ответь сам», «отправь это Алишеру»), says
which chat it sent to, and asks first only when the text is sensitive (passwords, codes, card
details, money, private matters). «удали моё последнее сообщение» takes one back. Deleting is the one action
that is read back first: it runs only if your **next** phrase confirms it. That check lives in
the code (`src/services/telegramSend.js`), not just in the prompt, so neither the model nor a
message someone sent you can delete anything on its own; interrupting the read-back cancels it.

> 🔒 Messages JARVIS reads, searches, summarizes or announces become part of the
> conversation sent to OpenAI. Chats it doesn't open stay on the phone.

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
# Optional, for Telegram: https://my.telegram.org → API development tools
EXPO_PUBLIC_TG_API_ID=12345678
EXPO_PUBLIC_TG_API_HASH=your_api_hash
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
