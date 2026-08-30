package com.musicroom.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import kotlin.math.max
import kotlin.math.min

/**
 * System-level floating lyrics for the Android shell. A WindowManager overlay
 * (TYPE_APPLICATION_OVERLAY) draws the current lyric line with per-character
 * karaoke fill plus the translation, staying on top of every other app —
 * the same behaviour the Tauri desktop window provides on desktop.
 *
 * State flow: the webview pushes char-level word timings once per line
 * (updateLine) and a play/progress anchor on every progress tick
 * (updatePlayback); this view interpolates elapsed time per frame so the fill
 * advances at display refresh rate without bridge traffic.
 */
@CapacitorPlugin(name = "DesktopLyrics")
class DesktopLyricsPlugin : Plugin() {
    private var overlayView: LyricsOverlayView? = null
    private var windowManager: WindowManager? = null

    @PluginMethod
    fun toggle(call: PluginCall) {
        val activity = bridge.activity ?: return call.resolve(overlayResult(granted = false, visible = false))
        if (!Settings.canDrawOverlays(activity)) {
            // Send the user to the "display over other apps" settings page;
            // toggling again after granting will show the overlay.
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${activity.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            call.resolve(overlayResult(granted = false, visible = false))
            return
        }

        bridge.executeOnMain {
            val visible = ensureOverlay().toggle()
            call.resolve(overlayResult(granted = true, visible = visible))
        }
    }

    @PluginMethod
    fun hide(call: PluginCall) {
        bridge.executeOnMain {
            overlayView?.setHidden(true)
            call.resolve()
        }
    }

    @PluginMethod
    fun updateLine(call: PluginCall) {
        val words = call.getString("words") ?: "[]"
        val translation = call.getString("translation")
        val romanized = call.getString("romanized")
        bridge.executeOnMain {
            ensureOverlay().setLine(words, translation, romanized)
            call.resolve()
        }
    }

    @PluginMethod
    fun updatePlayback(call: PluginCall) {
        val isPlaying = call.getBoolean("isPlaying", false) == true
        val progressMs = call.getDouble("progressMs") ?: 0.0
        val at = call.getDouble("at") ?: System.currentTimeMillis().toDouble()
        bridge.executeOnMain {
            ensureOverlay().updatePlayback(isPlaying, progressMs, at)
            call.resolve()
        }
    }

    private fun overlayResult(granted: Boolean, visible: Boolean): JSObject {
        return JSObject().apply {
            put("granted", granted)
            put("visible", visible)
        }
    }

    private fun ensureOverlay(): LyricsOverlayView {
        overlayView?.let { return it }
        val activity = bridge.activity ?: throw IllegalStateException("Activity unavailable")
        val manager = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val view = LyricsOverlayView(activity)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val marginPx = dp(16f)
        val params = WindowManager.LayoutParams(
            max(0, activity.resources.displayMetrics.widthPixels - marginPx * 2),
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(96f)
        }
        view.bindWindow(manager, params)
        manager.addView(view, params)
        windowManager = manager
        overlayView = view
        return view
    }

    private fun dp(value: Float): Int {
        return (value * (bridge.activity?.resources?.displayMetrics?.density ?: 1f)).toInt()
    }
}

private class LyricsOverlayView(context: Context) : View(context) {
    private data class Segment(val text: String, val startMs: Double, val durationMs: Double)

    private val mainHandler = Handler(Looper.getMainLooper())

    private var segments: List<Segment> = emptyList()
    private var translationLine: String? = null
    private var hasLine = false
    private var hidden = true
    private var isPlaying = false
    private var anchorProgressMs = 0.0
    private var anchorAtMs = System.currentTimeMillis()

    private var windowManager: WindowManager? = null
    private var windowParams: WindowManager.LayoutParams? = null
    private var dragOffsetY = 0f
    private var dragActive = false

    private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(178, 12, 14, 19)
    }
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(115, 255, 255, 255)
        isFakeBoldText = true
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        isFakeBoldText = true
    }
    private val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(150, 255, 255, 255)
    }
    private val messagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(170, 255, 255, 255)
        isFakeBoldText = true
    }

    private val frameRunnable = object : Runnable {
        override fun run() {
            if (isPlaying && !hidden) {
                invalidate()
                mainHandler.postDelayed(this, 16)
            }
        }
    }

    fun bindWindow(manager: WindowManager, params: WindowManager.LayoutParams) {
        windowManager = manager
        windowParams = params
    }

    fun setLine(wordsJson: String, translation: String?, romanized: String?) {
        val parsed = mutableListOf<Segment>()
        try {
            val array = JSONArray(wordsJson)
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val text = item.optString("t", "")
                val startMs = item.optDouble("s", Double.NaN)
                val durationMs = item.optDouble("d", Double.NaN)
                if (text.isNotEmpty() && !startMs.isNaN() && !durationMs.isNaN()) {
                    parsed.add(Segment(text, startMs, max(0.0, durationMs)))
                }
            }
        } catch (_: Exception) {
            parsed.clear()
        }
        segments = parsed
        hasLine = parsed.isNotEmpty()
        translationLine = translation
        if (romanized != null) {
            // Prefer romanization as the secondary line when no translation is set.
            translationLine = translation ?: romanized
        }
        requestLayout()
        invalidate()
    }

    fun updatePlayback(playing: Boolean, progressMs: Double, at: Double) {
        isPlaying = playing
        anchorProgressMs = progressMs
        anchorAtMs = at.toLong()
        if (playing && !hidden) {
            mainHandler.removeCallbacks(frameRunnable)
            mainHandler.post(frameRunnable)
        }
        invalidate()
    }

    fun setHidden(value: Boolean) {
        hidden = value
        visibility = if (value) GONE else VISIBLE
        if (!value && isPlaying) {
            mainHandler.removeCallbacks(frameRunnable)
            mainHandler.post(frameRunnable)
        }
    }

    fun toggle(): Boolean {
        setHidden(!hidden)
        return !hidden
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val params = windowParams ?: return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                dragActive = true
                dragOffsetY = event.rawY - params.y
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (dragActive) {
                    params.y = (event.rawY - dragOffsetY).toInt()
                    windowManager?.updateViewLayout(this, params)
                    return true
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                dragActive = false
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val horizontalPadding = dp(18f)
        val available = max(0, width - horizontalPadding * 2)
        fitTextSize(available)
        val fontMetrics = basePaint.fontMetrics
        val lineHeight = fontMetrics.bottom - fontMetrics.top
        var height = dp(14f) * 2 + lineHeight
        if (!translationLine.isNullOrEmpty()) {
            height += dp(6f) + subPaint.textSize * 1.3f
        }
        setMeasuredDimension(width, resolveHeight(height.toInt(), heightMeasureSpec))
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val width = width.toFloat()
        val height = height.toFloat()
        canvas.drawRoundRect(
            RectF(dp(8f).toFloat(), 0f, width - dp(8f).toFloat(), height),
            dp(18f).toFloat(),
            dp(18f).toFloat(),
            backgroundPaint
        )

        val horizontalPadding = dp(18f).toFloat()
        val available = width - horizontalPadding * 2

        if (!hasLine) {
            val message = if (segments.isEmpty() && translationLine == null) "暂无歌词" else "等待播放…"
            val textHeight = messagePaint.fontMetrics.bottom - messagePaint.fontMetrics.top
            val y = height / 2 - textHeight / 2 - messagePaint.fontMetrics.ascent
            canvas.drawText(message, horizontalPadding, y, messagePaint)
            return
        }

        val elapsed = if (isPlaying) {
            anchorProgressMs + max(0.0, (System.currentTimeMillis() - anchorAtMs).toDouble())
        } else {
            anchorProgressMs
        }

        val fontMetrics = basePaint.fontMetrics
        val lineHeight = fontMetrics.bottom - fontMetrics.top
        val lineBaseline = dp(14f) - fontMetrics.ascent

        // Dim base pass, then the karaoke fill pass clipped to per-character
        // progress so CJK and latin text both advance smoothly.
        var cursor = horizontalPadding
        var lastSegmentEnd = elapsed
        for (segment in segments) {
            val textWidth = basePaint.measureText(segment.text)
            canvas.drawText(segment.text, cursor, lineBaseline, basePaint)
            val segmentStart = min(cursor + textWidth, width - horizontalPadding)
            val segmentProgress = when {
                elapsed <= segment.startMs -> 0.0
                elapsed >= segment.startMs + segment.durationMs -> 1.0
                segment.durationMs <= 0.0 -> 1.0
                else -> (elapsed - segment.startMs) / segment.durationMs
            }
            if (segmentProgress > 0.0) {
                val fillWidth = (textWidth * segmentProgress).toFloat()
                canvas.save()
                canvas.clipRect(cursor, 0f, min(cursor + fillWidth, width - horizontalPadding), height)
                canvas.drawText(segment.text, cursor, lineBaseline, fillPaint)
                canvas.restore()
            }
            lastSegmentEnd = segment.startMs + segment.durationMs
            cursor = segmentStart
            if (cursor >= width - horizontalPadding) break
        }

        var secondary = translationLine
        if (!secondary.isNullOrEmpty()) {
            val text = ellipsize(secondary, subPaint, available)
            val subBaseline = lineBaseline + dp(6f) + subPaint.textSize
            canvas.drawText(text, horizontalPadding, subBaseline, subPaint)
        }
    }

    private fun ellipsize(value: String, paint: Paint, available: Float): String {
        if (paint.measureText(value) <= available) return value
        var text = value
        while (text.isNotEmpty() && paint.measureText("$text…") > available) {
            text = text.dropLast(1)
        }
        return "$text…"
    }

    private fun fitTextSize(available: Int) {
        if (available <= 0) return
        var total = 0f
        for (segment in segments) {
            total += basePaint.measureText(segment.text)
        }
        if (total > available && total > 0f) {
            val scale = available / total
            basePaint.textSize = basePaint.textSize * scale
            fillPaint.textSize = fillPaint.textSize * scale
        }
    }

    private fun resolveHeight(measured: Int, heightMeasureSpec: Int): Int {
        val mode = MeasureSpec.getMode(heightMeasureSpec)
        return when (mode) {
            MeasureSpec.EXACTLY -> MeasureSpec.getSize(heightMeasureSpec)
            MeasureSpec.AT_MOST -> min(measured, MeasureSpec.getSize(heightMeasureSpec))
            else -> measured
        }
    }

    private fun dp(value: Float): Int {
        return (value * resources.displayMetrics.density).toInt()
    }
}
