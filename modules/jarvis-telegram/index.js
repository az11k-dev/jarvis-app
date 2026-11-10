import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Telegram through TDLib (Android), logged in as the user. Requests and
 * results use TDLib's JSON API shape: { '@type': 'getMe' }.
 * See JarvisTelegramModule.kt.
 */
const Native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule('JarvisTelegram')
    : null;

export const isSupported = !!Native;

export const start = (apiId, apiHash) => Native.start(apiId, apiHash);

/** Resolves with the TDLib result object; rejects with TDLib's error message. */
export async function send(request) {
  return JSON.parse(await Native.send(JSON.stringify(request)));
}

/** Update @types to receive besides updateAuthorizationState. */
export const setForwardedUpdates = (types) => Native.setForwardedUpdates(types);

/** listener(update) for every forwarded TDLib update. */
export function addUpdateListener(listener) {
  const sub = Native?.addListener('onUpdate', (e) =>
    listener(JSON.parse(e.json))
  );
  return () => sub?.remove();
}
