import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as Speech from 'expo-speech';
import * as Background from '../../modules/jarvis-background';
import { VoiceActivityDetector } from '../audio/vad';
import { encodeWav } from '../audio/wav';
import {
  ACK_PHRASES,
  CONVERSATION_QUESTION_WINDOW_MS,
  CONVERSATION_WINDOW_MS,
  FOLLOW_UP_WINDOW_MS,
  OPENAI_API_KEY,
  SOS,
  SOS_CANCEL_PATTERN,
  SOS_START_PATTERN,
  SOS_STOP_PATTERN,
  TRANSCRIBE_PROMPT,
  TRANSCRIBE_TIMEOUT_MS,
  TRANSCRIPT_HALLUCINATIONS,
  VAD,
  WAKE_CHECK_MS,
  WAKE_FILLERS,
  WAKE_WORD_PATTERN,
} from '../config/jarvis';
import { JarvisBrain } from '../services/brain';
import { localSpeech, SpeechNotReadyError } from '../services/localSpeech';
import {
  MissingApiKeyError,
  OpenAIError,
  transcribe,
} from '../services/openai';
import { requestPhoneAccess } from '../services/phone';
import { loadSettings, saveSettings } from '../services/settings';
import {
  isSosActive,
  listSosContacts,
  onSosChange,
  requestLocationAccess,
  startSos,
  stopSos,
} from '../services/sos';
import { cleanForSpeech, voiceOutput } from '../services/voice';
import { discardPending } from '../services/telegramSend';
import { speechLanguage } from '../utils/language';

/**
 * States:
 *  off        – microphone disabled
 *  standby    – only phrases that start with the wake word are handled
 *  listening  – the next phrase is a command, no wake word needed: after a
 *               bare "Jarvis", a tap on the core, or an answer (the
 *               conversation stays open for a few seconds); then standby
 *  thinking   – transcribing / waiting for the model / running tools
 *  speaking   – JARVIS is talking
 *
 * snapshot.sos: 'countdown' (an SOS alert is about to go out: «отмена» or a
 * tap stops it), 'active' (SOS mode is on), or null.
 */

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s-]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * The phrase must open with the wake word (only fillers like «эй», "ok" may
 * come before it). Returns null otherwise, else the words after it minus
 * fillers — an empty array for a bare "Jarvis".
 */
export function parseWakeWord(text) {
  const all = words(text);
  const index = all.findIndex((w) => !WAKE_FILLERS.has(w));
  if (index === -1 || !WAKE_WORD_PATTERN.test(all[index])) return null;
  return all.slice(index + 1).filter((w) => !WAKE_FILLERS.has(w));
}

/** The command without the wake word and fillers, lowercase. */
const commandOf = (text) =>
  (parseWakeWord(text) ?? words(text).filter((w) => !WAKE_FILLERS.has(w))).join(
    ' '
  );

const names = (list) => list.map((c) => c.name).join(', ');

/** What JARVIS says once the alert has gone out. */
function sosReport({ contacts, position }, ru) {
  const reached = contacts.filter((c) => c.sms === true || c.telegram === true);
  const failed = contacts.filter((c) => !reached.includes(c));
  if (!reached.length) {
    return ru
      ? 'Сэр, сигнал SOS не удалось отправить никому. Проверьте связь.'
      : 'Sir, the SOS alert reached no one. Please check the connection.';
  }
  const where = position
    ? ru
      ? 'Местоположение передано.'
      : 'Your location was sent.'
    : ru
      ? 'Местоположение пока не определено, отправлю, как только появится.'
      : 'No location yet; I will send it as soon as I have one.';
  const missed = !failed.length
    ? ''
    : ru
      ? ` Не удалось связаться: ${names(failed)}.`
      : ` I could not reach: ${names(failed)}.`;
  return ru
    ? `Сигнал SOS отправлен: ${names(reached)}. ${where}${missed} Чтобы отключить, скажите: «Джарвис, отбой SOS».`
    : `SOS alert sent to: ${names(reached)}. ${where}${missed} To call it off, say: “Jarvis, cancel SOS”.`;
}

const promptWords = words(TRANSCRIBE_PROMPT).join(' ');

// The transcription model reads its prompt back when it gets silence or
// noise. A run of 3+ words lifted from the prompt is such an echo.
const isPromptEcho = (text) => {
  const w = words(text);
  return w.length >= 3 && promptWords.includes(w.join(' '));
};

const isNoise = (text) =>
  !text ||
  isPromptEcho(text) ||
  TRANSCRIPT_HALLUCINATIONS.some((re) => re.test(text.trim()));

// Status line shown under the core while a tool runs.
const TOOL_ACTIVITY = {
  web_search: 'Searching the web…',
  analyze_image: 'Analyzing…',
  tg_unread_chats: 'Checking Telegram…',
  tg_find_chat: 'Finding the chat…',
  tg_read_messages: 'Reading messages…',
  tg_mark_read: 'Marking as read…',
  tg_search_messages: 'Searching messages…',
  tg_watch_chat: 'Updating settings…',
  tg_announcements: 'Updating settings…',
  tg_remember_chat: 'Remembering…',
  tg_send_message: 'Sending…',
  tg_delete_sent: 'Preparing to delete…',
  tg_confirm_delete: 'Deleting…',
  tg_media: 'Opening the media…',
  contacts_find: 'Checking contacts…',
  sms_read: 'Reading SMS…',
  sms_send: 'Sending SMS…',
  call_log: 'Checking calls…',
  phone_call: 'Preparing the call…',
  phone_end_call: 'Ending the call…',
  phone_answer_call: 'Answering…',
  sos: 'SOS…',
  sos_contacts: 'Updating SOS contacts…',
  reset_conversation: 'Clearing the chat…',
};

// What JARVIS says when a turn fails, by OpenAIError kind: [ru, en].
const FAILURE_SPEECH = {
  key: [
    'Сэр, не найден ключ OpenAI. Добавьте его в файл .env.',
    'Sir, I can’t find the OpenAI key. Please add it to the .env file.',
  ],
  timeout: [
    'Сэр, сервер не ответил вовремя. Повторите, пожалуйста.',
    'Sir, the server took too long to answer. Please say that again.',
  ],
  network: [
    'Сэр, нет связи с сервером. Проверьте интернет и повторите.',
    'Sir, I can’t reach the server. Please check the connection and try again.',
  ],
  auth: [
    'Сэр, ключ OpenAI не принят. Его нужно проверить.',
    'Sir, the OpenAI key was rejected. It needs checking.',
  ],
  quota: [
    'Сэр, на счёте OpenAI закончились средства.',
    'Sir, the OpenAI account has run out of credit.',
  ],
  rate: [
    'Сэр, слишком много запросов. Повторите через минуту.',
    'Sir, too many requests. Please try again in a minute.',
  ],
  server: [
    'Сэр, на стороне OpenAI сбой. Повторите чуть позже.',
    'Sir, OpenAI is having trouble. Please try again shortly.',
  ],
  empty: [
    'Сэр, я не получил ответа. Повторите, пожалуйста.',
    'Sir, I got no answer. Please say that again.',
  ],
  other: [
    'Сэр, произошла ошибка. Повторите, пожалуйста.',
    'Sir, something went wrong. Please say that again.',
  ],
};

function failureKind(e) {
  if (e instanceof MissingApiKeyError) return 'key';
  if (e instanceof OpenAIError && FAILURE_SPEECH[e.kind]) return e.kind;
  if (/network request failed|failed to fetch/i.test(e?.message || '')) {
    return 'network';
  }
  return 'other';
}

let messageId = 0;

export class JarvisEngine {
  brain = new JarvisBrain();
  stream = null;
  listeners = new Set();
  levelListener = null;
  followUpTimer = null;
  listenDeadline = 0; // when the current listening window closes
  turn = 0;
  abort = null;
  busy = false; // an utterance is being processed
  appActive = true;
  disposed = false;
  micFailed = false; // start() was rejected; retry when the app is active
  recorder = null; // (samples, sampleRate) while recordAmbient() runs
  sosPending = false; // the SOS countdown is running (or being announced)
  sosTimer = null;

  snapshot = {
    status: 'off',
    userSpeaking: false,
    messages: [],
    settings: { voice: null, micEnabled: true },
    deviceVoices: [],
    speech: localSpeech.state, // on-device model downloads / readiness
    error: null,
    activity: null,
    sos: null,
  };

  // The language the user last spoke ('ru' | 'en'), for replies made in
  // code — e.g. when the turn fails before there is a transcript.
  lang = 'en';

  constructor() {
    this.vad = new VoiceActivityDetector({
      onLevel: (v) => this.levelListener?.(v),
      onSpeechStart: () => this.handleSpeechStart(),
      onSpeechEnd: (utterance) => this.handleSpeechEnd(utterance),
    });
  }

  // ── store plumbing (for useSyncExternalStore) ─────────────────────────

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  set(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  addMessage(role, text) {
    const messages = [
      ...this.snapshot.messages,
      { id: ++messageId, role, text, at: Date.now() },
    ].slice(-60);
    this.set({ messages });
  }

  get status() {
    return this.snapshot.status;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  setLevelListener(listener) {
    this.levelListener = listener;
  }

  attachStream(stream) {
    this.stream = stream;
  }

  async boot() {
    this.disposed = false;
    const settings = await loadSettings();
    voiceOutput.setVoice(settings.voice);
    this.set({ settings });

    this.unsubscribeSpeech?.();
    this.unsubscribeSpeech = localSpeech.subscribe((speech) =>
      this.set({ speech })
    );
    localSpeech.start(settings.voice);
    localSpeech.preload(settings.voice);

    Speech.getAvailableVoicesAsync()
      .then((voices) =>
        this.set({
          deviceVoices: voices.filter(
            (v) => v.language.startsWith('ru') || v.language.startsWith('en')
          ),
        })
      )
      .catch(() => {});

    if (!OPENAI_API_KEY) {
      this.set({ error: 'EXPO_PUBLIC_OPENAI_API_KEY is not set in .env' });
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      this.set({ error: 'No microphone permission', status: 'off' });
      return;
    }
    // Everything SMS, calls and SOS need is asked for now, with the app on
    // screen, so nothing waits for a dialog when the user talks hands-free.
    // Location comes before the microphone service starts: the service then
    // may get a position in the background too.
    await requestPhoneAccess();
    await requestLocationAccess();
    this.unsubscribeSos?.();
    this.unsubscribeSos = onSosChange((active) => {
      if (!this.sosPending) this.set({ sos: active ? 'active' : null });
    });

    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldRouteThroughEarpiece: false,
      // Keep listening and talking after the user leaves the app.
      allowsBackgroundRecording: true,
      shouldPlayInBackground: true,
    });

    if (settings.micEnabled) await this.startMic('standby');
  }

  dispose() {
    this.disposed = true;
    this.unsubscribeSpeech?.();
    this.unsubscribeSpeech = null;
    this.unsubscribeSos?.();
    this.unsubscribeSos = null;
    clearTimeout(this.sosTimer);
    this.sosPending = false;
    this.cancelTurn();
    this.stopMic();
  }

  async startMic(status) {
    if (!this.stream || this.disposed) return;
    const before = this.status;
    try {
      // The microphone can only be opened while the app is visible; a
      // background service then keeps it open after the user leaves.
      if (!this.stream.isStreaming && this.appActive) {
        await this.stream.start();
        // Fresh audio: forget any half-heard phrase. Not when the stream
        // kept running (e.g. the app just came back to the foreground):
        // that would drop what the user is saying and leave JARVIS stuck
        // in "hearing you" with no end of speech ever reported.
        this.vad.reset();
        this.set({ userSpeaking: false });
      }
      this.micFailed = false;
      // A turn may have moved on while the microphone was opening; putting
      // the old status back would leave JARVIS stuck in it.
      this.set({
        status: this.status === before ? status : this.status,
        error: null,
      });
      if (this.appActive) await this.startBackgroundService();
    } catch (e) {
      console.warn('Mic start failed:', e);
      this.micFailed = true;
      this.set({ status: 'off', error: 'Couldn’t turn on the microphone' });
    }
  }

  stopMic() {
    try {
      this.stream?.stop();
    } catch {
      // already stopped
    }
    this.levelListener?.(0);
    Background.stop().catch(() => {});
  }

  /** Keeps the mic (and JS) alive in the background via a foreground service. */
  async startBackgroundService() {
    if (!Background.isSupported || Background.isRunning()) return;
    try {
      await Background.start({
        title: 'J.A.R.V.I.S.',
        text: 'Listening. Say “Jarvis”, sir.',
        stopLabel: 'Turn off',
      });
    } catch (e) {
      // Usually "app not in the foreground"; retried in setAppActive(true).
      console.warn('Background listening unavailable:', e);
    }
  }

  setAppActive(active) {
    this.appActive = active;
    if (!active) {
      if (Background.isRunning()) return; // keep listening in the background
      // No background service (iOS/web, or it failed) — the OS would cut
      // the mic anyway, so stop cleanly and stop talking.
      this.stopMic();
      voiceOutput.stop();
    } else if (this.status === 'thinking' || this.status === 'speaking') {
      // Back mid-turn, e.g. from the camera during analyze_image: reopen the
      // mic but leave the turn's state alone; it moves on when it finishes.
      this.startMic(this.status);
    } else if (this.status !== 'off') {
      this.startMic(this.status === 'listening' ? 'listening' : 'standby');
    } else if (this.micFailed && this.snapshot.settings.micEnabled) {
      // e.g. ERR_MISSING_ACTIVITY while the activity was being recreated.
      this.startMic('standby');
    }
  }

  // ── user controls ─────────────────────────────────────────────────────

  /** The main orb: wake / interrupt / dismiss. */
  async tap() {
    if (this.sosPending) {
      this.cancelSos();
      return;
    }
    switch (this.status) {
      case 'off':
        await this.setMicEnabled(true);
        this.enterListening();
        break;
      case 'standby':
        if (this.busy) this.cancelTurn(); // drop a pending wake-word check
        this.enterListening();
        break;
      case 'listening':
        this.enterStandby();
        break;
      case 'thinking':
      case 'speaking':
        this.cancelTurn();
        this.enterListening();
        break;
    }
  }

  /**
   * Invoked as the phone's assistant (side/home button hold): always ends up
   * listening for a command, unlike tap(), which toggles.
   */
  async summon() {
    if (this.sosPending) return;
    if (this.status === 'off') await this.setMicEnabled(true);
    if (this.status === 'off') return; // the microphone couldn't start
    if (this.busy || this.status === 'thinking' || this.status === 'speaking') {
      this.cancelTurn();
    }
    this.enterListening();
  }

  async setMicEnabled(enabled) {
    await this.updateSettings({ micEnabled: enabled });
    if (enabled) {
      if (this.status === 'off') await this.startMic('standby');
    } else {
      this.cancelTurn();
      this.clearFollowUp();
      this.stopMic();
      this.set({ status: 'off', userSpeaking: false });
    }
  }

  /** `lang` ('ru' | 'en') picks the language of the spoken preview. */
  async setVoice(voice, lang) {
    voiceOutput.setVoice(voice);
    await this.updateSettings({ voice });
    localSpeech.ensureForVoice(voice);
    const ru = lang ? lang === 'ru' : !!voice.language?.startsWith('ru');
    if (voice.engine === 'local' && localSpeech.supported) {
      // Preview in the new voice itself, not the device fallback, even if
      // it has to download first (progress shows under the core).
      try {
        await localSpeech.ensureVoice(voice, ru ? 'ru' : 'en');
      } catch {
        // download failed: the preview falls back to the device voice
      }
      if (this.snapshot.settings.voice !== voice) return; // picked another
    }
    const previous = await this.say(
      ru ? 'Так лучше, сэр?' : 'How is this, sir?',
      { cacheable: true }
    );
    this.resumeAfterSpeaking(previous);
  }

  async updateSettings(patch) {
    const settings = { ...this.snapshot.settings, ...patch };
    this.set({ settings });
    await saveSettings(settings);
  }

  clearConversation() {
    this.brain.reset();
    this.set({ messages: [] });
  }

  /** Speak something not triggered by the user (e.g. a reminder). */
  /** Nothing going on: waiting for the wake word, not busy, not speaking. */
  isIdle() {
    return !this.disposed && this.status === 'standby' && !this.busy;
  }

  /**
   * Speaks new Telegram messages and goes back to standby: an announcement
   * doesn't open the microphone for commands, the wake word does. `note`
   * (with message ids) goes into the conversation so «Джарвис, ответь ему»
   * knows what "him" is.
   */
  async announceIncoming(text, note) {
    if (!this.isIdle()) return false;
    const turn = ++this.turn;
    this.busy = true;
    this.brain.note(note);
    this.addMessage('jarvis', text);
    try {
      await this.say(text);
    } finally {
      if (turn === this.turn) this.busy = false;
    }
    if (turn === this.turn) this.resumeAfterSpeaking('standby');
    return true;
  }

  async announce(text) {
    this.addMessage('jarvis', text);
    if (this.status === 'thinking' || this.status === 'speaking') return;
    const previous = await this.say(text);
    this.resumeAfterSpeaking(previous);
  }

  // ── state transitions ─────────────────────────────────────────────────

  enterStandby() {
    this.clearFollowUp();
    this.set({ status: 'standby', userSpeaking: false, activity: null });
  }

  enterListening(windowMs = FOLLOW_UP_WINDOW_MS) {
    this.clearFollowUp();
    this.listenDeadline = Date.now() + windowMs;
    this.set({ status: 'listening', userSpeaking: false, activity: null });
    this.followUpTimer = setTimeout(() => {
      if (this.status === 'listening' && !this.snapshot.userSpeaking) {
        this.enterStandby();
      }
    }, windowMs);
  }

  /**
   * Back to listening after a sound that wasn't speech, for whatever is left
   * of the window — so a noisy room can't hold the conversation open.
   */
  resumeListening() {
    const left = this.listenDeadline - Date.now();
    if (left > 0) this.enterListening(left);
    else this.enterStandby();
  }

  clearFollowUp() {
    clearTimeout(this.followUpTimer);
    this.followUpTimer = null;
  }

  cancelTurn() {
    this.turn++;
    // A Telegram deletion whose read-back was cut off must not be confirmable.
    discardPending();
    this.abort?.abort();
    this.abort = null;
    this.busy = false;
    voiceOutput.stop();
  }

  resumeAfterSpeaking(next = 'listening', windowMs) {
    if (this.disposed || this.status === 'off') return;
    this.vad.reset();
    this.vad.ignoreFor(VAD.echoGuardMs);
    if (next !== 'listening') this.enterStandby();
    else this.enterListening(windowMs);
  }

  async say(text, options) {
    const previous = this.status;
    if (previous !== 'off') this.set({ status: 'speaking' });
    await voiceOutput.speak(text, options);
    return previous;
  }

  // ── audio pipeline ────────────────────────────────────────────────────

  handleBuffer = (buffer) => {
    if (this.recorder && buffer.channels === 1) {
      this.recorder(new Int16Array(buffer.data.slice(0)), buffer.sampleRate);
    }
    const status = this.status;
    if ((status !== 'standby' && status !== 'listening') || this.busy) return;
    if (buffer.channels !== 1) return;
    this.vad.process(new Int16Array(buffer.data.slice(0)), buffer.sampleRate);
  };

  handleSpeechStart() {
    // Speech holds the SOS countdown until it is clear what was said.
    if (this.sosPending) clearTimeout(this.sosTimer);
    if (this.status === 'listening') this.clearFollowUp();
    this.set({ userSpeaking: true });
  }

  async handleSpeechEnd(utterance) {
    this.set({ userSpeaking: false });
    if (this.sosPending) return this.hearDuringCountdown(utterance);
    const wasListening = this.status === 'listening';
    if (!utterance) {
      if (wasListening) this.resumeListening();
      return;
    }

    const turn = ++this.turn;
    this.busy = true;
    this.abort = new AbortController();
    const { signal } = this.abort;
    // Whether the user is actually talking to JARVIS (vs. background chatter).
    let engaged = wasListening;

    try {
      let text;
      let heardLocally = null; // what the device heard, when it heard it all
      if (!wasListening && localSpeech.supported) {
        // Standby: look for the wake word on the device first, so speech
        // that isn't for JARVIS (TV, calls, people talking) never leaves
        // the phone. Platforms without the on-device recognizer (iOS)
        // check the cloud transcript instead, below.
        const heard = await this.hearWakeWord(utterance);
        if (turn !== this.turn) return;
        if (!heard) {
          this.busy = false; // not for us
          return;
        }
        engaged = true;
        if (heard.complete) heardLocally = heard.text;
        // A bare "Jarvis" needs no cloud round-trip, nor does anything
        // when there is no OpenAI key (transcribe() would go local anyway).
        if (heard.complete && (heard.bare || !OPENAI_API_KEY)) {
          text = heard.text;
        }
      }
      if (text === undefined) {
        // Background chatter in standby on iOS shouldn't flash "thinking".
        if (engaged)
          this.set({ status: 'thinking', activity: 'Transcribing…' });
        const wav = encodeWav(utterance.chunks, utterance.sampleRate);
        text = await this.transcribe(wav, signal);
      }
      if (turn !== this.turn) return;

      if (this.snapshot.error === 'Can’t reach OpenAI')
        this.set({ error: null });

      // The device heard the wake word but the cloud transcript came back
      // empty: go by what the device heard rather than drop the command.
      if (isNoise(text) && heardLocally) text = heardLocally;

      if (isNoise(text)) {
        this.busy = false;
        if (wasListening) this.resumeListening();
        else if (engaged) this.enterStandby();
        return;
      }

      // If the device already heard the wake word in standby, the phrase is
      // a command even when the cloud transcript misses it. Without the
      // on-device check (iOS), the cloud transcript decides.
      const rest = parseWakeWord(text);
      if (!engaged && !rest) {
        this.busy = false; // not for us
        return;
      }
      engaged = true;
      this.lang = speechLanguage(text, this.lang);
      if (rest?.length === 0) {
        // Just "Jarvis" — acknowledge and listen for the command.
        this.addMessage('user', text);
        const lang = /[a-z]/i.test(text) ? 'en' : 'ru';
        const options = ACK_PHRASES[lang];
        const ack = options[Math.floor(Math.random() * options.length)];
        this.addMessage('jarvis', ack);
        await this.say(ack, { cacheable: true });
        if (turn !== this.turn) return;
        this.busy = false;
        this.resumeAfterSpeaking();
        return;
      }

      await this.converse(text, turn, signal);
    } catch (e) {
      if (turn !== this.turn || signal.aborted) return;
      this.busy = false;
      if (e instanceof SpeechNotReadyError) {
        if (engaged) {
          this.addMessage(
            'error',
            'The speech recognition model is still downloading'
          );
          this.enterStandby();
        }
        return;
      }
      if (!engaged) {
        console.warn('Jarvis turn failed:', e);
        // Don't announce errors for background noise heard in standby.
        this.set({
          error:
            e instanceof MissingApiKeyError
              ? 'EXPO_PUBLIC_OPENAI_API_KEY is not set in .env'
              : 'Can’t reach OpenAI',
        });
        return;
      }
      await this.failTurn(e, turn);
    } finally {
      if (turn === this.turn) {
        this.busy = false;
        this.abort = null;
      }
    }
  }

  /**
   * On-device wake-word check of the first WAKE_CHECK_MS of an utterance
   * (the wake word must open the phrase, and a cap keeps long TV chatter
   * cheap). Null unless it starts with the wake word; else the local text,
   * whether it is a bare "Jarvis", and whether the whole utterance was heard.
   */
  async hearWakeWord({ chunks, sampleRate }) {
    const limit = (WAKE_CHECK_MS / 1000) * sampleRate;
    const head = [];
    let samples = 0;
    for (const chunk of chunks) {
      if (samples >= limit) break;
      head.push(chunk);
      samples += chunk.length;
    }
    const text = await localSpeech.transcribe(encodeWav(head, sampleRate));
    const rest = isNoise(text) ? null : parseWakeWord(text);
    if (!rest) return null;
    return {
      text,
      bare: rest.length === 0,
      complete: head.length === chunks.length,
    };
  }

  /**
   * Speech-to-text with OpenAI (MODELS.transcribe). When it fails or takes
   * too long, or no key is set, the on-device recognizer stands in.
   */
  async transcribe(wav, signal) {
    if (OPENAI_API_KEY) {
      const started = Date.now();
      try {
        const text = await transcribe(wav, {
          signal,
          timeoutMs: TRANSCRIBE_TIMEOUT_MS,
        });
        if (__DEV__) {
          console.log(`[speech] stt cloud ${Date.now() - started}ms: ${text}`);
        }
        return text;
      } catch (e) {
        if (signal.aborted || !localSpeech.sttReady) throw e;
        console.warn('Cloud transcription failed, using on-device:', e.message);
      }
    }
    if (localSpeech.sttReady) return localSpeech.transcribe(wav);
    throw new SpeechNotReadyError();
  }

  /** Runs a typed command as if it had been spoken (dev bridge `?ask=`). */
  async ask(text) {
    this.cancelTurn();
    this.clearFollowUp();
    const turn = ++this.turn;
    this.busy = true;
    this.abort = new AbortController();
    const { signal } = this.abort;
    try {
      await this.converse(text, turn, signal);
    } catch (e) {
      if (turn !== this.turn || signal.aborted) return;
      this.busy = false;
      await this.failTurn(e, turn);
    } finally {
      if (turn === this.turn) {
        this.busy = false;
        this.abort = null;
      }
    }
  }

  /** Says why a turn failed: a command never ends in silence. */
  async failTurn(e, turn) {
    console.warn('Jarvis turn failed:', e);
    this.addMessage('error', e.message);
    this.set({ activity: null });
    const [ru, en] = FAILURE_SPEECH[failureKind(e)];
    await this.say(this.lang === 'ru' ? ru : en);
    if (turn === this.turn) this.resumeAfterSpeaking();
  }

  async converse(text, turn, signal) {
    this.addMessage('user', text);
    // "SOS" alone says nothing about the language: keep the last one.
    this.lang = speechLanguage(text.replace(/s\.?o\.?s\.?/gi, ''), this.lang);
    this.set({ status: 'thinking', activity: 'Thinking…' });

    // «Джарвис, SOS» works without the model (and without the internet).
    const command = commandOf(text);
    if (SOS_START_PATTERN.test(command)) return this.beginSos(turn);
    if (isSosActive() && SOS_STOP_PATTERN.test(command)) {
      return this.endSos(turn);
    }

    const reply = await this.brain.respond(text, {
      signal,
      onToolStart: (name) =>
        this.set({
          activity: TOOL_ACTIVITY[name] || 'Working…',
        }),
    });
    if (turn !== this.turn) return;
    if (reply.sos === 'start') return this.beginSos(turn);

    // "Reset the chat" by voice: same as the RESET button, but JARVIS's
    // confirmation stays on the cleared screen.
    if (reply.resetConversation) this.clearConversation();

    if (reply.text) {
      this.addMessage('jarvis', cleanForSpeech(reply.text));
      this.set({ status: 'speaking', activity: null });
      await voiceOutput.speak(reply.text);
      if (turn !== this.turn) return;
    }

    this.busy = false;
    for (const action of reply.after) {
      try {
        if (action.label) {
          this.set({ status: 'speaking', activity: action.label });
        }
        await action({ signal });
        if (turn !== this.turn) return;
      } catch (e) {
        if (turn !== this.turn) return;
        this.addMessage('error', e.message);
      }
    }
    if (turn !== this.turn) return;

    // Keep the conversation open so the next phrase needs no wake word —
    // unless the user signed off, or JARVIS opened another app (its sound,
    // e.g. a YouTube video, would be taken for the user talking). keepOpen:
    // what ran afterwards has ended (a voice message was played).
    if (reply.endConversation || (reply.after.length && !reply.keepOpen)) {
      this.resumeAfterSpeaking('standby');
    } else {
      const asked = /\?\s*$/.test(reply.text || '');
      this.resumeAfterSpeaking(
        'listening',
        asked ? CONVERSATION_QUESTION_WINDOW_MS : CONVERSATION_WINDOW_MS
      );
    }
  }

  // ── SOS ───────────────────────────────────────────────────────────────

  /** Reply made in code, shown and spoken. */
  async report(ru, en) {
    const text = this.lang === 'ru' ? ru : en;
    this.addMessage('jarvis', text);
    this.set({ activity: null });
    await this.say(text);
  }

  /**
   * Announces the alert and gives a few seconds to stop it: «отмена» or a
   * tap on the core. Silence, or anything else said, sends it.
   */
  async beginSos(turn) {
    if (!(await listSosContacts()).length) {
      await this.report(
        'Сэр, SOS-контакты не заданы. Скажите, например: «добавь папу в SOS-контакты».',
        'Sir, there are no SOS contacts yet. Say, for example: “add my dad to the SOS contacts”.'
      );
      if (turn !== this.turn) return;
      this.busy = false;
      this.resumeAfterSpeaking();
      return;
    }
    this.sosPending = true;
    this.set({ sos: 'countdown' });
    await this.report(
      'Режим SOS. Отправляю сигнал через пять секунд. Скажите «отмена» или коснитесь экрана.',
      'SOS mode. Sending the alert in five seconds. Say “cancel” or tap the screen.'
    );
    if (turn !== this.turn || !this.sosPending) return; // stopped by a tap
    this.busy = false;
    this.clearFollowUp();
    this.vad.reset();
    this.vad.ignoreFor(VAD.echoGuardMs);
    this.set({ status: 'listening', userSpeaking: false, activity: null });
    this.armSos(SOS.countdownMs);
  }

  armSos(ms) {
    clearTimeout(this.sosTimer);
    this.sosTimer = setTimeout(() => this.fireSos(), ms);
  }

  /** Something was said during the countdown: «отмена» stops the alert. */
  async hearDuringCountdown(utterance) {
    if (!utterance) {
      this.armSos(SOS.afterNoiseMs); // a noise, not speech
      return;
    }
    this.busy = true;
    let text = '';
    try {
      const wav = encodeWav(utterance.chunks, utterance.sampleRate);
      // Both recognizers, so a misheard «отмена» is less likely to send
      // a false alarm; on the device alone when there is no connection.
      const heard = await Promise.all([
        localSpeech.sttReady ? localSpeech.transcribe(wav).catch(() => '') : '',
        OPENAI_API_KEY
          ? transcribe(wav, { timeoutMs: SOS.cancelCheckTimeoutMs }).catch(
              () => ''
            )
          : '',
      ]);
      text = heard.join(' | ');
    } catch (e) {
      console.warn('SOS countdown: could not make out the speech:', e.message);
    }
    this.busy = false;
    if (!this.sosPending) return; // stopped by a tap meanwhile
    if (__DEV__) console.log(`[sos] heard during countdown: ${text}`);
    if (SOS_CANCEL_PATTERN.test(text)) this.cancelSos();
    else this.fireSos();
  }

  async cancelSos() {
    clearTimeout(this.sosTimer);
    this.sosPending = false;
    this.cancelTurn();
    this.clearFollowUp();
    this.set({ sos: isSosActive() ? 'active' : null });
    const turn = ++this.turn;
    this.busy = true;
    await this.report('SOS отменён, сэр.', 'SOS cancelled, sir.');
    if (turn !== this.turn) return;
    this.busy = false;
    this.resumeAfterSpeaking('standby');
  }

  /** Sends the alert, says who got it, then records a voice message for them. */
  async fireSos() {
    clearTimeout(this.sosTimer);
    this.sosPending = false;
    this.cancelTurn();
    this.clearFollowUp();
    const turn = ++this.turn;
    this.busy = true;
    this.set({
      status: 'thinking',
      activity: 'Sending SOS…',
      userSpeaking: false,
      sos: 'active',
    });
    let result = null;
    try {
      result = await startSos();
      const ru = this.lang === 'ru';
      const text = sosReport(result, ru);
      this.addMessage('jarvis', text);
      this.set({ activity: null });
      if (turn === this.turn) await this.say(text);
    } catch (e) {
      console.warn('SOS failed:', e);
      this.addMessage('error', e.message);
      if (turn === this.turn) {
        await this.report(
          'Сэр, не удалось отправить сигнал SOS.',
          'Sir, the SOS alert could not be sent.'
        );
      }
    }
    this.set({ sos: isSosActive() ? 'active' : null });
    // What the microphone hears next goes to the contacts as a voice message.
    if (result?.sendVoice) {
      this.recordAmbient(SOS.voiceMs)
        .then(result.sendVoice)
        .catch((e) => console.warn('SOS voice message failed:', e.message));
    }
    if (turn !== this.turn) return;
    this.busy = false;
    this.resumeAfterSpeaking('standby');
  }

  /** «Джарвис, отбой SOS»: stops the alarm and tells the contacts. */
  async endSos(turn) {
    this.set({ status: 'thinking', activity: 'Stopping SOS…' });
    const { contacts = [] } = await stopSos();
    if (turn !== this.turn) return;
    const told = contacts.filter((c) => c.sms === true || c.telegram === true);
    await this.report(
      told.length
        ? 'Режим SOS отключён. Контактам отправлено, что с вами всё в порядке.'
        : 'Режим SOS отключён, сэр.',
      told.length
        ? 'SOS mode is off. Your contacts were told you are all right.'
        : 'SOS mode is off, sir.'
    );
    if (turn !== this.turn) return;
    this.busy = false;
    this.resumeAfterSpeaking('standby');
  }

  /** The next `ms` of microphone audio as WAV bytes (null if the mic is off). */
  recordAmbient(ms) {
    return new Promise((resolve) => {
      const chunks = [];
      let rate = 16000;
      this.recorder = (samples, sampleRate) => {
        chunks.push(samples);
        rate = sampleRate;
      };
      setTimeout(() => {
        this.recorder = null;
        resolve(chunks.length ? encodeWav(chunks, rate) : null);
      }, ms);
    });
  }
}
