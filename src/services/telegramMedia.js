import { createAudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Phone from '../../modules/jarvis-phone';
import * as Td from '../../modules/jarvis-telegram';
import { TELEGRAM_MEDIA } from '../config/jarvis';
import { mediaViewer } from './mediaViewer';
import { analyzeImage, transcribeRecording } from './openai';
import { getChat, messageSender, requireReady, titleOf } from './telegramChats';

/**
 * Photos, videos and voice messages of Telegram chats: JARVIS can look at
 * them (vision model), show them on screen, play them and write down what
 * is said in them. Files are downloaded by TDLib into its own cache.
 */

const ft = (formatted) =>
  typeof formatted === 'string' ? formatted : formatted?.text || '';

/** What a message carries: { kind, file, thumb, duration, mime, caption }. */
function mediaOf(content) {
  const caption = ft(content?.caption) || undefined;
  switch (content?.['@type']) {
    case 'messagePhoto':
      return { kind: 'photo', sizes: content.photo?.sizes || [], caption };
    case 'messageVideo':
      return {
        kind: 'video',
        file: content.video?.video,
        thumb: content.video?.thumbnail?.file,
        duration: content.video?.duration,
        mime: content.video?.mime_type,
        caption,
      };
    case 'messageAnimation':
      return {
        kind: 'video',
        gif: true,
        file: content.animation?.animation,
        thumb: content.animation?.thumbnail?.file,
        duration: content.animation?.duration,
        mime: content.animation?.mime_type,
        caption,
      };
    case 'messageVideoNote':
      return {
        kind: 'video_message',
        file: content.video_note?.video,
        thumb: content.video_note?.thumbnail?.file,
        duration: content.video_note?.duration,
        mime: 'video/mp4',
      };
    case 'messageVoiceNote':
      return {
        kind: 'voice_message',
        file: content.voice_note?.voice,
        duration: content.voice_note?.duration,
        mime: content.voice_note?.mime_type || 'audio/ogg',
        caption,
      };
    case 'messageAudio':
      return {
        kind: 'audio',
        file: content.audio?.audio,
        duration: content.audio?.duration,
        mime: content.audio?.mime_type || 'audio/mpeg',
        name: content.audio?.file_name,
        caption,
      };
    case 'messageDocument': {
      // A photo or video sent "as a file".
      const mime = content.document?.mime_type || '';
      const file = content.document?.document;
      const name = content.document?.file_name;
      if (/^image\/(jpeg|png|webp)$/.test(mime)) {
        return { kind: 'photo', file, mime, name, caption };
      }
      if (mime.startsWith('video/')) {
        return { kind: 'video', file, mime, name, caption };
      }
      if (mime.startsWith('audio/')) {
        return { kind: 'audio', file, mime, name, caption };
      }
      return null;
    }
    default:
      return null;
  }
}

const VISUAL = new Set(['photo', 'video', 'video_message']);
const AUDIBLE = new Set(['voice_message', 'audio', 'video_message', 'video']);
const SUPPORTED = {
  describe: VISUAL,
  show: VISUAL,
  play: AUDIBLE,
  transcribe: AUDIBLE,
};

/** The photo size to use: the largest, or the largest up to `maxSide`. */
function photoFile(media, maxSide) {
  if (media.file) return media.file;
  const sizes = [...media.sizes].sort(
    (a, b) => a.width * a.height - b.width * b.height
  );
  if (!sizes.length) return null;
  const fitting = sizes.filter((s) => Math.max(s.width, s.height) <= maxSide);
  return (maxSide && fitting.length ? fitting.pop() : sizes.pop()).photo;
}

/** Downloads a TDLib file (if it isn't on the phone yet); resolves with its path. */
async function download(
  file,
  { signal, maxMb = TELEGRAM_MEDIA.maxDownloadMb }
) {
  if (!file) throw new Error('The message has no file to download.');
  if (file.local?.is_downloading_completed && file.local.path) {
    return file.local.path;
  }
  const mb = (file.size || file.expected_size || 0) / 1e6;
  if (mb > maxMb) {
    throw new Error(
      `The file is too large: ${Math.round(mb)} MB (the limit is ${maxMb} MB).`
    );
  }
  const cancel = () =>
    Td.send({
      '@type': 'cancelDownloadFile',
      file_id: file.id,
      only_if_pending: false,
    }).catch(() => {});
  let timer;
  let onAbort;
  try {
    const done = await Promise.race([
      Td.send({
        '@type': 'downloadFile',
        file_id: file.id,
        priority: 32,
        offset: 0,
        limit: 0,
        synchronous: true,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The download took too long.')),
          TELEGRAM_MEDIA.downloadTimeoutMs + mb * TELEGRAM_MEDIA.downloadMsPerMb
        );
        onAbort = () => reject(new Error('Cancelled.'));
        signal?.addEventListener('abort', onAbort);
      }),
    ]);
    if (!done.local?.path) throw new Error('The download did not finish.');
    return done.local.path;
  } catch (e) {
    cancel();
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const uriOf = (path) => (path.startsWith('file://') ? path : `file://${path}`);

const imageMime = (path) =>
  /\.png$/i.test(path)
    ? 'image/png'
    : /\.webp$/i.test(path)
      ? 'image/webp'
      : 'image/jpeg';

/** The newest message in the chat that `action` can work with. */
async function latestWithMedia(chatId, action) {
  const { messages = [] } = await Td.send({
    '@type': 'getChatHistory',
    chat_id: chatId,
    from_message_id: 0,
    offset: 0,
    limit: TELEGRAM_MEDIA.lookBack,
    only_local: false,
  });
  // The first call may return only the last message; ask for the rest.
  let all = messages;
  if (messages.length && messages.length < TELEGRAM_MEDIA.lookBack) {
    const more = await Td.send({
      '@type': 'getChatHistory',
      chat_id: chatId,
      from_message_id: messages[messages.length - 1].id,
      offset: 0,
      limit: TELEGRAM_MEDIA.lookBack,
      only_local: false,
    });
    all = [...messages, ...(more.messages || [])];
  }
  return all.find((m) => {
    const media = mediaOf(m.content);
    return media && SUPPORTED[action].has(media.kind);
  });
}

/** Plays an audio file to the end; stops early when `signal` aborts. */
export function playAudio(uri, { signal } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const player = createAudioPlayer({ uri });
    let finished = false;
    let watchdog;
    let armed = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      sub.remove();
      signal?.removeEventListener('abort', finish);
      try {
        player.pause();
        player.remove();
      } catch {
        // already released
      }
      resolve();
    };
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish();
      if (status.isLoaded && status.duration > 0 && !armed) {
        armed = true;
        clearTimeout(watchdog);
        watchdog = setTimeout(finish, status.duration * 1000 + 3000);
      }
    });
    // Until the real duration is known: a file that never loads ends here.
    watchdog = setTimeout(finish, 20000);
    signal?.addEventListener('abort', finish);
    player.play();
  });
}

/** A few frames across a video as base64 JPEGs; its preview when that fails. */
async function videoFrames(path, previewPath) {
  try {
    const frames = await Phone.videoFrames(
      path,
      TELEGRAM_MEDIA.videoFrames,
      TELEGRAM_MEDIA.frameMaxSide
    );
    if (frames?.length) return { images: frames, mime: 'image/jpeg' };
  } catch (e) {
    if (__DEV__) console.warn('Video frames failed:', e.message);
  }
  const thumb = await previewPath?.().catch(() => null);
  if (!thumb) throw new Error('Could not read the video.');
  return {
    images: [await new File(uriOf(thumb)).base64()],
    mime: imageMime(thumb),
    previewOnly: true,
  };
}

async function transcribeFile(media, path, signal) {
  const file = new File(uriOf(path));
  if ((file.size || 0) > TELEGRAM_MEDIA.maxTranscribeMb * 1e6) {
    throw new Error('The recording is too long to transcribe.');
  }
  const video = media.kind === 'video' || media.kind === 'video_message';
  // OpenAI goes by the file extension; Telegram voice files end in .oga.
  const ext = video
    ? 'mp4'
    : media.kind === 'voice_message'
      ? 'ogg'
      : /\.(mp3|m4a|wav|ogg|webm|flac)$/i.exec(path)?.[1]?.toLowerCase() ||
        'mp3';
  return transcribeRecording(
    {
      bytes: await file.bytes(),
      name: `recording.${ext}`,
      type: video ? 'video/mp4' : media.mime || 'audio/ogg',
    },
    { signal, timeoutMs: TELEGRAM_MEDIA.transcribeTimeoutMs }
  );
}

/**
 * action: 'describe' (look at a photo or video and answer `question`),
 * 'show' (put it on screen), 'play' (voice message, audio; a video opens on
 * screen), 'transcribe' (what is said in a voice or video message),
 * 'close' (take the photo or video off the screen).
 * messageId 0 means the newest message in the chat the action fits.
 * Returns a tool result: { output, after?, keepOpen? }.
 */
export async function telegramMedia(
  { chatId, messageId, action, question },
  { signal } = {}
) {
  if (action === 'close') {
    return {
      output: { status: mediaViewer.hide() ? 'closed' : 'nothing_open' },
    };
  }
  if (!SUPPORTED[action]) return { output: { error: 'Unknown action.' } };
  await requireReady();
  const chat = await getChat(chatId);
  const message = Number(messageId)
    ? await Td.send({
        '@type': 'getMessage',
        chat_id: chat.id,
        message_id: Number(messageId),
      })
    : await latestWithMedia(chat.id, action);
  if (!message) {
    return {
      output: {
        error: `No recent message in this chat has something to ${action}.`,
      },
    };
  }
  const media = mediaOf(message.content);
  if (!media || !SUPPORTED[action].has(media.kind)) {
    return {
      output: {
        error: media
          ? `A ${media.kind.replace('_', ' ')} can't be used with ${action}.`
          : 'That message has no photo, video or voice message.',
      },
    };
  }

  const info = {
    chat: titleOf(chat),
    message_id: message.id,
    from: await messageSender(message),
    kind: media.gif ? 'GIF' : media.kind,
    duration_s: media.duration || undefined,
    caption: media.caption,
  };

  // A photo goes to the vision model in a moderate size, to the screen in full.
  const file =
    media.kind === 'photo'
      ? photoFile(
          media,
          action === 'describe' ? TELEGRAM_MEDIA.visionMaxSide : 0
        )
      : media.file;
  const path = await download(file, {
    signal,
    maxMb: action === 'transcribe' ? TELEGRAM_MEDIA.maxTranscribeMb : undefined,
  });
  return actOnFile(
    {
      action,
      media,
      path,
      question,
      info,
      title: info.from === 'me' ? titleOf(chat) : info.from,
      previewPath: () => download(media.thumb, { signal }),
    },
    { signal }
  );
}

/**
 * The action itself, on a file that is already on the phone. `media` is
 * { kind, gif?, mime? }; `previewPath()` gets a video's preview image for
 * when its frames can't be read.
 */
export async function actOnFile(
  { action, media, path, question, info = {}, title = '', previewPath },
  { signal } = {}
) {
  const isVideo = media.kind === 'video' || media.kind === 'video_message';
  switch (action) {
    case 'describe': {
      if (!isVideo) {
        const description = await analyzeImage(
          {
            base64: await new File(uriOf(path)).base64(),
            mime: imageMime(path),
            question,
          },
          { signal }
        );
        return { output: { ...info, description } };
      }
      const frames = await videoFrames(path, previewPath);
      const description = await analyzeImage(
        {
          images: frames.images,
          mime: frames.mime,
          question:
            `${question || 'What happens in this video?'}\n` +
            (frames.previewOnly
              ? '(This is the preview frame of a video.)'
              : '(These are frames of one video, in order.)'),
        },
        { signal }
      );
      return {
        output: {
          ...info,
          description,
          note: 'Seen as still frames, without sound. Use transcribe for what is said.',
        },
      };
    }

    case 'transcribe': {
      const transcript = await transcribeFile(media, path, signal);
      return {
        output: { ...info, transcript: transcript || '(no speech heard)' },
      };
    }

    case 'show':
      return {
        output: { ...info, status: 'on_screen_after_reply' },
        after: () =>
          mediaViewer.show({
            kind: isVideo ? 'video' : 'photo',
            uri: uriOf(path),
            title,
            loop: !!media.gif,
          }),
      };

    case 'play': {
      if (isVideo) {
        return {
          output: { ...info, status: 'playing_on_screen_after_reply' },
          after: () =>
            mediaViewer.show({ kind: 'video', uri: uriOf(path), title }),
        };
      }
      const play = (context) => playAudio(uriOf(path), context);
      play.label = 'Playing…';
      return {
        output: {
          ...info,
          status: 'plays_right_after_your_reply',
          note: 'Say only a few words (who it is from); the recording itself plays next.',
        },
        after: play,
        keepOpen: true,
      };
    }

    default:
      return { output: { error: 'Unknown action.' } };
  }
}
