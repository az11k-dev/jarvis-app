import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * On-device speech (Android): model downloads, speech-to-text and
 * text-to-speech through sherpa-onnx. See JarvisSpeechModule.kt.
 */
const Native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule('JarvisSpeech')
    : null;

export const isSupported = !!Native;

export const modelsDir = () => Native?.modelsDir() ?? null;

export const installedModels = () => Native?.installedModels() ?? [];

export const downloadModel = (id, url, exclude = []) =>
  Native.downloadModel(id, url, exclude);

export const deleteModel = (id) => Native.deleteModel(id);

export const loadRecognizer = (dir, numThreads) =>
  Native.loadRecognizer(dir, numThreads);

export const transcribe = (wavPath) => Native.transcribe(wavPath);

export const loadVoice = (key, files, numThreads) =>
  Native.loadVoice(key, files, numThreads);

export const unloadVoice = (key) => Native.unloadVoice(key);

/** Resolves to { duration, sampleRate }. */
export const synthesize = (key, text, sid, speed, outPath) =>
  Native.synthesize(key, text, sid, speed, outPath);

/** listener({ id, received, total }) while a model downloads. */
export function addDownloadProgressListener(listener) {
  const sub = Native?.addListener('onDownloadProgress', listener);
  return () => sub?.remove();
}
