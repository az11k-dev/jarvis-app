import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VISION_PHOTO_QUALITY } from '../config/jarvis';
import {
  cancelReminder,
  listReminders,
  scheduleReminder,
} from './notificationsService';
import { analyzeImage } from './openai';
import {
  answerCall,
  callLog,
  endCall,
  findContacts,
  prepareCall,
  readSms,
  sendSms,
} from './phone';
import {
  getPlace,
  listPlaces,
  removePlace,
  savePlace,
  whereAmI,
} from './places';
import { openTaxi, prepareTaxi } from './taxi';
import { scanWithCamera } from './scanner';
import {
  addSosContact,
  listSosContacts,
  removeSosContact,
  sosStatus,
  stopSos,
} from './sos';
import {
  findChat,
  markRead,
  readMessages,
  rememberChatName,
  searchMessages,
  unreadChats,
} from './telegramChats';
import { controlAnnouncements, watchChat } from './telegramAnnounce';
import { telegramMedia } from './telegramMedia';
import { confirmDelete, prepareDelete, sendMessage } from './telegramSend';
import {
  deliveryAddress,
  listRestaurants,
  openTezkor,
  searchFood,
  setAddress,
  setAddressToPlace,
  vendorMenu,
} from './tezkor';

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

// Tools the user takes part in, or that play something: they take as long
// as they take (every other tool is cut off after TOOL_TIMEOUT_MS).
export const UNTIMED_TOOLS = new Set(['analyze_image', 'tg_media']);

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
    'tg_media',
    "Work with a photo, video, GIF, voice message, video message or audio from a Telegram chat: look at it and answer a question (describe), put it on the phone's screen (show), play a voice message or audio aloud (play; a video opens on screen), write down what is said in it (transcribe), or take what is shown off the screen (close).",
    {
      chat_id: {
        type: 'integer',
        description:
          'chat_id from tg_unread_chats or tg_find_chat (0 with close).',
      },
      message_id: {
        type: 'integer',
        description:
          'id of the message with the media (from tg_read_messages or an announcement), or 0 for the newest message in the chat that fits the action.',
      },
      action: {
        type: 'string',
        enum: ['describe', 'show', 'play', 'transcribe', 'close'],
      },
      question: {
        type: 'string',
        description:
          'For describe: what the user wants to know about the photo or video, in their language. Empty otherwise.',
      },
    },
    ['chat_id', 'message_id', 'action', 'question']
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
    'tg_send_message',
    "Send a Telegram message from the user's own account to a chat right away, optionally as a reply to a message.",
    {
      chat_id: {
        type: 'integer',
        description: 'chat_id from tg_unread_chats or tg_find_chat.',
      },
      text: {
        type: 'string',
        description:
          'The message as the user would write it: their words cleaned up into a natural message, or a reply or content you wrote for them when they asked.',
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
    'Show or change which new Telegram messages JARVIS speaks: pause/resume all, mentions of the user on/off, private chats on/off. status lists the watched chats with their chat_id.',
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
    'contacts_find',
    "Look up people in the phone's contacts by name. Returns their phone numbers.",
    {
      name: {
        type: 'string',
        description: 'The name as the user said it.',
      },
    },
    ['name']
  ),
  fn(
    'sms_read',
    "Read the phone's SMS, newest first: the inbox, sent messages or both, optionally from one sender or containing some words.",
    {
      from: {
        type: 'string',
        description:
          'Only messages from/to this sender: a contact name, a phone number, or a sender name like Click or Uzum. Empty for everyone.',
      },
      query: {
        type: 'string',
        description: 'Only messages containing this text, or empty.',
      },
      box: {
        type: 'string',
        enum: ['inbox', 'sent', 'all'],
        description: 'inbox (default), sent, or all.',
      },
      unread_only: {
        type: 'boolean',
        description: 'true for only the SMS the user has not opened yet.',
      },
      limit: {
        type: 'integer',
        description: 'How many at most (default 10, max 30).',
      },
    },
    ['from', 'query', 'box', 'unread_only', 'limit']
  ),
  fn(
    'sms_send',
    "Send an SMS from the user's own number right away.",
    {
      to: {
        type: 'string',
        description: 'A contact name as the user said it, or a phone number.',
      },
      text: {
        type: 'string',
        description:
          'The message as the user would write it: their words cleaned up, or text you wrote for them when they asked.',
      },
    },
    ['to', 'text']
  ),
  fn(
    'call_log',
    "The phone's recent calls, newest first: who called, missed calls, calls with one person.",
    {
      kind: {
        type: 'string',
        enum: ['all', 'missed', 'incoming', 'outgoing'],
      },
      contact: {
        type: 'string',
        description:
          'Only calls with this contact name or number, or empty for everyone.',
      },
      limit: {
        type: 'integer',
        description: 'How many at most (default 10, max 30).',
      },
    },
    ['kind', 'contact', 'limit']
  ),
  fn(
    'phone_call',
    'Call someone on the phone. The call is placed right after you finish speaking, on the speaker unless the user asks otherwise.',
    {
      to: {
        type: 'string',
        description: 'A contact name as the user said it, or a phone number.',
      },
      speaker: {
        type: 'boolean',
        description: 'true (default) to turn the loudspeaker on.',
      },
    },
    ['to', 'speaker']
  ),
  fn(
    'phone_end_call',
    'Hang up the current phone call, or decline the one that is ringing.'
  ),
  fn('phone_answer_call', 'Pick up the phone call that is ringing.'),
  fn(
    'sos',
    'SOS mode. start: raise the alarm — after a short spoken countdown every SOS contact gets an SMS and a Telegram message with where the user is, a live location and a voice message. stop: call the alarm off and tell the contacts the user is fine. status: whether it is on.',
    { action: { type: 'string', enum: ['start', 'stop', 'status'] } },
    ['action']
  ),
  fn(
    'sos_contacts',
    'The people alerted in SOS mode: list them, add one (by the name the user calls them; the number comes from the phone book and their Telegram chat from the number) or remove one.',
    {
      action: { type: 'string', enum: ['list', 'add', 'remove'] },
      name: {
        type: 'string',
        description:
          'How the user calls the person (папа, мама, Алишер). Empty for list.',
      },
      phone: {
        type: 'string',
        description:
          'Their phone number if the user gave it, or the one you found with contacts_find. Empty to look the name up in the phone book.',
      },
      chat_id: {
        type: 'integer',
        description:
          'Their Telegram chat_id from tg_find_chat if the user wants a particular chat, or 0 to find it by the phone number.',
      },
    },
    ['action', 'name', 'phone', 'chat_id']
  ),
  fn(
    'tezkor_search_food',
    'Search Uzum Tezkor (food and grocery delivery in Uzbekistan) for a dish, cuisine, product or restaurant near the delivery address. Returns restaurants (open ones first; a place whose name matches has name_matches_query) with rating, delivery time and price, minimum order, and the matching dishes with prices in sum.',
    {
      query: {
        type: 'string',
        description:
          'What to look for, as a short dish, cuisine or place name in Russian (плов, бургер, пицца пепперони, Evos), since menus are in Russian.',
      },
    },
    ['query']
  ),
  fn(
    'tezkor_restaurants',
    'List Uzum Tezkor restaurants (or shops) that deliver to the delivery address, like its home screen: which are open now and how many there are, optionally only one kitchen or one place by name. Use for «что сейчас открыто?», «какие рестораны работают?», «где поесть?», or when the user names a kitchen rather than a dish.',
    {
      kitchen: {
        type: 'string',
        description:
          'Kitchen in Russian as Tezkor names them (Бургеры, Пицца, Лаваш, Суши, Курочка, Шашлыки, Плов, Milliy Taom for Uzbek food, Европа, Азия, Турецкая, Обеды, Завтраки, Десерты, Кофе), a place name (KFC), or empty for all.',
      },
      type: {
        type: 'string',
        enum: ['restaurant', 'shop'],
        description: 'restaurant (default) or shop (groceries, pharmacies).',
      },
      open_only: {
        type: 'boolean',
        description:
          'true (default) to list only places open now; false to also get the closed ones with their opening time (in closed).',
      },
    },
    ['kitchen', 'type', 'open_only']
  ),
  fn(
    'tezkor_menu',
    "Get one Uzum Tezkor restaurant's menu (dish names, prices, weight, categories, a few dishes from each category), or only what matches some words. Also searches inside one shop; a shop needs query, without it you get its sections.",
    {
      vendor_id: {
        type: 'string',
        description: 'vendor_id from tezkor_search_food or tezkor_restaurants.',
      },
      query: {
        type: 'string',
        description:
          'A dish, product or category to look for (in Russian: лаваш, напитки, молоко), or empty for an overview of the menu.',
      },
    },
    ['vendor_id', 'query']
  ),
  fn(
    'places',
    "The user's saved places (home, work, or any name they give): list them, save one (from an address, or where the phone is now) or remove one. Saved places are used by name for food delivery and taxis. Use when the user says «запомни мой домашний адрес», «я на работе, сохрани это место», «какие у меня адреса?».",
    {
      action: { type: 'string', enum: ['list', 'save', 'remove'] },
      name: {
        type: 'string',
        description:
          'What the user calls the place: home, work, or their own name for it (дача, мама, спортзал). Empty for list.',
      },
      address: {
        type: 'string',
        description:
          'For save: street and house number with the city, e.g. «Ташкент, улица Амира Темура, 1». Empty when here is true.',
      },
      here: {
        type: 'boolean',
        description:
          "For save: true to save the phone's current location («я дома, запомни»), false to use address.",
      },
      note: {
        type: 'string',
        description:
          'For save: details a courier or driver needs (подъезд, этаж, квартира, ориентир), or empty.',
      },
    },
    ['action', 'name', 'address', 'here', 'note']
  ),
  fn(
    'where_am_i',
    'Where the phone is right now (GPS): the address, a map link, and the nearest saved place with its distance. Use for «где я?», «где я сейчас нахожусь?», «какой это адрес?», «я далеко от дома?».',
    {},
    []
  ),
  fn(
    'tezkor_set_address',
    'Set the delivery address used for Uzum Tezkor searches: a saved place («закажи домой», «доставка на работу») or a new address. Kept on the phone for next time. A new address fails, saving nothing, when Tezkor does not deliver there.',
    {
      place: {
        type: 'string',
        description:
          'Name of a saved place (home, work, or one from places), or empty to use address.',
      },
      address: {
        type: 'string',
        description:
          'Street and house number with the city, e.g. «Ташкент, улица Амира Темура, 1». Empty when place is given.',
      },
    },
    ['place', 'address']
  ),
  fn(
    'open_tezkor',
    'Open the Uzum Tezkor website so the user can place the order themselves: the restaurant when vendor_id is given, and straight on the dish with its add-to-cart button when product_id is given too. Use once the user decides what to order; JARVIS cannot log in or pay itself. Returns delivery_address: the website must have the same address chosen, or it shows the restaurant as unavailable.',
    {
      vendor_id: {
        type: 'string',
        description:
          'vendor_id of the restaurant to open from tezkor_search_food, tezkor_restaurants or tezkor_menu, or empty for the Tezkor home screen.',
      },
      product_id: {
        type: 'string',
        description:
          'product_id of the dish the user chose, from the same restaurant, or empty to open the restaurant menu.',
      },
    },
    ['vendor_id', 'product_id']
  ),
  fn(
    'order_taxi',
    'Open Yandex Go or WB Taxi with the route filled in (prices for each class shown), so the user only taps the order button. Use for «вызови такси домой», «закажи Яндекс на работу», «такси до аэропорта через WB», "get me a cab to the office". JARVIS cannot press the order button itself: that charges the user.',
    {
      service: {
        type: 'string',
        enum: ['yandex', 'wb', ''],
        description:
          'yandex for Yandex Go / Яндекс Такси, wb for WB Taxi / Wildberries, or empty when the user did not name one (the one used last time, Yandex at first).',
      },
      to: {
        type: 'string',
        description:
          'Where to go: a saved place name (home, work, or one from places) or an address or landmark with the city («Ташкент, аэропорт», «Ташкент, улица Амира Темура, 1»). Empty if the user did not say; they pick it in the app.',
      },
      from: {
        type: 'string',
        description:
          'Pickup: a saved place name or an address, or empty to start where the phone is now (the usual case).',
      },
    },
    ['service', 'to', 'from']
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
  fn(
    'reset_conversation',
    'Clear the conversation: wipe the chat on screen and forget everything said so far, like the RESET button. Call when the user asks to reset, clear or start the chat over.'
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
 * Executes a tool call. Returns `{ output, after?, keepOpen?, sos?, endConversation?, resetConversation? }`.
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

    case 'tg_media':
      return telegramMedia(
        {
          chatId: args.chat_id,
          messageId: args.message_id,
          action: args.action,
          question: args.question,
        },
        { signal }
      );

    case 'contacts_find':
      return { output: await findContacts(String(args.name || '')) };

    case 'sms_read':
      return {
        output: await readSms({
          from: args.from,
          query: args.query,
          box: args.box,
          limit: args.limit,
          unreadOnly: args.unread_only === true || args.unread_only === 'true',
        }),
      };

    case 'sms_send':
      return { output: await sendSms({ to: args.to, text: args.text }) };

    case 'call_log':
      return {
        output: await callLog({
          kind: args.kind,
          limit: args.limit,
          contact: args.contact,
        }),
      };

    case 'phone_call': {
      const { output, dial } = await prepareCall({
        to: args.to,
        speaker: args.speaker,
      });
      return { output, after: dial };
    }

    case 'phone_end_call':
      return { output: await endCall() };

    case 'phone_answer_call':
      // The call takes the microphone: don't keep listening for a command.
      return { output: await answerCall(), endConversation: true };

    case 'sos':
      if (args.action === 'start') {
        const contacts = await listSosContacts();
        if (!contacts.length) {
          return {
            output: {
              error:
                'No SOS contacts yet. Ask who to alert and add them with sos_contacts.',
            },
          };
        }
        return {
          output: {
            status: 'starting',
            note: 'JARVIS announces the countdown itself; say nothing.',
          },
          sos: 'start',
        };
      }
      if (args.action === 'stop') return { output: await stopSos() };
      return {
        output: { ...sosStatus(), contacts: await listSosContacts() },
      };

    case 'sos_contacts':
      if (args.action === 'add') {
        return {
          output: await addSosContact({
            name: args.name,
            phone: args.phone,
            chatId: args.chat_id,
          }),
        };
      }
      if (args.action === 'remove') {
        return { output: await removeSosContact(args.name) };
      }
      return { output: { contacts: await listSosContacts() } };

    case 'tg_search_messages':
      return {
        output: await searchMessages(args.chat_id, args.query, {
          from: args.from,
          limit: args.limit,
        }),
      };

    case 'tg_mark_read':
      return { output: await markRead(args.chat_id) };

    case 'tg_send_message':
      return {
        output: await sendMessage({
          chatId: args.chat_id,
          text: args.text,
          replyToId: args.reply_to_message_id,
        }),
      };

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

    case 'tezkor_search_food':
      return { output: await searchFood(args.query, { signal }) };

    case 'tezkor_restaurants':
      return {
        output: await listRestaurants(
          {
            kitchen: String(args.kitchen || ''),
            type: args.type,
            openOnly: args.open_only !== false && args.open_only !== 'false',
          },
          { signal }
        ),
      };

    case 'tezkor_menu':
      return {
        output: await vendorMenu(args.vendor_id, args.query, { signal }),
      };

    case 'places':
      if (args.action === 'save') {
        return {
          output: await savePlace(
            {
              name: args.name,
              address: args.address,
              here: args.here === true || args.here === 'true',
              note: args.note,
            },
            { signal }
          ),
        };
      }
      if (args.action === 'remove') {
        return { output: await removePlace(args.name) };
      }
      return { output: { places: await listPlaces() } };

    case 'where_am_i':
      return { output: await whereAmI() };

    case 'tezkor_set_address': {
      if (String(args.place || '').trim()) {
        const place = await getPlace(args.place);
        if (!place) {
          return {
            output: {
              error: `No saved place «${args.place}». Ask for the address, and offer to save it with places.`,
              places: await listPlaces(),
            },
          };
        }
        return { output: await setAddressToPlace(place) };
      }
      return { output: await setAddress(args.address, { signal }) };
    }

    case 'open_tezkor':
      return {
        output: {
          status: 'opening_after_reply',
          delivery_address: await deliveryAddress(),
        },
        after: () =>
          openTezkor({
            vendorId: args.vendor_id,
            productId: args.product_id,
          }),
      };

    case 'order_taxi': {
      const ride = await prepareTaxi(
        { service: args.service, from: args.from, to: args.to },
        { signal }
      );
      if (!ride.url) return { output: ride.output };
      return {
        output: ride.output,
        after: () => openTaxi(ride.url, ride.service),
      };
    }

    case 'end_conversation':
      return { output: { status: 'standing_by' }, endConversation: true };

    case 'reset_conversation':
      return {
        output: { status: 'cleared_after_reply' },
        resetConversation: true,
      };

    default:
      return { output: { error: `Unknown tool ${name}` } };
  }
}
