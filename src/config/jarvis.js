// Central tuning knobs for J.A.R.V.I.S. Everything that affects how the
// assistant listens, thinks and speaks lives here.

export const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

export const MODELS = {
  // Fast non-reasoning model with function calling + built-in web search.
  chat: process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-6-luna',
  // Analyses camera photos (analyze_image tool). Must accept image input.
  vision:
    process.env.EXPO_PUBLIC_OPENAI_VISION_MODEL ||
    process.env.EXPO_PUBLIC_OPENAI_MODEL ||
    'gpt-6-luna',
  // Speech-to-text. The on-device recognizer stands in when this is
  // unreachable (offline, API error, timeout) or no key is set.
  transcribe:
    process.env.EXPO_PUBLIC_OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe',
};

// How long to wait for OpenAI's transcription before falling back to the
// on-device recognizer. Short phrases normally come back in 1–2 s.
export const TRANSCRIBE_TIMEOUT_MS = 8000;

// In standby the on-device recognizer checks this much of each utterance
// for the wake word; only phrases that open with it go to OpenAI. Leaves
// room for pre-roll and fillers («эй, слушай, Джарвис»).
export const WAKE_CHECK_MS = 3000;

// Microphone stream format. 16 kHz mono PCM is what speech models want and
// keeps uploads small.
export const AUDIO_FORMAT = {
  sampleRate: 16000,
  channels: 1,
  encoding: 'int16',
};

// Voice activity detection (energy based, adaptive to room noise).
export const VAD = {
  // Speech must be this many dB above the measured noise floor...
  thresholdAboveFloorDb: 10,
  // ...and never quieter than this absolute level.
  minThresholdDb: -50,
  // Consecutive loud audio needed to count as speech (filters clicks/taps).
  speechStartMs: 200,
  // Silence after speech that ends the utterance.
  speechEndMs: 900,
  // Audio kept from before speech was detected so the first syllable isn't cut.
  preRollMs: 400,
  // Utterances shorter than this are ignored (coughs, door slams).
  minSpeechMs: 350,
  // Hard cap per utterance.
  maxSpeechMs: 30000,
  // Mic is ignored this long after JARVIS stops talking (speaker echo tail).
  echoGuardMs: 350,
};

// Photos for analyze_image. JPEG quality keeps uploads to ~1–2 MB.
export const VISION_PHOTO_QUALITY = 0.5;

// The scanner shoots by itself: it waits settleMs after the camera is ready
// (autofocus + exposure), and gives up if the camera isn't ready in time.
export const VISION_SCAN = { settleMs: 1200, readyTimeoutMs: 8000 };

// After a bare "Jarvis" (or a tap on the core), how long JARVIS waits for
// the command before going back to standby.
export const FOLLOW_UP_WINDOW_MS = 8000;

// After JARVIS answers, the conversation stays open this long: the next
// phrase needs no wake word. Speaking keeps it open; silence closes it.
export const CONVERSATION_WINDOW_MS = 10000;
// Longer when JARVIS ended on a question and is waiting for the answer.
export const CONVERSATION_QUESTION_WINDOW_MS = 15000;

// Spoken forms of the wake word as the on-device recognizer spells them,
// collected from real tests: it blurs or drops the "в" (Джарес, Джарыз,
// Джарвейс), doubles the "р" (Джаррез, Джаррес), mixes alphabets (Джарvс),
// hears "б" (Джабись), "чарл" (Чарлись), "о" (Джорис) or drops the "Дж"
// (Арлис), and in English mangles the name (Jarres, Jovis, Joraus). A vowel
// or "в" must follow the "р" so ordinary words (дерзкий, jersey, jars) don't
// wake JARVIS.
export const WAKE_WORD_PATTERN =
  /^(дж?[аеэ][рp]{1,2}(?:[вv][аеиэыя]?|[аеиэыя])й?[сзш]\S*|дж[аеэ]б[иы]с\S*|ч[аеэ]рл[иеыя]с\S*|ж[аеэ]рв[иеэы][сз]\S*|джор[иеэы][сз]\S*|арл[иеэы]с\S*|j[aeo](?:rr?|rv|v)[aeiouy]{1,2}[sz]\S{0,2}|javis|jarvi|jarvice)$/i;

// Words people put around the wake word that don't make a command on their own.
export const WAKE_FILLERS = new Set([
  'эй',
  'hey',
  'ok',
  'okay',
  'окей',
  'ок',
  'ну',
  'слушай',
  'hi',
  'yo',
  'а',
  'о',
]);

// Context sent with every transcription request. It biases recognition
// towards the assistant's name, spelled in the script of the language spoken
// (a bare "Джарвис. Jarvis." made the model transliterate Russian into Latin
// letters). On silence or noise the model tends to read the prompt back
// verbatim, so it must not look like a command: an earlier prompt made of
// sample commands ("Джарвис, который час?…") got echoed and answered.
// Echoes of this text are dropped in jarvisEngine (see isNoise).
export const TRANSCRIBE_PROMPT =
  'Разговор с голосовым ассистентом Джарвисом (Jarvis) на русском и английском.';

// Things transcription models "hear" in silence or noise.
export const TRANSCRIPT_HALLUCINATIONS = [
  /^продолжение следует/i,
  /субтитр/i,
  /редактор/i,
  /спасибо за просмотр/i,
  /подписывайтесь/i,
  /thanks? (you )?for watching/i,
  /^(you|thank you|bye)\.?$/i,
  /^[.…\s]*$/,
];

// ── On-device speech (sherpa-onnx, see modules/jarvis-speech) ───────────
// Models download once on first launch into the app's files folder.

const MODEL_RELEASES =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download';

// `voice` is the Piper voice name, e.g. 'ru_RU-ruslan-medium'.
const piper = (voice, sizeMb) => ({
  url: `${MODEL_RELEASES}/tts-models/vits-piper-${voice}.tar.bz2`,
  sizeMb,
  exclude: ['MODEL_CARD'],
});

export const SPEECH_MODELS = {
  // Offline speech-to-text, used when OpenAI's transcription is unreachable:
  // NeMo FastConformer transducer, Russian + English (and 8 more European
  // languages), with punctuation.
  stt: {
    url: `${MODEL_RELEASES}/asr-models/sherpa-onnx-nemo-fast-conformer-transducer-be-de-en-es-fr-hr-it-pl-ru-uk-20k-int8.tar.bz2`,
    sizeMb: 101,
    exclude: ['test_wavs/'],
  },
  // Voices (Piper, ~0.1 s per second of speech on a Snapdragon 855). fp32 on
  // purpose: the int8 builds are smaller but slower on CPU.
  'piper-ruslan': piper('ru_RU-ruslan-medium', 64),
  'piper-en-alan': piper('en_GB-alan-medium', 64),
};

export const STT_THREADS = 2;
export const TTS_THREADS = 4;

// `id` picks the model `piper-<id>`; `model` is the .onnx inside it.
export const RUSSIAN_VOICES = [
  { id: 'ruslan', model: 'ru_RU-ruslan-medium', label: 'Ruslan — male' },
];

export const ENGLISH_VOICES = [
  { id: 'en-alan', model: 'en_GB-alan-medium', label: 'Alan — British' },
];

// Russian text is spoken by `ru`, English text by `en`.
export const DEFAULT_VOICE = {
  engine: 'local',
  ru: 'ruslan',
  en: 'en-alan',
};

// Speaking rate for on-device voices (1 = model default).
export const LOCAL_VOICE_SPEED = 1.0;

// Short phrases JARVIS uses when woken without a command.
export const ACK_PHRASES = {
  ru: ['Да, сэр?', 'Слушаю, сэр.', 'К вашим услугам, сэр.'],
  en: ['Yes, sir?', 'At your service, sir.', 'Listening, sir.'],
};

// ── Telegram (TDLib, logged in as the user; see modules/jarvis-telegram) ──
// From https://my.telegram.org → API development tools.
export const TELEGRAM_API_ID = Number(process.env.EXPO_PUBLIC_TG_API_ID) || 0;
export const TELEGRAM_API_HASH = process.env.EXPO_PUBLIC_TG_API_HASH || '';

// How much of Telegram JARVIS reads per request (keeps answers and token
// use small; "read more" asks again with a higher limit).
export const TELEGRAM_READ = {
  chatsScanned: 100, // main-list chats checked for unread messages
  maxUnreadChats: 20, // chats with unread messages listed at once
  defaultMessages: 20,
  maxMessages: 50,
  maxMessageChars: 800, // longer messages are cut
  defaultSearchResults: 10,
  maxSearchResults: 20,
};

// Sending and deleting Telegram messages (deleting is read back and confirmed).
export const TELEGRAM_SEND = {
  draftTtlMs: 2 * 60 * 1000, // a prepared deletion must be confirmed within this time
  deliveryTimeoutMs: 15000, // wait this long for Telegram to confirm delivery
  maxChars: 4096, // Telegram's limit for one text message
  maxDelete: 5, // most of the user's own messages deleted at once
};

// ── Uzum Tezkor food delivery (unofficial API of uzumtezkor.uz) ──
// clientId is the public id the uzumtezkor.uz web app sends with every
// login request; it is not a secret.
export const TEZKOR = {
  baseUrl: 'https://uzumtezkor.uz',
  clientId: '297ce037-13c6-4cb8-9517-1382fb59a75d',
  language: 'ru', // dish and restaurant names come back in this language
  timeoutMs: 15000,
  maxVendors: 6, // restaurants returned per search
  maxDishes: 4, // matching dishes listed per restaurant
  maxMenuItems: 25, // dishes returned from one restaurant's menu
  maxRestaurants: 15, // restaurants returned when listing what is open
  maxDescriptionChars: 100,
};

// Speaking new Telegram messages (watched chats, mentions, private chats).
export const TELEGRAM_ANNOUNCE = {
  batchMs: 4000, // wait this long for more messages before speaking
  minGapMs: 15000, // at least this long between announcements
  retryMs: 3000, // re-check this often while JARVIS is busy
  maxAgeSec: 300, // skip messages older than this (e.g. after reconnecting)
  maxSpokenPerChat: 3, // more than this is announced as a count
  maxChars: 200, // longer messages are cut when spoken
};
