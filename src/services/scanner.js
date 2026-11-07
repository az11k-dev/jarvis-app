import { Camera } from 'expo-camera';

// Bridge between the analyze_image tool (plain JS, no UI) and the on-screen
// <VisionScanner/>, which owns the camera and takes the shot by itself.

let handler = null;

/** Called by <VisionScanner/> on mount. Returns an unregister function. */
export function setScannerHandler(fn) {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Shows the scanner, waits for focus and takes a photo automatically.
 * Resolves with base64 JPEG, or null if the user cancelled.
 */
export async function scanWithCamera({ facing = 'back', signal } = {}) {
  if (!handler) throw new Error('Scanner is not mounted.');
  const { granted } = await Camera.requestCameraPermissionsAsync();
  if (!granted) throw new Error('No camera access.');
  signal?.throwIfAborted?.();
  return handler({ facing, signal });
}
