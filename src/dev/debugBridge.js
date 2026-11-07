import { Linking } from 'react-native';
import * as Speech from 'expo-speech';

/**
 * Dev-only hooks for testing on a real device over adb:
 *   adb shell am start -a android.intent.action.VIEW \
 *     -d 'exp+jarvis-app://debug?speak=Джарвис%2C%20который%20час'
 * makes the phone say the phrase out loud through its speaker, so the
 * microphone hears it exactly like a person talking. Engine state changes
 * are logged to logcat (tag ReactNativeJS) with a [jarvis] prefix;
 * `exp+jarvis-app://debug?telemetry=on` adds per-second mic levels;
 * `?say=<text>` makes JARVIS itself say the text (tests his voice).
 */
export function attachDebugBridge(engine) {
  let last = {};
  const unsubscribe = engine.subscribe(() => {
    const s = engine.getSnapshot();
    if (s.status !== last.status || s.activity !== last.activity) {
      console.log(`[jarvis] status=${s.status} activity=${s.activity ?? '-'}`);
    }
    if (s.userSpeaking !== last.userSpeaking) {
      console.log(`[jarvis] userSpeaking=${s.userSpeaking}`);
    }
    if (s.error !== last.error && s.error)
      console.log(`[jarvis] error=${s.error}`);
    if (s.messages !== last.messages) {
      const added = s.messages.filter(
        (m) => !last.messages?.some((o) => o.id === m.id)
      );
      added.forEach((m) => console.log(`[jarvis] ${m.role}: ${m.text}`));
    }
    last = s;
  });

  // Once a second: buffers received, loudest level, noise floor, threshold.
  const vad = engine.vad;
  const process = vad.process.bind(vad);
  let stats = { n: 0, peak: -Infinity };
  vad.process = (samples, sampleRate) => {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const db = 20 * Math.log10(Math.sqrt(sum / samples.length) / 32768 + 1e-9);
    stats.n++;
    stats.peak = Math.max(stats.peak, db);
    return process(samples, sampleRate);
  };
  let telemetryOn = false;
  const telemetry = setInterval(() => {
    if (!telemetryOn || !stats.n) return;
    console.log(
      `[jarvis] mic buffers=${stats.n} peak=${stats.peak.toFixed(1)}dB ` +
        `floor=${vad.noiseFloorDb?.toFixed(1)} thr=${vad.thresholdDb.toFixed(1)}`
    );
    stats = { n: 0, peak: -Infinity };
  }, 1000);

  const onUrl = ({ url }) => {
    const toggle = /[?&]telemetry=(on|off)/.exec(url || '');
    if (toggle) telemetryOn = toggle[1] === 'on';
    // ?voice=en:en-alan or ?voice=ru:ruslan picks an on-device voice.
    const pick = /[?&]voice=(ru|en):([\w-]+)/.exec(url || '');
    if (pick) {
      const current = engine.getSnapshot().settings?.voice;
      const base = current?.engine === 'local' ? current : {};
      const [, lang, id] = pick;
      console.log(`[jarvis] debug voice: ${lang}=${id}`);
      engine.setVoice({ ...base, engine: 'local', [lang]: id }, lang);
      return;
    }
    const say = /[?&]say=([^&]+)/.exec(url || '');
    if (say) {
      const text = decodeURIComponent(say[1].replace(/\+/g, ' '));
      console.log(`[jarvis] debug say: ${text}`);
      engine.announce(text);
      return;
    }
    const match = /[?&]speak=([^&]+)/.exec(url || '');
    if (!match) return;
    const text = decodeURIComponent(match[1].replace(/\+/g, ' '));
    console.log(`[jarvis] debug speak: ${text}`);
    Speech.speak(text, { language: 'ru-RU', rate: 0.95 });
  };
  const sub = Linking.addEventListener('url', onUrl);

  return () => {
    unsubscribe();
    sub.remove();
    clearInterval(telemetry);
    vad.process = process;
  };
}
