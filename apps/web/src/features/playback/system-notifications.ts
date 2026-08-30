import { getAppSettings } from "@/features/settings/settings-store";
import { invokeTauri, isTauriRuntime } from "@/lib/desktop/tauri";

function resolveNotificationArtworkUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("//")) return `https:${value}`;
  return value.replace(/^http:\/\//i, "https://");
}

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

/**
 * Checks current system notification permission.
 */
export function getNotificationPermissionState(): NotificationPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Requests notification permission from user.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    return false;
  }
}

export type TrackNotificationPayload = {
  title: string;
  artist?: string | null;
  artworkUrl?: string | null;
};

export type RoomQueueNotificationPayload = {
  title: string;
  artist?: string | null;
  artworkUrl?: string | null;
  requestedBy: string;
  requestedById?: string | null;
  currentUserId?: string | null;
  roomTitle?: string | null;
};

let lastNotifiedTrackKey = "";
let lastNotifiedAtMs = 0;

/**
 * Focuses the main window, restoring it from minimized / background state.
 */
export async function focusMainWindow(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.focus();
  } catch {
    // Ignored in non-browser environments
  }
  if (isTauriRuntime()) {
    try {
      await invokeTauri("focus_main_window");
    } catch {
      // Ignored if command is not available
    }
  }
}

/**
 * Dispatches a system Toast notification when a track starts playing.
 * - Respects the user's `trackChangeNotification` and `onlyNotifyInBackground` settings.
 * - Dispatches when app is in the background or minimized.
 * - Uses notification tags so successive track switches replace the prior toast.
 */
export function notifyTrackChange(payload: TrackNotificationPayload, options?: { force?: boolean }) {
  if (typeof window === "undefined") return;

  const settings = getAppSettings();
  if (!settings.playback.trackChangeNotification) return;
  if (!payload.title || payload.title.trim().length === 0) return;

  const trackKey = `${payload.title}:${payload.artist ?? ""}`;
  const now = Date.now();

  // Avoid duplicate notifications within 2 seconds for the same track
  if (!options?.force && trackKey === lastNotifiedTrackKey && now - lastNotifiedAtMs < 2000) {
    return;
  }

  // Check visibility: only notify if document is hidden / in background unless disabled or forced
  const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  if (settings.playback.onlyNotifyInBackground && !options?.force && !isHidden && !isTauriRuntime()) {
    return;
  }

  lastNotifiedTrackKey = trackKey;
  lastNotifiedAtMs = now;

  const body = payload.artist ? `${payload.artist}` : "Music Room";
  const icon = resolveNotificationArtworkUrl(payload.artworkUrl) ?? "/icons/icon-192.png";

  // If in Tauri desktop shell, try native notification
  if (isTauriRuntime()) {
    void invokeTauri("plugin:notification|notify", {
      options: {
        title: payload.title,
        body,
        icon: resolveNotificationArtworkUrl(payload.artworkUrl)
      }
    }).catch(() => {
      // Fallback to standard Web Notification API if Tauri plugin is not available
      sendWebNotification(payload.title, body, icon, "music-room-now-playing");
    });
    return;
  }

  // Web Browser / PWA
  sendWebNotification(payload.title, body, icon, "music-room-now-playing");
}

/**
 * Dispatches a system Toast notification when a member adds/requests a track in a room.
 */
export function notifyRoomQueueTrackAdded(
  payload: RoomQueueNotificationPayload,
  options?: { force?: boolean }
) {
  if (typeof window === "undefined") return;

  const settings = getAppSettings();
  if (!settings.playback.roomQueueNotification) return;
  if (!payload.title || payload.title.trim().length === 0) return;

  // Do not notify if the current user requested the song
  if (payload.currentUserId && payload.requestedById && payload.currentUserId === payload.requestedById) {
    return;
  }

  // Check background visibility requirement
  const isHidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  if (settings.playback.onlyNotifyInBackground && !options?.force && !isHidden && !isTauriRuntime()) {
    return;
  }

  const requester = payload.requestedBy || "房间成员";
  const title = `🎵 ${requester} 点播了新歌曲`;
  const body = payload.artist
    ? `《${payload.title}》 - ${payload.artist}`
    : `《${payload.title}》`;
  const icon = resolveNotificationArtworkUrl(payload.artworkUrl) ?? "/icons/icon-192.png";
  const tag = `music-room-queue-${payload.title}-${Date.now()}`;

  if (isTauriRuntime()) {
    void invokeTauri("plugin:notification|notify", {
      options: {
        title,
        body,
        icon: resolveNotificationArtworkUrl(payload.artworkUrl)
      }
    }).catch(() => {
      sendWebNotification(title, body, icon, tag);
    });
    return;
  }

  sendWebNotification(title, body, icon, tag);
}

function sendWebNotification(title: string, body: string, icon?: string, tag = "music-room-now-playing") {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  try {
    const notification = new Notification(title, {
      body,
      icon,
      silent: true,
      tag
    });
    notification.onclick = () => {
      void focusMainWindow();
    };
    // Auto-dismiss toast after 5 seconds
    setTimeout(() => {
      try {
        notification.close();
      } catch {
        // Ignored
      }
    }, 5000);
  } catch {
    // Some browsers require ServiceWorker registration for notifications
  }
}

