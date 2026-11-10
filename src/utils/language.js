import { WAKE_FILLERS, WAKE_WORD_PATTERN } from '../config/jarvis';

const CYRILLIC = /[а-яё]/i;
const LATIN = /[a-z]/i;

/**
 * The language the user spoke, 'ru' or 'en'. Any Russian word makes it
 * Russian, since Russian commands often contain English names («открой
 * YouTube»). The wake word and fillers before it are skipped: speech
 * recognition may spell "Jarvis" in either alphabet. Returns `fallback`
 * when there are no letters at all.
 */
export function speechLanguage(text, fallback = 'en') {
  const all = String(text || '')
    .toLowerCase()
    .split(/[^a-zа-яё0-9-]+/i)
    .filter(Boolean);
  let start = 0;
  while (start < all.length && WAKE_FILLERS.has(all[start])) start++;
  if (start < all.length && WAKE_WORD_PATTERN.test(all[start])) start++;
  // A bare "Jarvis" still tells which alphabet the user spoke in.
  const rest = start < all.length ? all.slice(start) : all;
  if (rest.some((w) => CYRILLIC.test(w))) return 'ru';
  if (rest.some((w) => LATIN.test(w))) return 'en';
  return fallback;
}
