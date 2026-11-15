import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as Phone from '../../modules/jarvis-phone';
import * as Td from '../../modules/jarvis-telegram';
import { OWNER_NAME, SOS } from '../config/jarvis';
import { digitsKey, nativeMessage, resolveRecipient } from './phone';
import { getState } from './telegram';
import { getChat, titleOf } from './telegramChats';
import { deliver, textContent } from './telegramSend';

/**
 * SOS mode. The user names the people to alert once («добавь папу в SOS
 * контакты»). An alert sends each of them an SMS and a Telegram message
 * with where the user is, a live location in Telegram that keeps updating,
 * and a voice message with what the microphone hears. It stays on until the
 * user calls it off, which tells the contacts all is well.
 */

const file = () => new File(Paths.document, 'sos.json');
let contacts = null; // [{ name, phone, chat_id, telegram }]
let active = null; // { since, position, live: [{ chatId, messageId }], timer }
const listeners = new Set();

const notify = () => listeners.forEach((l) => l(!!active));

/** listener(isActive) whenever SOS mode turns on or off. */
export function onSosChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const isSosActive = () => !!active;

async function load() {
  if (contacts) return contacts;
  try {
    const f = file();
    contacts = f.exists ? JSON.parse(await f.text()).contacts || [] : [];
  } catch {
    contacts = [];
  }
  return contacts;
}

const save = () => file().write(JSON.stringify({ contacts }));

const telegramReady = () => getState().step === 'ready';

const publicContact = (c) => ({
  name: c.name,
  phone: c.phone || undefined,
  telegram: c.telegram || undefined,
});

export async function listSosContacts() {
  return (await load()).map(publicContact);
}

/** The contact's own Telegram chat, found by their phone number. */
async function telegramChatFor(phone) {
  if (!telegramReady() || !phone) return null;
  try {
    const user = await Td.send({
      '@type': 'searchUserByPhoneNumber',
      phone_number: phone,
      only_local: false,
    });
    if (!user?.id) return null;
    return await Td.send({
      '@type': 'createPrivateChat',
      user_id: user.id,
      force: false,
    });
  } catch {
    return null; // not on Telegram, or hides their number
  }
}

/**
 * Adds (or updates) someone to alert. `name` is how the user calls them;
 * the number comes from the phone book unless `phone` is given, and their
 * Telegram chat from the number unless `chatId` is given.
 */
export async function addSosContact({ name, phone, chatId }) {
  const label = String(name || '').trim();
  if (!label) return { error: 'Give the name of the contact.' };
  await load();

  let number = String(phone || '').trim();
  let contactName;
  if (!number) {
    const found = await resolveRecipient(label).catch((e) => ({
      error: e.message,
    }));
    if (found.error && !Number(chatId)) return found;
    number = found.number || '';
    contactName = found.name;
  }
  let chat = null;
  try {
    chat = Number(chatId)
      ? await getChat(Number(chatId))
      : await telegramChatFor(number);
  } catch {
    chat = null;
  }
  if (!number && !chat) {
    return { error: 'Neither a phone number nor a Telegram chat was found.' };
  }

  const entry = {
    name: label,
    phone: number || null,
    chat_id: chat?.id || null,
    telegram: chat ? titleOf(chat) : null,
  };
  const same = (c) =>
    c.name.toLowerCase() === label.toLowerCase() ||
    (number && c.phone && digitsKey(c.phone) === digitsKey(number));
  contacts = [...contacts.filter((c) => !same(c)), entry];
  await save();
  return {
    status: 'added',
    ...publicContact(entry),
    phone_book_name: contactName,
    note: chat
      ? undefined
      : 'No Telegram chat found for them: they will get the SMS only. Pass chat_id (from tg_find_chat) to add Telegram.',
  };
}

export async function removeSosContact(name) {
  const list = await load();
  const key = String(name || '')
    .trim()
    .toLowerCase();
  const left = list.filter(
    (c) =>
      c.name.toLowerCase() !== key &&
      !(c.phone && digitsKey(c.phone) === digitsKey(key) && digitsKey(key))
  );
  if (left.length === list.length) {
    return {
      error: 'No SOS contact with that name.',
      contacts: list.map(publicContact),
    };
  }
  contacts = left;
  await save();
  return { status: 'removed', contacts: left.map(publicContact) };
}

// ── location ──────────────────────────────────────────────────────────────

/** Asked at start-up, so an alert never waits for a permission dialog. */
export async function requestLocationAccess() {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    return granted;
  } catch (e) {
    console.warn('Location permission request failed:', e);
    return false;
  }
}

const toPosition = (p, stale) =>
  p && {
    latitude: p.coords.latitude,
    longitude: p.coords.longitude,
    accuracy: Math.round(p.coords.accuracy || 0),
    at: p.timestamp,
    stale,
  };

/**
 * Where the phone is: a fresh fix if one comes within the timeout, else the
 * last known position (marked stale), else null.
 */
export async function currentPosition(timeoutMs = SOS.locationTimeoutMs) {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted && !(await requestLocationAccess())) return null;
  } catch {
    return null;
  }
  let timer;
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (fresh) return toPosition(fresh, false);
  } catch (e) {
    if (__DEV__) console.log(`[sos] no fresh position: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  try {
    const last = await Location.getLastKnownPositionAsync();
    return toPosition(last, !last || Date.now() - last.timestamp > SOS.freshMs);
  } catch {
    return null;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const mapLink = (p) =>
  `https://maps.google.com/?q=${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;

function alertText(position) {
  if (!position) {
    return `SOS! Это ${OWNER_NAME}. Мне нужна помощь. Местоположение пока не определилось, пришлю, как только появится. Отправлено автоматически.`;
  }
  const when = position.stale
    ? `последнее известное, ${clock(position.at)}`
    : `точность ${position.accuracy} м, ${clock(position.at)}`;
  return `SOS! Это ${OWNER_NAME}. Мне нужна помощь. Я здесь: ${mapLink(position)} (${when}). Отправлено автоматически.`;
}

const locationText = (position) =>
  `SOS, ${OWNER_NAME}: местоположение ${mapLink(position)} (${clock(position.at)}).`;

const ALL_CLEAR = `Отбой тревоги: это ${OWNER_NAME}, со мной всё в порядке.`;

// ── sending ───────────────────────────────────────────────────────────────

const tdLocation = (p) => ({
  '@type': 'location',
  latitude: p.latitude,
  longitude: p.longitude,
  horizontal_accuracy: Math.min(p.accuracy || 0, 1500),
});

async function smsTo(contact, text) {
  if (!contact.phone) return undefined;
  try {
    if (!(await Phone.request(Phone.PERMISSIONS.sendSms))) {
      return 'no SMS permission';
    }
    await Phone.sendSms(contact.phone, text);
    return true;
  } catch (e) {
    return nativeMessage(e);
  }
}

async function telegramTo(contact, text) {
  if (!contact.chat_id) return undefined;
  if (!telegramReady()) return 'Telegram is not connected';
  try {
    await deliver(contact.chat_id, textContent(text), {
      timeoutMs: SOS.telegramTimeoutMs,
    });
    return true;
  } catch (e) {
    return nativeMessage(e);
  }
}

/** A live location message; remembered so it can be updated and stopped. */
async function liveLocationTo(contact, position) {
  if (!contact.chat_id || !telegramReady() || !position) return;
  try {
    const { message } = await deliver(
      contact.chat_id,
      {
        '@type': 'inputMessageLocation',
        location: tdLocation(position),
        live_period: SOS.liveMinutes * 60,
      },
      { timeoutMs: SOS.telegramTimeoutMs }
    );
    if (active && message?.id) {
      active.live.push({ chatId: contact.chat_id, messageId: message.id });
    }
  } catch (e) {
    if (__DEV__) console.log(`[sos] live location failed: ${e.message}`);
  }
}

const everyone = (list, send) => Promise.all(list.map(send));

/**
 * Raises the alarm: SMS and Telegram to every SOS contact with the
 * position, then live location in Telegram. Resolves once the texts are
 * out with { contacts: [{ name, sms, telegram }], position, sendVoice }.
 * `sms` / `telegram` are true, an error text, or undefined (not set up).
 */
export async function startSos() {
  const list = await load();
  if (!list.length) return { error: 'no_contacts' };

  const position = await currentPosition();
  if (active) clearInterval(active.timer);
  active = { since: Date.now(), position, live: [], timer: null };
  notify();

  const text = alertText(position);
  const results = await everyone(list, async (contact) => {
    const [sms, telegram] = await Promise.all([
      smsTo(contact, text),
      telegramTo(contact, text),
    ]);
    return { name: contact.name, sms, telegram };
  });
  if (__DEV__) console.log(`[sos] sent: ${JSON.stringify(results)}`);

  // Not awaited: the user hears that help was called while these go out.
  everyone(list, (contact) => liveLocationTo(contact, position));
  active.timer = setInterval(updatePosition, SOS.updateMs);

  return { contacts: results, position, sendVoice };
}

/** Moves the live locations; sends the position once if the alert had none. */
async function updatePosition() {
  const session = active;
  if (!session) return;
  if (Date.now() - session.since > SOS.liveMinutes * 60000) {
    clearInterval(session.timer);
    return;
  }
  const position = await currentPosition(SOS.updateTimeoutMs);
  if (!position || position.stale || active !== session) return;
  const list = await load();
  if (!session.position || session.position.stale) {
    // The alert went out without a (fresh) position: send it now.
    const text = locationText(position);
    everyone(list, (c) => Promise.all([smsTo(c, text), telegramTo(c, text)]));
    if (!session.live.length)
      everyone(list, (c) => liveLocationTo(c, position));
  }
  session.position = position;
  for (const { chatId, messageId } of session.live) {
    Td.send({
      '@type': 'editMessageLiveLocation',
      chat_id: chatId,
      message_id: messageId,
      location: tdLocation(position),
    }).catch(() => {});
  }
}

/**
 * Sends what the microphone recorded (WAV bytes, 16-bit mono) to the SOS
 * contacts on Telegram as a voice message.
 */
async function sendVoice(wavBytes) {
  const list = (await load()).filter((c) => c.chat_id);
  if (!wavBytes || !list.length || !telegramReady()) return;
  const stamp = Date.now();
  const wav = new File(Paths.cache, `sos-${stamp}.wav`);
  const ogg = new File(Paths.cache, `sos-${stamp}.ogg`);
  try {
    await wav.write(wavBytes);
    let content;
    try {
      const seconds = await Phone.encodeVoiceNote(wav.uri, ogg.uri);
      content = {
        '@type': 'inputMessageVoiceNote',
        voice_note: {
          '@type': 'inputFileLocal',
          path: ogg.uri.replace('file://', ''),
        },
        duration: Math.round(seconds),
      };
    } catch (e) {
      // No Opus encoder on this phone: send the recording as an audio file.
      if (__DEV__)
        console.log(`[sos] voice note encoding failed: ${e.message}`);
      content = {
        '@type': 'inputMessageAudio',
        audio: {
          '@type': 'inputFileLocal',
          path: wav.uri.replace('file://', ''),
        },
        title: 'SOS',
      };
    }
    const sent = await everyone(list, (c) =>
      deliver(c.chat_id, content, { timeoutMs: SOS.voiceTimeoutMs }).then(
        () => true,
        (e) => e.message
      )
    );
    if (__DEV__) console.log(`[sos] voice: ${JSON.stringify(sent)}`);
  } finally {
    for (const f of [wav, ogg]) {
      try {
        if (f.exists) f.delete();
      } catch {
        // cache cleanup is best effort
      }
    }
  }
}

/** Calls the alarm off and tells the contacts all is well. */
export async function stopSos() {
  const session = active;
  if (!session) return { status: 'not_active' };
  clearInterval(session.timer);
  active = null;
  notify();
  for (const { chatId, messageId } of session.live) {
    // No location stops the live location.
    Td.send({
      '@type': 'editMessageLiveLocation',
      chat_id: chatId,
      message_id: messageId,
    }).catch(() => {});
  }
  const list = await load();
  const results = await everyone(list, async (contact) => {
    const [sms, telegram] = await Promise.all([
      smsTo(contact, ALL_CLEAR),
      telegramTo(contact, ALL_CLEAR),
    ]);
    return { name: contact.name, sms, telegram };
  });
  return { status: 'stopped', contacts: results };
}

export function sosStatus() {
  return {
    active: !!active,
    since: active ? clock(active.since) : undefined,
    position_sent: active ? !!active.position : undefined,
  };
}
