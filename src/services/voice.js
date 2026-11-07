import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { DEFAULT_VOICE } from '../config/jarvis';
import { synthesizeSpeech } from './openai';

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
 * JARVIS's voice. Uses OpenAI neural TTS when available and falls back to
 * the device's speech engine. `speak()` resolves when speech has finished
 * (or was stopped).
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

    if (this.voice.engine === 'openai') {
      try {
        await this.speakNeural(text, cancelled, cacheable);
        return;
      } catch (e) {
        if (cancelled()) return;
        console.warn('Neural TTS failed, using device voice:', e.message);
      }
    }
    if (!cancelled()) await this.speakDevice(text);
  }

  async speakNeural(text, cancelled, cacheable) {
    const voice = this.voice.id;

    if (cacheable) {
      const file = new File(Paths.cache, `say-${voice}-${hash(text)}.mp3`);
      if (!file.exists) await synthesizeSpeech(text, voice, { file });
      if (!cancelled()) await this.play(file.uri);
      return;
    }

    const chunks = chunkForSpeech(text);
    const pending = chunks.map(() => null);
    const synth = (i) => {
      pending[i] ??= synthesizeSpeech(chunks[i], voice);
      // Prefetched chunks may fail before we await them.
      pending[i].catch(() => {});
      return pending[i];
    };

    for (let i = 0; i < chunks.length; i++) {
      const file = await synth(i);
      if (i + 1 < chunks.length) synth(i + 1);
      try {
        if (!cancelled()) await this.play(file.uri);
      } finally {
        safeDelete(file);
      }
      if (cancelled()) {
        pending.slice(i + 1).forEach((p) => p?.then(safeDelete, () => {}));
        return;
      }
    }
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
