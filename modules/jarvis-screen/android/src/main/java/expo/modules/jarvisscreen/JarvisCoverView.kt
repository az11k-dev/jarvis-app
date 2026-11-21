package expo.modules.jarvisscreen

import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.SystemClock
import android.view.View
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The screen JARVIS shows over a taxi app while it works there: the HUD's
 * arc reactor, brand, clock and a status line, in the app's colours and
 * fonts (src/styles/mainStyles.jsx, src/components/ArcReactor.jsx).
 *
 * Drawn on a canvas and animated natively, so it keeps moving while the JS
 * thread is busy reading the taxi app.
 *
 * The backdrop is at most [backdropAlpha] opaque: behind a fully opaque
 * window the taxi apps stop drawing their map and never load the route.
 */
class JarvisCoverView(context: Context) : View(context) {
  var title: String = ""
    set(value) {
      // «Checking taxi prices…» → CHECKING TAXI PRICES: the progress bar
      // already says "in progress".
      field = value.trimEnd('…', '.', ' ').uppercase(Locale.ROOT)
      invalidate()
    }
  var subtitle: String = ""
    set(value) {
      field = value.uppercase(Locale.ROOT)
      invalidate()
    }
  var backdropAlpha: Int = 0xCC
    set(value) {
      field = value
      invalidate()
    }

  /** JARVIS's steps, newest last: (text, time it was added). */
  private val log = ArrayList<Pair<String, Long>>()

  /** Adds a step to the task log (the newest is typed out). */
  fun addLog(line: String) {
    log.add(line.uppercase(Locale.ROOT) to SystemClock.uptimeMillis())
    while (log.size > 6) log.removeAt(0)
    invalidate()
  }

  private val d = resources.displayMetrics.density
  private val start = SystemClock.uptimeMillis()
  private val clock = SimpleDateFormat("HH:mm", Locale.ROOT)

  private fun font(name: String): Typeface =
    try {
      Typeface.createFromAsset(context.assets, "fonts/$name.ttf")
    } catch (e: Exception) {
      Typeface.DEFAULT_BOLD
    }

  private val brandFont = font("Orbitron_700Bold")
  private val readoutFont = font("Orbitron_500Medium")
  private val bodyFont = font("Jura_500Medium")

  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val text = Paint(Paint.ANTI_ALIAS_FLAG)
  private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    maskFilter = BlurMaskFilter(14 * d, BlurMaskFilter.Blur.NORMAL)
  }
  private val rect = RectF()

  init {
    alpha = 0f
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    animate().alpha(1f).setDuration(220).start()
  }

  /** Fades out, then runs [done] (which removes the window). */
  fun dismiss(done: () -> Unit) {
    animate().alpha(0f).setDuration(180).withEndAction(done).start()
  }

  override fun onDraw(canvas: Canvas) {
    val t = (SystemClock.uptimeMillis() - start) / 1000f
    val w = width.toFloat()
    val h = height.toFloat()

    drawBackdrop(canvas, w, h, t)
    drawFrame(canvas, w, h)
    drawHeader(canvas, w)

    val cx = w / 2
    val cy = h * 0.4f
    val size = min(w * 0.78f, 300 * d)
    drawReactor(canvas, cx, cy, size / 2, t)
    val statusTop = cy + size / 2 + 46 * d
    drawStatus(canvas, cx, statusTop, t)
    drawLog(canvas, w, statusTop + 96 * d, h - 110 * d)
    drawFooter(canvas, w, h, t)

    postInvalidateOnAnimation()
  }

  // ── backdrop: dimmed app, grid, a slow scan line ─────────────────────────

  private fun drawBackdrop(c: Canvas, w: Float, h: Float, t: Float) {
    // A fully opaque backdrop keeps a hairline at the bottom clear, so the
    // app underneath still counts as visible and keeps drawing.
    paint.style = Paint.Style.FILL
    paint.shader = null
    paint.color = Color.argb(backdropAlpha, 3, 7, 13)
    c.drawRect(0f, 0f, w, if (backdropAlpha >= 255) h - SLIT else h, paint)

    // Glow pooled around the reactor.
    paint.style = Paint.Style.FILL
    paint.shader = RadialGradient(
      w / 2, h * 0.4f, w * 0.75f,
      intArrayOf(Color.argb(46, 79, 227, 255), Color.argb(0, 79, 227, 255)),
      null, Shader.TileMode.CLAMP
    )
    c.drawRect(0f, 0f, w, h, paint)
    paint.shader = null

    // HUD grid.
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1f
    paint.color = Color.argb(12, 79, 227, 255)
    val step = 28 * d
    var x = (w % step) / 2
    while (x < w) {
      c.drawLine(x, 0f, x, h, paint)
      x += step
    }
    var y = 0f
    while (y < h) {
      c.drawLine(0f, y, w, y, paint)
      y += step
    }

    // Scan band sweeping down every 4 s.
    val band = 120 * d
    val sy = ((t % 4f) / 4f) * (h + band) - band
    paint.style = Paint.Style.FILL
    paint.shader = LinearGradient(
      0f, sy, 0f, sy + band,
      intArrayOf(Color.argb(0, 79, 227, 255), Color.argb(22, 79, 227, 255), Color.argb(0, 79, 227, 255)),
      null, Shader.TileMode.CLAMP
    )
    c.drawRect(0f, sy, w, sy + band, paint)
    paint.shader = null
  }

  // ── corner brackets, like the dock's ────────────────────────────────────

  private fun drawFrame(c: Canvas, w: Float, h: Float) {
    val inset = 18 * d
    val top = 44 * d
    val len = 26 * d
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 2 * d
    paint.color = CYAN_SOFT
    fun corner(x: Float, y: Float, dx: Float, dy: Float) {
      c.drawLine(x, y, x + len * dx, y, paint)
      c.drawLine(x, y, x, y + len * dy, paint)
    }
    corner(inset, top, 1f, 1f)
    corner(w - inset, top, -1f, 1f)
    corner(inset, h - inset - 16 * d, 1f, -1f)
    corner(w - inset, h - inset - 16 * d, -1f, -1f)
  }

  // ── header: brand and clock ─────────────────────────────────────────────

  private fun drawHeader(c: Canvas, w: Float) {
    val left = 36 * d
    val base = 96 * d

    text.textAlign = Paint.Align.LEFT
    text.typeface = brandFont
    text.textSize = 22 * d
    text.letterSpacing = 0.26f
    text.color = CYAN
    text.setShadowLayer(14 * d, 0f, 0f, CYAN)
    c.drawText("J.A.R.V.I.S.", left, base, text)
    text.clearShadowLayer()

    text.typeface = readoutFont
    text.textSize = 7 * d
    text.letterSpacing = 0.24f
    text.color = MUTED
    c.drawText("JUST A RATHER VERY INTELLIGENT SYSTEM", left, base + 18 * d, text)

    text.textAlign = Paint.Align.RIGHT
    text.textSize = 17 * d
    text.letterSpacing = 0.12f
    text.color = TEXT
    c.drawText(clock.format(Date()), w - 36 * d, base - 2 * d, text)

    text.textSize = 8 * d
    text.letterSpacing = 0.3f
    text.color = AMBER
    c.drawText("REMOTE OPS", w - 36 * d, base + 38 * d, text)
    paint.style = Paint.Style.FILL
    paint.color = AMBER
    val tw = text.measureText("REMOTE OPS")
    c.drawCircle(w - 36 * d - tw - 8 * d, base + 35 * d, 2.6f * d, paint)
  }

  // ── the arc reactor ─────────────────────────────────────────────────────

  private fun drawReactor(c: Canvas, cx: Float, cy: Float, r: Float, t: Float) {
    val breath = (sin(t * 2 * PI / 1.6) * 0.5 + 0.5).toFloat()

    // Halo.
    paint.style = Paint.Style.FILL
    paint.shader = RadialGradient(
      cx, cy, r,
      intArrayOf(Color.argb((70 + 40 * breath).toInt(), 79, 227, 255), Color.argb(18, 79, 227, 255), Color.argb(0, 79, 227, 255)),
      floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
    )
    c.drawCircle(cx, cy, r, paint)
    paint.shader = null

    paint.style = Paint.Style.STROKE

    // Outer tick ring, slow spin.
    c.save()
    c.rotate(t * 360f / 14f, cx, cy)
    paint.strokeWidth = 0.75f * d
    paint.color = Color.argb(46, 79, 227, 255)
    c.drawCircle(cx, cy, r - 2 * d, paint)
    for (i in 0 until 90) {
      val a = 2 * PI * i / 90
      val major = i % 5 == 0
      val r1 = if (major) r - 15 * d else r - 10 * d
      val r2 = r - 5 * d
      paint.strokeWidth = (if (major) 1.6f else 0.9f) * d
      paint.color = if (major) CYAN else Color.argb(100, 79, 227, 255)
      c.drawLine(
        cx + (r1 * sin(a)).toFloat(), cy - (r1 * cos(a)).toFloat(),
        cx + (r2 * sin(a)).toFloat(), cy - (r2 * cos(a)).toFloat(), paint
      )
    }
    c.restore()

    // Machined arc segments, counter-rotating.
    val arcR = r * 0.8f
    val arcLen = (2 * PI * arcR).toFloat()
    c.save()
    c.rotate(-t * 360f / 9.8f, cx, cy)
    paint.strokeWidth = 2.4f * d
    paint.color = CYAN
    paint.pathEffect = DashPathEffect(
      floatArrayOf(0.23f, 0.03f, 0.01f, 0.03f, 0.13f, 0.03f, 0.01f, 0.03f, 0.28f, 0.03f, 0.01f, 0.03f, 0.13f, 0.03f)
        .map { it * arcLen }.toFloatArray(), 0f
    )
    c.drawCircle(cx, cy, arcR, paint)
    paint.strokeWidth = 1f * d
    paint.color = Color.argb(115, 79, 227, 255)
    paint.pathEffect = DashPathEffect(floatArrayOf(1.5f * d, 5f * d), 0f)
    c.drawCircle(cx, cy, arcR - 9 * d, paint)
    paint.pathEffect = null
    c.restore()

    // Amber sweep: the "working" arc chasing round the reactor.
    val sweep = (t * 220f) % 360f
    paint.strokeWidth = 3f * d
    paint.strokeCap = Paint.Cap.ROUND
    paint.color = AMBER
    rect.set(cx - arcR - 16 * d, cy - arcR - 16 * d, cx + arcR + 16 * d, cy + arcR + 16 * d)
    c.drawArc(rect, sweep, 46f, false, paint)
    paint.color = Color.argb(80, 255, 181, 74)
    c.drawArc(rect, sweep + 180f, 18f, false, paint)
    paint.strokeCap = Paint.Cap.BUTT

    // Segmented coil, breathing.
    val coilR = r * 0.62f * (1 + 0.03f * breath)
    val seg = (2 * PI * coilR / 12).toFloat()
    c.save()
    c.rotate(t * 360f / 42f, cx, cy)
    paint.strokeWidth = 0.8f * d
    paint.color = Color.argb(90, 79, 227, 255)
    c.drawCircle(cx, cy, coilR + 9 * d, paint)
    c.drawCircle(cx, cy, coilR - 9 * d, paint)
    paint.strokeWidth = 9 * d
    paint.color = Color.argb(217, 79, 227, 255)
    paint.pathEffect = DashPathEffect(floatArrayOf(seg - 7 * d, 7 * d), 0f)
    c.drawCircle(cx, cy, coilR, paint)
    paint.pathEffect = null
    c.restore()

    // Core.
    val coreR = r * 0.42f * (1 + 0.05f * breath)
    paint.style = Paint.Style.FILL
    paint.shader = RadialGradient(
      cx, cy, coreR,
      intArrayOf(Color.WHITE, Color.argb(242, 230, 251, 255), Color.argb(217, 79, 227, 255), Color.argb(46, 79, 227, 255), Color.argb(0, 79, 227, 255)),
      floatArrayOf(0f, 0.22f, 0.4f, 0.7f, 1f), Shader.TileMode.CLAMP
    )
    c.drawCircle(cx, cy, coreR, paint)
    paint.shader = null
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1f * d
    paint.color = Color.argb(140, 230, 251, 255)
    c.drawCircle(cx, cy, r * 0.2f, paint)
  }

  // ── status: «— CHECKING TAXI PRICES —», app, progress ───────────────────

  private fun drawStatus(c: Canvas, cx: Float, top: Float, t: Float) {
    text.textAlign = Paint.Align.CENTER
    text.typeface = readoutFont
    text.textSize = 14 * d
    text.letterSpacing = 0.22f
    text.color = CYAN
    val label = title.ifEmpty { "WORKING" }
    // Shrink long labels to fit between the flanking lines.
    val maxW = width - 150 * d
    while (text.measureText(label) > maxW && text.textSize > 10 * d) text.textSize -= 0.5f * d
    glow.color = Color.argb(120, 79, 227, 255)
    glow.typeface = text.typeface
    glow.textSize = text.textSize
    glow.letterSpacing = text.letterSpacing
    glow.textAlign = Paint.Align.CENTER
    c.drawText(label, cx, top, glow)
    c.drawText(label, cx, top, text)

    val half = text.measureText(label) / 2
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1.2f * d
    paint.color = CYAN_SOFT
    val ly = top - text.textSize * 0.36f
    c.drawLine(cx - half - 40 * d, ly, cx - half - 12 * d, ly, paint)
    c.drawLine(cx + half + 12 * d, ly, cx + half + 40 * d, ly, paint)

    if (subtitle.isNotEmpty()) {
      text.typeface = bodyFont
      text.textSize = 13 * d
      text.letterSpacing = 0.18f
      text.color = TEXT_DIM
      c.drawText(subtitle, cx, top + 28 * d, text)
    }

    // Indeterminate progress: a bright segment gliding along a track.
    val barW = 220 * d
    val by = top + 52 * d
    paint.strokeWidth = 2 * d
    paint.color = LINE
    c.drawLine(cx - barW / 2, by, cx + barW / 2, by, paint)
    val p = ((t % 1.6f) / 1.6f)
    val eased = (0.5f - 0.5f * cos(PI.toFloat() * p))
    val segW = barW * 0.28f
    val sx = cx - barW / 2 - segW + (barW + segW) * eased
    paint.color = CYAN
    c.save()
    c.clipRect(cx - barW / 2, by - 4 * d, cx + barW / 2, by + 4 * d)
    c.drawLine(sx, by, sx + segW, by, paint)
    c.restore()
  }

  // ── task log: what JARVIS is doing in the app, typed out ──────────────

  private fun drawLog(c: Canvas, w: Float, top: Float, bottom: Float) {
    if (log.isEmpty()) return
    val left = 44 * d
    val lineH = 24 * d
    val now = SystemClock.uptimeMillis()
    text.textAlign = Paint.Align.LEFT
    text.typeface = readoutFont
    text.letterSpacing = 0.16f

    // Section label with a rule, like the HUD's «◇ LOG ——— 04».
    text.textSize = 8.5f * d
    text.color = MUTED
    c.drawText("◇  TASK LOG", left - 8 * d, top, text)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 1f
    paint.color = LINE
    val labelEnd = left - 8 * d + text.measureText("◇  TASK LOG") + 12 * d
    c.drawLine(labelEnd, top - 3 * d, w - 44 * d, top - 3 * d, paint)
    text.textAlign = Paint.Align.RIGHT
    c.drawText(String.format(Locale.ROOT, "%02d", log.size), w - 36 * d, top, text)
    text.textAlign = Paint.Align.LEFT

    // Lines that fit, newest at the bottom.
    val fit = max(1, ((bottom - top - 16 * d) / lineH).toInt())
    val shown = log.takeLast(fit)
    var y = top + 26 * d
    shown.forEachIndexed { i, (line, at) ->
      val newest = i == shown.size - 1
      val age = shown.size - 1 - i
      text.textSize = 11 * d
      // Older lines fade; the newest types itself out, then gets a cursor.
      text.letterSpacing = 0.16f
      val full = fit(line, w - left - 52 * d)
      val chars = if (newest) min(full.length, ((now - at) / 22).toInt()) else full.length
      val body = full.substring(0, chars)
      text.color = when {
        newest -> TEXT
        else -> Color.argb(max(70, 200 - age * 40), 159, 195, 209)
      }
      paint.style = Paint.Style.FILL
      paint.color = if (newest) AMBER else Color.argb(max(60, 160 - age * 30), 79, 227, 255)
      c.drawRect(left - 8 * d, y - 7 * d, left - 4 * d, y - 3 * d, paint)
      c.drawText(body, left + 6 * d, y, text)
      if (newest && (now / 450) % 2 == 0L) {
        val x = left + 6 * d + text.measureText(body) + 3 * d
        paint.color = CYAN
        c.drawRect(x, y - 10 * d, x + 6 * d, y + 1 * d, paint)
      }
      y += lineH
    }
  }

  /** `s`, cut with «…» to fit `maxW` in the current text paint. */
  private fun fit(s: String, maxW: Float): String {
    if (text.measureText(s) <= maxW) return s
    var n = s.length
    while (n > 1 && text.measureText(s, 0, n) + text.measureText("…") > maxW) n--
    return s.substring(0, n).trimEnd() + "…"
  }

  // ── footer telemetry ────────────────────────────────────────────────────

  private fun drawFooter(c: Canvas, w: Float, h: Float, t: Float) {
    val base = h - 64 * d
    text.typeface = readoutFont
    text.textSize = 8.5f * d
    text.letterSpacing = 0.3f

    val secs = t.toInt()
    text.textAlign = Paint.Align.LEFT
    text.color = MUTED
    c.drawText("ELAPSED", 36 * d, base - 16 * d, text)
    text.color = TEXT
    c.drawText(String.format(Locale.ROOT, "T+%02d:%02d", secs / 60, secs % 60), 36 * d, base, text)

    text.textAlign = Paint.Align.RIGHT
    text.color = MUTED
    c.drawText("CHANNEL", w - 36 * d, base - 16 * d, text)
    text.color = TEXT
    c.drawText("SECURE · A11Y", w - 36 * d, base, text)

    // Centre: a small signal meter, like the VOX meter on the HUD.
    paint.style = Paint.Style.FILL
    val bars = 9
    val bw = 4 * d
    val gap = 3 * d
    val total = bars * bw + (bars - 1) * gap
    var x = w / 2 - total / 2
    for (i in 0 until bars) {
      val lvl = (sin(t * 5 + i * 0.7f) * 0.5f + 0.5f)
      val bh = (4 + 14 * lvl) * d
      paint.color = if (lvl > 0.55f) CYAN else Color.argb(90, 79, 227, 255)
      c.drawRect(x, base - bh, x + bw, base, paint)
      x += bw + gap
    }
  }

  private companion object {
    val CYAN = Color.rgb(79, 227, 255)
    val CYAN_SOFT = Color.argb(140, 79, 227, 255)
    val LINE = Color.argb(41, 79, 227, 255)
    val TEXT = Color.rgb(217, 246, 255)
    val TEXT_DIM = Color.rgb(159, 195, 209)
    val MUTED = Color.rgb(79, 115, 133)
    val AMBER = Color.rgb(255, 181, 74)
    const val SLIT = 2f
  }
}
