import { File, Paths } from 'expo-file-system';
import * as Td from '../../modules/jarvis-telegram';
import { TELEGRAM_READ } from '../config/jarvis';
import { getState } from './telegram';

/**
 * Reading Telegram for JARVIS: which chats have unread messages, finding a
 * chat by name, reading its messages as plain text, marking it read.
 * Results are shaped for the model: small, flat, no TDLib internals.
 */

class TelegramNotReadyError extends Error {
  constructor() {
    super(
      'Telegram is not connected. The user must log in once via the Telegram button in the app.'
    );
  }
}

// The user's own Telegram id; filled by requireReady().
let myId = null;

export async function requireReady() {
  if (getState().step !== 'ready') throw new TelegramNotReadyError();
  if (!myId)
    myId = getState().me?.id ?? (await Td.send({ '@type': 'getMe' })).id;
}

const send = (request) => Td.send(request);

// ── chats ─────────────────────────────────────────────────────────────────

function chatKind(chat) {
  switch (chat.type?.['@type']) {
    case 'chatTypePrivate':
    case 'chatTypeSecret':
      return 'private';
    case 'chatTypeBasicGroup':
      return 'group';
    case 'chatTypeSupergroup':
      return chat.type.is_channel ? 'channel' : 'group';
    default:
      return 'other';
  }
}

const SCOPE = {
  private: 'notificationSettingsScopePrivateChats',
  group: 'notificationSettingsScopeGroupChats',
  channel: 'notificationSettingsScopeChannelChats',
};
const scopeMuteFor = new Map(); // scope → mute_for, cached per app run

async function isMuted(chat) {
  const settings = chat.notification_settings;
  if (settings && !settings.use_default_mute_for) return settings.mute_for > 0;
  const scope = SCOPE[chatKind(chat)];
  if (!scope) return false;
  if (!scopeMuteFor.has(scope)) {
    try {
      const s = await send({
        '@type': 'getScopeNotificationSettings',
        scope: { '@type': scope },
      });
      scopeMuteFor.set(scope, s.mute_for || 0);
    } catch {
      scopeMuteFor.set(scope, 0);
    }
  }
  return scopeMuteFor.get(scope) > 0;
}

export const getChat = (chatId) =>
  send({ '@type': 'getChat', chat_id: chatId });

// TDLib titles the chat with yourself with your own name; the apps call it
// Saved Messages («Избранное»).
const SAVED_TITLE = 'Saved Messages (Избранное)';
// Matches inflected forms too: «в избранном», «сохранённые», "Saved Messages".
const SAVED_NAME = /^(избранн|сохранен|saved\b)/;

const isSaved = (chat) =>
  chat.type?.['@type'] === 'chatTypePrivate' && chat.type.user_id === myId;

export const titleOf = (chat) =>
  isSaved(chat) ? SAVED_TITLE : chat.title || 'Deleted account';

/** Chats of the main list in Telegram's order (pinned, then most recent). */
async function mainChats(limit) {
  const { chat_ids = [] } = await send({
    '@type': 'getChats',
    chat_list: { '@type': 'chatListMain' },
    limit,
  });
  return Promise.all(chat_ids.map(getChat));
}

async function chatSummary(chat) {
  return {
    chat_id: chat.id,
    title: titleOf(chat),
    kind: chatKind(chat),
    unread: chat.unread_count,
    mentions: chat.unread_mention_count || undefined,
    muted: (await isMuted(chat)) || undefined,
  };
}

/** Chats with unread messages, not muted first. */
export async function unreadChats() {
  await requireReady();
  const chats = await mainChats(TELEGRAM_READ.chatsScanned);
  const unread = chats.filter(
    (c) => c.unread_count > 0 || c.is_marked_as_unread
  );
  const summaries = await Promise.all(unread.map(chatSummary));
  summaries.sort((a, b) => !!a.muted - !!b.muted);
  return {
    chats: summaries.slice(0, TELEGRAM_READ.maxUnreadChats),
    total_chats_with_unread: summaries.length,
  };
}

// ── names the user gives chats («рабочая группа») ─────────────────────────

const aliasFile = () => new File(Paths.document, 'telegram-aliases.json');
let aliases = null; // { normalized alias: { alias, chat_id, title } }

// Lowercase words only: «Ruslan Aka [UB]» → "ruslan aka ub".
const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-яўқғҳ]+/g, ' ')
    .trim();

const CYR_TO_LAT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 's',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ў: 'o',
  қ: 'q',
  ғ: 'g',
  ҳ: 'h',
};

// One spelling for Cyrillic and Latin names: «Руслан ака» and "Ruslan Aka"
// both become "ruslan aka".
const nameKey = (s) =>
  normalize(s)
    .replace(/[а-яўқғҳ]/g, (c) => CYR_TO_LAT[c] ?? c)
    .replace(/kh/g, 'x')
    .replace(/zh/g, 'j')
    .replace(/ts/g, 's')
    // х is x in Uzbek Latin but h in most spellings: Мухаммад = Muhammad.
    .replace(/x/g, 'h');

// A spoken word matches a title word when it starts it («рус» → Ruslan) or
// is it with a short case ending («Руслана» → Ruslan).
const wordMatches = (spoken, word) =>
  word.startsWith(spoken) ||
  (word.length >= 3 &&
    spoken.startsWith(word) &&
    spoken.length - word.length <= 2);

/**
 * 3 exact, 2 every spoken word matches a title word, 1 matches with the
 * spaces dropped (speech recognition merges words: «Русланака»), 0 no match.
 */
function nameScore(spoken, title) {
  const q = nameKey(spoken);
  const t = nameKey(title);
  if (!q || !t) return 0;
  if (q === t) return 3;
  const words = t.split(' ');
  if (q.split(' ').every((w) => words.some((x) => wordMatches(w, x)))) {
    return 2;
  }
  const solid = q.replace(/ /g, '');
  return solid.length >= 4 && t.replace(/ /g, '').startsWith(solid) ? 1 : 0;
}

async function loadAliases() {
  if (aliases) return aliases;
  try {
    const file = aliasFile();
    aliases = file.exists ? JSON.parse(await file.text()) : {};
  } catch {
    aliases = {};
  }
  return aliases;
}

export async function rememberChatName(alias, chatId) {
  await requireReady();
  const chat = await getChat(chatId);
  const all = await loadAliases();
  all[normalize(alias)] = { alias, chat_id: chat.id, title: titleOf(chat) };
  await aliasFile().write(JSON.stringify(all));
  return { status: 'remembered', alias, title: titleOf(chat) };
}

async function chatsByIds(ids) {
  return Promise.all((ids || []).map(getChat));
}

// Telegram's own searches, tried in order when no loaded chat title matches.
const SEARCHES = [
  async (query) =>
    chatsByIds(
      (await send({ '@type': 'searchChats', query, limit: 5 })).chat_ids
    ),
  async (query) => {
    const { user_ids = [] } = await send({
      '@type': 'searchContacts',
      query,
      limit: 5,
    });
    return Promise.all(
      user_ids.map((id) =>
        send({ '@type': 'createPrivateChat', user_id: id, force: false })
      )
    );
  },
  async (query) =>
    chatsByIds(
      (await send({ '@type': 'searchChatsOnServer', query, limit: 5 })).chat_ids
    ),
];

/**
 * Chats matching a spoken name: Saved Messages, a remembered alias, the
 * titles of loaded chats (Cyrillic or Latin, case endings ignored), then
 * Telegram's chat, contact and server search. With no match, the recent
 * chats are returned so the model can pick the one the user meant.
 */
export async function findChat(name) {
  await requireReady();
  // found_by tells the model whether the name is worth remembering.
  const summaries = async (chats, foundBy) => ({
    found_by: foundBy,
    matches: await Promise.all(chats.slice(0, 5).map(chatSummary)),
  });

  if (SAVED_NAME.test(normalize(name))) {
    return summaries(
      [
        await send({
          '@type': 'createPrivateChat',
          user_id: myId,
          force: false,
        }),
      ],
      'name'
    );
  }
  const alias = (await loadAliases())[normalize(name)];
  if (alias) return summaries([await getChat(alias.chat_id)], 'alias');

  const loaded = await mainChats(TELEGRAM_READ.chatsScanned);
  const scored = loaded
    .map((chat) => ({ chat, score: nameScore(name, titleOf(chat)) }))
    .filter((m) => m.score > 0);
  if (scored.length) {
    const best = Math.max(...scored.map((m) => m.score));
    return summaries(
      scored.filter((m) => m.score === best).map((m) => m.chat),
      'title'
    );
  }

  for (const search of SEARCHES) {
    try {
      const chats = await search(name);
      if (chats.length) return summaries(chats, 'search');
    } catch (e) {
      if (__DEV__) console.warn('Telegram search failed:', e.message);
    }
  }
  return {
    matches: [],
    recent_chats: loaded.map((c) => ({ chat_id: c.id, title: titleOf(c) })),
  };
}

// ── messages ──────────────────────────────────────────────────────────────

const userNames = new Map();

async function senderName(sender, meId) {
  if (sender?.['@type'] === 'messageSenderUser') {
    if (sender.user_id === meId) return 'me';
    if (!userNames.has(sender.user_id)) {
      try {
        const u = await send({ '@type': 'getUser', user_id: sender.user_id });
        const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
        userNames.set(sender.user_id, name || 'Deleted account');
      } catch {
        userNames.set(sender.user_id, 'unknown');
      }
    }
    return userNames.get(sender.user_id);
  }
  if (sender?.['@type'] === 'messageSenderChat') {
    try {
      return (await getChat(sender.chat_id)).title;
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

const ft = (formatted) =>
  typeof formatted === 'string' ? formatted : formatted?.text || '';

const withCaption = (label, caption) =>
  ft(caption) ? `[${label}] ${ft(caption)}` : `[${label}]`;

/** A message's content as one line of text for the model. */
function contentText(content) {
  switch (content?.['@type']) {
    case 'messageText':
      return ft(content.text);
    case 'messagePhoto':
      return withCaption('photo', content.caption);
    case 'messageVideo':
      return withCaption('video', content.caption);
    case 'messageAnimation':
      return withCaption('GIF', content.caption);
    case 'messageVoiceNote':
      return withCaption(
        `voice message ${content.voice_note?.duration || 0}s`,
        content.caption
      );
    case 'messageVideoNote':
      return `[video message ${content.video_note?.duration || 0}s]`;
    case 'messageAudio':
      return withCaption(
        `audio: ${content.audio?.title || content.audio?.file_name || ''}`,
        content.caption
      );
    case 'messageDocument':
      return withCaption(
        `file: ${content.document?.file_name || ''}`,
        content.caption
      );
    case 'messageSticker':
      return `[sticker ${content.sticker?.emoji || ''}]`;
    case 'messagePoll':
      return `[poll: ${ft(content.poll?.question)}]`;
    case 'messageLocation':
    case 'messageVenue':
      return '[location]';
    case 'messageContact':
      return `[contact: ${content.contact?.first_name || ''} ${content.contact?.last_name || ''}]`;
    case 'messageCall':
      return '[call]';
    default:
      return `[${String(content?.['@type'] || 'message').replace(/^message/, '')}]`;
  }
}

function timeLabel(unix) {
  const d = new Date(unix * 1000);
  const hm = d.toTimeString().slice(0, 5);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hm;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm} ${hm}`;
}

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max)}… [cut]` : text;

/**
 * Newest-first history down to (not including) afterId, at most limit
 * messages. TDLib may return fewer than asked per call, so it pages.
 * complete: it got down to afterId (or the chat's start), nothing skipped.
 */
async function history(chatId, { limit, afterId = 0 }) {
  const out = [];
  const seen = new Set();
  let from = 0;
  for (let page = 0; page < 10 && out.length < limit; page++) {
    const { messages = [] } = await send({
      '@type': 'getChatHistory',
      chat_id: chatId,
      from_message_id: from,
      offset: 0,
      limit: Math.min(50, limit - out.length),
      only_local: false,
    });
    const fresh = messages.filter((m) => !seen.has(m.id));
    if (!fresh.length) return { messages: out, complete: true };
    for (const m of fresh) {
      if (m.id <= afterId) return { messages: out, complete: true };
      if (out.length >= limit) return { messages: out, complete: false };
      seen.add(m.id);
      out.push(m);
    }
    from = fresh[fresh.length - 1].id;
  }
  return { messages: out, complete: false };
}

/**
 * Messages of a chat, oldest first. mode 'unread' reads what the user
 * hasn't seen; 'recent' the last `limit` messages.
 */
export async function readMessages(chatId, { mode = 'unread', limit } = {}) {
  await requireReady();
  const chat = await getChat(chatId);
  const max = Math.min(
    Math.max(1, Number(limit) || TELEGRAM_READ.defaultMessages),
    TELEGRAM_READ.maxMessages
  );
  const unreadOnly = mode !== 'recent';
  if (unreadOnly && !chat.unread_count) {
    return { chat: titleOf(chat), unread: 0, messages: [] };
  }
  // Unread mode pages down to the last read message; the user's own
  // messages in between are skipped below.
  const page = await history(chat.id, {
    limit: max,
    afterId: unreadOnly ? chat.last_read_inbox_message_id : 0,
  });
  const raw = page.messages.reverse();
  const messages = [];
  for (const m of raw) {
    if (unreadOnly && m.is_outgoing) continue;
    messages.push({
      id: m.id,
      from: await senderName(m.sender_id, myId),
      time: timeLabel(m.date),
      text: clip(contentText(m.content), TELEGRAM_READ.maxMessageChars),
      reply_to_id:
        m.reply_to?.['@type'] === 'messageReplyToMessage' &&
        m.reply_to.chat_id === chat.id
          ? m.reply_to.message_id
          : undefined,
      mentions_me: m.contains_unread_mention || undefined,
    });
  }
  return {
    chat: titleOf(chat),
    unread: chat.unread_count,
    not_shown_unread:
      unreadOnly && !page.complete && chat.unread_count > messages.length
        ? chat.unread_count - messages.length
        : undefined,
    messages,
  };
}

/** Marks everything in the chat as read, mentions included. */
export async function markRead(chatId) {
  await requireReady();
  const chat = await getChat(chatId);
  if (chat.last_message) {
    await send({
      '@type': 'viewMessages',
      chat_id: chat.id,
      message_ids: [chat.last_message.id],
      force_read: true,
    });
  }
  if (chat.unread_mention_count) {
    await send({ '@type': 'readAllChatMentions', chat_id: chat.id });
  }
  if (chat.is_marked_as_unread) {
    await send({
      '@type': 'toggleChatIsMarkedAsUnread',
      chat_id: chat.id,
      is_marked_as_unread: false,
    });
  }
  return { status: 'marked_read', chat: titleOf(chat) };
}

/** Who wrote a message and its first words, to confirm what a reply answers. */
export async function messagePreview(chatId, messageId) {
  const m = await send({
    '@type': 'getMessage',
    chat_id: chatId,
    message_id: messageId,
  });
  return {
    from: await senderName(m.sender_id, myId),
    text: clip(contentText(m.content), 120),
  };
}

/** The user's own newest messages in a chat (newest first), for undo. */
export async function myRecentMessages(chatId, count) {
  const { messages } = await history(chatId, { limit: 50 });
  return messages
    .filter((m) => m.is_outgoing)
    .slice(0, count)
    .map((m) => ({ id: m.id, text: clip(contentText(m.content), 200) }));
}

/**
 * Messages matching `query`, newest first: in one chat, or in all chats
 * when chatId is 0. `from` keeps messages whose sender's name matches it
 * («Дина», "Alisher"; "me" for the user's own); with an empty query that
 * is simply the latest messages from that person.
 */
export async function searchMessages(chatId, query, { from, limit } = {}) {
  await requireReady();
  const q = String(query || '').trim();
  const sender = String(from || '').trim();
  const max = Math.min(
    Math.max(1, Number(limit) || TELEGRAM_READ.defaultSearchResults),
    TELEGRAM_READ.maxSearchResults
  );
  const inChat = Number(chatId) || 0;
  if (!q && (!sender || !inChat)) {
    return {
      error:
        'Give words to search for (or a chat plus a sender to list their latest messages).',
    };
  }

  let found;
  if (inChat) {
    found = await send({
      '@type': 'searchChatMessages',
      chat_id: inChat,
      query: q,
      from_message_id: 0,
      offset: 0,
      limit: 100,
    });
  } else {
    // A person writes in private chats and groups; channels, which post
    // the same words all day, would crowd their messages out of the batch.
    const types = sender
      ? [
          'searchMessagesChatTypeFilterPrivate',
          'searchMessagesChatTypeFilterGroup',
        ]
      : [null];
    const pages = await Promise.all(
      types.map((type) =>
        send({
          '@type': 'searchMessages',
          query: q,
          offset: '',
          limit: 100,
          chat_type_filter: type ? { '@type': type } : undefined,
        })
      )
    );
    found = {
      messages: pages
        .flatMap((p) => p.messages || [])
        .sort((a, b) => b.date - a.date),
    };
  }

  const isMe = /^(me|я|мои?|мне)$/i.test(sender);
  const results = [];
  for (const m of found.messages || []) {
    if (results.length >= max) break;
    const name = await senderName(m.sender_id, myId);
    if (isMe ? !m.is_outgoing : sender && nameScore(sender, name) === 0) {
      continue;
    }
    results.push({
      chat: inChat ? undefined : titleOf(await getChat(m.chat_id)),
      chat_id: inChat ? undefined : m.chat_id,
      id: m.id,
      from: name,
      time: timeLabel(m.date),
      text: clip(contentText(m.content), TELEGRAM_READ.maxMessageChars),
    });
  }
  return { found: results.length, newest_first: true, messages: results };
}
