import { File, Paths } from 'expo-file-system';
import {
  DEFAULT_VOICE,
  ENGLISH_VOICES,
  RUSSIAN_VOICES,
} from '../config/jarvis';

const DEFAULTS = { voice: DEFAULT_VOICE, micEnabled: true };

const settingsFile = () => new File(Paths.document, 'jarvis-settings.json');

export async function loadSettings() {
  try {
    const file = settingsFile();
    if (!file.exists) return { ...DEFAULTS };
    const saved = { ...DEFAULTS, ...JSON.parse(await file.text()) };
    return { ...saved, voice: migrateVoice(saved.voice) };
  } catch {
    return { ...DEFAULTS };
  }
}

const known = (voices, id) => voices.some((v) => v.id === id);

// OpenAI voices and the extra on-device voices (Kokoro, other Piper ones)
// were removed; anything no longer offered falls back to the default.
function migrateVoice(voice) {
  if (voice?.engine === 'device') return voice;
  if (voice?.engine !== 'local') return DEFAULT_VOICE;
  return {
    engine: 'local',
    ru: known(RUSSIAN_VOICES, voice.ru) ? voice.ru : DEFAULT_VOICE.ru,
    en: known(ENGLISH_VOICES, voice.en) ? voice.en : DEFAULT_VOICE.en,
  };
}

export async function saveSettings(settings) {
  try {
    await settingsFile().write(JSON.stringify(settings));
  } catch (e) {
    console.warn('Could not save settings:', e);
  }
}
