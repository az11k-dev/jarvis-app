import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { DEFAULT_VOICE } from '../config/jarvis';
import { localSpeech } from './localSpeech';

const isRussian = (text) => /[а-яё]/i.test(text);

/** Strips things that sound bad when read aloud. */
export function cleanForSpeech(text) {
  return text
    .replace(/\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, '') // web-search citations
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // markdown links/images
    .replace(/\(\s*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits text so the first sentence can start playing while the rest is
 * still being synthesized.
 */
export function chunkForSpeech(text) {
  const sentences = text.match(/[^.!?…]+[.!?…]+["»)]*\s*|[^.!?…]+$/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    current += s;
    const limit = chunks.length === 0 ? 0 : 280;
    if (current.length > limit) {
      chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function safeDelete(file) {
  try {
    if (file?.exists) file.delete();
  } catch {
    // cache cleanup is best effort
  }
}

/**
 * JARVIS's voice. Speaks with the on-device neural voices (Piper: Ruslan
 * for Russian, Alan for English) and falls back to the device's speech engine
 * for anything they can't say yet (e.g. while a model is downloading).
 * `speak()` resolves when speech has finished (or was stopped).
 */
class VoiceOutput {
  voice = DEFAULT_VOICE;
  generation = 0;
  stopCurrent = null;

  setVoice(voice) {
    this.voice = voice || DEFAULT_VOICE;
  }

  stop() {
    this.generation++;
    this.stopCurrent?.();
    this.stopCurrent = null;
    Speech.stop();
  }

  async speak(rawText, { cacheable = false } = {}) {
    const text = cleanForSpeech(rawText || '');
    if (!text) return;
    this.stop();
    const generation = this.generation;
    const cancelled = () => generation !== this.generation;

    if (this.voice.engine === 'local' && localSpeech.supported) {
      await this.speakLocal(text, cancelled, cacheable);
    } else {
      await this.speakDevice(text);
    }
  }

  /**
   * Sentence by sentence: the next chunk is synthesized while the current
   * one plays. A chunk the local voices can't produce goes to the device
   * voice instead.
   */
  async speakLocal(text, cancelled, cacheable) {
    const chunks = cacheable ? [text] : chunkForSpeech(text);
    const pending = [];
    const synth = (i) =>
      (pending[i] ??= this.synthLocal(chunks[i], cacheable).then(
        (file) => ({ file }),
        (error) => ({ error })
      ));
    const discard = (result) => {
      if (!cacheable) safeDelete(result?.file);
    };

    for (let i = 0; i < chunks.length; i++) {
      const result = await synth(i);
      if (i + 1 < chunks.length) synth(i + 1);
      try {
        if (cancelled()) break;
        if (result.error) {
          console.warn(
            'Local voice failed, using device voice:',
            result.error.message
          );
          await this.speakDevice(chunks[i]);
        } else {
          await this.play(result.file.uri);
        }
      } finally {
        discard(result);
      }
      if (cancelled()) break;
    }
    // Clean up chunks synthesized ahead that will never play.
    pending.slice(1).forEach((p) => p?.then(discard));
  }

  async synthLocal(chunk, cacheable) {
    const lang = isRussian(chunk) ? 'ru' : 'en';
    const voiceId = lang === 'ru' ? this.voice.ru : this.voice.en;
    const file = cacheable
      ? new File(Paths.cache, `say-${voiceId}-${hash(chunk)}.wav`)
      : new File(
          Paths.cache,
          `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
        );
    if (cacheable && file.exists) return file;
    return localSpeech.synthesize(chunk, this.voice, lang, file);
  }

  play(uri) {
    return new Promise((resolve) => {
      const player = createAudioPlayer({ uri });
      let finished = false;
      let watchdog;
      let watchdogArmed = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        sub.remove();
        try {
          player.pause();
          player.remove();
        } catch {
          // already released
        }
        if (this.stopCurrent === finish) this.stopCurrent = null;
        resolve();
      };
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finish();
        // Re-arm the watchdog once the real duration is known.
        if (status.isLoaded && status.duration > 0 && !watchdogArmed) {
          watchdogArmed = true;
          clearTimeout(watchdog);
          watchdog = setTimeout(finish, status.duration * 1000 + 3000);
        }
      });
      watchdog = setTimeout(finish, 60000);
      this.stopCurrent = finish;
      player.play();
    });
  }

  speakDevice(text) {
    return new Promise((resolve) => {
      const ru = isRussian(text);
      const custom = this.voice.engine === 'device' ? this.voice : null;
      const sameLanguage =
        custom && custom.language?.startsWith(ru ? 'ru' : 'en');
      Speech.speak(text, {
        language: ru ? 'ru-RU' : 'en-US',
        voice: sameLanguage ? custom.id : undefined,
        rate: 0.95,
        pitch: 1.0,
        onDone: resolve,
        onStopped: resolve,
        onError: resolve,
      });
      this.stopCurrent = resolve;
    });
  }
}

export const voiceOutput = new VoiceOutput();
