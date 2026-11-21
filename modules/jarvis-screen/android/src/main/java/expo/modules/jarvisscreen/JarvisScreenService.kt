package expo.modules.jarvisscreen

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.lang.ref.WeakReference

/**
 * Reads and taps the windows of the taxi apps, and of no other app: every
 * entry point refuses a package outside ALLOWED. Everything app-specific —
 * which text is a class, a price or the order button — is decided in JS
 * from dump().
 */
class JarvisScreenService : AccessibilityService() {
  override fun onServiceConnected() {
    instance = WeakReference(this)
  }

  override fun onDestroy() {
    uncover()
    if (instance?.get() === this) instance = null
    super.onDestroy()
  }

  // Reads happen on demand; events only need to be accepted.
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

  override fun onInterrupt() {}

  /** Roots of the windows that belong to `pkg`, top-most first. */
  private fun roots(pkg: String): List<AccessibilityNodeInfo> {
    if (pkg !in ALLOWED) return emptyList()
    val all = try {
      windows.mapNotNull { it.root }
    } catch (e: Exception) {
      emptyList()
    }
    val fromWindows = all.filter { it.packageName == pkg }
    if (fromWindows.isEmpty()) {
      Log.d(TAG, "no window of $pkg among ${all.map { it.packageName }}")
    }
    if (fromWindows.isNotEmpty()) return fromWindows
    return listOfNotNull(rootInActiveWindow?.takeIf { it.packageName == pkg })
  }

  /** The visible nodes of `pkg` that carry text, a description or a click. */
  fun dump(pkg: String): List<Map<String, Any?>> {
    val out = ArrayList<Map<String, Any?>>()
    val rect = Rect()
    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || depth > 60) return
      if (node.isVisibleToUser) {
        val text = node.text?.toString()
        val desc = node.contentDescription?.toString()
        if (!text.isNullOrBlank() || !desc.isNullOrBlank() || node.isClickable || node.isScrollable) {
          node.getBoundsInScreen(rect)
          out.add(
            mapOf(
              "text" to text,
              "desc" to desc,
              "id" to node.viewIdResourceName?.substringAfter(":id/"),
              "cls" to node.className?.toString()?.substringAfterLast('.'),
              "click" to node.isClickable,
              "scroll" to node.isScrollable,
              "sel" to node.isSelected,
              "x" to rect.left,
              "y" to rect.top,
              "w" to rect.width(),
              "h" to rect.height(),
              "depth" to depth,
            )
          )
        }
      }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }
    roots(pkg).forEach { walk(it, 0) }
    return out
  }

  /**
   * Clicks the first visible node of `pkg` whose text or description equals
   * `label` (case-insensitive), through its nearest clickable ancestor.
   * Falls back to a tap at its centre. Returns false if there is none.
   */
  fun clickLabel(pkg: String, label: String, onDone: (Boolean) -> Unit) {
    val wanted = label.trim().lowercase()
    var found: AccessibilityNodeInfo? = null
    fun walk(node: AccessibilityNodeInfo?, depth: Int) {
      if (node == null || found != null || depth > 60) return
      val t = node.text?.toString()?.trim()?.lowercase()
      val d = node.contentDescription?.toString()?.trim()?.lowercase()
      if (node.isVisibleToUser && (t == wanted || d == wanted)) {
        found = node
        return
      }
      for (i in 0 until node.childCount) walk(node.getChild(i), depth + 1)
    }
    roots(pkg).forEach { walk(it, 0) }
    val node = found ?: return onDone(false)
    var target: AccessibilityNodeInfo? = node
    while (target != null && !target.isClickable) target = target.parent
    if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
      return onDone(true)
    }
    val r = Rect()
    node.getBoundsInScreen(r)
    tap(r.exactCenterX(), r.exactCenterY(), onDone)
  }

  /** A finger tap at screen coordinates. */
  fun tap(x: Float, y: Float, onDone: (Boolean) -> Unit) {
    if (!taxiOnTop()) return onDone(false)
    val path = Path().apply { moveTo(x, y) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
      .build()
    val ok = dispatchGesture(
      gesture,
      object : GestureResultCallback() {
        override fun onCompleted(g: GestureDescription?) = onDone(true)
        override fun onCancelled(g: GestureDescription?) = onDone(false)
      },
      null
    )
    if (!ok) onDone(false)
  }

  /** A horizontal swipe from (x1, y) to (x2, y), to scroll a row of cards. */
  fun swipe(x1: Float, x2: Float, y: Float, onDone: (Boolean) -> Unit) {
    if (!taxiOnTop()) return onDone(false)
    val path = Path().apply {
      moveTo(x1, y)
      lineTo(x2, y)
    }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, 300))
      .build()
    val ok = dispatchGesture(
      gesture,
      object : GestureResultCallback() {
        override fun onCompleted(g: GestureDescription?) = onDone(true)
        override fun onCancelled(g: GestureDescription?) = onDone(false)
      },
      null
    )
    if (!ok) onDone(false)
  }

  // ── the cover: JARVIS's screen over the taxi app while it works there ──

  private val main = Handler(Looper.getMainLooper())
  private var cover: TextView? = null

  /**
   * Shows (or updates) a full-screen JARVIS card with `text` above every
   * app. It takes no touches, so taps and swipes still reach the taxi app
   * underneath, and its nodes stay readable; the user just doesn't see it.
   */
  fun cover(text: String, alpha: Int = 0xF2) = main.post {
    cover?.let {
      it.text = text
      it.setBackgroundColor(Color.argb(alpha, 5, 8, 13))
      return@post
    }
    val view = TextView(this).apply {
      this.text = text
      setTextColor(Color.parseColor("#7FDBFF"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
      gravity = Gravity.CENTER
      setBackgroundColor(Color.argb(alpha, 5, 8, 13))
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    )
    try {
      (getSystemService(WINDOW_SERVICE) as WindowManager).addView(view, params)
      cover = view
    } catch (e: Exception) {
      Log.w(TAG, "cover failed", e)
    }
  }

  fun uncover() = main.post {
    val view = cover ?: return@post
    cover = null
    try {
      (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(view)
    } catch (e: Exception) {
      Log.w(TAG, "uncover failed", e)
    }
  }

  /**
   * Brings a taxi app (or JARVIS itself) back to the front as it was left:
   * the launcher intent resumes the existing task instead of restarting it.
   */
  fun bringToFront(pkg: String): Boolean {
    if (pkg !in ALLOWED && pkg != packageName) return false
    val intent = packageManager.getLaunchIntentForPackage(pkg) ?: return false
    return try {
      intent.removeFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      Log.w(TAG, "bringToFront $pkg failed", e)
      false
    }
  }

  /** Whether `pkg` is the active window. */
  fun onTop(pkg: String): Boolean = rootInActiveWindow?.packageName?.toString() == pkg

  /** Gestures land only while a taxi app is the active window. */
  private fun taxiOnTop(): Boolean =
    rootInActiveWindow?.packageName?.toString() in ALLOWED

  companion object {
    private const val TAG = "JarvisScreen"

    /** The only apps the service reads or taps. */
    val ALLOWED = setOf("ru.yandex.taxi", "uz.wildberries.taxi.client")

    @Volatile
    private var instance: WeakReference<JarvisScreenService>? = null

    fun get(): JarvisScreenService? = instance?.get()
  }
}
