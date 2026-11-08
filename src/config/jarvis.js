// Central tuning knobs for J.A.R.V.I.S. Everything that affects how the
// assistant listens, thinks and speaks lives here.

export const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
export const GITHUB_OWNER = 'az11k-dev';
export const GITHUB_DEFAULT_REPO = 'jarvis-app';

export const MODELS = {
  // Fast non-reasoning model with function calling + built-in web search.
  chat: process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-6-luna',
  // Analyses camera photos (analyze_image tool). Must accept image input.
  vision:
    process.env.EXPO_PUBLIC_OPENAI_VISION_MODEL ||
    process.env.EXPO_PUBLIC_OPENAI_MODEL ||
    'gpt-6-luna',
  // Fallback only, used while the on-device recognizer is still downloading.
  transcribe: 'gpt-4o-mini-transcribe',
};

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
// hears "б" (Джабись) or "чарл" (Чарлись), and in English mangles the name
// (Jarres, Jovis, Joraus). A vowel or "в" must follow the "р" so ordinary
// words (дерзкий, jersey, jars) don't wake JARVIS.
export const WAKE_WORD_PATTERN =
  /^(дж?[аеэ][рp]{1,2}(?:[вv][аеиэыя]?|[аеиэыя])й?[сзш]\S*|дж[аеэ]б[иы]с\S*|ч[аеэ]рл[иеыя]с\S*|ж[аеэ]рв[иеэы][сз]\S*|j[aeo](?:rr?|rv|v)[aeiouy]{1,2}[sz]\S{0,2}|javis|jarvi|jarvice)$/i;

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
  // Speech-to-text: NeMo FastConformer transducer, Russian + English (and 8
  // more European languages), with punctuation.
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
  { id: 'ruslan', model: 'ru_RU-ruslan-medium', label: 'Руслан — мужской' },
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
