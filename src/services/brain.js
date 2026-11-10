import { JARVIS_INSTRUCTIONS } from '../utils/constants';
import { createResponse } from './openai';
import { runTool, TOOL_DEFINITIONS } from './tools';

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_ITEMS = 30;

function instructions() {
  const now = new Date();
  return `${JARVIS_INSTRUCTIONS}\n\nCurrent local date and time: ${now.toString()}.`;
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
  // (sending a Telegram draft) check it. Never reset.
  turns = 0;

  reset() {
    this.history = [];
  }

  trimHistory() {
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
   * `{ text, after: [fn], endConversation }`.
   */
  async respond(userText, { signal, onToolStart } = {}) {
    const turn = ++this.turns;
    const input = [...this.history, { role: 'user', content: userText }];
    const after = [];
    let endConversation = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await createResponse(
        { instructions: instructions(), input, tools: TOOL_DEFINITIONS },
        { signal }
      );
      const calls = (response.output || []).filter(
        (item) => item.type === 'function_call'
      );
      const text = outputText(response);

      // A sign-off that comes with only end_conversation needs no follow-up.
      const onlyEnding =
        calls.length > 0 && calls.every((c) => c.name === 'end_conversation');

      if (!calls.length || (onlyEnding && text)) {
        if (onlyEnding) endConversation = true;
        input.push({ role: 'assistant', content: text || '…' });
        this.history = input;
        this.trimHistory();
        return { text, after, endConversation };
      }

      for (const call of calls) {
        signal?.throwIfAborted?.();
        onToolStart?.(call.name);
        let output;
        try {
          const args = call.arguments ? JSON.parse(call.arguments) : {};
          const result = await runTool(call.name, args, { signal, turn });
          output = result.output;
          if (result.after) after.push(result.after);
          if (result.endConversation) endConversation = true;
        } catch (e) {
          output = { error: e.message };
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

    this.history = input;
    this.trimHistory();
    return {
      text: 'Сэр, задача оказалась сложнее, чем ожидалось.',
      after,
      endConversation,
    };
  }
}
