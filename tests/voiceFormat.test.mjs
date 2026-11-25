import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLanguage } from '../src/services/voiceFormat.js';

test('Russian text is read by the Russian voice', () => {
  assert.equal(voiceLanguage('Сейчас 21:05, сэр.'), 'ru');
});

test('a Russian reply with an English name stays Russian', () => {
  assert.equal(voiceLanguage('Открываю YouTube, сэр.'), 'ru');
});

test('an English reply quoting a Russian word stays English', () => {
  assert.equal(
    voiceLanguage(
      'Got it, sir. You used «там» twice, once in «Как ты там?» and again later.'
    ),
    'en'
  );
});

test('a tie goes to Russian', () => {
  assert.equal(voiceLanguage('Telegram подключён'), 'ru');
});

test('no letters at all is English', () => {
  assert.equal(voiceLanguage('600'), 'en');
  assert.equal(voiceLanguage(''), 'en');
});
