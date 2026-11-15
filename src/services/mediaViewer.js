// Bridge between tools (plain JS, no UI) and the on-screen <MediaViewer/>,
// which shows one photo or video over the HUD.

let current = null; // { kind: 'photo' | 'video', uri, title, loop }
const listeners = new Set();

function set(next) {
  current = next;
  listeners.forEach((l) => l());
}

export const mediaViewer = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => current,
  show: (item) => set(item),
  /** Returns whether something was on screen. */
  hide() {
    const wasOpen = !!current;
    if (wasOpen) set(null);
    return wasOpen;
  },
};
