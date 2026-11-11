import { MODELS, OPENAI_API_KEY, TRANSCRIBE_PROMPT } from '../config/jarvis';
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

/** Speech-to-text for WAV bytes. */
export async function transcribe(wavBytes, { signal, timeoutMs } = {}) {
  const { body, contentType } = multipart(
    {
      model: MODELS.transcribe,
      prompt: TRANSCRIBE_PROMPT,
    },
    { name: 'utterance.wav', type: 'audio/wav', bytes: wavBytes }
  );

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

/** One call to the Responses API. Returns the raw response object. */
export async function createResponse(
  { model = MODELS.chat, instructions, input, tools },
  { signal } = {}
) {
  const res = await fetch(`${API}/responses`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions,
      input,
      tools,
      store: false,
      max_output_tokens: 700,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await readError(res)}`);
  return res.json();
}

const VISION_INSTRUCTIONS = `
You are the visual sensor of J.A.R.V.I.S. You receive one photo from the user's phone camera and the user's question about it.
Report what is relevant to the question, factually and compactly: identify objects, products, plants, animals, places; read any visible text verbatim (and translate it if asked); give counts, colours, condition, notable details and possible hazards.
Do not identify real people by their face; you may describe them.
If the photo is blurry, too dark or does not show what was asked, say so plainly.
Answer in the language of the question. Plain text, no markdown.
`.trim();

/** Analyses a JPEG (base64) with the vision model and returns plain text. */
export async function analyzeImage({ base64, question }, { signal } = {}) {
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
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${base64}`,
              detail: 'auto',
            },
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
