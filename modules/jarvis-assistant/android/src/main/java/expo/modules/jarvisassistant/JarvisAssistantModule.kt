package expo.modules.jarvisassistant

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Tells JS when the user invokes JARVIS as the system assistant.
 *
 * An invocation sets a pending flag and emits `onAssist`. JS acts only when
 * consumePendingAssist() returns true, so an invocation that cold-starts the
 * app (before JS listens) is still handled, and never twice.
 */
class JarvisAssistantModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JarvisAssistant")

    Events("onAssist")

    OnCreate {
      instance = WeakReference(this@JarvisAssistantModule)
    }

    OnDestroy {
      if (instance?.get() === this@JarvisAssistantModule) instance = null
    }

    Function("consumePendingAssist") {
      val was = pending
      pending = false
      was
    }
  }

  companion object {
    @Volatile
    private var pending = false

    @Volatile
    private var instance: WeakReference<JarvisAssistantModule>? = null

    internal fun requestAssist() {
      pending = true
      instance?.get()?.sendEvent("onAssist", emptyMap<String, Any>())
    }
  }
}
