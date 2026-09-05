package com.musicroom.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor bridge for the Android system media session (notification drawer,
 * lock screen controls, Bluetooth/wired headset transport). The webview pushes
 * playback state through updateMetadata / updatePlaybackState / hide;
 * SystemMediaService owns the actual MediaSessionCompat and the MediaStyle
 * foreground notification, and routes transport commands back here.
 *
 * Implemented in Java (not Kotlin) for the same reason as DesktopLyricsPlugin:
 * the app Gradle module has no Kotlin plugin applied, so .kt sources would
 * silently not compile in CI.
 */
@CapacitorPlugin(name = "SystemMediaControls")
public class SystemMediaControlsPlugin extends Plugin {
    /** Live instance so the service can emit commands without a binder handshake. */
    static volatile SystemMediaControlsPlugin activeInstance;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    /** Forwards a transport command from the MediaSession to the webview listener. */
    static void emitCommand(String action, Long positionMs, Long deltaMs) {
        SystemMediaControlsPlugin plugin = activeInstance;
        if (plugin == null) {
            return;
        }
        JSObject payload = new JSObject();
        payload.put("action", action);
        if (positionMs != null) {
            payload.put("positionMs", positionMs.doubleValue());
        }
        if (deltaMs != null) {
            payload.put("deltaMs", deltaMs.doubleValue());
        }
        plugin.notifyListeners("systemMediaCommand", payload);
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        Intent intent = serviceIntent();
        if (intent == null) {
            call.resolve();
            return;
        }
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("album", call.getString("album", ""));
        intent.putExtra("artworkUrl", call.getString("artworkUrl", ""));
        intent.putExtra("durationMs", (long) call.getDouble("durationMs", 0.0));
        startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        Intent intent = serviceIntent();
        if (intent == null) {
            call.resolve();
            return;
        }
        intent.putExtra("isPlaying", call.getBoolean("isPlaying", false));
        intent.putExtra("positionMs", (long) call.getDouble("positionMs", 0.0));
        startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        Context context = bridge.getContext();
        context.stopService(new Intent(context, SystemMediaService.class));
        call.resolve();
    }

    private Intent serviceIntent() {
        if (bridge == null || bridge.getContext() == null) {
            return null;
        }
        return new Intent(bridge.getContext(), SystemMediaService.class);
    }

    private void startService(Intent intent) {
        Context context = bridge.getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(context, intent);
        } else {
            context.startService(intent);
        }
    }
}
