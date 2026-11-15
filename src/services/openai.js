import {
  CHAT_TIMEOUT_MS,
  MODELS,
  OPENAI_API_KEY,
  TRANSCRIBE_PROMPT,
} from '../config/jarvis';
import { withTimeout } from '../utils/timeout';

const API = 'https://api.openai.com/v1';

export class MissingApiKeyError extends Error {
  constructor() {
    super('EXPO_PUBLIC_OPENAI_API_KEY is not set in .env');
  }
}

function authHeaders() {
  if (!OPENAI_API_KEY) throw new MissingApiKeyError();
  return { Authorization: `Bearer ${OPENAI_API_KEY}` };
}

/**
 * Why a request to OpenAI failed, so JARVIS can say what went wrong:
 * 'timeout' | 'network' | 'auth' | 'quota' | 'rate' | 'server' | 'request'
 * | 'empty' (the model answered with nothing).
 */
export class OpenAIError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function errorKind(status, message) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) {
    return /quota|billing|credit/i.test(message) ? 'quota' : 'rate';
  }
  return status >= 500 ? 'server' : 'request';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readError(res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text).error?.message || text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

/**
 * Builds a multipart/form-data body by hand. Expo's fetch (the global fetch
 * since SDK 52+) rejects React Native's `{ uri, name, type }` FormData parts,
 * and we already hold the audio in memory anyway.
 */
function multipart(fields, file) {
  const boundary = `----jarvis${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  let head = '';
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  head +=
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
    `Content-Type: ${file.type}\r\n\r\n`;
  const start = encoder.encode(head);
  const end = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(start.length + file.bytes.length + end.length);
  body.set(start, 0);
  body.set(file.bytes, start.length);
  body.set(end, start.length + file.bytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

async function postTranscription(fields, file, { signal, timeoutMs } = {}) {
  const { body, contentType } = multipart(fields, file);
  const request = withTimeout(signal, timeoutMs);
  try {
    const res = await fetch(`${API}/audio/transcriptions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': contentType },
      body,
      signal: request.signal,
    });
    if (!res.ok) {
      throw new Error(`Transcription failed: ${await readError(res)}`);
    }
    const data = await res.json();
    return (data.text || '').trim();
  } finally {
    request.cleanup();
  }
}

/** Speech-to-text for WAV bytes of what the user said to JARVIS. */
export const transcribe = (wavBytes, options) =>
  postTranscription(
    { model: MODELS.transcribe, prompt: TRANSCRIBE_PROMPT },
    { name: 'utterance.wav', type: 'audio/wav', bytes: wavBytes },
    options
  );

/**
 * Speech-to-text for someone else's recording (a Telegram voice message, the
 * sound of a video). `name` must end in a format OpenAI takes: ogg, mp3,
 * mp4, m4a, wav, webm.
 */
export const transcribeRecording = ({ bytes, name, type }, options) =>
  postTranscription(
    { model: MODELS.transcribe },
    { name, type, bytes },
    options
  );

/**
 * One call to the Responses API. Returns the raw response object.
 * Never hangs: each attempt is cut off after `timeoutMs`, and a dropped
 * connection, a 5xx or a rate limit is tried once more. Fails with an
 * OpenAIError that says why.
 */
export async function createResponse(
  { model = MODELS.chat, instructions, input, tools },
  { signal, timeoutMs = CHAT_TIMEOUT_MS } = {}
) {
  const headers = { ...authHeaders(), 'Content-Type': 'application/json' };
  const body = JSON.stringify({
    model,
    instructions,
    input,
    tools,
    store: false,
    max_output_tokens: 1500,
  });

  for (let attempt = 0; ; attempt++) {
    const request = withTimeout(signal, timeoutMs);
    let failure;
    try {
      const res = await fetch(`${API}/responses`, {
        method: 'POST',
        headers,
        body,
        signal: request.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'failed' || data.error) {
          throw new OpenAIError(
            'server',
            `OpenAI error: ${data.error?.message || 'the response failed'}`
          );
        }
        return data;
      }
      const message = await readError(res);
      failure = new OpenAIError(
        errorKind(res.status, message),
        `OpenAI error ${res.status}: ${message}`
      );
    } catch (e) {
      if (signal?.aborted) throw e; // cancelled by the user
      if (e instanceof OpenAIError) failure = e;
      else if (request.signal.aborted) {
        failure = new OpenAIError(
          'timeout',
          `OpenAI did not answer in ${Math.round(timeoutMs / 1000)} s`
        );
      } else {
        failure = new OpenAIError(
          'network',
          `Can’t reach OpenAI: ${e.message}`
        );
      }
    } finally {
      request.cleanup();
    }
    const retryable = ['network', 'server', 'rate'].includes(failure.kind);
    if (!retryable || attempt >= 1) throw failure;
    if (__DEV__) console.log(`[openai] retrying after: ${failure.message}`);
    await sleep(800);
    signal?.throwIfAborted?.();
  }
}

const VISION_INSTRUCTIONS = `
You are the visual sensor of J.A.R.V.I.S. You receive one photo (from the user's phone camera or from a message), or a few frames taken in order from one video, and the user's question about it.
Report what is relevant to the question, factually and compactly: identify objects, products, plants, animals, places; read any visible text verbatim (and translate it if asked); give counts, colours, condition, notable details and possible hazards.
Do not identify real people by their face; you may describe them.
If the photo is blurry, too dark or does not show what was asked, say so plainly.
Answer in the language of the question. Plain text, no markdown.
`.trim();

/**
 * Analyses a photo (base64 JPEG), or several frames of one video passed as
 * `images`, with the vision model and returns plain text.
 */
export async function analyzeImage(
  { base64, images, question, mime = 'image/jpeg' },
  { signal } = {}
) {
  const response = await createResponse(
    {
      model: MODELS.vision,
      instructions: VISION_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: question || 'What is in this photo?',
            },
            ...(images || [base64]).map((data) => ({
              type: 'input_image',
              image_url: `data:${mime};base64,${data}`,
              detail: 'auto',
            })),
          ],
        },
      ],
    },
    { signal }
  );
  return (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('')
    .trim();
}
