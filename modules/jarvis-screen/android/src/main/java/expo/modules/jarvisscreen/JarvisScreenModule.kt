package expo.modules.jarvisscreen

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side of JarvisScreenService: is it on, read a taxi app, tap in it. */
class JarvisScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("JarvisScreen")

    Function("isEnabled") { JarvisScreenService.get() != null }

    Function("openSettings") {
      val context = appContext.reactContext ?: return@Function false
      context.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
      true
    }

    // A wait that doesn't need JS timers: React Native pauses those while
    // another app (the taxi app) is in front, unless a headless task runs.
    AsyncFunction("sleep") { ms: Int, promise: Promise ->
      Handler(Looper.getMainLooper()).postDelayed({ promise.resolve(null) }, ms.toLong())
    }

    Function("cover") { title: String, subtitle: String?, alpha: Int? ->
      JarvisScreenService.get()?.cover(title, subtitle ?: "", alpha ?: 0xCC) != null
    }

    Function("coverLog") { line: String -> JarvisScreenService.get()?.coverLog(line); true }

    Function("uncover") { JarvisScreenService.get()?.uncover(); true }

    // pkg: a taxi app, or null for JARVIS itself.
    Function("bringToFront") { pkg: String? ->
      val service = JarvisScreenService.get() ?: return@Function false
      service.bringToFront(pkg ?: service.packageName)
    }

    Function("onTop") { pkg: String -> JarvisScreenService.get()?.onTop(pkg) == true }

    AsyncFunction("dump") { pkg: String ->
      JarvisScreenService.get()?.dump(pkg)
    }

    AsyncFunction("clickLabel") { pkg: String, label: String, promise: Promise ->
      val service = JarvisScreenService.get() ?: return@AsyncFunction promise.resolve(false)
      service.clickLabel(pkg, label) { promise.resolve(it) }
    }

    AsyncFunction("tap") { x: Double, y: Double, promise: Promise ->
      val service = JarvisScreenService.get() ?: return@AsyncFunction promise.resolve(false)
      service.tap(x.toFloat(), y.toFloat()) { promise.resolve(it) }
    }

    AsyncFunction("swipe") { x1: Double, x2: Double, y: Double, promise: Promise ->
      val service = JarvisScreenService.get() ?: return@AsyncFunction promise.resolve(false)
      service.swipe(x1.toFloat(), x2.toFloat(), y.toFloat()) { promise.resolve(it) }
    }
  }
}
