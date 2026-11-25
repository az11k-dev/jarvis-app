import { JARVIS_INSTRUCTIONS } from '../utils/constants';
import { speechLanguage } from '../utils/language';
import { CHAT_REASONING_EFFORT, TOOL_TIMEOUT_MS } from '../config/jarvis';
import { createResponse, OpenAIError } from './openai';
import { runTool, TOOL_DEFINITIONS, UNTIMED_TOOLS } from './tools';

// Multi-step laptop/server work («open the project, go fullscreen, start
// Claude in its terminal») takes ~10 rounds; most other turns take 1-3.
const MAX_TOOL_ROUNDS = 12;
const MAX_HISTORY_ITEMS = 30;
// Tools whose result needs no follow-up from the model when it already
// gave a reply alongside them.
const FINAL_TOOLS = new Set(['end_conversation', 'reset_conversation']);

/** runTool, but a tool that hangs (Telegram offline, a dead site) fails. */
function runToolInTime(name, args, context) {
  const run = runTool(name, args, context);
  if (UNTIMED_TOOLS.has(name)) return run;
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out: no result in ${Math.round(TOOL_TIMEOUT_MS / 1000)} s. Tell the user it did not work.`
          )
        ),
      TOOL_TIMEOUT_MS
    );
  });
  run.catch(() => {}); // a late failure after the timeout is not unhandled
  return Promise.race([run, limit]).finally(() => clearTimeout(timer));
}

// Same key for every brain request: they share the tools + instructions
// prefix, so OpenAI serves it from cache.
const CACHE_KEY = 'jarvis-brain';

// Read-only lookups the model often asks for together («unread Telegram
// and missed calls»): they run at once instead of one after another.
// Anything that touches the screen, sends, orders or plays stays in order.
const PARALLEL_TOOLS = new Set([
  'tg_unread_chats',
  'tg_find_chat',
  'tg_read_messages',
  'tg_search_messages',
  'contacts_find',
  'sms_read',
  'call_log',
  'sos_contacts',
  'tezkor_search_food',
  'tezkor_restaurants',
  'tezkor_menu',
  'places',
  'where_am_i',
  'list_reminders',
  'server_status',
]);

/**
 * The user's words with the local time stamped on them. The time lives in
 * the message, not the instructions: instructions that change every second
 * made every request miss OpenAI's prompt cache. Minutes are enough.
 */
function stamped(userText) {
  const time = new Date().toString().replace(/:\d\d (?=GMT)/, ' ');
  return `${userText}\n[local time: ${time}]`;
}

function outputText(response) {
  return (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('')
    .trim();
}

/** Conversation state + the tool-calling loop. */
export class JarvisBrain {
  history = [];
  // Counts user utterances; tools that need the user's answer first
  // (deleting Telegram messages) check it. Never reset.
  turns = 0;

  reset() {
    this.history = [];
  }

  /** Adds something JARVIS said on its own (e.g. announced messages). */
  note(text) {
    this.history.push({ role: 'assistant', content: text });
    this.trimHistory();
  }

  trimHistory() {
    if (this.history.length <= MAX_HISTORY_ITEMS) return;
    // Tool calls of earlier turns go first: a long laptop task can make
    // 20+ of them, which would push out what the user actually asked
    // («…tell Claude to analyse the project») a turn ago.
    const lastUser = this.history.findLastIndex((item) => item.role === 'user');
    if (lastUser > 0) {
      this.history = [
        ...this.history
          .slice(0, lastUser)
          .filter(
            (item) =>
              item.type !== 'function_call' &&
              item.type !== 'function_call_output'
          ),
        ...this.history.slice(lastUser),
      ];
      if (this.history.length <= MAX_HISTORY_ITEMS) return;
    }
    // One turn alone can exceed the limit (12 rounds of tools): then keep
    // only what was said.
    this.history = this.history.filter((item) => item.role);
    if (this.history.length <= MAX_HISTORY_ITEMS) return;
    let start = this.history.length - MAX_HISTORY_ITEMS;
    // Never start on a tool result whose call was trimmed away.
    while (start < this.history.length && this.history[start].role !== 'user') {
      start++;
    }
    this.history = this.history.slice(start);
  }

  /**
   * Sends the user's words, runs any tools the model asks for, and returns
   * `{ text, after: [fn], endConversation, resetConversation }`.
   */
  async respond(userText, { signal, onToolStart } = {}) {
    const turn = ++this.turns;
    const input = [
      ...this.history,
      { role: 'user', content: stamped(userText) },
    ];
    const after = [];
    let endConversation = false;
    let resetConversation = false;
    let keepOpen = false;
    let emptyReplies = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await createResponse(
        {
          instructions: JARVIS_INSTRUCTIONS,
          input,
          tools: TOOL_DEFINITIONS,
          cacheKey: CACHE_KEY,
          reasoning: CHAT_REASONING_EFFORT,
        },
        { signal }
      );
      const calls = (response.output || []).filter(
        (item) => item.type === 'function_call'
      );
      const text = outputText(response);

      // A sign-off or "chat cleared" that comes with only final tools needs
      // no follow-up.
      const onlyFinal =
        calls.length > 0 && calls.every((c) => FINAL_TOOLS.has(c.name));

      if (!calls.length || (onlyFinal && text)) {
        for (const c of calls) {
          if (c.name === 'end_conversation') endConversation = true;
          if (c.name === 'reset_conversation') resetConversation = true;
        }
        // Nothing to say and nothing to do (e.g. the reply was cut off at
        // the token limit): ask once more, then fail out loud. A sign-off
        // may be silent.
        if (!text && !endConversation) {
          if (__DEV__) {
            console.log(
              `[brain] empty reply: status=${response.status} reason=${response.incomplete_details?.reason}`
            );
          }
          if (++emptyReplies < 2) continue;
          throw new OpenAIError('empty', 'The model returned an empty reply');
        }
        input.push({ role: 'assistant', content: text || '…' });
        this.history = input;
        this.trimHistory();
        return { text, after, endConversation, resetConversation, keepOpen };
      }

      // Start every call of the round now if all are read-only lookups;
      // otherwise each starts when the one before it has finished.
      const parallel =
        calls.length > 1 && calls.every((c) => PARALLEL_TOOLS.has(c.name));
      const runs = [];
      const run = (call) => {
        if (!runs[call.index]) {
          onToolStart?.(call.name);
          const started = Date.now();
          runs[call.index] = Promise.resolve()
            .then(() => {
              const args = call.arguments ? JSON.parse(call.arguments) : {};
              return runToolInTime(call.name, args, { signal, turn });
            })
            .then(
              (result) => ({ result }),
              (error) => ({ error })
            )
            .finally(() => {
              if (__DEV__) {
                console.log(
                  `[perf] tool ${call.name} ${Date.now() - started}ms`
                );
              }
            });
        }
        return runs[call.index];
      };
      calls.forEach((call, index) => (call.index = index));
      if (parallel) calls.forEach(run);

      for (const call of calls) {
        signal?.throwIfAborted?.();
        let output;
        const { result, error } = await run(call);
        if (error) {
          if (signal?.aborted) throw error;
          output = { error: error.message };
        } else {
          output = result.output;
          if (result.after) after.push(result.after);
          if (result.keepOpen) keepOpen = true;
          // The alarm is raised by the engine, with its own countdown.
          if (result.sos === 'start') {
            input.push({
              role: 'assistant',
              content: '[SOS countdown started]',
            });
            this.history = input.filter((item) => item.role);
            this.trimHistory();
            return { text: '', after: [], sos: 'start' };
          }
          if (result.endConversation) endConversation = true;
          if (result.resetConversation) resetConversation = true;
        }
        if (__DEV__) {
          console.log(
            `[tool] ${call.name} ${call.arguments || '{}'} -> ${JSON.stringify(output)}`
          );
        }
        input.push(
          {
            type: 'function_call',
            call_id: call.call_id,
            name: call.name,
            arguments: call.arguments,
          },
          {
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(output),
          }
        );
      }
    }

    // Out of rounds: one last call without tools, so JARVIS says what it
    // did and what is left instead of a canned line.
    let text = '';
    try {
      text = outputText(
        await createResponse(
          {
            instructions: JARVIS_INSTRUCTIONS,
            cacheKey: CACHE_KEY,
            reasoning: CHAT_REASONING_EFFORT,
            input: [
              ...input,
              {
                role: 'developer',
                content:
                  'Step limit reached: no more tools this turn. In one or two spoken sentences tell the user what you did and what is left; offer to continue if it makes sense.',
              },
            ],
            tools: TOOL_DEFINITIONS,
            toolChoice: 'none',
          },
          { signal }
        )
      );
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    if (!text) {
      text =
        speechLanguage(userText) === 'ru'
          ? 'Сэр, задача оказалась сложнее, чем ожидалось.'
          : 'Sir, the task turned out to be harder than expected.';
    }
    input.push({ role: 'assistant', content: text });
    this.history = input;
    this.trimHistory();
    return {
      text,
      after,
      endConversation,
      resetConversation,
      keepOpen,
    };
  }
}
