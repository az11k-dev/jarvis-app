package expo.modules.jarvisbackground

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

private const val KEEP_ALIVE_TASK = "JarvisKeepAlive"

class JarvisBackgroundModule : Module() {
  private var keepAliveTaskId: Int? = null

  private val reactContext: ReactContext
    get() = appContext.reactContext as? ReactContext
      ?: throw CodedException("ERR_NO_REACT_CONTEXT", "React context is not available", null)

  override fun definition() = ModuleDefinition {
    Name("JarvisBackground")

    Events("onStopRequested", "onStartFailed")

    OnCreate {
      instance = WeakReference(this@JarvisBackgroundModule)
    }

    OnDestroy {
      stopKeepAliveTask()
      if (instance?.get() === this@JarvisBackgroundModule) instance = null
    }

    /** Starts (or updates) the foreground service. Call while the app is visible. */
    AsyncFunction("start") { title: String, text: String, stopLabel: String ->
      val context = reactContext
      val intent = Intent(context, ListeningService::class.java)
        .putExtra(ListeningService.EXTRA_TITLE, title)
        .putExtra(ListeningService.EXTRA_TEXT, text)
        .putExtra(ListeningService.EXTRA_STOP_LABEL, stopLabel)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        // ForegroundServiceStartNotAllowedException when called from the background.
        throw CodedException("ERR_FGS_START", e.message ?: e.toString(), e)
      }
      startKeepAliveTask()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") {
      val context = reactContext
      context.stopService(Intent(context, ListeningService::class.java))
      stopKeepAliveTask()
    }.runOnQueue(Queues.MAIN)

    Function("isRunning") {
      ListeningService.isRunning
    }
  }

  /**
   * React Native pauses JS timers once the activity is paused, unless a
   * headless JS task is active. This long-running task (finished only by
   * stop()) keeps setTimeout & co. working while JARVIS is in the background.
   */
  private fun startKeepAliveTask() {
    val tasks = HeadlessJsTaskContext.getInstance(reactContext)
    keepAliveTaskId?.let { if (tasks.isTaskRunning(it)) return }
    keepAliveTaskId = tasks.startTask(
      HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true)
    )
  }

  private fun stopKeepAliveTask() {
    val id = keepAliveTaskId ?: return
    keepAliveTaskId = null
    val context = appContext.reactContext as? ReactContext ?: return
    HeadlessJsTaskContext.getInstance(context).finishTask(id)
  }

  // Called by ListeningService on the main thread.
  private fun onServiceStopRequested() {
    stopKeepAliveTask()
    sendEvent("onStopRequested", emptyMap<String, Any>())
  }

  companion object {
    @Volatile
    private var instance: WeakReference<JarvisBackgroundModule>? = null

    internal fun notifyStopRequested() {
      instance?.get()?.onServiceStopRequested()
    }

    internal fun notifyStartFailed(message: String) {
      instance?.get()?.let { module ->
        module.stopKeepAliveTask()
        module.sendEvent("onStartFailed", mapOf("message" to message))
      }
    }
  }
}
