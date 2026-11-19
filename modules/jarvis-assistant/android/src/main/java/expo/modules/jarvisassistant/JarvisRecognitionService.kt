package expo.modules.jarvisassistant

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import android.util.Log

private const val TAG = "JarvisRecognition"

// Preferred engines to hand speech recognition to, best first.
private val PREFERRED = listOf(
  "com.google.android.googlequicksearchbox",
  "com.google.android.as",
  "com.google.android.tts",
  "com.samsung.android.bixby.agent"
)

/**
 * Android requires every digital assistant to provide a speech recognizer,
 * and while JARVIS is the assistant other apps (voice typing, voice search)
 * may be pointed at it. JARVIS's own recognition runs in JS, so this one
 * forwards each request to the device's regular recognizer, and those apps
 * keep working.
 */
class JarvisRecognitionService : RecognitionService() {
  private var recognizer: SpeechRecognizer? = null

  override fun onStartListening(recognizerIntent: Intent, listener: Callback) {
    recognizer?.destroy()
    recognizer = null
    val target = delegate()
    if (target == null) {
      Log.w(TAG, "No other speech recognizer on this device")
      safely { listener.error(SpeechRecognizer.ERROR_CLIENT) }
      return
    }
    recognizer = SpeechRecognizer.createSpeechRecognizer(this, target).apply {
      setRecognitionListener(Forwarder(listener))
      startListening(recognizerIntent)
    }
  }

  override fun onStopListening(listener: Callback) {
    recognizer?.stopListening()
  }

  override fun onCancel(listener: Callback) {
    recognizer?.cancel()
  }

  override fun onDestroy() {
    recognizer?.destroy()
    recognizer = null
    super.onDestroy()
  }

  private fun delegate(): ComponentName? {
    val others = packageManager
      .queryIntentServices(Intent(SERVICE_INTERFACE), 0)
      .map { ComponentName(it.serviceInfo.packageName, it.serviceInfo.name) }
      .filter { it.packageName != packageName }
    return PREFERRED.firstNotNullOfOrNull { pkg -> others.firstOrNull { it.packageName == pkg } }
      ?: others.firstOrNull()
  }

  private class Forwarder(private val out: Callback) : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = safely { out.readyForSpeech(params ?: Bundle()) }
    override fun onBeginningOfSpeech() = safely { out.beginningOfSpeech() }
    override fun onRmsChanged(rmsdB: Float) = safely { out.rmsChanged(rmsdB) }
    override fun onBufferReceived(buffer: ByteArray?) = safely { buffer?.let { out.bufferReceived(it) } }
    override fun onEndOfSpeech() = safely { out.endOfSpeech() }
    override fun onError(error: Int) = safely { out.error(error) }
    override fun onResults(results: Bundle?) = safely { out.results(results ?: Bundle()) }
    override fun onPartialResults(partialResults: Bundle?) =
      safely { out.partialResults(partialResults ?: Bundle()) }
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
  }
}

// The caller may have gone away (RemoteException); nothing to do then.
private inline fun safely(block: () -> Unit) {
  try {
    block()
  } catch (e: Exception) {
    Log.w(TAG, "Recognition callback failed", e)
  }
}
