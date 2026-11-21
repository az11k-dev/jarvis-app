import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * JARVIS's accessibility service (Android), limited to the taxi apps: read
 * what Yandex Go or WB Taxi shows (classes, prices, addresses) and tap in it.
 * The user turns it on once in Settings → Accessibility → «JARVIS: taxi».
 */
const Native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule('JarvisScreen')
    : null;

export const isAvailable = () => !!Native;

/** Whether the user has turned the service on. */
export const isEnabled = () => !!Native?.isEnabled();

/** Opens Settings → Accessibility so the user can turn it on. */
export const openSettings = () => !!Native?.openSettings();

/**
 * The visible nodes of `pkg`'s windows: { text, desc, id, cls, click,
 * scroll, sel, x, y, w, h, depth } in screen pixels, in tree order. null when
 * the service is off; [] when the app isn't on screen.
 */
export async function dump(pkg) {
  if (!Native) return null;
  return Native.dump(pkg);
}

/** Clicks the node whose text or description is `label`. */
export async function clickLabel(pkg, label) {
  return !!Native && Native.clickLabel(pkg, label);
}

/** Taps the screen at (x, y). */
export async function tap(x, y) {
  return !!Native && Native.tap(x, y);
}

/** Swipes horizontally from x1 to x2 at height y. */
export async function swipe(x1, x2, y) {
  return !!Native && Native.swipe(x1, x2, y);
}

/**
 * Waits `ms` on the native side. Use instead of setTimeout while a taxi app
 * is in front: React Native may pause JS timers in the background.
 */
export async function sleep(ms) {
  if (Native?.sleep) return Native.sleep(Math.round(ms));
  return new Promise((r) => setTimeout(r, ms));
}
