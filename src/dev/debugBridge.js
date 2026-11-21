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
 * `?say=<text>` makes JARVIS itself say the text (tests his voice);
 * `?ask=<text>` runs a command as if spoken, skipping speech recognition
 * (`?new&ask=…` starts a fresh conversation first);
 * `?td=<json>` sends a raw TDLib request and logs its result.
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
    if (/[?&]new\b/.test(url || '')) {
      console.log('[jarvis] debug: new conversation');
      engine.clearConversation();
    }
    const ask = /[?&]ask=([^&]+)/.exec(url || '');
    if (ask) {
      const text = decodeURIComponent(ask[1].replace(/\+/g, ' '));
      console.log(`[jarvis] debug ask: ${text}`);
      engine.ask(text);
      return;
    }
    // ?media=<describe|show|play|transcribe>&kind=<photo|video|voice_message>
    // &path=<file on the phone>[&q=<question>] runs the Telegram media
    // action on a local file, for testing without a chat.
    const media = /[?&]media=(\w+)/.exec(url || '');
    if (media) {
      const param = (name) => {
        const m = new RegExp(`[?&]${name}=([^&]+)`).exec(url);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
      };
      const abort = new AbortController();
      require('../services/telegramMedia')
        .actOnFile(
          {
            action: media[1],
            media: { kind: param('kind') },
            path: param('path'),
            question: param('q'),
            title: 'Test',
          },
          { signal: abort.signal }
        )
        .then(async (result) => {
          console.log(`[media] ${JSON.stringify(result.output)}`);
          if (!result.after) return;
          const started = Date.now();
          await result.after({ signal: abort.signal });
          console.log(`[media] after finished in ${Date.now() - started}ms`);
        })
        .catch((e) => console.log(`[media] error: ${e.message}`));
      return;
    }
    // ?announce=<text> speaks it the way a new Telegram message is.
    const announce = /[?&]announce=([^&]+)/.exec(url || '');
    if (announce) {
      const text = decodeURIComponent(announce[1].replace(/\+/g, ' '));
      console.log(`[jarvis] debug announce: ${text}`);
      engine.announceIncoming(
        text,
        `[Announced new Telegram messages] ${text}`
      );
      return;
    }
    // ?voicenote=<seconds> records the microphone and encodes it the way an
    // SOS voice message is, logs the result and plays it back.
    const voicenote = /[?&]voicenote=(\d+)/.exec(url || '');
    if (voicenote) {
      (async () => {
        const { File, Paths } = require('expo-file-system');
        const Phone = require('../../modules/jarvis-phone');
        const wav = new File(Paths.cache, 'debug-voicenote.wav');
        const ogg = new File(Paths.cache, 'debug-voicenote.ogg');
        const bytes = await engine.recordAmbient(Number(voicenote[1]) * 1000);
        if (!bytes) return console.log('[voicenote] the microphone is off');
        await wav.write(bytes);
        const seconds = await Phone.encodeVoiceNote(wav.uri, ogg.uri);
        console.log(
          `[voicenote] ${seconds.toFixed(1)}s wav=${bytes.length}B ogg=${ogg.size}B ${ogg.uri}`
        );
        await require('../services/telegramMedia').playAudio(ogg.uri);
        console.log('[voicenote] played');
      })().catch((e) => console.log(`[voicenote] error: ${e.message}`));
      return;
    }
    // ?screen=<package>[&wait=<s>] logs what the accessibility service sees of a taxi
    // app, one node per line ([screen] x,y wxh flags text | desc #id).
    const screen = /[?&]screen=([^&]+)/.exec(url || '');
    if (screen) {
      // &wait=<s> reads later, so the taxi app can be brought to the front.
      const wait = Number(/[?&]wait=(\d+)/.exec(url)?.[1] || 0);
      new Promise((r) => setTimeout(r, wait * 1000))
        .then(() =>
          require('../../modules/jarvis-screen').dump(
            decodeURIComponent(screen[1])
          )
        )
        .then((nodes) => {
          if (!nodes) return console.log('[screen] service is off');
          console.log(`[screen] ${nodes.length} nodes`);
          for (const n of nodes) {
            const flags = `${n.click ? 'C' : ''}${n.scroll ? 'S' : ''}${n.sel ? '*' : ''}`;
            console.log(
              `[screen] ${'.'.repeat(Math.min(n.depth, 30))}${n.x},${n.y} ${n.w}x${n.h} ${flags} ${n.cls} «${n.text ?? ''}» | ${n.desc ?? ''} #${n.id ?? ''}`
            );
          }
        })
        .catch((e) => console.log(`[screen] error: ${e.message}`));
      return;
    }
    // ?td=<TDLib request as JSON> sends it and logs the result.
    const td = /[?&]td=([^&]+)/.exec(url || '');
    if (td) {
      const request = decodeURIComponent(td[1]);
      require('../../modules/jarvis-telegram')
        .send(JSON.parse(request))
        .then(
          (result) =>
            console.log(`[td] ${JSON.stringify(result).slice(0, 3000)}`),
          (e) => console.log(`[td] error: ${e.message}`)
        );
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
