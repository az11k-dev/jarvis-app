import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VISION_PHOTO_QUALITY } from '../config/jarvis';
import {
  cancelReminder,
  listReminders,
  scheduleReminder,
} from './notificationsService';
import { analyzeImage } from './openai';
import { scanWithCamera } from './scanner';
import {
  findChat,
  markRead,
  readMessages,
  rememberChatName,
  searchMessages,
  unreadChats,
} from './telegramChats';
import { controlAnnouncements, watchChat } from './telegramAnnounce';
import {
  confirmDelete,
  draftMessage,
  prepareDelete,
  sendDraft,
} from './telegramSend';

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  name,
  description,
  parameters: {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  },
});

/** Tool schemas sent to the model. */
export const TOOL_DEFINITIONS = [
  { type: 'web_search' },
  fn(
    'analyze_image',
    'See through the phone camera: JARVIS opens its scanner and takes the photo by itself, then you get a description of it. Use whenever the user asks what they are looking at, to scan, identify or check something, to read or translate text, a sign, a label or a document, to count things, or to help with whatever is in front of them.',
    {
      question: {
        type: 'string',
        description:
          'What the user wants to know about the photo, in the user language.',
      },
      source: {
        type: 'string',
        enum: ['camera', 'gallery'],
        description:
          'camera to take a new photo (default), gallery when the user refers to an existing photo.',
      },
      facing: {
        type: 'string',
        enum: ['back', 'front'],
        description:
          'back camera (default) for things in front of the user; front (selfie) camera when the question is about the user themselves: how they look, what they are wearing.',
      },
    },
    ['question', 'source', 'facing']
  ),
  fn('open_telegram', 'Open the Telegram app.'),
  fn(
    'tg_unread_chats',
    "List the user's Telegram chats that have unread messages, with unread counts, mentions of the user, and whether the chat is muted."
  ),
  fn(
    'tg_find_chat',
    'Find a Telegram chat (person, group or channel) by the name the user said. Returns matches with chat_id; if nothing matches, returns recent chats so you can pick the one the user meant (names may be transliterated, e.g. Алишер = Alisher).',
    {
      name: {
        type: 'string',
        description: 'The chat name as the user said it.',
      },
    },
    ['name']
  ),
  fn(
    'tg_read_messages',
    'Read messages of a Telegram chat, oldest first. Does not mark them as read.',
    {
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
      mode: {
        type: 'string',
        enum: ['unread', 'recent'],
        description:
          'unread: only messages the user has not read (default). recent: the last messages regardless of read state.',
      },
      limit: {
        type: 'integer',
        description: 'How many messages at most (default 20, max 50).',
      },
    },
    ['chat_id', 'mode', 'limit']
  ),
  fn(
    'tg_search_messages',
    'Search Telegram messages by words, in one chat or in all chats, optionally only from one person. Returns matches newest first with sender, time and text.',
    {
      chat_id: {
        type: 'integer',
        description:
          'chat_id to search in (from tg_unread_chats or tg_find_chat), or 0 for all chats.',
      },
      query: {
        type: 'string',
        description:
          "Words to look for, as a stem without case endings (макет, not макета). Empty with a chat and a sender lists that person's latest messages.",
      },
      from: {
        type: 'string',
        description:
          'Only messages from this person (name as said, or "me" for the user), or empty for anyone.',
      },
      limit: {
        type: 'integer',
        description: 'How many results at most (default 10, max 20).',
      },
    },
    ['chat_id', 'query', 'from', 'limit']
  ),
  fn(
    'tg_mark_read',
    'Mark all messages in a Telegram chat as read. Only when the user asks.',
    {
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
    },
    ['chat_id']
  ),
  fn(
    'tg_draft_message',
    'Prepare a Telegram message from the user (their account) to a chat, optionally as a reply to a message. Nothing is sent: read it back and send with tg_send_draft after the user confirms.',
    {
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
      text: {
        type: 'string',
        description:
          "What to send: the user's dictated words (punctuation fixed, nothing added), or, only when the user asked you to answer for them, a short reply you wrote in their voice.",
      },
      reply_to_message_id: {
        type: 'integer',
        description:
          'id of the message being answered (from tg_read_messages), or 0 for a plain message.',
      },
    },
    ['chat_id', 'text', 'reply_to_message_id']
  ),
  fn(
    'tg_send_draft',
    'Send the draft from tg_draft_message. Only after the user, in their reply to the read-back, confirmed sending.',
    {
      draft_id: {
        type: 'string',
        description: 'draft_id from tg_draft_message.',
      },
    },
    ['draft_id']
  ),
  fn(
    'tg_delete_sent',
    "Prepare deleting, for everyone, the user's own latest messages in a Telegram chat (e.g. to undo a mistake). Nothing is deleted yet: confirm with tg_confirm_delete after the user agrees. Never deletes other people's messages.",
    {
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
      count: {
        type: 'integer',
        description: "How many of the user's latest messages (1-5, default 1).",
      },
    },
    ['chat_id', 'count']
  ),
  fn(
    'tg_confirm_delete',
    'Delete the message prepared by tg_delete_sent. Only after the user, in their reply, confirmed.',
    {
      action_id: {
        type: 'string',
        description: 'action_id from tg_delete_sent.',
      },
    },
    ['action_id']
  ),
  fn(
    'tg_watch_chat',
    'Start or stop speaking new messages from a Telegram chat as they arrive.',
    {
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
      watch: {
        type: 'boolean',
        description: 'true to announce its new messages, false to stop.',
      },
    },
    ['chat_id', 'watch']
  ),
  fn(
    'tg_announcements',
    'Show or change which new Telegram messages JARVIS speaks: pause/resume all, mentions of the user on/off, private chats on/off. status lists the watched chats.',
    {
      action: {
        type: 'string',
        enum: [
          'status',
          'pause',
          'resume',
          'mentions_on',
          'mentions_off',
          'private_on',
          'private_off',
        ],
      },
    },
    ['action']
  ),
  fn(
    'tg_remember_chat',
    'Remember a name the user gives a Telegram chat (e.g. «рабочая группа» → the team chat), so tg_find_chat finds it by that name from now on.',
    {
      alias: {
        type: 'string',
        description: 'The name the user uses for the chat.',
      },
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
    },
    ['alias', 'chat_id']
  ),
  fn(
    'open_youtube',
    'Open YouTube, optionally searching for something.',
    { query: { type: 'string', description: 'Search query, may be empty.' } },
    []
  ),
  fn(
    'open_url',
    'Open a website, map link or any https URL in the browser.',
    { url: { type: 'string', description: 'Full https:// URL.' } },
    ['url']
  ),
  fn(
    'set_reminder',
    'Schedule a reminder notification that JARVIS will read aloud.',
    {
      text: {
        type: 'string',
        description: 'What to remind about, in the user language.',
      },
      delay_seconds: {
        type: 'integer',
        description: 'Seconds from now until the reminder fires.',
      },
    },
    ['text', 'delay_seconds']
  ),
  fn(
    'list_reminders',
    'List the reminders that have not fired yet, with their ids and times.'
  ),
  fn(
    'cancel_reminder',
    'Cancel a pending reminder. Call list_reminders first to get its id.',
    {
      id: {
        type: 'string',
        description: 'Reminder id from list_reminders or set_reminder.',
      },
    },
    ['id']
  ),
  fn(
    'end_conversation',
    'Call when the user says goodbye, thanks you to finish, or tells you to stand by. JARVIS goes back to waiting for the wake word.'
  ),
];

async function openWithFallback(appUrl, webUrl) {
  try {
    await Linking.openURL(appUrl);
  } catch {
    await Linking.openURL(webUrl);
  }
}

/** Picks an existing photo. Returns base64 JPEG, or null if cancelled. */
async function pickFromGallery() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') throw new Error('No access to the photo library.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: VISION_PHOTO_QUALITY,
    base64: true,
    exif: false,
  });
  if (result.canceled || !result.assets?.[0]?.base64) return null;
  return result.assets[0].base64;
}

/**
 * Executes a tool call. Returns `{ output, after?, endConversation? }`.
 * `after` runs once JARVIS has finished speaking (used for anything that
 * switches to another app, so the reply isn't cut off).
 */
export async function runTool(name, args, { signal, turn } = {}) {
  switch (name) {
    case 'analyze_image': {
      const base64 =
        args.source === 'gallery'
          ? await pickFromGallery()
          : await scanWithCamera({ facing: args.facing, signal });
      if (!base64) return { output: { status: 'cancelled_by_user' } };
      signal?.throwIfAborted?.();
      const description = await analyzeImage(
        { base64, question: args.question },
        { signal }
      );
      return { output: { analysis: description || 'Nothing recognised.' } };
    }

    case 'open_telegram':
      return {
        output: { status: 'opening_after_reply' },
        after: () => openWithFallback('tg://', 'https://t.me'),
      };

    case 'open_youtube': {
      const q = (args.query || '').trim();
      const enc = encodeURIComponent(q);
      return {
        output: { status: 'opening_after_reply', query: q },
        after: () =>
          openWithFallback(
            q ? `vnd.youtube://results?search_query=${enc}` : 'vnd.youtube://',
            q
              ? `https://www.youtube.com/results?search_query=${enc}`
              : 'https://www.youtube.com'
          ),
      };
    }

    case 'open_url': {
      const url = String(args.url || '');
      if (!/^https:\/\//i.test(url)) {
        return { output: { error: 'Only https:// URLs can be opened.' } };
      }
      return {
        output: { status: 'opening_after_reply' },
        after: () => Linking.openURL(url),
      };
    }

    case 'set_reminder': {
      const seconds = Math.max(1, Math.round(Number(args.delay_seconds) || 0));
      const { id, firesAt } = await scheduleReminder(args.text, seconds);
      return {
        output: { status: 'scheduled', id, fires_at: firesAt.toString() },
      };
    }

    case 'list_reminders': {
      const reminders = await listReminders();
      return {
        output: {
          reminders: reminders.map((r) => ({
            id: r.id,
            text: r.text,
            fires_at: r.firesAt ? r.firesAt.toString() : 'unknown',
          })),
        },
      };
    }

    case 'cancel_reminder': {
      const cancelled = await cancelReminder(String(args.id || ''));
      return {
        output: cancelled
          ? { status: 'cancelled' }
          : { error: 'No pending reminder with that id.' },
      };
    }

    case 'tg_unread_chats':
      return { output: await unreadChats() };

    case 'tg_find_chat':
      return { output: await findChat(String(args.name || '')) };

    case 'tg_read_messages':
      return {
        output: await readMessages(args.chat_id, {
          mode: args.mode,
          limit: args.limit,
        }),
      };

    case 'tg_search_messages':
      return {
        output: await searchMessages(args.chat_id, args.query, {
          from: args.from,
          limit: args.limit,
        }),
      };

    case 'tg_mark_read':
      return { output: await markRead(args.chat_id) };

    case 'tg_draft_message':
      return {
        output: await draftMessage(
          {
            chatId: args.chat_id,
            text: args.text,
            replyToId: args.reply_to_message_id,
          },
          { turn }
        ),
      };

    case 'tg_send_draft':
      return { output: await sendDraft(args.draft_id, { turn }) };

    case 'tg_delete_sent':
      return {
        output: await prepareDelete(args.chat_id, args.count, { turn }),
      };

    case 'tg_confirm_delete':
      return { output: await confirmDelete(args.action_id, { turn }) };

    case 'tg_watch_chat':
      return {
        output: await watchChat(
          args.chat_id,
          args.watch === true || args.watch === 'true'
        ),
      };

    case 'tg_announcements':
      return { output: await controlAnnouncements(String(args.action)) };

    case 'tg_remember_chat':
      return {
        output: await rememberChatName(String(args.alias || ''), args.chat_id),
      };

    case 'end_conversation':
      return { output: { status: 'standing_by' }, endConversation: true };

    default:
      return { output: { error: `Unknown tool ${name}` } };
  }
}
