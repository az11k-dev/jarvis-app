/**
 * A signal that aborts when `signal` does or after `ms`. `cleanup()` stops
 * the timer and listener. (AbortSignal.any/timeout aren't in Hermes.)
 */
export function withTimeout(signal, ms) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort);
  const timer = ms ? setTimeout(abort, ms) : null;
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}
