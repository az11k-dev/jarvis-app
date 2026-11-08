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
  TRANSCRIBE_PROMPT,
  TRANSCRIPT_HALLUCINATIONS,
  VAD,
  WAKE_FILLERS,
  WAKE_WORD_PATTERN,
} from '../config/jarvis';
import { JarvisBrain } from '../services/brain';
import { localSpeech, SpeechNotReadyError } from '../services/localSpeech';
import { MissingApiKeyError, transcribe } from '../services/openai';
import { loadSettings, saveSettings } from '../services/settings';
import { cleanForSpeech, voiceOutput } from '../services/voice';

/**
 * States:
 *  off        – microphone disabled
 *  standby    – only phrases that start with the wake word are handled
 *  listening  – the next phrase is a command, no wake word needed: after a
 *               bare "Jarvis", a tap on the core, or an answer (the
 *               conversation stays open for a few seconds); then standby
 *  thinking   – transcribing / waiting for the model / running tools
 *  speaking   – JARVIS is talking
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
  web_search: 'Ищу в сети…',
  analyze_image: 'Анализирую…',
};

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

  snapshot = {
    status: 'off',
    userSpeaking: false,
    messages: [],
    settings: { voice: null, micEnabled: true },
    deviceVoices: [],
    speech: localSpeech.state, // on-device model downloads / readiness
    error: null,
    activity: null,
  };

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
      { id: ++messageId, role, text },
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
      this.set({ error: 'Не задан EXPO_PUBLIC_OPENAI_API_KEY в .env' });
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      this.set({ error: 'Нет доступа к микрофону', status: 'off' });
      return;
    }
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
    this.cancelTurn();
    this.stopMic();
  }

  async startMic(status) {
    if (!this.stream || this.disposed) return;
    try {
      // The microphone can only be opened while the app is visible; a
      // background service then keeps it open after the user leaves.
      if (!this.stream.isStreaming && this.appActive) await this.stream.start();
      this.micFailed = false;
      this.vad.reset();
      this.set({ status, error: null });
      if (this.appActive) await this.startBackgroundService();
    } catch (e) {
      console.warn('Mic start failed:', e);
      this.micFailed = true;
      this.set({ status: 'off', error: 'Не удалось включить микрофон' });
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
        text: 'Слушаю. Скажите «Джарвис», сэр.',
        stopLabel: 'Выключить',
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
    const status = this.status;
    if ((status !== 'standby' && status !== 'listening') || this.busy) return;
    if (buffer.channels !== 1) return;
    this.vad.process(new Int16Array(buffer.data.slice(0)), buffer.sampleRate);
  };

  handleSpeechStart() {
    if (this.status === 'listening') this.clearFollowUp();
    this.set({ userSpeaking: true });
  }

  async handleSpeechEnd(utterance) {
    this.set({ userSpeaking: false });
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
      if (wasListening)
        this.set({ status: 'thinking', activity: 'Распознаю…' });
      const wav = encodeWav(utterance.chunks, utterance.sampleRate);
      const text = await this.transcribe(wav, signal);
      if (turn !== this.turn) return;

      if (this.snapshot.error === 'Нет связи с OpenAI')
        this.set({ error: null });

      if (isNoise(text)) {
        this.busy = false;
        if (wasListening) this.resumeListening();
        return;
      }

      const rest = parseWakeWord(text);
      if (!wasListening && !rest) {
        this.busy = false; // not for us
        return;
      }
      engaged = true;
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
        if (wasListening) {
          this.addMessage('error', 'Модель распознавания речи ещё загружается');
          this.enterStandby();
        }
        return;
      }
      console.warn('Jarvis turn failed:', e);
      if (!engaged) {
        // Don't announce errors for background noise heard in standby.
        this.set({
          error:
            e instanceof MissingApiKeyError
              ? 'Не задан EXPO_PUBLIC_OPENAI_API_KEY в .env'
              : 'Нет связи с OpenAI',
        });
        return;
      }
      const message =
        e instanceof MissingApiKeyError
          ? 'Сэр, не найден ключ OpenAI. Добавьте его в файл .env.'
          : 'Сэр, возникла проблема со связью. Повторите, пожалуйста.';
      this.addMessage('error', e.message);
      await this.say(message);
      if (turn === this.turn) this.resumeAfterSpeaking();
    } finally {
      if (turn === this.turn) {
        this.busy = false;
        this.abort = null;
      }
    }
  }

  /**
   * On-device speech-to-text. Until its model has downloaded, OpenAI's
   * transcription stands in (if a key is configured).
   */
  async transcribe(wav, signal) {
    if (localSpeech.sttReady) return localSpeech.transcribe(wav);
    if (OPENAI_API_KEY) return transcribe(wav, { signal });
    throw new SpeechNotReadyError();
  }

  async converse(text, turn, signal) {
    this.addMessage('user', text);
    this.set({ status: 'thinking', activity: 'Думаю…' });

    const reply = await this.brain.respond(text, {
      signal,
      onToolStart: (name) =>
        this.set({
          activity: TOOL_ACTIVITY[name] || 'Выполняю…',
        }),
    });
    if (turn !== this.turn) return;

    if (reply.text) {
      this.addMessage('jarvis', cleanForSpeech(reply.text));
      this.set({ status: 'speaking', activity: null });
      await voiceOutput.speak(reply.text);
      if (turn !== this.turn) return;
    }

    this.busy = false;
    for (const action of reply.after) {
      try {
        await action();
      } catch (e) {
        this.addMessage('error', e.message);
      }
    }
    if (turn !== this.turn) return;

    // Keep the conversation open so the next phrase needs no wake word —
    // unless the user signed off, or JARVIS opened another app (its sound,
    // e.g. a YouTube video, would be taken for the user talking).
    if (reply.endConversation || reply.after.length) {
      this.resumeAfterSpeaking('standby');
    } else {
      const asked = /\?\s*$/.test(reply.text || '');
      this.resumeAfterSpeaking(
        'listening',
        asked ? CONVERSATION_QUESTION_WINDOW_MS : CONVERSATION_WINDOW_MS
      );
    }
  }
}
