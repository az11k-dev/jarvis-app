// Central tuning knobs for J.A.R.V.I.S. Everything that affects how the
// assistant listens, thinks and speaks lives here.

export const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
export const GITHUB_TOKEN = process.env.EXPO_PUBLIC_GITHUB_TOKEN_KEY;
export const GITHUB_OWNER = 'az11k-dev';
export const GITHUB_DEFAULT_REPO = 'jarvis-app';

export const MODELS = {
  // Fast non-reasoning model with function calling + built-in web search.
  chat: process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-6-luna',
  transcribe: 'gpt-4o-mini-transcribe',
  tts: 'gpt-4o-mini-tts',
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

// After a bare "Jarvis" (or a tap on the core), how long JARVIS waits for
// the command before going back to standby.
export const FOLLOW_UP_WINDOW_MS = 8000;

// Spoken forms of the wake word as speech-to-text tends to spell them.
export const WAKE_WORD_PATTERN =
  /^(дж?[аеэ]рв[иеэы]с\S*|жарвис\S*|jarvis\S*|jervis\S*|javis|jarvi|jarvice)$/i;

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

export const OPENAI_VOICES = [
  { id: 'onyx', label: 'Onyx — глубокий, спокойный' },
  { id: 'ash', label: 'Ash — чёткий, уверенный' },
  { id: 'echo', label: 'Echo — мягкий' },
  { id: 'fable', label: 'Fable — британский рассказчик' },
  { id: 'sage', label: 'Sage — ровный' },
  { id: 'verse', label: 'Verse — выразительный' },
  { id: 'alloy', label: 'Alloy — нейтральный' },
  { id: 'ballad', label: 'Ballad — тёплый' },
];

export const DEFAULT_VOICE = { engine: 'openai', id: 'onyx' };

export const TTS_INSTRUCTIONS = `
You are J.A.R.V.I.S., a refined British AI butler.
Voice: calm, composed, articulate, quietly confident, with dry understated wit.
Pace: measured and smooth, never rushed; slight warmth when addressing "sir".
If the text is in Russian, speak natural fluent Russian in the same composed manner.
`.trim();

// Short phrases JARVIS uses when woken without a command.
export const ACK_PHRASES = {
  ru: ['Да, сэр?', 'Слушаю, сэр.', 'К вашим услугам, сэр.'],
  en: ['Yes, sir?', 'At your service, sir.', 'Listening, sir.'],
};
