import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * JARVIS as the phone's digital assistant (Android): once picked in
 * Settings → Default apps → Digital assistant app, holding the side/home
 * button (or the assistant gesture) summons him.
 */
const Native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule('JarvisAssistant')
    : null;

/**
 * Calls `listener` each time the user invokes the assistant, including the
 * invocation that launched the app (before JS was listening).
 */
export function addAssistListener(listener) {
  if (!Native) return () => {};
  const fire = () => {
    if (Native.consumePendingAssist()) listener();
  };
  const sub = Native.addListener('onAssist', fire);
  fire();
  return () => sub.remove();
}
