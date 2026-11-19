import { AppState } from 'react-native';
import { AudioModule } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { AUDIO_FORMAT } from '../config/jarvis';
import { JarvisEngine } from './jarvisEngine';
import { startAnnouncer } from '../services/telegramAnnounce';
import * as Background from '../../modules/jarvis-background';

/**
 * The JARVIS engine, its microphone stream and its listeners, kept outside
 * React on purpose.
 *
 * Swiping the app out of recents destroys the activity and unmounts the React
 * tree, but the listening foreground service keeps the process and the JS
 * runtime alive. If all of this lived in a hook (as it once did), the
 * unmount cleanup would dispose the engine, release the mic stream and stop
 * the service, so JARVIS went deaf the moment the app was swiped away. As a
 * process-wide singleton it keeps listening, and the screen simply
 * reattaches to it when the app is opened again.
 */
let runtime = null;

export function getJarvisRuntime() {
  if (runtime) return runtime;

  const engine = new JarvisEngine();
  // The same native class useAudioStream() wraps; the hook would release it
  // on unmount. (A native-module property, so eslint can't see it.)
  // eslint-disable-next-line import/namespace
  const stream = new AudioModule.AudioStream({
    sampleRate: AUDIO_FORMAT.sampleRate,
    channels: AUDIO_FORMAT.channels,
    encoding: AUDIO_FORMAT.encoding,
  });
  stream.addListener('audioStreamBuffer', engine.handleBuffer);

  // "Turn off" tapped in the listening notification.
  Background.addStopRequestedListener(() => engine.setMicEnabled(false));

  AppState.addEventListener('change', (next) =>
    engine.setAppActive(next === 'active')
  );

  // New Telegram messages from watched chats, mentions (and private chats
  // if turned on) are spoken while JARVIS is idle.
  startAnnouncer(engine);

  // Reminders fire as notifications; JARVIS reads them out.
  Notifications.addNotificationReceivedListener((n) => {
    const body = n.request.content.body;
    if (body) engine.announce(body);
  });

  // Dev-only: adb test hooks + state logging (see src/dev/debugBridge.js).
  if (__DEV__) require('../dev/debugBridge').attachDebugBridge(engine);

  engine.attachStream(stream);
  engine.boot();

  runtime = { engine, stream };
  return runtime;
}
