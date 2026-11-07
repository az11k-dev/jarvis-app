import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { GITHUB_OWNER, VISION_PHOTO_QUALITY } from '../config/jarvis';
import { getLatestCommits } from '../core/github/commits';
import { createGitHubRepo } from '../core/github/createRepo';
import { deleteGitHubRepo } from '../core/github/deleteRepo';
import { scheduleReminder } from './notificationsService';
import { analyzeImage } from './openai';
import { scanWithCamera } from './scanner';

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
  fn(
    'open_camera',
    'Just open the camera app for the user to take a photo themselves, without analysing it.'
  ),
  fn('open_telegram', 'Open the Telegram app.'),
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
    'create_github_repo',
    `Create a GitHub repository for ${GITHUB_OWNER}.`,
    {
      name: {
        type: 'string',
        description:
          'Repository name: lowercase latin letters, digits, dashes.',
      },
      private: { type: 'boolean', description: 'Private repo. Default false.' },
    },
    ['name']
  ),
  fn(
    'delete_github_repo',
    `Delete a GitHub repository of ${GITHUB_OWNER}. The app asks the user to confirm on screen.`,
    { name: { type: 'string', description: 'Repository name.' } },
    ['name']
  ),
  fn(
    'get_latest_commits',
    'List the latest commits of a GitHub repository.',
    {
      count: { type: 'integer', description: 'How many commits. Default 5.' },
      repo: {
        type: 'string',
        description: 'Repository name. Default jarvis-app.',
      },
    },
    []
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

async function launchCamera() {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') return;
  await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
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

function confirmDelete(name) {
  return new Promise((resolve) => {
    Alert.alert(
      'Подтвердите удаление',
      `Удалить репозиторий ${GITHUB_OWNER}/${name}? Это необратимо.`,
      [
        { text: 'Отмена', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Удалить', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

/**
 * Executes a tool call. Returns `{ output, after?, endConversation? }`.
 * `after` runs once JARVIS has finished speaking (used for anything that
 * switches to another app, so the reply isn't cut off).
 */
export async function runTool(name, args, { signal } = {}) {
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

    case 'open_camera':
      return { output: { status: 'opening_after_reply' }, after: launchCamera };

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
      await scheduleReminder(args.text, seconds);
      const at = new Date(Date.now() + seconds * 1000);
      return {
        output: { status: 'scheduled', fires_at: at.toString() },
      };
    }

    case 'create_github_repo': {
      const url = await createGitHubRepo({
        name: args.name,
        private: !!args.private,
      });
      return { output: { status: 'created', url } };
    }

    case 'delete_github_repo': {
      const confirmed = await confirmDelete(args.name);
      if (!confirmed) return { output: { status: 'cancelled_by_user' } };
      await deleteGitHubRepo(GITHUB_OWNER, args.name);
      return { output: { status: 'deleted' } };
    }

    case 'get_latest_commits': {
      const commits = await getLatestCommits(args.count || 5, args.repo);
      return {
        output: commits.map((c) => ({
          author: c.author,
          message: c.message.split('\n')[0],
          date: c.date,
        })),
      };
    }

    case 'end_conversation':
      return { output: { status: 'standing_by' }, endConversation: true };

    default:
      return { output: { error: `Unknown tool ${name}` } };
  }
}
