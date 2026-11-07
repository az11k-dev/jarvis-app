import { AppRegistry, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Keeps JARVIS listening while the app is in the background (Android).
 *
 * Starts a `microphone` foreground service with an ongoing notification, so
 * Android keeps delivering microphone audio and keeps the JS runtime awake.
 */
const Native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule('JarvisBackground')
    : null;

// The native side runs this headless task while the service is up; React
// Native keeps JS timers ticking in the background only while a task is
// active. The native module finishes it, so the promise never needs to settle.
AppRegistry.registerHeadlessTask(
  'JarvisKeepAlive',
  () => () => new Promise(() => {})
);

export const isSupported = !!Native;

export async function start({ title, text, stopLabel }) {
  if (!Native) return;
  await Native.start(title, text, stopLabel);
}

export async function stop() {
  if (!Native) return;
  await Native.stop();
}

export const isRunning = () => !!Native?.isRunning();

/** "Stop" tapped in the notification. */
export function addStopRequestedListener(listener) {
  const sub = Native?.addListener('onStopRequested', listener);
  return () => sub?.remove();
}

/** The service couldn't enter the foreground (e.g. the app wasn't visible). */
export function addStartFailedListener(listener) {
  const sub = Native?.addListener('onStartFailed', listener);
  return () => sub?.remove();
}
