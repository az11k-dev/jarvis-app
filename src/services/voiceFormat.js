// Pure helpers for JARVIS's voice (no React Native imports: node tests them).

const CYRILLIC_WORD = /[а-яё]/i;
const LATIN_WORD = /[a-z]/i;

/**
 * Which on-device voice reads `text`: 'ru' (Ruslan) or 'en' (Alan). The
 * alphabet most words are in wins, so an English reply that quotes a
 * Russian word («там») stays with the English voice, and a Russian one with
 * a name in it («Открываю YouTube») stays Russian. A tie goes to Russian.
 */
export function voiceLanguage(text) {
  let ru = 0;
  let en = 0;
  for (const word of String(text || '').split(/[^a-zа-яё]+/i)) {
    if (CYRILLIC_WORD.test(word)) ru++;
    else if (LATIN_WORD.test(word)) en++;
  }
  return ru > 0 && ru >= en ? 'ru' : 'en';
}
