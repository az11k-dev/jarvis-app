// Bridge between tools (plain JS, no UI) and the on-screen <TextInputBar/>:
// the text box is hidden until the user asks JARVIS by voice to open it
// («Джарвис, открой ввод текста»), and stays until closed.

let open = false;
const listeners = new Set();

function set(next) {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

export const textInput = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => open,
  show: () => set(true),
  /** Returns whether it was on screen. */
  hide() {
    const wasOpen = open;
    set(false);
    return wasOpen;
  },
};
