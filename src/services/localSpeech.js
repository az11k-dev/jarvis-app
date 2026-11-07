import { File, Paths } from 'expo-file-system';
import * as Native from '../../modules/jarvis-speech';
import {
  DEFAULT_VOICE,
  ENGLISH_VOICES,
  LOCAL_VOICE_SPEED,
  RUSSIAN_VOICES,
  SPEECH_MODELS,
  STT_THREADS,
  TTS_THREADS,
} from '../config/jarvis';

export class SpeechNotReadyError extends Error {
  constructor() {
    super('On-device speech recognition is still downloading');
  }
}

const RETRY_DOWNLOAD_MS = 60 * 1000;

const pathOf = (file) => decodeURIComponent(file.uri.replace(/^file:\/\//, ''));

const VOICES = { ru: RUSSIAN_VOICES, en: ENGLISH_VOICES };

/** The on-device voice `voice` uses for `lang`, or the default one. */
const voiceFor = (voice, lang) =>
  VOICES[lang].find((v) => v.id === voice?.[lang]) ||
  VOICES[lang].find((v) => v.id === DEFAULT_VOICE[lang]);

const log = (...args) => {
  if (__DEV__) console.log('[speech]', ...args);
};

/**
 * On-device speech: downloads the models JARVIS needs (one at a time, in
 * the background), runs speech-to-text and synthesizes speech to WAV files.
 *
 * Memory: the recognizer and both voices stay loaded (~700 MB PSS in all on
 * a Snapdragon 855): the recognizer hears every phrase in standby and the
 * voices are small.
 */
class LocalSpeech {
  supported = Native.isSupported;
  installed = new Set();
  listeners = new Set();
  pending = new Map(); // model id -> download promise
  queue = Promise.resolve();
  voices = new Map(); // voice key -> load promise
  retryTimer = null;
  started = false;

  state = {
    downloading: null, // model id being downloaded
    progress: 0, // 0..1 of the current download
    error: null,
    sttReady: false,
    installed: [],
  };

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  get sttReady() {
    return this.state.sttReady;
  }

  /** Call once at startup with the saved voice. */
  start(voice) {
    if (!this.supported) return;
    if (!this.started) {
      this.started = true;
      this.removeUnusedModels();
      this.installed = new Set(Native.installedModels());
      this.set({ installed: [...this.installed] });
      Native.addDownloadProgressListener(({ id, received, total }) => {
        if (id === this.state.downloading && total > 0) {
          this.set({ progress: received / total });
        }
      });
      if (this.installed.has('stt')) this.loadRecognizer();
    }
    this.ensureForVoice(voice);
  }

  /** Downloads (in the background) everything `voice` and STT need. */
  ensureForVoice(voice) {
    if (!this.supported) return;
    this.lastVoice = voice;
    const ids = ['stt'];
    if (voice?.engine === 'local') {
      ids.push(this.voiceSpec(voice, 'ru').modelId);
      ids.push(this.voiceSpec(voice, 'en').modelId);
    }
    ids.forEach((id) => this.ensure(id).catch(() => {}));
  }

  /** Deletes downloaded models the app no longer uses (e.g. old voices). */
  removeUnusedModels() {
    for (const id of Native.installedModels()) {
      if (SPEECH_MODELS[id]) continue;
      log(`deleting unused model ${id}`);
      Native.deleteModel(id).catch((e) =>
        console.warn(`Could not delete speech model ${id}:`, e.message)
      );
    }
  }

  isInstalled(id) {
    return this.installed.has(id);
  }

  ensure(id) {
    if (this.installed.has(id)) return Promise.resolve();
    if (!this.pending.has(id)) {
      // One download at a time, in the order they were asked for.
      const job = (this.queue = this.queue
        .catch(() => {})
        .then(() => this.download(id)));
      this.pending.set(id, job);
      job.catch(() => this.pending.delete(id));
    }
    return this.pending.get(id);
  }

  async download(id) {
    if (this.installed.has(id)) return;
    const model = SPEECH_MODELS[id];
    if (!model) throw new Error(`Unknown speech model ${id}`);
    this.set({ downloading: id, progress: 0, error: null });
    const started = Date.now();
    try {
      await Native.downloadModel(id, model.url, model.exclude);
    } catch (e) {
      console.warn(`Speech model ${id} download failed:`, e.message);
      this.set({ downloading: null, error: e.message });
      this.scheduleRetry();
      throw e;
    }
    log(`downloaded ${id} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    this.installed.add(id);
    this.pending.delete(id);
    this.set({ downloading: null, installed: [...this.installed] });
    if (id === 'stt') await this.loadRecognizer();
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.set({ error: null });
      this.ensureForVoice(this.lastVoice);
    }, RETRY_DOWNLOAD_MS);
  }

  dir(id) {
    return `${Native.modelsDir()}/${id}`;
  }

  // ── speech-to-text ────────────────────────────────────────────────────

  async loadRecognizer() {
    try {
      const started = Date.now();
      await Native.loadRecognizer(this.dir('stt'), STT_THREADS);
      log(`recognizer loaded in ${Date.now() - started}ms`);
      this.set({ sttReady: true });
    } catch (e) {
      console.warn('Speech recognizer failed to load:', e.message);
      this.set({ error: e.message });
    }
  }

  /** WAV bytes (16-bit mono) -> text. */
  async transcribe(wavBytes) {
    if (!this.state.sttReady) throw new SpeechNotReadyError();
    const file = new File(
      Paths.cache,
      `stt-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
    );
    try {
      await file.write(wavBytes);
      const started = Date.now();
      const text = await Native.transcribe(pathOf(file));
      const seconds = (wavBytes.length - 44) / 2 / 16000;
      log(`stt ${Date.now() - started}ms for ~${seconds.toFixed(1)}s: ${text}`);
      return text;
    } finally {
      try {
        file.delete();
      } catch {
        // best effort
      }
    }
  }

  // ── text-to-speech ────────────────────────────────────────────────────

  voiceSpec(voice, lang) {
    const { id, model } = voiceFor(voice, lang);
    const modelId = `piper-${id}`;
    const dir = this.dir(modelId);
    return {
      key: modelId,
      modelId,
      lang,
      files: {
        model: `${dir}/${model}.onnx`,
        tokens: `${dir}/tokens.txt`,
        dataDir: `${dir}/espeak-ng-data`,
      },
    };
  }

  /** Resolves once the model for `voice` in `lang` is downloaded. */
  ensureVoice(voice, lang) {
    return this.ensure(this.voiceSpec(voice, lang).modelId);
  }

  canSpeak(voice, lang) {
    return (
      this.supported && this.installed.has(this.voiceSpec(voice, lang).modelId)
    );
  }

  loadVoice(spec) {
    for (const [key, loaded] of this.voices) {
      // Keep one voice per language in memory.
      if (key !== spec.key && loaded.lang === spec.lang) this.unloadVoice(key);
    }
    if (!this.voices.has(spec.key)) {
      const started = Date.now();
      const promise = Native.loadVoice(spec.key, spec.files, TTS_THREADS).then(
        () => log(`voice ${spec.key} loaded in ${Date.now() - started}ms`)
      );
      promise.lang = spec.lang;
      promise.catch(() => this.voices.delete(spec.key));
      this.voices.set(spec.key, promise);
    }
    return this.voices.get(spec.key);
  }

  unloadVoice(key) {
    this.voices.delete(key);
    Native.unloadVoice(key).catch(() => {});
    log(`voice ${key} unloaded`);
  }

  /** Loads the downloaded voices ahead of time so the first reply is quick. */
  preload(voice) {
    if (voice?.engine !== 'local') return;
    for (const lang of ['ru', 'en']) {
      if (this.canSpeak(voice, lang)) {
        this.loadVoice(this.voiceSpec(voice, lang)).catch(() => {});
      }
    }
  }

  /** Synthesizes `text` into the WAV `file` with the voice for `lang`. */
  async synthesize(text, voice, lang, file) {
    const spec = this.voiceSpec(voice, lang);
    if (!this.installed.has(spec.modelId)) {
      throw new Error(`Voice model ${spec.modelId} is not downloaded yet`);
    }
    await this.loadVoice(spec);
    const started = Date.now();
    const { duration } = await Native.synthesize(
      spec.key,
      text,
      0, // speaker id: Piper voices have one speaker
      LOCAL_VOICE_SPEED,
      pathOf(file)
    );
    log(
      `tts ${spec.key} ${Date.now() - started}ms for ${duration.toFixed(1)}s audio`
    );
    return file;
  }
}

export const localSpeech = new LocalSpeech();
