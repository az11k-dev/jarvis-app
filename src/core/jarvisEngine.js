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
  TRANSCRIBE_TIMEOUT_MS,
  TRANSCRIPT_HALLUCINATIONS,
  VAD,
  WAKE_CHECK_MS,
  WAKE_FILLERS,
  WAKE_WORD_PATTERN,
} from '../config/jarvis';
import { JarvisBrain } from '../services/brain';
import { localSpeech, SpeechNotReadyError } from '../services/localSpeech';
import { MissingApiKeyError, transcribe } from '../services/openai';
import { loadSettings, saveSettings } from '../services/settings';
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
  reset_conversation: 'Clearing the chat…',
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
  /** Nothing going on: waiting for the wake word, not busy, not speaking. */
  isIdle() {
    return !this.disposed && this.status === 'standby' && !this.busy;
  }

  /**
   * Speaks new Telegram messages, then listens briefly so the user can
   * answer without the wake word. `note` (with message ids) goes into the
   * conversation so «ответь ему» knows what "him" is.
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
    if (turn === this.turn) this.resumeAfterSpeaking('listening');
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
      let text;
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
        if (wasListening) {
          this.addMessage(
            'error',
            'The speech recognition model is still downloading'
          );
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
              ? 'EXPO_PUBLIC_OPENAI_API_KEY is not set in .env'
              : 'Can’t reach OpenAI',
        });
        return;
      }
      const ru = this.lang === 'ru';
      const message =
        e instanceof MissingApiKeyError
          ? ru
            ? 'Сэр, не найден ключ OpenAI. Добавьте его в файл .env.'
            : 'Sir, I can’t find the OpenAI key. Please add it to the .env file.'
          : ru
            ? 'Сэр, возникла проблема со связью. Повторите, пожалуйста.'
            : 'Sir, there’s a connection problem. Please say that again.';
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
      this.addMessage('error', e.message);
      this.resumeAfterSpeaking();
    } finally {
      if (turn === this.turn) {
        this.busy = false;
        this.abort = null;
      }
    }
  }

  async converse(text, turn, signal) {
    this.addMessage('user', text);
    this.set({ status: 'thinking', activity: 'Thinking…' });

    const reply = await this.brain.respond(text, {
      signal,
      onToolStart: (name) =>
        this.set({
          activity: TOOL_ACTIVITY[name] || 'Working…',
        }),
    });
    if (turn !== this.turn) return;

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
