import { File, Paths } from 'expo-file-system';
import { DEFAULT_VOICE } from '../config/jarvis';

const DEFAULTS = { voice: DEFAULT_VOICE, micEnabled: true };

const settingsFile = () => new File(Paths.document, 'jarvis-settings.json');

export async function loadSettings() {
  try {
    const file = settingsFile();
    if (!file.exists) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(await file.text()) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings) {
  try {
    await settingsFile().write(JSON.stringify(settings));
  } catch (e) {
    console.warn('Could not save settings:', e);
  }
}
