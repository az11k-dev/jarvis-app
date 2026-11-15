package expo.modules.jarvisphone

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Still frames of a video file, for the vision model. */
internal object VideoFrames {
  fun extract(path: String, count: Int, maxSide: Int): List<String> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(path)
      val durationMs = retriever
        .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
        ?.toLongOrNull() ?: 0L
      val n = if (durationMs < 1500) 1 else count.coerceIn(1, 8)
      val frames = ArrayList<String>()
      for (i in 0 until n) {
        // The middle of each of n equal parts, so the first frame isn't a black fade-in.
        val atUs = durationMs * 1000 * (2 * i + 1) / (2 * n)
        val frame = retriever.getFrameAtTime(atUs, MediaMetadataRetriever.OPTION_CLOSEST)
          ?: continue
        val scale = maxSide.toFloat() / maxOf(frame.width, frame.height)
        val bitmap = if (scale < 1f) {
          Bitmap.createScaledBitmap(
            frame,
            (frame.width * scale).toInt().coerceAtLeast(1),
            (frame.height * scale).toInt().coerceAtLeast(1),
            true
          )
        } else {
          frame
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
        frames.add(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
        if (bitmap !== frame) bitmap.recycle()
        frame.recycle()
      }
      return frames
    } finally {
      retriever.release()
    }
  }
}
