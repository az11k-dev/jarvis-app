package expo.modules.jarvisspeech

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * On-device speech for JARVIS, backed by sherpa-onnx:
 *  - downloads and unpacks model archives into filesDir/speech-models/<id>
 *  - speech-to-text with an offline transducer model
 *  - text-to-speech with Piper (VITS) voices, written to WAV files
 *
 * Each kind of work has its own single thread, so recognition never waits
 * behind synthesis and native objects are only touched from one thread.
 */
class JarvisSpeechModule : Module() {
  private val downloadThread: ExecutorService = Executors.newSingleThreadExecutor()
  private val sttThread: ExecutorService = Executors.newSingleThreadExecutor()
  private val ttsThread: ExecutorService = Executors.newSingleThreadExecutor()

  // Touched only on sttThread / ttsThread respectively.
  private var recognizer: OfflineRecognizer? = null
  private val voices = HashMap<String, OfflineTts>()

  private val modelsRoot: File
    get() {
      val context = appContext.reactContext ?: throw IOException("No Android context")
      return File(context.filesDir, "speech-models").apply { mkdirs() }
    }

  override fun definition() = ModuleDefinition {
    Name("JarvisSpeech")

    Events("onDownloadProgress")

    OnDestroy {
      sttThread.execute {
        recognizer?.release()
        recognizer = null
      }
      ttsThread.execute {
        voices.values.forEach { it.release() }
        voices.clear()
      }
      downloadThread.shutdown()
      sttThread.shutdown()
      ttsThread.shutdown()
    }

    Function("modelsDir") { modelsRoot.absolutePath }

    /** Ids of models that finished downloading and unpacking. */
    Function("installedModels") {
      val dirs: Array<File> = modelsRoot.listFiles() ?: emptyArray()
      dirs.filter { File(it, COMPLETE_MARKER).exists() }.map { it.name }
    }

    /**
     * Streams a .tar.bz2 archive from [url] and unpacks it into
     * speech-models/[id], dropping the archive's top-level folder. Entries
     * matching [exclude] ("dir/" prefixes or "*.ext" suffixes) are skipped.
     */
    AsyncFunction("downloadModel") { id: String, url: String, exclude: List<String>, promise: Promise ->
      downloadThread.execute {
        try {
          promise.resolve(download(id, url, exclude).absolutePath)
        } catch (e: Throwable) {
          promise.reject("ERR_DOWNLOAD", "Could not download $id: ${e.message}", e)
        }
      }
    }

    AsyncFunction("deleteModel") { id: String, promise: Promise ->
      downloadThread.execute {
        File(modelsRoot, id).deleteRecursively()
        promise.resolve(null)
      }
    }

    AsyncFunction("loadRecognizer") { dir: String, numThreads: Int, promise: Promise ->
      sttThread.execute {
        try {
          recognizer?.release()
          recognizer = null
          val config = OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
            modelConfig = OfflineModelConfig(
              transducer = OfflineTransducerModelConfig(
                encoder = "$dir/encoder.int8.onnx",
                decoder = "$dir/decoder.int8.onnx",
                joiner = "$dir/joiner.int8.onnx",
              ),
              tokens = "$dir/tokens.txt",
              modelType = "nemo_transducer",
              numThreads = numThreads,
            ),
          )
          recognizer = OfflineRecognizer(config = config)
          promise.resolve(null)
        } catch (e: Throwable) {
          promise.reject("ERR_STT_LOAD", e.message ?: e.toString(), e)
        }
      }
    }

    /** Transcribes a 16-bit PCM mono WAV file. */
    AsyncFunction("transcribe") { wavPath: String, promise: Promise ->
      sttThread.execute {
        try {
          val rec = recognizer ?: throw IllegalStateException("Recognizer is not loaded")
          val (samples, sampleRate) = readPcm16Wav(File(wavPath))
          val stream = rec.createStream()
          try {
            stream.acceptWaveform(samples, sampleRate)
            rec.decode(stream)
            promise.resolve(rec.getResult(stream).text.trim())
          } finally {
            stream.release()
          }
        } catch (e: Throwable) {
          promise.reject("ERR_STT", e.message ?: e.toString(), e)
        }
      }
    }

    /** Loads a Piper voice under [key]; [files] holds model, tokens, dataDir. */
    AsyncFunction("loadVoice") { key: String, files: Map<String, String>, numThreads: Int, promise: Promise ->
      ttsThread.execute {
        try {
          if (!voices.containsKey(key)) {
            val model = OfflineTtsModelConfig(
              vits = OfflineTtsVitsModelConfig(
                model = files.getValue("model"),
                tokens = files.getValue("tokens"),
                dataDir = files.getValue("dataDir"),
              ),
              numThreads = numThreads,
            )
            voices[key] = OfflineTts(config = OfflineTtsConfig(model = model))
          }
          promise.resolve(null)
        } catch (e: Throwable) {
          promise.reject("ERR_TTS_LOAD", e.message ?: e.toString(), e)
        }
      }
    }

    AsyncFunction("unloadVoice") { key: String, promise: Promise ->
      ttsThread.execute {
        voices.remove(key)?.release()
        promise.resolve(null)
      }
    }

    /** Synthesizes [text] into a WAV file at [outPath]; returns its duration. */
    AsyncFunction("synthesize") { key: String, text: String, sid: Int, speed: Double, outPath: String, promise: Promise ->
      ttsThread.execute {
        try {
          val tts = voices[key] ?: throw IllegalStateException("Voice $key is not loaded")
          val audio = tts.generate(text = text, sid = sid, speed = speed.toFloat())
          if (audio.samples.isEmpty()) throw IllegalStateException("Voice produced no audio")
          File(outPath).parentFile?.mkdirs()
          if (!audio.save(outPath)) throw IOException("Could not write $outPath")
          promise.resolve(
            mapOf(
              "duration" to audio.samples.size.toDouble() / audio.sampleRate,
              "sampleRate" to audio.sampleRate,
            )
          )
        } catch (e: Throwable) {
          promise.reject("ERR_TTS", e.message ?: e.toString(), e)
        }
      }
    }
  }

  // ── downloads ──────────────────────────────────────────────────────────

  private fun download(id: String, url: String, exclude: List<String>): File {
    val root = modelsRoot
    val target = File(root, id)
    if (File(target, COMPLETE_MARKER).exists()) return target

    val partial = File(root, "$id.partial")
    partial.deleteRecursively()
    partial.mkdirs()
    val partialPath = partial.canonicalPath + File.separator

    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 20_000
    connection.readTimeout = 60_000
    try {
      val code = connection.responseCode
      if (code !in 200..299) throw IOException("HTTP $code")
      val total = connection.contentLengthLong
      var lastReported = 0L

      val counting = CountingInputStream(BufferedInputStream(connection.inputStream, 1 shl 16)) { received ->
        if (received - lastReported >= PROGRESS_STEP_BYTES || received == total) {
          lastReported = received
          sendEvent(
            "onDownloadProgress",
            mapOf("id" to id, "received" to received.toDouble(), "total" to total.toDouble())
          )
        }
      }

      TarArchiveInputStream(BZip2CompressorInputStream(counting)).use { tar ->
        while (true) {
          val entry = tar.nextEntry ?: break
          // Drop the archive's top-level folder (some archives prefix "./").
          val relative = entry.name.removePrefix("./").substringAfter('/', "")
          if (relative.isEmpty() || isExcluded(relative, exclude)) continue
          val out = File(partial, relative)
          if (!out.canonicalPath.startsWith(partialPath)) {
            throw IOException("Unsafe path in archive: ${entry.name}")
          }
          if (entry.isDirectory) {
            out.mkdirs()
          } else if (entry.isFile) {
            out.parentFile?.mkdirs()
            out.outputStream().use { tar.copyTo(it, 1 shl 16) }
          }
        }
      }
    } finally {
      connection.disconnect()
    }

    target.deleteRecursively()
    if (!partial.renameTo(target)) throw IOException("Could not move $partial into place")
    File(target, COMPLETE_MARKER).writeText(url)
    return target
  }

  private fun isExcluded(path: String, patterns: List<String>) = patterns.any { pattern ->
    if (pattern.startsWith("*")) path.endsWith(pattern.substring(1)) else path.startsWith(pattern)
  }

  private class CountingInputStream(
    input: InputStream,
    private val onProgress: (Long) -> Unit,
  ) : FilterInputStream(input) {
    private var count = 0L

    override fun read(): Int = super.read().also { if (it >= 0) report(1) }

    override fun read(b: ByteArray, off: Int, len: Int): Int =
      super.read(b, off, len).also { if (it > 0) report(it.toLong()) }

    private fun report(n: Long) {
      count += n
      onProgress(count)
    }
  }

  // ── audio ──────────────────────────────────────────────────────────────

  /** Reads a canonical 16-bit PCM mono WAV (as written by src/audio/wav.js). */
  private fun readPcm16Wav(file: File): Pair<FloatArray, Int> {
    RandomAccessFile(file, "r").use { raf ->
      val bytes = ByteArray(raf.length().toInt())
      raf.readFully(bytes)
      val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      if (String(bytes, 0, 4) != "RIFF" || String(bytes, 8, 4) != "WAVE") {
        throw IOException("Not a WAV file")
      }
      var sampleRate = 16000
      var pos = 12
      while (pos + 8 <= bytes.size) {
        val chunkId = String(bytes, pos, 4)
        val size = buf.getInt(pos + 4)
        val body = pos + 8
        when (chunkId) {
          "fmt " -> {
            val channels = buf.getShort(body + 2).toInt()
            sampleRate = buf.getInt(body + 4)
            val bits = buf.getShort(body + 14).toInt()
            if (channels != 1 || bits != 16) throw IOException("Expected 16-bit mono WAV")
          }
          "data" -> {
            val n = minOf(size, bytes.size - body) / 2
            val samples = FloatArray(n) { i -> buf.getShort(body + i * 2) / 32768f }
            return samples to sampleRate
          }
        }
        pos = body + size + (size and 1)
      }
      throw IOException("WAV has no data chunk")
    }
  }

  companion object {
    private const val COMPLETE_MARKER = ".complete"
    private const val PROGRESS_STEP_BYTES = 512L * 1024
  }
}
