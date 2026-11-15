package expo.modules.jarvisphone

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.SystemClock
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val TIMEOUT_US = 10_000L
private const val DEADLINE_MS = 30_000L

/**
 * Turns a 16-bit mono PCM WAV into OGG/Opus, the format Telegram shows as a
 * voice message. Uses the platform Opus encoder (Android 10+).
 */
internal object VoiceNote {
  /** Returns the duration in seconds. */
  fun encode(wav: File, out: File): Double {
    val bytes = wav.readBytes()
    require(bytes.size > 44) { "Not a WAV file" }
    val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val channels = header.getShort(22).toInt()
    val sampleRate = header.getInt(24)
    require(channels == 1 && header.getShort(34).toInt() == 16) { "Only 16-bit mono WAV is supported" }

    // Find the "data" chunk (there may be others before it).
    var start = 44
    var length = bytes.size - 44
    var pos = 12
    while (pos + 8 <= bytes.size) {
      val id = String(bytes, pos, 4, Charsets.US_ASCII)
      val size = header.getInt(pos + 4)
      if (id == "data") {
        start = pos + 8
        length = minOf(size, bytes.size - start)
        break
      }
      pos += 8 + size + (size and 1)
    }
    val end = start + (length and 1.inv())

    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, sampleRate, 1).apply {
      setInteger(MediaFormat.KEY_BIT_RATE, 24_000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
    }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
    var muxer: MediaMuxer? = null
    var muxing = false
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      out.delete()
      muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG)
      val info = MediaCodec.BufferInfo()
      val deadline = SystemClock.elapsedRealtime() + DEADLINE_MS
      var track = -1
      var offset = start
      var ptsUs = 0L
      var inputDone = false
      var outputDone = false

      while (!outputDone) {
        check(SystemClock.elapsedRealtime() < deadline) { "Encoding took too long" }
        if (!inputDone) {
          val index = codec.dequeueInputBuffer(TIMEOUT_US)
          if (index >= 0) {
            val buffer = codec.getInputBuffer(index)!!
            val n = minOf(buffer.remaining(), end - offset) and 1.inv()
            if (n <= 0) {
              codec.queueInputBuffer(index, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              buffer.put(bytes, offset, n)
              codec.queueInputBuffer(index, 0, n, ptsUs, 0)
              offset += n
              ptsUs += (n / 2) * 1_000_000L / sampleRate
            }
          }
        }
        val index = codec.dequeueOutputBuffer(info, TIMEOUT_US)
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxing = true
        } else if (index >= 0) {
          val buffer = codec.getOutputBuffer(index)!!
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!isConfig && info.size > 0 && muxing) muxer.writeSampleData(track, buffer, info)
          codec.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
        }
      }
      return (end - start) / 2.0 / sampleRate
    } finally {
      try {
        codec.stop()
      } catch (e: Exception) {
        // never started
      }
      codec.release()
      try {
        if (muxing) muxer?.stop()
      } catch (e: Exception) {
        // nothing was written
      }
      muxer?.release()
    }
  }
}
