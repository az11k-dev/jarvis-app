import { File, Paths } from 'expo-file-system';
import * as Td from '../../modules/jarvis-telegram';
import { TELEGRAM_ANNOUNCE } from '../config/jarvis';
import { onTelegramUpdate } from './telegram';
import {
  describeMessage,
  getChat,
  isChatMuted,
  requireReady,
  titleOf,
} from './telegramChats';

/**
 * JARVIS speaks new Telegram messages while it is idle: from chats the
 * user asked it to watch, messages that mention the user, and (if turned
 * on) private chats. Messages arriving close together are spoken as one
 * announcement per chat, and announcements are spaced out.
 */

const DEFAULTS = {
  paused: false,
  mentions: true,
  privateChats: false,
  chats: {},
};
let settings = { ...DEFAULTS };
let loaded = null;

const settingsFile = () => new File(Paths.document, 'telegram-announce.json');

function loadSettings() {
  loaded ??= (async () => {
    try {
      const file = settingsFile();
      if (file.exists)
        settings = { ...DEFAULTS, ...JSON.parse(await file.text()) };
    } catch {
      settings = { ...DEFAULTS };
    }
  })();
  return loaded;
}

async function saveSettings() {
  try {
    await settingsFile().write(JSON.stringify(settings));
  } catch (e) {
    console.warn('Could not save Telegram announcement settings:', e);
  }
}

// Tags people put in names, like "Ruslan [UB]" or "Anna (work)", aren't said.
const spokenName = (name) =>
  name.replace(/\s*(\[[^\]]*\]|\([^)]*\))/g, '').trim() || name;

function status() {
  return {
    paused: settings.paused,
    mentions: settings.mentions,
    private_chats: settings.privateChats,
    watched_chats: Object.values(settings.chats).map(spokenName),
  };
}

/** Starts or stops announcing new messages from one chat. */
export async function watchChat(chatId, watch) {
  await requireReady();
  await loadSettings();
  const chat = await getChat(chatId);
  if (watch) settings.chats[chat.id] = titleOf(chat);
  else delete settings.chats[chat.id];
  await saveSettings();
  return {
    status: watch ? 'watching' : 'not_watching',
    chat: titleOf(chat),
    ...(watch &&
      settings.paused && {
        note: 'All announcements are paused, so nothing will be spoken yet. Tell the user and offer to resume.',
      }),
  };
}

/** status | pause | resume | mentions_on/off | private_on/off */
export async function controlAnnouncements(action) {
  await loadSettings();
  const changes = {
    pause: { paused: true },
    resume: { paused: false },
    mentions_on: { mentions: true },
    mentions_off: { mentions: false },
    private_on: { privateChats: true },
    private_off: { privateChats: false },
  };
  if (changes[action]) {
    settings = { ...settings, ...changes[action] };
    await saveSettings();
  }
  return status();
}

const plural = (n, one, few, many) => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

/**
 * One chat's new messages as a spoken line plus a note for the model
 * (with ids, so «ответь ему» can reply to the right message).
 */
async function describeChat(chatId, messages, reason) {
  const chat = await getChat(chatId);
  const title = titleOf(chat);
  const items = (await Promise.all(messages.map(describeMessage))).map((m) => ({
    ...m,
    from: spokenName(m.from),
  }));
  const isPrivate = chat.type?.['@type'] === 'chatTypePrivate';
  const where = isPrivate ? '' : ` в «${spokenName(title)}»`;

  let spoken;
  if (items.length === 1) {
    const [m] = items;
    spoken =
      reason === 'mention' && !isPrivate
        ? `Вас упомянули${where}. ${m.from}: ${m.spoken}`
        : `${m.from}${where}: ${m.spoken}`;
  } else if (items.length <= TELEGRAM_ANNOUNCE.maxSpokenPerChat) {
    spoken =
      `${isPrivate ? items[0].from : `В «${spokenName(title)}»`}: ` +
      items
        .map((m) => (isPrivate ? m.spoken : `${m.from}: ${m.spoken}`))
        .join('. ');
  } else {
    const names = [...new Set(items.map((m) => m.from))].slice(0, 3);
    const n = items.length;
    spoken = `${isPrivate ? `${items[0].from}` : `В «${spokenName(title)}»`}: ${n} ${plural(n, 'новое сообщение', 'новых сообщения', 'новых сообщений')}${isPrivate ? '' : ` от ${names.join(', ')}`}.`;
  }

  const note =
    `«${title}» (chat_id ${chat.id}): ` +
    items.map((m) => `${m.from} (message id ${m.id}): ${m.text}`).join(' | ');
  return { spoken, note };
}

/**
 * Listens for new messages and has the engine speak them when it is idle.
 * Returns a function that stops it.
 */
export function startAnnouncer(engine) {
  loadSettings();
  const pending = new Map(); // chat_id → { messages, reason }
  const botIds = new Map(); // user_id → is a bot (cached)
  let timer = null;
  let lastSpokenAt = 0;
  let stopped = false;

  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };

  async function isBot(userId) {
    if (!botIds.has(userId)) {
      try {
        const u = await Td.send({ '@type': 'getUser', user_id: userId });
        botIds.set(userId, u.type?.['@type'] === 'userTypeBot');
      } catch {
        botIds.set(userId, false);
      }
    }
    return botIds.get(userId);
  }

  // Why a message should be spoken, or null.
  async function reasonFor(m) {
    if (settings.paused || m.is_outgoing) return null;
    if (Date.now() / 1000 - m.date > TELEGRAM_ANNOUNCE.maxAgeSec) return null;
    if (settings.chats[m.chat_id] !== undefined) return 'watched';
    if (settings.mentions && m.contains_unread_mention) return 'mention';
    if (settings.privateChats && m.sender_id?.user_id === m.chat_id) {
      if (await isBot(m.sender_id.user_id)) return null;
      if (await isChatMuted(m.chat_id)) return null;
      return 'private';
    }
    return null;
  }

  const offUpdate = onTelegramUpdate(
    'updateNewMessage',
    async ({ message }) => {
      if (!message) return;
      await loadSettings();
      const reason = await reasonFor(message);
      if (!reason || stopped) return;
      const entry = pending.get(message.chat_id) || { messages: [], reason };
      entry.messages.push(message);
      if (reason === 'watched') entry.reason = reason;
      pending.set(message.chat_id, entry);
      // Wait a moment for the rest of a burst.
      schedule(TELEGRAM_ANNOUNCE.batchMs);
    }
  );

  async function flush() {
    if (stopped || !pending.size) return;
    const waited = Date.now() - lastSpokenAt;
    if (!engine.isIdle() || waited < TELEGRAM_ANNOUNCE.minGapMs) {
      schedule(
        Math.max(TELEGRAM_ANNOUNCE.retryMs, TELEGRAM_ANNOUNCE.minGapMs - waited)
      );
      return;
    }
    const batch = [...pending.entries()];
    pending.clear();
    // Puts messages back (ahead of newer ones) when they couldn't be spoken.
    const restore = () => {
      for (const [chatId, entry] of batch) {
        const newer = pending.get(chatId);
        pending.set(
          chatId,
          newer
            ? { ...newer, messages: [...entry.messages, ...newer.messages] }
            : entry
        );
      }
      schedule(TELEGRAM_ANNOUNCE.retryMs);
    };
    try {
      const parts = await Promise.all(
        batch.map(([chatId, { messages, reason }]) =>
          describeChat(chatId, messages, reason)
        )
      );
      if (stopped) return;
      // The user may have started talking while the messages were looked up.
      const spoken = await engine.announceIncoming(
        parts.map((p) => p.spoken).join(' '),
        `[Announced new Telegram messages] ${parts.map((p) => p.note).join(' || ')}`
      );
      if (spoken) lastSpokenAt = Date.now();
      else restore();
    } catch (e) {
      console.warn('Telegram announcement failed:', e.message);
    }
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    offUpdate();
  };
}
