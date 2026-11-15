import * as Phone from '../../modules/jarvis-phone';
import { PHONE } from '../config/jarvis';
import { nameScore, timeLabel } from './telegramChats';

/**
 * SMS, calls and contacts for JARVIS (Android, modules/jarvis-phone).
 * Results are shaped for the model: small, flat, with contact names
 * instead of bare numbers where the phone book knows them.
 */

const WHAT = {
  contacts: 'contacts',
  readSms: 'SMS',
  sendSms: 'sending SMS',
  callLog: 'the call log',
  call: 'phone calls',
  manageCalls: 'managing calls',
};

async function ensure(kind) {
  if (!Phone.isSupported) {
    throw new Error('SMS and calls work only on the Android build.');
  }
  if (!(await Phone.request(Phone.PERMISSIONS[kind]))) {
    throw new Error(
      `No permission for ${WHAT[kind]}. The user must allow it for JARVIS in the phone settings (open the app, then Settings → Apps → JARVIS → Permissions).`
    );
  }
}

/**
 * Asks once, at start-up, for everything the phone tools need, so nothing
 * has to be confirmed on screen later when the user is talking hands-free.
 */
export async function requestPhoneAccess() {
  if (!Phone.isSupported) return;
  try {
    await Phone.request(Phone.ALL_PERMISSIONS);
  } catch (e) {
    console.warn('Phone permissions request failed:', e);
  }
}

// ── contacts ──────────────────────────────────────────────────────────────

// The national number: «+998 90 123-45-67», «901234567» → same key.
const digitsKey = (number) => {
  const digits = String(number || '').replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
};

const isNumber = (text) => /^[+\d][\d\s()\-*#]{2,}$/.test(String(text).trim());

const cleanNumber = (text) => String(text).replace(/[^\d+*#]/g, '');

let book = null; // { at, list, byNumber }

async function phoneBook() {
  if (book && Date.now() - book.at < PHONE.contactsCacheMs) return book;
  if (!(await Phone.request(Phone.PERMISSIONS.contacts))) {
    return { at: 0, list: [], byNumber: new Map() };
  }
  const list = await Phone.contacts();
  const byNumber = new Map();
  for (const c of list) {
    for (const n of c.numbers) byNumber.set(digitsKey(n), c.name);
  }
  book = { at: Date.now(), list, byNumber };
  return book;
}

/** The contact's name for a number, or undefined. */
async function nameFor(number) {
  return (await phoneBook()).byNumber.get(digitsKey(number));
}

/** Contacts matching a spoken name (Cyrillic or Latin, case endings ignored). */
export async function findContacts(name) {
  await ensure('contacts');
  const { list } = await phoneBook();
  const scored = list
    .map((c) => ({ c, score: nameScore(name, c.name) }))
    .filter((m) => m.score > 0);
  if (!scored.length) {
    return {
      matches: [],
      note: 'No contact with that name. It may be saved differently (another language, a nickname: папа = Dadam, Otam, Dad). Try another spelling, or ask the user for the number.',
    };
  }
  const best = Math.max(...scored.map((m) => m.score));
  return {
    matches: scored
      .filter((m) => m.score === best)
      .slice(0, PHONE.maxContactMatches)
      .map((m) => ({ name: m.c.name, numbers: m.c.numbers })),
  };
}

/**
 * Who to text or call: `to` is a phone number or a contact name as said.
 * Returns { number, name } or { error, choices } when it isn't clear.
 */
export async function resolveRecipient(to) {
  const said = String(to || '').trim();
  if (!said) return { error: 'No recipient given.' };
  if (isNumber(said)) {
    const number = cleanNumber(said);
    return { number, name: await nameFor(number) };
  }
  const { matches, note } = await findContacts(said);
  if (!matches.length) return { error: note };
  if (matches.length > 1) {
    return {
      error:
        'Several contacts match. Ask the user which one, then pass that number.',
      choices: matches,
    };
  }
  const [contact] = matches;
  return {
    number: cleanNumber(contact.numbers[0]),
    name: contact.name,
    other_numbers:
      contact.numbers.length > 1 ? contact.numbers.slice(1) : undefined,
  };
}

// ── SMS ───────────────────────────────────────────────────────────────────

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max)}… [cut]` : text;

/**
 * SMS newest first. `from` narrows to one sender: a contact name, a number,
 * or a sender name like «Uzum» / «Click».
 */
export async function readSms({ from, query, box, limit, unreadOnly } = {}) {
  await ensure('readSms');
  const max = Math.min(
    Math.max(1, Number(limit) || PHONE.defaultSms),
    PHONE.maxSms
  );
  let address = String(from || '').trim();
  if (address && !isNumber(address)) {
    // A contact's name becomes their number; anything else is matched
    // against the sender name banks and shops send from.
    const { list } = await phoneBook();
    const scored = list
      .map((c) => ({ c, score: nameScore(address, c.name) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length) address = scored[0].c.numbers[0];
  }
  const rows = await Phone.readSms({
    box: ['inbox', 'sent', 'all'].includes(box) ? box : 'inbox',
    // Unread ones are filtered here, so fetch more than asked.
    limit: unreadOnly ? PHONE.maxSms * 4 : max,
    address,
    query: String(query || ''),
  });
  const messages = [];
  for (const m of rows) {
    if (messages.length >= max) break;
    if (unreadOnly && (m.read || m.sent)) continue;
    const name = await nameFor(m.address);
    messages.push({
      [m.sent ? 'to' : 'from']: name || m.address,
      number: name ? m.address : undefined,
      time: timeLabel(m.date / 1000),
      unread: !m.sent && !m.read ? true : undefined,
      text: clip(m.body, PHONE.maxSmsChars),
    });
  }
  return { found: messages.length, newest_first: true, messages };
}

export async function sendSms({ to, text }) {
  const body = String(text || '').trim();
  if (!body) return { error: 'The message is empty.' };
  if (body.length > PHONE.maxSmsLength) {
    return { error: 'Too long for an SMS. Shorten it.' };
  }
  await ensure('sendSms');
  const recipient = await resolveRecipient(to);
  if (recipient.error) return recipient;
  try {
    await Phone.sendSms(recipient.number, body);
  } catch (e) {
    return { error: `The SMS was not sent: ${nativeMessage(e)}` };
  }
  return {
    status: 'sent',
    to: recipient.name || recipient.number,
    number: recipient.number,
  };
}

// Expo wraps native rejections: "Call to function … → Caused by: <message>".
const nativeMessage = (e) =>
  String(e?.message || e)
    .split('Caused by:')
    .pop()
    .trim();

// ── calls ─────────────────────────────────────────────────────────────────

const durationLabel = (s) =>
  s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;

/** Recent calls newest first. kind: all | missed | incoming | outgoing. */
export async function callLog({ kind, limit, contact } = {}) {
  await ensure('callLog');
  let number = '';
  if (contact) {
    const recipient = await resolveRecipient(contact);
    if (recipient.error) return recipient;
    number = recipient.number;
  }
  const rows = await Phone.callLog({
    kind: ['missed', 'incoming', 'outgoing'].includes(kind) ? kind : 'all',
    limit: Math.min(
      Math.max(1, Number(limit) || PHONE.defaultCalls),
      PHONE.maxCalls
    ),
    number,
  });
  const calls = [];
  for (const c of rows) {
    const name = c.name || (await nameFor(c.number));
    calls.push({
      who: name || c.number || 'hidden number',
      number: name ? c.number : undefined,
      kind: c.kind,
      time: timeLabel(c.date / 1000),
      duration: c.duration ? durationLabel(c.duration) : undefined,
    });
  }
  return { found: calls.length, newest_first: true, calls };
}

/**
 * Prepares a call; `dial()` places it (run after JARVIS has said who it is
 * calling, since the call takes over the speaker and microphone).
 */
export async function prepareCall({ to, speaker }) {
  await ensure('call');
  const recipient = await resolveRecipient(to);
  if (recipient.error) return { output: recipient };
  return {
    output: {
      status: 'calling_right_after_your_reply',
      to: recipient.name || recipient.number,
      number: recipient.number,
      other_numbers: recipient.other_numbers,
    },
    dial: () => Phone.call(recipient.number, speaker !== false),
  };
}

export async function endCall() {
  await ensure('manageCalls');
  const state = await Phone.callState();
  if (state === 'idle') return { status: 'no_call_in_progress' };
  await Phone.endCall();
  return { status: state === 'ringing' ? 'declined' : 'ended' };
}

export async function answerCall() {
  await ensure('manageCalls');
  if ((await Phone.callState()) !== 'ringing') {
    return { status: 'no_incoming_call' };
  }
  await Phone.answerCall();
  return { status: 'answered' };
}

export const callState = () => Phone.callState();

export { digitsKey, nativeMessage };
