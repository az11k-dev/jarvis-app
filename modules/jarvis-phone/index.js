import { PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * The phone itself for JARVIS (Android): contacts, SMS, the call log and
 * calls. See JarvisPhoneModule.kt.
 */
const Native =
  Platform.OS === 'android' ? requireOptionalNativeModule('JarvisPhone') : null;

export const isSupported = !!Native;

const P = PermissionsAndroid.PERMISSIONS;

/** Android permissions behind each kind of access. */
export const PERMISSIONS = {
  contacts: [P.READ_CONTACTS],
  readSms: [P.READ_SMS, P.READ_CONTACTS],
  sendSms: [P.SEND_SMS, P.READ_PHONE_STATE],
  callLog: [P.READ_CALL_LOG, P.READ_CONTACTS],
  call: [P.CALL_PHONE, P.READ_PHONE_STATE],
  manageCalls: [P.ANSWER_PHONE_CALLS, P.READ_PHONE_STATE],
};

export const ALL_PERMISSIONS = [...new Set(Object.values(PERMISSIONS).flat())];

/** Which of `permissions` are still not granted. */
export async function missing(permissions) {
  const checks = await Promise.all(
    permissions.map((p) => PermissionsAndroid.check(p))
  );
  return permissions.filter((_, i) => !checks[i]);
}

/**
 * Asks for the permissions that are missing (the dialog needs the app on
 * screen). Resolves true when all are granted.
 */
export async function request(permissions) {
  if (!Native) return false;
  const needed = await missing(permissions);
  if (!needed.length) return true;
  const result = await PermissionsAndroid.requestMultiple(needed);
  return needed.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** [{ name, numbers: [string] }] — every contact that has a phone number. */
export const contacts = () => Native.contacts();

/** box: 'inbox' | 'sent' | 'all'. Newest first: [{ id, address, body, date, sent, read }]. */
export const readSms = ({
  box = 'inbox',
  limit = 20,
  address = '',
  query = '',
  sinceMs = 0,
} = {}) => Native.readSms(box, limit, address, query, sinceMs);

/** Resolves once the network accepted the message; rejects when it didn't. */
export const sendSms = (number, text) => Native.sendSms(number, text);

/** kind: 'all' | 'missed' | 'incoming' | 'outgoing'. Newest first. */
export const callLog = ({ kind = 'all', limit = 20, number = '' } = {}) =>
  Native.callLog(kind, limit, number);

/** Dials right away (no dialer screen to confirm). */
export const call = (number, speaker = false) => Native.call(number, speaker);

/** Hangs up the current call, or declines a ringing one. */
export const endCall = () => Native.endCall();

/** Picks up a ringing call. */
export const answerCall = () => Native.answerCall();

/** 'idle' | 'ringing' | 'in_call' */
export const callState = () => Native.callState();

/**
 * Encodes 16-bit mono PCM WAV into an OGG/Opus file Telegram plays as a
 * voice message. Resolves with the duration in seconds.
 */
export const encodeVoiceNote = (wavPath, oggPath) =>
  Native.encodeVoiceNote(wavPath, oggPath);

/** `count` frames spread over a video file, as base64 JPEGs. */
export const videoFrames = (path, count, maxSide) =>
  Native.videoFrames(path, count, maxSide);
