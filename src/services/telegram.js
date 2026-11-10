import * as Td from '../../modules/jarvis-telegram';
import { TELEGRAM_API_HASH, TELEGRAM_API_ID } from '../config/jarvis';

/**
 * Telegram as the user's own account. Keeps the login state that the
 * Telegram modal shows, and wraps the TDLib requests JARVIS uses.
 *
 * state.step: 'unavailable' | 'loading' | 'phone' | 'code' | 'password'
 *   | 'ready' | 'unsupported'
 */

export const isConfigured =
  Td.isSupported && TELEGRAM_API_ID > 0 && !!TELEGRAM_API_HASH;

let state = { step: isConfigured ? 'loading' : 'unavailable' };
const listeners = new Set();
let started = false;

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export const getState = () => state;

// Other TDLib updates JS code listens to, by @type. The native side only
// forwards the types listed here.
const updateHandlers = new Map();

/** handler(update) for every TDLib update of `type`; returns unsubscribe. */
export function onTelegramUpdate(type, handler) {
  if (!Td.isSupported) return () => {};
  if (!updateHandlers.has(type)) updateHandlers.set(type, new Set());
  updateHandlers.get(type).add(handler);
  Td.setForwardedUpdates([...updateHandlers.keys()]);
  return () => {
    const handlers = updateHandlers.get(type);
    handlers?.delete(handler);
    if (handlers && !handlers.size) {
      updateHandlers.delete(type);
      Td.setForwardedUpdates([...updateHandlers.keys()]);
    }
  };
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const UNSUPPORTED = {
  authorizationStateWaitEmailAddress:
    'Telegram is asking for an email to sign in. Sign in once in the official app, then try again.',
  authorizationStateWaitEmailCode:
    'Telegram is asking for an email code. Sign in once in the official app, then try again.',
  authorizationStateWaitRegistration:
    'There’s no Telegram account for this number. Sign up in the official app first.',
  authorizationStateWaitOtherDeviceConfirmation:
    'Confirm the sign-in on your other device.',
  authorizationStateWaitPremiumPurchase:
    'Telegram requires Premium to sign in with this number. Sign in in the official app.',
};

async function onAuthState(auth) {
  const type = auth['@type'];
  switch (type) {
    case 'authorizationStateWaitPhoneNumber':
      return setState({ step: 'phone', me: null });
    case 'authorizationStateWaitCode':
      return setState({
        step: 'code',
        codeType: auth.code_info?.type?.['@type'],
      });
    case 'authorizationStateWaitPassword':
      return setState({ step: 'password', passwordHint: auth.password_hint });
    case 'authorizationStateReady': {
      setState({ step: 'ready' });
      try {
        setState({ me: await getMe() });
      } catch (e) {
        console.warn('Telegram getMe failed:', e.message);
      }
      return;
    }
    case 'authorizationStateClosed':
      // After a log out TDLib closes the client; a fresh one asks for the phone.
      setState({ step: 'loading', me: null });
      Td.start(TELEGRAM_API_ID, TELEGRAM_API_HASH);
      return;
    default:
      if (UNSUPPORTED[type]) {
        return setState({ step: 'unsupported', message: UNSUPPORTED[type] });
      }
      return setState({ step: 'loading' });
  }
}

/** Starts TDLib and restores the saved session. Safe to call more than once. */
export async function startTelegram() {
  if (!isConfigured || started) return;
  started = true;
  let sawUpdate = false;
  Td.addUpdateListener((update) => {
    if (update['@type'] === 'updateAuthorizationState') {
      sawUpdate = true;
      onAuthState(update.authorization_state);
      return;
    }
    updateHandlers.get(update['@type'])?.forEach((handler) => handler(update));
  });
  Td.start(TELEGRAM_API_ID, TELEGRAM_API_HASH);
  // The client outlives JS reloads, so its auth update may have gone out
  // before this listener existed. Events and promise results can arrive in
  // either order, so an update always wins over this answer.
  try {
    const auth = await Td.send({ '@type': 'getAuthorizationState' });
    if (!sawUpdate) onAuthState(auth);
  } catch {
    // Not initialised yet; the update will arrive.
  }
}

const ERRORS = [
  [/PHONE_NUMBER_INVALID/, 'Invalid phone number.'],
  [/PHONE_NUMBER_BANNED/, 'This number is banned on Telegram.'],
  [/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/, 'Wrong code.'],
  [/PHONE_CODE_EXPIRED/, 'The code has expired. Request a new one.'],
  [/PASSWORD_HASH_INVALID/, 'Wrong password.'],
  [/retry after (\d+)/i, (m) => `Too many attempts. Wait ${m[1]} s.`],
  [/FLOOD_WAIT_(\d+)/, (m) => `Too many attempts. Wait ${m[1]} s.`],
];

export function errorText(e) {
  // Expo wraps native rejections: "Call to function … → Caused by: <TDLib message>".
  const message = String(e?.message || e)
    .split('Caused by:')
    .pop()
    .trim();
  for (const [pattern, text] of ERRORS) {
    const m = message.match(pattern);
    if (m) return typeof text === 'function' ? text(m) : text;
  }
  return message;
}

async function authStep(request) {
  setState({ busy: true, error: null });
  try {
    await Td.send(request);
  } catch (e) {
    setState({ error: errorText(e) });
  } finally {
    setState({ busy: false });
  }
}

export const submitPhone = (phone) =>
  authStep({
    '@type': 'setAuthenticationPhoneNumber',
    phone_number: phone.replace(/[^\d+]/g, ''),
  });

export const submitCode = (code) =>
  authStep({ '@type': 'checkAuthenticationCode', code: code.trim() });

export const submitPassword = (password) =>
  authStep({ '@type': 'checkAuthenticationPassword', password });

export const resendCode = () =>
  authStep({ '@type': 'resendAuthenticationCode' });

export const logOut = () => authStep({ '@type': 'logOut' });

export const getMe = () => Td.send({ '@type': 'getMe' });

export function displayName(user) {
  if (!user) return '';
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const username = user.usernames?.active_usernames?.[0];
  return username ? `${name} (@${username})` : name;
}
