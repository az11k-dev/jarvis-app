package expo.modules.jarvisassistant

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.util.Log

private const val TAG = "JarvisAssistant"

class JarvisSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = JarvisSession(this)
}

/**
 * Runs when the assistant is invoked (long-press of the side/home button,
 * the assistant gesture, …). It has no UI of its own: it asks the engine to
 * start listening and brings the JARVIS screen up.
 */
private class JarvisSession(context: Context) : VoiceInteractionSession(context) {
  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    JarvisAssistantModule.requestAssist()

    // Prefer a plain start: startAssistantActivity() opens a second JARVIS
    // screen in a separate "assistant" task next to the normal one. Android
    // only lets the plain start through from the background while JARVIS
    // may draw over other apps; otherwise use the assistant start.
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    if (intent != null) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !Settings.canDrawOverlays(context)) {
          startAssistantActivity(intent)
        } else {
          context.startActivity(intent)
        }
      } catch (e: Exception) {
        Log.w(TAG, "Could not open JARVIS", e)
      }
    }
    hide()
  }
}
