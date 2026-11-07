import { fetch as expoFetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import {
  MODELS,
  OPENAI_API_KEY,
  TRANSCRIBE_PROMPT,
  TTS_INSTRUCTIONS,
} from '../config/jarvis';

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
export async function transcribe(wavBytes, { signal } = {}) {
  const { body, contentType } = multipart(
    {
      model: MODELS.transcribe,
      prompt: TRANSCRIBE_PROMPT,
    },
    { name: 'utterance.wav', type: 'audio/wav', bytes: wavBytes }
  );

  const res = await fetch(`${API}/audio/transcriptions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': contentType },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`Transcription failed: ${await readError(res)}`);
  const data = await res.json();
  return (data.text || '').trim();
}

/** One call to the Responses API. Returns the raw response object. */
export async function createResponse(
  { instructions, input, tools },
  { signal } = {}
) {
  const res = await fetch(`${API}/responses`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.chat,
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

/** Text-to-speech. Writes an mp3 to the cache and returns its File. */
export async function synthesizeSpeech(text, voice, { signal, file } = {}) {
  const res = await expoFetch(`${API}/audio/speech`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.tts,
      voice,
      input: text,
      instructions: TTS_INSTRUCTIONS,
      response_format: 'mp3',
    }),
    signal,
  });
  if (!res.ok) throw new Error(`TTS failed: ${await readError(res)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const out =
    file ??
    new File(
      Paths.cache,
      `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
    );
  await out.write(bytes);
  return out;
}
