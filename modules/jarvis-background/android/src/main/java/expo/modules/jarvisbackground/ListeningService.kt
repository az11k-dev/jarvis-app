package expo.modules.jarvisbackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

private const val TAG = "JarvisListening"
private const val CHANNEL_ID = "jarvis_listening"
private const val NOTIFICATION_ID = 0x1A4F

/**
 * Foreground service of type `microphone`. While it runs, Android lets the
 * app keep capturing audio after it leaves the screen, and keeps the process
 * (and the JS runtime that does wake-word detection) alive.
 *
 * It doesn't record anything itself: the AudioStream from expo-audio keeps
 * doing that. This only holds the foreground status, a partial wake lock so
 * the CPU keeps processing audio with the screen off, and the notification.
 */
class ListeningService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      // "Stop" tapped in the notification — let JS turn the mic off too.
      JarvisBackgroundModule.notifyStopRequested()
      stopSelf()
      return START_NOT_STICKY
    }

    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "J.A.R.V.I.S."
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Listening"
    val stopLabel = intent?.getStringExtra(EXTRA_STOP_LABEL) ?: "Stop"

    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(title, text, stopLabel),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
          0
        }
      )
    } catch (e: Exception) {
      // e.g. started while the app wasn't visible (Android 14+ forbids that
      // for microphone services). JS retries when the app is opened again.
      Log.w(TAG, "Could not enter the foreground", e)
      JarvisBackgroundModule.notifyStartFailed(e.message ?: e.toString())
      stopSelf()
      return START_NOT_STICKY
    }

    acquireWakeLock()
    isRunning = true
    // Not sticky: without the JS runtime there's nothing to listen with.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "jarvis:listening").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun buildNotification(title: String, text: String, stopLabel: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      manager.getNotificationChannel(CHANNEL_ID) == null
    ) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "JARVIS listening", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while JARVIS listens for its wake word"
          setShowBadge(false)
          setSound(null, null)
          enableVibration(false)
        }
      )
    }

    val openApp = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val stop = PendingIntent.getService(
      this,
      1,
      Intent(this, ListeningService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentIntent(openApp)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, stopLabel, stop)
      .setOngoing(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    const val ACTION_STOP = "expo.modules.jarvisbackground.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_STOP_LABEL = "stopLabel"

    @Volatile
    var isRunning = false
      private set
  }
}
