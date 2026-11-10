import * as Td from '../../modules/jarvis-telegram';
import { TELEGRAM_SEND } from '../config/jarvis';
import { onTelegramUpdate } from './telegram';
import {
  getChat,
  messagePreview,
  myRecentMessages,
  requireReady,
  titleOf,
} from './telegramChats';

/**
 * Sending goes out right away: the user asked for it, JARVIS doesn't ask
 * again. Deleting messages for everyone can't be undone, so it takes two
 * steps: it is prepared and read back, and only runs in the user's next
 * turn. That turn check lives here, not in the prompt, so neither the model
 * nor text inside other people's messages can delete without the user
 * hearing it and answering first.
 */

// The one action waiting for the user's answer:
// { id, kind: 'delete', turn, at, ...details }
let pending = null;
let nextActionId = 1;

function prepare(kind, turn, details) {
  pending = {
    id: String(nextActionId++),
    kind,
    turn,
    at: Date.now(),
    ...details,
  };
  return pending.id;
}

/**
 * Takes the pending action if `turn` is the user's answer to its read-back.
 * Synchronous, so one action runs at most once. Returns { action } or { error }.
 */
function takeConfirmed(kind, actionId, turn) {
  const action = pending;
  if (!action || action.kind !== kind || action.id !== String(actionId)) {
    return {
      error: 'Nothing like that is waiting for confirmation. Prepare it first.',
    };
  }
  if (turn === action.turn) {
    return {
      error:
        'Not confirmed yet. Read it back to the user and wait for their answer.',
    };
  }
  pending = null;
  if (
    turn !== action.turn + 1 ||
    Date.now() - action.at > TELEGRAM_SEND.draftTtlMs
  ) {
    return {
      error:
        'Expired: the user did not confirm right after hearing it. Ask whether to prepare it again.',
    };
  }
  return { action };
}

/**
 * Drops whatever waits for confirmation. Called when the user cuts JARVIS
 * off, so a read-back they didn't hear to the end can't be confirmed.
 */
export function discardPending() {
  pending = null;
}

// ── send ──────────────────────────────────────────────────────────────────

/** Sends a message from the user's account and waits until Telegram confirms delivery. */
export async function sendMessage({ chatId, text, replyToId }) {
  await requireReady();
  const body = String(text || '').trim();
  if (!body) return { error: 'The message is empty.' };
  if (body.length > TELEGRAM_SEND.maxChars) {
    return { error: 'Too long for one Telegram message.' };
  }
  const chat = await getChat(chatId);
  const replyTo = Number(replyToId) || 0;
  if (replyTo) {
    try {
      await messagePreview(chat.id, replyTo);
    } catch {
      return { error: 'The message to reply to was not found in this chat.' };
    }
  }
  const d = {
    chatId: chat.id,
    title: titleOf(chat),
    text: body,
    replyToId: replyTo,
  };

  // Delivery updates can reach JS before the sendMessage result does, so
  // listen first and match by the temporary message id afterwards.
  const outcomes = new Map();
  let wake = null;
  const record = (update) => {
    outcomes.set(update.old_message_id, update);
    wake?.();
  };
  const unsubscribe = [
    onTelegramUpdate('updateMessageSendSucceeded', record),
    onTelegramUpdate('updateMessageSendFailed', record),
  ];
  try {
    const sent = await Td.send({
      '@type': 'sendMessage',
      chat_id: d.chatId,
      reply_to: d.replyToId
        ? { '@type': 'inputMessageReplyToMessage', message_id: d.replyToId }
        : undefined,
      input_message_content: {
        '@type': 'inputMessageText',
        text: { '@type': 'formattedText', text: d.text, entities: [] },
        clear_draft: true,
      },
    });
    if (!sent.sending_state) return { status: 'sent', chat: d.title };

    const deadline = Date.now() + TELEGRAM_SEND.deliveryTimeoutMs;
    while (!outcomes.has(sent.id) && Date.now() < deadline) {
      let timer;
      await new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, 500);
      });
      clearTimeout(timer);
    }
    const outcome = outcomes.get(sent.id);
    if (!outcome) {
      return {
        status: 'still_sending',
        chat: d.title,
        note: 'Telegram has not confirmed yet (slow connection); it will be sent when the connection allows.',
      };
    }
    if (outcome['@type'] === 'updateMessageSendFailed') {
      return {
        error: `Telegram did not send it: ${outcome.error?.message || 'unknown error'}`,
      };
    }
    return { status: 'sent', chat: d.title };
  } finally {
    unsubscribe.forEach((off) => off());
  }
}

// ── delete (undo the user's own messages) ─────────────────────────────────

/** Prepares deleting the user's last `count` messages in a chat, for everyone. */
export async function prepareDelete(chatId, count, { turn }) {
  await requireReady();
  const chat = await getChat(chatId);
  const n = Math.min(Math.max(1, Number(count) || 1), TELEGRAM_SEND.maxDelete);
  const mine = await myRecentMessages(chat.id, n);
  if (!mine.length) {
    return { error: 'The user has no messages of their own in this chat.' };
  }
  const id = prepare('delete', turn, {
    chatId: chat.id,
    title: titleOf(chat),
    messageIds: mine.map((m) => m.id),
  });
  return {
    action_id: id,
    chat: titleOf(chat),
    messages: mine.map((m) => m.text).reverse(),
    next: 'Not deleted yet. Tell the user which of their messages (chat and texts) will be deleted for everyone and ask to confirm. Call tg_confirm_delete only if their next reply confirms.',
  };
}

export async function confirmDelete(actionId, { turn }) {
  const { action, error } = takeConfirmed('delete', actionId, turn);
  if (error) return { error };
  await requireReady();
  await Td.send({
    '@type': 'deleteMessages',
    chat_id: action.chatId,
    message_ids: action.messageIds,
    revoke: true,
  });
  return {
    status: 'deleted_for_everyone',
    chat: action.title,
    count: action.messageIds.length,
  };
}
