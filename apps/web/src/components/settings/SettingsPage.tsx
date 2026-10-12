"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { PersonalizationExclusion, PlaybackMode } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { CustomLayoutEditor } from "./CustomLayoutEditor";
import { LocalStorageManagementCard } from "./LocalStorageSettingsSection";
import { AboutSettingsSection } from "./AboutSettingsSection";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/domain/client-shell";
import { musicRoomApi } from "@/lib/network/music-room-api";
import {
  appSettingsChangeEvent,
  getDefaultAppSettings,
  getAppSettings,
  normalizeCustomLayoutSettings,
  resetAppSettings,
  updateAppSettings,
  type AppSettings,
  type AudioQualityPreference,
  type PlayerStyle,
  type ThemePreference
} from "@/features/settings/settings-store";
import {
  queryNotificationPermissionState,
  requestNotificationPermission,
  openMobileNotificationSettings,
  notifyTrackChange,
  type NotificationPermissionState
} from "@/features/playback/system-notifications";
import { isCapacitorRuntime, isTauriRuntime } from "@/lib/desktop/tauri";
import {
  getLocalAudioStorageState,
  requestLocalAudioDirectoryPermission,
  type LocalAudioStorageState
} from "@/features/library/local-audio-storage";
import { checkAnyProviderAccountBound } from "@/features/playback/provider-account-guard";

export type SettingsCategoryId =
  | "general"
  | "playback"
  | "appearance"
  | "network"
  | "storage"
  | "about";

interface SettingsCategoryConfig {
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: (props: { className?: string }) => ReactNode;
}

const playbackModeLabels: Record<PlaybackMode, string> = {
  sequence: "列表循环",
  shuffle: "随机播放",
  single: "单曲循环"
};

const themeLabels: Record<ThemePreference, string> = {
  dark: "深色",
  light: "浅色",
  system: "跟随系统"
};

const playerStyleLabels: Record<PlayerStyle, string> = {
  vinyl: "唱片",
  "square-cover": "正方形封面"
};

const SETTINGS_CATEGORIES: SettingsCategoryConfig[] = [
  {
    id: "general",
    label: "通用",
    description: "基础外观、动效与系统通知偏好",
    icon: GeneralIcon
  },
  {
    id: "playback",
    label: "播放策略",
    description: "音量、音质、播放模式与缓存规则",
    icon: PlaybackIcon
  },
  {
    id: "appearance",
    label: "界面外观",
    description: "界面缩放与画布自定义布局",
    icon: AppearanceIcon
  },
  {
    id: "network",
    label: "网络与P2P",
    description: "本地目录授权与个性化推荐画像",
    icon: NetworkIcon
  },
  {
    id: "storage",
    label: "存储管理",
    description: "本地曲库、缓存占用统计与数据清理",
    icon: StorageIcon
  },
  {
    id: "about",
    label: "关于与账号",
    description: "客户端版本、更新检查与账号会话",
    icon: AboutIcon
  }
];

interface SettingItemDef {
  id: string;
  categoryId: SettingsCategoryId;
  sectionTitle: string;
  label: string;
  description: string;
  keywords: string[];
  render: () => ReactNode;
}

export function SettingsPage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/profile" });
  const { activeSession, hydrated, clearIdentity } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [settings, setSettings] = useState<AppSettings>(() => getDefaultAppSettings());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isCustomLayoutEditorOpen, setIsCustomLayoutEditorOpen] = useState(false);
  const [recommendationExclusions, setRecommendationExclusions] = useState<PersonalizationExclusion[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>("default");
  const [showNotificationHelp, setShowNotificationHelp] = useState(false);
  const [directoryState, setDirectoryState] = useState<LocalAudioStorageState | null>(null);

  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchCategory, setSelectedSearchCategory] = useState<SettingsCategoryId | "all">("all");

  const refreshPermissions = useCallback(async () => {
    const state = await queryNotificationPermissionState();
    setNotificationPermission(state);
    try {
      const storageState = await getLocalAudioStorageState();
      setDirectoryState(storageState);
    } catch {
      // Ignored
    }
  }, []);

  useEffect(() => {
    void refreshPermissions();
    if (typeof navigator !== "undefined" && "permissions" in navigator) {
      try {
        navigator.permissions.query({ name: "notifications" as PermissionName }).then((permissionStatus) => {
          permissionStatus.onchange = () => {
            setNotificationPermission(permissionStatus.state as NotificationPermissionState);
          };
        }).catch(() => {
          // Ignored
        });
      } catch {
        // Ignored
      }
    }
  }, [refreshPermissions]);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    const syncSettings = () => {
      const next = getAppSettings();
      setSettings(next);
    };
    syncSettings();
    window.addEventListener(appSettingsChangeEvent, syncSettings);
    window.addEventListener("storage", syncSettings);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  useEffect(() => {
    if (isCustomLayoutEditorOpen) {
      document.documentElement.dataset.customLayoutEditorOpen = "true";
    } else {
      delete document.documentElement.dataset.customLayoutEditorOpen;
    }
    return () => {
      delete document.documentElement.dataset.customLayoutEditorOpen;
    };
  }, [isCustomLayoutEditorOpen]);

  useEffect(() => {
    if (!activeSession) {
      setRecommendationExclusions([]);
      return;
    }
    void musicRoomApi.listPersonalizationExclusions().then(setRecommendationExclusions).catch(() => undefined);
  }, [activeSession]);

  const patchSettings = useCallback((patch: Parameters<typeof updateAppSettings>[0]) => {
    setSettings(updateAppSettings(patch));
    setStatusMessage("设置已保存");
  }, []);

  const resetSettings = useCallback(() => {
    if (!window.confirm("确定要恢复默认设置吗？本地歌曲和歌单不会被删除。")) return;
    setSettings(resetAppSettings());
    setStatusMessage("已恢复默认设置");
  }, []);

  const resetListeningProfile = useCallback(async () => {
    if (!window.confirm("确定要重置听歌画像吗？此操作会清除当前账号的聆听记录和画像统计。")) return;
    try {
      await musicRoomApi.clearPersonalizationProfile();
      setStatusMessage("听歌画像已重置");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "听歌画像重置失败。");
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await musicRoomApi.logout();
    } catch {
      // Clear the local session even when the server cannot be reached.
    }
    clearIdentity();
    router.replace(authEntryHref as Route);
  }, [authEntryHref, clearIdentity, router]);

  const customLayoutEnabled = settings.layout.customLayout.enabled;

  // 定义所有可索引与可渲染的设置条目
  const settingItems: SettingItemDef[] = useMemo(() => [
    // ---------------- 通用 (general) ----------------
    {
      id: "theme",
      categoryId: "general",
      sectionTitle: "界面与外观偏好",
      label: "主题",
      description: "选择应用的颜色主题，也可以跟随操作系统设置。",
      keywords: ["主题", "颜色", "色彩", "深色", "浅色", "系统", "暗色", "明亮", "theme", "dark", "light"],
      render: () => (
        <SettingRow key="theme" label="主题" description="选择应用的颜色主题，也可以跟随操作系统设置。">
          <div aria-label="主题" className="grid grid-cols-3 rounded-lg border border-surface-border bg-surface/60 p-1" role="group">
            {(Object.entries(themeLabels) as Array<[ThemePreference, string]>).map(([theme, label]) => (
              <button
                aria-pressed={settings.theme === theme}
                className={`min-w-16 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  settings.theme === theme ? "bg-accent text-white shadow-xs" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                }`}
                key={theme}
                onClick={() => patchSettings({ theme })}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </SettingRow>
      )
    },
    {
      id: "sidebarCollapsed",
      categoryId: "general",
      sectionTitle: "界面与外观偏好",
      label: "侧边栏默认收纳",
      description: customLayoutEnabled ? "自定义界面已启用，请在自定义面板中调整侧边栏宽度。" : "在桌面端优先为内容留出空间。",
      keywords: ["侧边栏", "导航栏", "收起", "展开", "折叠", "宽度", "sidebar", "collapse"],
      render: () => (
        <SettingRow
          key="sidebarCollapsed"
          label="侧边栏默认收纳"
          description={customLayoutEnabled ? "自定义界面已启用，请在自定义面板中调整侧边栏宽度。" : "在桌面端优先为内容留出空间。"}
        >
          <Toggle
            checked={settings.layout.sidebarCollapsed}
            label="侧边栏默认收纳"
            disabled={customLayoutEnabled}
            onChange={(checked) => patchSettings({ layout: { sidebarCollapsed: checked } })}
          />
        </SettingRow>
      )
    },
    {
      id: "reduceMotion",
      categoryId: "general",
      sectionTitle: "界面与外观偏好",
      label: "减少界面动画",
      description: "降低页面切换和播放器动效。",
      keywords: ["减少动画", "动效", "性能", "省电", "流畅", "reduce motion", "animation"],
      render: () => (
        <SettingRow key="reduceMotion" label="减少界面动画" description="降低页面切换和播放器动效。">
          <Toggle
            checked={settings.layout.reduceMotion}
            label="减少界面动画"
            onChange={(checked) => patchSettings({ layout: { reduceMotion: checked } })}
          />
        </SettingRow>
      )
    },
    {
      id: "fullMotion",
      categoryId: "general",
      sectionTitle: "界面与外观偏好",
      label: "开启完全动效",
      description: "常态持续运行房间舞台微光、星空共鸣与黑胶旋转动效（适合高性能设备）。",
      keywords: ["完全动效", "微光", "星空", "黑胶旋转", "舞台", "特效", "full motion", "glow"],
      render: () => (
        <SettingRow
          key="fullMotion"
          label="开启完全动效"
          description="常态持续运行房间舞台微光、星空共鸣与黑胶旋转动效（适合高性能设备）。"
        >
          <Toggle
            checked={settings.layout.fullMotion}
            label="开启完全动效"
            onChange={(checked) => patchSettings({ layout: { fullMotion: checked } })}
          />
        </SettingRow>
      )
    },
    {
      id: "resetDefault",
      categoryId: "general",
      sectionTitle: "界面与外观偏好",
      label: "恢复默认设置",
      description: "只重置界面和播放偏好，不删除本地歌曲。",
      keywords: ["恢复默认", "重置设置", "还原", "初始化", "reset"],
      render: () => (
        <SettingRow key="resetDefault" label="恢复默认设置" description="只重置界面和播放偏好，不删除本地歌曲。">
          <Button onClick={resetSettings} size="sm" type="button" variant="outline">
            恢复默认
          </Button>
        </SettingRow>
      )
    },
    {
      id: "notificationPermission",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "系统通知权限",
      description: "接收切歌、点歌、曲库更新和聊天消息的系统 Toast 通知。",
      keywords: ["通知", "系统通知", "权限", "toast", "弹窗", "推送", "授权", "notification", "permission"],
      render: () => (
        <SettingRow key="notificationPermission" label="系统通知权限" description="接收切歌、点歌、曲库更新和聊天消息的系统 Toast 通知。">
          <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                  notificationPermission === "granted"
                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                    : notificationPermission === "denied"
                      ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    notificationPermission === "granted" ? "bg-green-400" : notificationPermission === "denied" ? "bg-red-400" : "bg-amber-400"
                  }`}
                />
                {notificationPermission === "granted" ? "已授权" : notificationPermission === "denied" ? "已禁用 (被拦截)" : "未授权"}
              </span>
              {notificationPermission === "default" ? (
                <Button
                  onClick={async () => {
                    const granted = await requestNotificationPermission();
                    setNotificationPermission(granted ? "granted" : await queryNotificationPermissionState());
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  立即授权
                </Button>
              ) : null}
              {notificationPermission === "denied" ? (
                <>
                  {isCapacitorRuntime() ? (
                    <Button onClick={() => void openMobileNotificationSettings()} size="sm" type="button" variant="outline">
                      打开系统设置
                    </Button>
                  ) : (
                    <Button onClick={() => setShowNotificationHelp((prev) => !prev)} size="sm" type="button" variant="outline">
                      {showNotificationHelp ? "收起指引" : "解除拦截教程"}
                    </Button>
                  )}
                  <Button onClick={() => void refreshPermissions()} size="sm" type="button" variant="outline">
                    重新检测
                  </Button>
                </>
              ) : null}
              <Button
                onClick={() => {
                  notifyTrackChange(
                    {
                      title: "Music Room 测试通知",
                      artist: "系统通知与推送工作正常 🎵",
                      artworkUrl: "/icons/icon-192.png"
                    },
                    { force: true }
                  );
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                测试通知
              </Button>
            </div>
            {notificationPermission === "denied" && showNotificationHelp ? (
              <div className="mt-2 w-full max-w-md rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-left text-xs text-amber-200 backdrop-blur-md">
                <div className="flex items-center justify-between font-semibold text-amber-100 mb-1.5">
                  <span>📌 浏览器通知已被拦截，解除步骤：</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-amber-200/90 text-[11px] leading-relaxed">
                  <li>点击浏览器地址栏左侧的 <strong>🔒 锁头</strong> 或 <strong>⚙️ 网站设置</strong> 图标</li>
                  <li>在权限列表中找到 <strong>「通知」</strong>，由「禁止」改为 <strong>「允许」</strong></li>
                  <li>修改完成后，点击右上角 <strong>「重新检测」</strong> 按钮即可激活</li>
                </ol>
              </div>
            ) : null}
          </div>
        </SettingRow>
      )
    },
    {
      id: "trackChangeNotification",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "切歌桌面通知",
      description: "后台播放或窗口最小化切歌时，弹出系统级 Toast 歌曲通知。",
      keywords: ["切歌通知", "桌面通知", "换歌", "后台通知", "track notification"],
      render: () => (
        <SettingRow key="trackChangeNotification" label="切歌桌面通知" description="后台播放或窗口最小化切歌时，弹出系统级 Toast 歌曲通知。">
          <Toggle
            checked={settings.playback.trackChangeNotification}
            label="切歌桌面通知"
            onChange={(checked) => {
              patchSettings({ playback: { trackChangeNotification: checked } });
              if (checked) {
                void requestNotificationPermission();
              }
            }}
          />
        </SettingRow>
      )
    },
    {
      id: "roomQueueNotification",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "房间点歌系统通知",
      description: "点歌房其他成员点播新歌曲时，弹出系统级 Toast 提醒。",
      keywords: ["点歌通知", "点播提醒", "房间通知", "queue notification"],
      render: () => (
        <SettingRow key="roomQueueNotification" label="房间点歌系统通知" description="点歌房其他成员点播新歌曲时，弹出系统级 Toast 提醒。">
          <Toggle
            checked={settings.playback.roomQueueNotification}
            label="房间点歌系统通知"
            onChange={(checked) => {
              patchSettings({ playback: { roomQueueNotification: checked } });
              if (checked) {
                void requestNotificationPermission();
              }
            }}
          />
        </SettingRow>
      )
    },
    {
      id: "roomLibraryNotification",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "房间曲库更新通知",
      description: "房间内其他成员上传或添加新歌曲到共享曲库时，弹出系统 Toast 提醒。",
      keywords: ["曲库更新", "曲库通知", "新歌提醒", "library notification"],
      render: () => (
        <SettingRow key="roomLibraryNotification" label="房间曲库更新通知" description="房间内其他成员上传或添加新歌曲到共享曲库时，弹出系统 Toast 提醒。">
          <Toggle
            checked={settings.playback.roomLibraryNotification}
            label="房间曲库更新通知"
            onChange={(checked) => {
              patchSettings({ playback: { roomLibraryNotification: checked } });
              if (checked) {
                void requestNotificationPermission();
              }
            }}
          />
        </SettingRow>
      )
    },
    {
      id: "roomChatNotification",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "房间聊天消息推送",
      description: "房间内其他成员发送聊天消息时，弹出系统级 Toast 提醒。",
      keywords: ["聊天通知", "聊天消息", "消息推送", "chat notification"],
      render: () => (
        <SettingRow key="roomChatNotification" label="房间聊天消息推送" description="房间内其他成员发送聊天消息时，弹出系统级 Toast 提醒。">
          <Toggle
            checked={settings.playback.roomChatNotification}
            label="房间聊天消息推送"
            onChange={(checked) => {
              patchSettings({ playback: { roomChatNotification: checked } });
              if (checked) {
                void requestNotificationPermission();
              }
            }}
          />
        </SettingRow>
      )
    },
    {
      id: "roomPresenceNotification",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "成员动态通知",
      description: "房间内成员加入、离开或上下线状态变更时，弹出系统 Toast 提醒。",
      keywords: ["成员动态", "上下线", "进房提醒", "presence notification"],
      render: () => (
        <SettingRow key="roomPresenceNotification" label="成员动态通知" description="房间内成员加入、离开或上下线状态变更时，弹出系统 Toast 提醒。">
          <Toggle
            checked={settings.playback.roomPresenceNotification}
            label="成员动态通知"
            onChange={(checked) => {
              patchSettings({ playback: { roomPresenceNotification: checked } });
              if (checked) {
                void requestNotificationPermission();
              }
            }}
          />
        </SettingRow>
      )
    },
    {
      id: "onlyNotifyInBackground",
      categoryId: "general",
      sectionTitle: "系统通知与推送",
      label: "仅在后台时通知",
      description: "在前台使用时免打扰，仅在窗口最小化或处于后台时弹出系统通知。",
      keywords: ["后台通知", "免打扰", "前台静音", "background notification"],
      render: () => (
        <SettingRow key="onlyNotifyInBackground" label="仅在后台时通知" description="在前台使用时免打扰，仅在窗口最小化或处于后台时弹出系统通知。">
          <Toggle
            checked={settings.playback.onlyNotifyInBackground}
            label="仅在后台时通知"
            onChange={(checked) => patchSettings({ playback: { onlyNotifyInBackground: checked } })}
          />
        </SettingRow>
      )
    },

    // ---------------- 播放策略 (playback) ----------------
    {
      id: "defaultVolume",
      categoryId: "playback",
      sectionTitle: "音频与控制偏好",
      label: "默认音量",
      description: "应用进入时使用的本地播放器音量。",
      keywords: ["音量", "声音", "默认音量", "大小", "volume"],
      render: () => (
        <SettingRow key="defaultVolume" label="默认音量" description="应用进入时使用的本地播放器音量。">
          <div className="flex w-44 items-center gap-3">
            <input
              aria-label="默认音量"
              className="min-w-0 flex-1 accent-accent cursor-pointer"
              max="1"
              min="0"
              onChange={(event) => patchSettings({ playback: { defaultVolume: Number(event.target.value) } })}
              step="0.05"
              type="range"
              value={settings.playback.defaultVolume}
            />
            <span className="w-10 text-right text-xs tabular-nums text-foreground-muted">
              {Math.round(settings.playback.defaultVolume * 100)}%
            </span>
          </div>
        </SettingRow>
      )
    },
    {
      id: "preferredAudioQuality",
      categoryId: "playback",
      sectionTitle: "音频与控制偏好",
      label: "首选音质",
      description: "解析并播放平台歌曲时的音质偏好；无权限或曲目缺少高规格时自动平滑回退。",
      keywords: ["音质", "比特率", "无损", "flac", "hires", "128k", "320k", "audio quality"],
      render: () => (
        <SettingRow key="preferredAudioQuality" label="首选音质" description="解析并播放平台歌曲时的音质偏好；无权限或曲目缺少高规格时自动平滑回退。">
          <select
            aria-label="首选音质"
            className="h-8 min-w-40 rounded-md border border-surface-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-accent"
            onChange={(event) => patchSettings({ playback: { preferredAudioQuality: event.target.value as AudioQualityPreference } })}
            value={settings.playback.preferredAudioQuality}
          >
            <option value="standard">标准 (128 kbps)</option>
            <option value="high">较高 (192 kbps)</option>
            <option value="exhigh">极高 (320 kbps)</option>
            <option value="lossless">无损 (FLAC)</option>
            <option value="hires">Hi-Res (高解析)</option>
          </select>
        </SettingRow>
      )
    },
    {
      id: "loudnessNormalization",
      categoryId: "playback",
      sectionTitle: "音频与控制偏好",
      label: "响度均衡",
      description: "自动平衡不同歌曲的主观响度，仅影响当前设备。",
      keywords: ["响度均衡", "响度", "音量平衡", "动态范围", "loudness", "normalize"],
      render: () => (
        <SettingRow key="loudnessNormalization" label="响度均衡" description="自动平衡不同歌曲的主观响度，仅影响当前设备。">
          <Toggle
            checked={settings.playback.loudnessNormalization}
            label="响度均衡"
            onChange={(checked) => patchSettings({ playback: { loudnessNormalization: checked } })}
          />
        </SettingRow>
      )
    },
    {
      id: "playerStyle",
      categoryId: "playback",
      sectionTitle: "音频与控制偏好",
      label: "播放器样式",
      description: "应用于底部、沉浸式和房间播放器。",
      keywords: ["播放器样式", "唱片", "封面", "正方形", "黑胶", "player style"],
      render: () => (
        <SettingRow key="playerStyle" label="播放器样式" description="应用于底部、沉浸式和房间播放器。">
          <select
            aria-label="播放器样式"
            className="h-8 min-w-40 rounded-md border border-surface-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-accent"
            onChange={(event) => patchSettings({ playback: { playerStyle: event.target.value as PlayerStyle } })}
            value={settings.playback.playerStyle}
          >
            {Object.entries(playerStyleLabels).map(([style, label]) => (
              <option key={style} value={style}>{label}</option>
            ))}
          </select>
        </SettingRow>
      )
    },
    {
      id: "disableArtworkColor",
      categoryId: "playback",
      sectionTitle: "音频与控制偏好",
      label: "播放器自动取色",
      description: "根据专辑封面提取播放器颜色；关闭后统一使用中性默认控件颜色。",
      keywords: ["取色", "自动取色", "封面颜色", "背景色", "artwork color"],
      render: () => (
        <SettingRow key="disableArtworkColor" label="播放器自动取色" description="根据专辑封面提取播放器颜色；关闭后统一使用中性默认控件颜色。">
          <Toggle
            checked={!settings.playback.disableArtworkColor}
            label="播放器自动取色"
            onChange={(checked) => patchSettings({ playback: { disableArtworkColor: !checked } })}
          />
        </SettingRow>
      )
    },
    {
      id: "desktopLyricScale",
      categoryId: "playback",
      sectionTitle: "音频与控制偏好",
      label: "桌面歌词大小",
      description: "缩放悬浮桌面歌词的字号与窗口尺寸。",
      keywords: ["歌词", "桌面歌词", "悬浮窗", "字号", "缩放", "lyric size"],
      render: () => (
        <SettingRow key="desktopLyricScale" label="桌面歌词大小" description="缩放悬浮桌面歌词的字号与窗口尺寸。">
          <div className="flex w-44 items-center gap-3">
            <input
              aria-label="桌面歌词大小"
              className="min-w-0 flex-1 accent-accent cursor-pointer"
              max="2"
              min="0.6"
              onChange={(event) => patchSettings({ playback: { desktopLyricScale: Number(event.target.value) } })}
              step="0.1"
              type="range"
              value={settings.playback.desktopLyricScale}
            />
            <span className="w-10 text-right text-xs tabular-nums text-foreground-muted">
              {Math.round(settings.playback.desktopLyricScale * 100)}%
            </span>
          </div>
        </SettingRow>
      )
    },
    {
      id: "localPlaybackMode",
      categoryId: "playback",
      sectionTitle: "播放方式与缓存规则",
      label: "本地歌单播放方式",
      description: "仅影响主页和本地歌单播放器。",
      keywords: ["播放方式", "播放模式", "列表循环", "随机播放", "单曲循环", "playback mode"],
      render: () => (
        <SettingRow key="localPlaybackMode" label="本地歌单播放方式" description="仅影响主页和本地歌单播放器。">
          <select
            aria-label="本地歌单播放方式"
            className="h-8 min-w-32 rounded-md border border-surface-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-accent"
            onChange={(event) => patchSettings({ playback: { localPlaybackMode: event.target.value as PlaybackMode } })}
            value={settings.playback.localPlaybackMode}
          >
            {Object.entries(playbackModeLabels).map(([mode, label]) => (
              <option key={mode} value={mode}>{label}</option>
            ))}
          </select>
        </SettingRow>
      )
    },
    {
      id: "fullyCachedPlaybackGuard",
      categoryId: "playback",
      sectionTitle: "播放方式与缓存规则",
      label: "缓存播放 (第三方歌曲)",
      description: "播放未预置 OPS 资产的歌曲时，自动通过已绑定的网易云/QQ音乐账号获取并在本地缓存播放。必须至少绑定一个平台账号。",
      keywords: ["缓存播放", "第三方", "网易云", "qq音乐", "平台账号", "cache playback"],
      render: () => (
        <SettingRow
          key="fullyCachedPlaybackGuard"
          label="缓存播放 (第三方歌曲)"
          description="播放未预置 OPS 资产的歌曲时，自动通过已绑定的网易云/QQ音乐账号获取并在本地缓存播放。必须至少绑定一个平台账号。"
        >
          <Toggle
            checked={settings.playback.fullyCachedPlayback}
            label="缓存播放"
            onChange={async (checked) => {
              if (checked) {
                const status = await checkAnyProviderAccountBound();
                if (!status.bound) {
                  window.alert("开启缓存播放必须先绑定网易云音乐或 QQ 音乐账号。请前往「我的页 → 平台账号」完成绑定。");
                  return;
                }
                patchSettings({ playback: { fullyCachedPlayback: true } });
              } else {
                patchSettings({ playback: { fullyCachedPlayback: false } });
              }
            }}
          />
        </SettingRow>
      )
    },
    {
      id: "preventOfflineAutoLoad",
      categoryId: "playback",
      sectionTitle: "播放方式与缓存规则",
      label: "禁止离线自动缓存",
      description: "房间成员离线时不从网易云或 QQ 音乐下载歌曲；已有本地缓存仍可播放。",
      keywords: ["禁止缓存", "离线缓存", "自动下载", "offline cache"],
      render: () => (
        <SettingRow
          key="preventOfflineAutoLoad"
          label="禁止离线自动缓存"
          description="房间成员离线时不从网易云或 QQ 音乐下载歌曲；已有本地缓存仍可播放。"
        >
          <Toggle
            checked={settings.playback.preventOfflineAutoLoad}
            label="禁止离线自动缓存"
            onChange={(checked) => patchSettings({ playback: { preventOfflineAutoLoad: checked } })}
          />
        </SettingRow>
      )
    },
    {
      id: "streamingOnlyPlayback",
      categoryId: "playback",
      sectionTitle: "播放方式与缓存规则",
      label: "房间仅流式播放",
      description: "房间歌曲不读取本机音频或平台缓存，始终使用实时流式播放，并停用离线自动缓存。",
      keywords: ["流式播放", "实时播放", "仅流式", "stream only"],
      render: () => (
        <SettingRow
          key="streamingOnlyPlayback"
          label="房间仅流式播放"
          description="房间歌曲不读取本机音频或平台缓存，始终使用实时流式播放，并停用离线自动缓存。"
        >
          <Toggle
            checked={settings.playback.streamingOnlyPlayback}
            label="房间仅流式播放"
            onChange={(checked) =>
              patchSettings({
                playback: {
                  streamingOnlyPlayback: checked,
                  ...(checked ? { fullyCachedPlayback: false } : {})
                }
              })
            }
          />
        </SettingRow>
      )
    },
    {
      id: "fullyCachedPlaybackRoom",
      categoryId: "playback",
      sectionTitle: "播放方式与缓存规则",
      label: "平台歌曲缓存播放",
      description: "房间中的网易云和 QQ 音乐歌曲下载到当前用户缓存后播放，不保存到正式本地曲库；与流式播放同时开启时以流式播放为准。",
      keywords: ["平台歌曲缓存", "下载播放", "平台缓存"],
      render: () => (
        <SettingRow
          key="fullyCachedPlaybackRoom"
          label="平台歌曲缓存播放"
          description="房间中的网易云和 QQ 音乐歌曲下载到当前用户缓存后播放，不保存到正式本地曲库；与流式播放同时开启时以流式播放为准。"
        >
          <Toggle
            checked={settings.playback.fullyCachedPlayback}
            label="平台歌曲缓存播放"
            onChange={(checked) =>
              patchSettings({
                playback: {
                  fullyCachedPlayback: checked,
                  ...(checked ? { streamingOnlyPlayback: false } : {})
                }
              })
            }
          />
        </SettingRow>
      )
    },

    // ---------------- 界面外观 (appearance) ----------------
    ...(isTauriRuntime()
      ? [
          {
            id: "uiScale",
            categoryId: "appearance" as const,
            sectionTitle: "显示与界面排版",
            label: "缩放比例",
            description: "调整客户端界面的显示大小，适配不同分辨率与显示器尺寸。",
            keywords: ["缩放", "比例", "界面大小", "显示大小", "放大", "缩小", "ui scale", "zoom"],
            render: () => (
              <SettingRow key="uiScale" label="缩放比例" description="调整客户端界面的显示大小，适配不同分辨率与显示器尺寸。">
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex w-44 items-center gap-2.5 sm:w-48">
                    <input
                      aria-label="缩放比例"
                      className="min-w-0 flex-1 accent-accent cursor-pointer"
                      max="1.5"
                      min="0.75"
                      onChange={(event) => patchSettings({ layout: { uiScale: Number(event.target.value) } })}
                      step="0.05"
                      type="range"
                      value={settings.layout.uiScale}
                    />
                    <span className="w-10 text-right text-xs font-mono tabular-nums text-foreground-muted">
                      {Math.round(settings.layout.uiScale * 100)}%
                    </span>
                    {settings.layout.uiScale !== 1 ? (
                      <button
                        type="button"
                        onClick={() => patchSettings({ layout: { uiScale: 1 } })}
                        className="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10 transition-colors"
                        title="重置为 100%"
                      >
                        重置
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {[0.8, 0.9, 1, 1.1, 1.25].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => patchSettings({ layout: { uiScale: preset } })}
                        className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                          Math.abs(settings.layout.uiScale - preset) < 0.01
                            ? "bg-accent text-white font-medium shadow-xs"
                            : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                        }`}
                      >
                        {Math.round(preset * 100)}%
                      </button>
                    ))}
                  </div>
                </div>
              </SettingRow>
            )
          }
        ]
      : []),
    {
      id: "customLayout",
      categoryId: "appearance",
      sectionTitle: "显示与界面排版",
      label: "自定义界面",
      description: "在桌面画布中调整页面区域的位置和大小。",
      keywords: ["自定义界面", "画布", "布局", "拖拽", "排版", "custom layout"],
      render: () => (
        <SettingRow key="customLayout" label="自定义界面" description="在桌面画布中调整页面区域的位置和大小。">
          <button
            aria-label="进入自定义界面编辑器"
            className="hidden min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-accent transition hover:bg-accent/10 hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:inline-flex"
            onClick={() => setIsCustomLayoutEditorOpen(true)}
            type="button"
          >
            <span>进入</span>
            <ChevronRightIcon />
          </button>
          <span className="text-xs text-foreground-muted md:hidden">请使用桌面浏览器调整</span>
        </SettingRow>
      )
    },

    // ---------------- 网络与P2P (network) ----------------
    ...(directoryState?.directoryName
      ? [
          {
            id: "directoryPermission",
            categoryId: "network" as const,
            sectionTitle: "本地曲库授权",
            label: "本地曲库目录权限",
            description: `已选目录 “${directoryState.directoryName}” 的浏览器读写授权。`,
            keywords: ["本地曲库", "目录权限", "文件授权", "文件夹", "directory permission", "local audio"],
            render: () => (
              <SettingRow
                key="directoryPermission"
                label="本地曲库目录权限"
                description={`已选目录 “${directoryState.directoryName}” 的浏览器读写授权。`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                      directoryState.permission === "granted"
                        ? "bg-green-500/10 text-green-400 border-green-500/20"
                        : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        directoryState.permission === "granted" ? "bg-green-400" : "bg-amber-400"
                      }`}
                    />
                    {directoryState.permission === "granted" ? "正常读写" : "待确认恢复"}
                  </span>
                  {directoryState.permission !== "granted" ? (
                    <Button
                      onClick={async () => {
                        await requestLocalAudioDirectoryPermission();
                        await refreshPermissions();
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      恢复授权
                    </Button>
                  ) : null}
                </div>
              </SettingRow>
            )
          }
        ]
      : []),
    {
      id: "listeningProfile",
      categoryId: "network",
      sectionTitle: "隐私与画像数据",
      label: "重置听歌画像",
      description: "清除当前账号在 Music Room 内产生的品味与推荐反馈，不会删除歌曲、收藏或缓存。",
      keywords: ["重置画像", "听歌画像", "推荐画像", "算法模型", "品味", "reset profile"],
      render: () => (
        <SettingRow
          key="listeningProfile"
          label="重置听歌画像"
          description="清除当前账号在 Music Room 内产生的品味与推荐反馈，不会删除歌曲、收藏或缓存。"
        >
          <Button onClick={() => void resetListeningProfile()} size="sm" type="button" variant="outline">
            重置画像
          </Button>
        </SettingRow>
      )
    },
    ...(recommendationExclusions.length > 0
      ? [
          {
            id: "recommendationExclusions",
            categoryId: "network" as const,
            sectionTitle: "隐私与画像数据",
            label: "已排除的推荐",
            description: "这些歌曲不会出现在个性化推荐中。",
            keywords: ["排除推荐", "不喜欢的歌", "屏蔽", "推荐黑名单", "exclusions"],
            render: () => (
              <SettingRow key="recommendationExclusions" label="已排除的推荐" description="这些歌曲不会出现在个性化推荐中。">
                <div className="flex max-w-sm flex-wrap justify-end gap-2">
                  {recommendationExclusions.map((item) => (
                    <Button
                      key={`${item.kind}:${item.key}`}
                      onClick={() =>
                        void musicRoomApi
                          .removePersonalizationExclusion(item.kind, item.key)
                          .then(() => {
                            setRecommendationExclusions((current) =>
                              current.filter((candidate) => candidate.key !== item.key || candidate.kind !== item.kind)
                            );
                            setStatusMessage("已恢复推荐。");
                          })
                          .catch((error) =>
                            setStatusMessage(error instanceof Error ? error.message : "恢复推荐失败。")
                          )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      恢复 {item.label ?? item.key}
                    </Button>
                  ))}
                </div>
              </SettingRow>
            )
          }
        ]
      : []),

    // ---------------- 存储管理 (storage) ----------------
    {
      id: "localStorageCard",
      categoryId: "storage",
      sectionTitle: "本地存储与曲库",
      label: "本地曲库与存储管理",
      description: "管理本地音频目录、查看缓存用量、已保存曲目统计并清理临时缓存。",
      keywords: ["存储", "缓存", "曲库", "目录", "磁盘空间", "清理缓存", "扫描曲库", "用量", "storage", "cache"],
      render: () => <LocalStorageManagementCard key="localStorageCard" />
    },

    // ---------------- 关于与账号 (about) ----------------
    {
      id: "aboutSection",
      categoryId: "about",
      sectionTitle: "版本与客户端信息",
      label: "关于 Music Room 与版本更新",
      description: "查看当前版本、运行环境平台、检查新版本与更新日志。",
      keywords: ["关于", "版本", "更新", "检测更新", "更新日志", "平台", "开源", "github", "about", "version", "update"],
      render: () => <AboutSettingsSection key="aboutSection" />
    },
    {
      id: "logout",
      categoryId: "about",
      sectionTitle: "账号与会话",
      label: "退出登录",
      description: "退出当前账号并返回登录页面。",
      keywords: ["退出登录", "退出", "登出", "注销", "账号", "切换账号", "logout", "sign out"],
      render: () => (
        <SettingRow key="logout" label="退出登录" description="退出当前账号并返回登录页面。">
          <Button
            data-testid="settings-logout-button"
            onClick={() => void handleLogout()}
            size="sm"
            type="button"
            variant="outline"
          >
            退出登录
          </Button>
        </SettingRow>
      )
    }
  ], [
    settings,
    customLayoutEnabled,
    notificationPermission,
    showNotificationHelp,
    directoryState,
    recommendationExclusions,
    patchSettings,
    resetSettings,
    resetListeningProfile,
    handleLogout,
    refreshPermissions
  ]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;

  // 匹配所有符合搜索条件的条目
  const matchingItems = useMemo(() => {
    if (!isSearching) return settingItems;
    return settingItems.filter((item) => {
      const matchLabel = item.label.toLowerCase().includes(trimmedQuery);
      const matchDesc = item.description.toLowerCase().includes(trimmedQuery);
      const matchSection = item.sectionTitle.toLowerCase().includes(trimmedQuery);
      const matchKeywords = item.keywords.some((k) => k.toLowerCase().includes(trimmedQuery));
      return matchLabel || matchDesc || matchSection || matchKeywords;
    });
  }, [isSearching, settingItems, trimmedQuery]);

  // 各分类匹配数量统计
  const categoryMatchCounts = useMemo(() => {
    const counts: Record<SettingsCategoryId, number> = {
      general: 0,
      playback: 0,
      appearance: 0,
      network: 0,
      storage: 0,
      about: 0
    };
    for (const item of matchingItems) {
      counts[item.categoryId]++;
    }
    return counts;
  }, [matchingItems]);

  // 当前要渲染的条目列表
  const displayedItems = useMemo(() => {
    if (!isSearching) {
      return settingItems.filter((item) => item.categoryId === activeCategory);
    }
    if (selectedSearchCategory === "all") {
      return matchingItems;
    }
    return matchingItems.filter((item) => item.categoryId === selectedSearchCategory);
  }, [activeCategory, isSearching, matchingItems, selectedSearchCategory, settingItems]);

  // 将展示条目按 sectionTitle 划分组合并渲染
  const groupedSections = useMemo(() => {
    const groups: Array<{
      categoryId: SettingsCategoryId;
      sectionTitle: string;
      items: SettingItemDef[];
    }> = [];

    for (const item of displayedItems) {
      let group = groups.find(
        (g) => g.categoryId === item.categoryId && g.sectionTitle === item.sectionTitle
      );
      if (!group) {
        group = {
          categoryId: item.categoryId,
          sectionTitle: item.sectionTitle,
          items: []
        };
        groups.push(group);
      }
      group.items.push(item);
    }

    return groups;
  }, [displayedItems]);

  const activeCategoryMeta = SETTINGS_CATEGORIES.find((c) => c.id === activeCategory);

  if (!hydrated || !activeSession) {
    return <div className="min-h-[calc(100*var(--app-dvh))] bg-background" />;
  }

  const content = (
    <div className="workspace-page__inner pt-6 sm:pt-10 md:pt-14">
      {/* 顶部标题栏与即时搜索框 */}
      <header className="workspace-page__header flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="workspace-page__title">设置</h1>
          <p className="workspace-page__description">调整播放和界面偏好。</p>
        </div>

        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          {/* 轻量级即时搜索过滤框 */}
          <div className="relative flex-1 sm:w-60 sm:flex-initial">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-muted">
              <SearchIcon className="h-3.5 w-3.5" />
            </span>
            <input
              aria-label="搜索设置"
              className="h-8 w-full rounded-lg border border-surface-border bg-surface/60 pl-8 pr-7 text-xs text-foreground placeholder:text-foreground-muted/70 focus:border-accent focus:bg-surface focus:outline-none transition-colors"
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedSearchCategory("all");
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                }
              }}
              placeholder="搜索设置…"
              type="search"
              value={searchQuery}
            />
            {searchQuery ? (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-foreground-muted hover:text-foreground transition-colors"
                onClick={() => setSearchQuery("")}
                title="清空搜索 (Esc)"
                type="button"
              >
                <ClearIcon className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          <Link
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-surface-border bg-surface px-3 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            href="/app/profile"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            返回到我的页
          </Link>
        </div>
      </header>

      {/* 移动端横向分类滑动导航 (< md) */}
      <div className="mt-4 -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 md:hidden scrollbar-none">
        {isSearching ? (
          <button
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
              selectedSearchCategory === "all"
                ? "border-accent bg-accent text-white shadow-xs"
                : "border-surface-border bg-surface/70 text-foreground-muted hover:text-foreground"
            }`}
            onClick={() => setSelectedSearchCategory("all")}
            type="button"
          >
            <span>全部结果</span>
            <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] tabular-nums">
              {matchingItems.length}
            </span>
          </button>
        ) : null}

        {SETTINGS_CATEGORIES.map((cat) => {
          const isSelected = isSearching
            ? selectedSearchCategory === cat.id
            : activeCategory === cat.id;
          const matchCount = categoryMatchCounts[cat.id];

          if (isSearching && matchCount === 0) return null;

          return (
            <button
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                isSelected
                  ? "border-accent bg-accent text-white shadow-xs"
                  : "border-surface-border bg-surface/70 text-foreground-muted hover:text-foreground"
              }`}
              key={cat.id}
              onClick={() => {
                if (isSearching) {
                  setSelectedSearchCategory(cat.id);
                } else {
                  setActiveCategory(cat.id);
                }
              }}
              type="button"
            >
              <cat.icon className="h-3.5 w-3.5" />
              <span>{cat.label}</span>
              {isSearching ? (
                <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] tabular-nums">
                  {matchCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 两栏主体布局 (桌面端左栏分类 + 右栏主面板) */}
      <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
        {/* 左侧分类导航 (桌面端竖向列表) */}
        <aside className="hidden w-52 shrink-0 md:block lg:w-56 md:sticky md:top-6">
          <nav
            aria-label="设置分类"
            className="rounded-xl border border-surface-border bg-surface/30 p-2 space-y-1 backdrop-blur-xs"
          >
            {isSearching ? (
              <div className="mb-2 border-b border-surface-border/60 pb-2">
                <button
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    selectedSearchCategory === "all"
                      ? "bg-accent/15 text-accent font-semibold"
                      : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                  }`}
                  onClick={() => setSelectedSearchCategory("all")}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <SearchIcon className="h-3.5 w-3.5 text-foreground-muted" />
                    <span>全部搜索结果</span>
                  </span>
                  <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-foreground-muted">
                    {matchingItems.length}
                  </span>
                </button>
              </div>
            ) : null}

            {SETTINGS_CATEGORIES.map((cat) => {
              const isSelected = isSearching
                ? selectedSearchCategory === cat.id
                : activeCategory === cat.id;
              const matchCount = categoryMatchCounts[cat.id];

              return (
                <button
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-accent/15 text-accent font-semibold"
                      : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
                  } ${isSearching && matchCount === 0 ? "opacity-40" : ""}`}
                  disabled={isSearching && matchCount === 0}
                  key={cat.id}
                  onClick={() => {
                    if (isSearching) {
                      setSelectedSearchCategory(cat.id);
                    } else {
                      setActiveCategory(cat.id);
                    }
                  }}
                  type="button"
                >
                  <span className="flex items-center gap-2.5">
                    <cat.icon className="h-4 w-4 shrink-0" />
                    <span>{cat.label}</span>
                  </span>
                  {isSearching ? (
                    <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-foreground-muted">
                      {matchCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 右侧主面板内容 */}
        <section className="min-w-0 flex-1 space-y-6">
          {/* 搜索提示条 */}
          {isSearching ? (
            <div className="flex items-center justify-between rounded-lg border border-surface-border/70 bg-surface/40 px-3.5 py-2 text-xs text-foreground-muted backdrop-blur-xs">
              <div>
                <span>搜索 </span>
                <strong className="text-foreground">“{searchQuery}”</strong>
                <span>
                  {selectedSearchCategory !== "all"
                    ? ` 在「${SETTINGS_CATEGORIES.find((c) => c.id === selectedSearchCategory)?.label}」中`
                    : ""}
                  ，共匹配 {displayedItems.length} 项设置
                </span>
              </div>
              <button
                className="text-xs text-accent hover:underline"
                onClick={() => setSearchQuery("")}
                type="button"
              >
                清除搜索
              </button>
            </div>
          ) : activeCategoryMeta ? (
            <div className="hidden border-b border-surface-border/50 pb-2 md:block">
              <h2 className="text-sm font-semibold text-foreground">{activeCategoryMeta.label}</h2>
              <p className="mt-0.5 text-xs text-foreground-muted">{activeCategoryMeta.description}</p>
            </div>
          ) : null}

          {/* 无匹配空状态 */}
          {isSearching && displayedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-surface-border bg-surface/30 px-4 py-12 text-center backdrop-blur-xs">
              <SearchIcon className="mb-3 h-8 w-8 text-foreground-muted/40" />
              <p className="text-sm font-medium text-foreground">未找到匹配的设置项</p>
              <p className="mt-1 text-xs text-foreground-muted">
                没有找到与“{searchQuery}”相关的设置，尝试更换关键词或清除搜索。
              </p>
              <button
                className="mt-4 rounded-md border border-surface-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
                onClick={() => setSearchQuery("")}
                type="button"
              >
                清空搜索
              </button>
            </div>
          ) : null}

          {/* 设置卡片分组列表 */}
          {groupedSections.map((group) => {
            // 特殊卡片自适应渲染
            const isSingleFullCard =
              group.items.length === 1 &&
              (group.items[0].id === "localStorageCard" || group.items[0].id === "aboutSection");

            if (isSingleFullCard) {
              return (
                <div key={`${group.categoryId}-${group.sectionTitle}`}>
                  {isSearching ? (
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        {SETTINGS_CATEGORIES.find((c) => c.id === group.categoryId)?.label}
                      </span>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                        {group.sectionTitle}
                      </h3>
                    </div>
                  ) : null}
                  {group.items[0].render()}
                </div>
              );
            }

            return (
              <SettingsSection
                badge={
                  isSearching
                    ? SETTINGS_CATEGORIES.find((c) => c.id === group.categoryId)?.label
                    : undefined
                }
                key={`${group.categoryId}-${group.sectionTitle}`}
                title={group.sectionTitle}
              >
                {group.items.map((item) => item.render())}
              </SettingsSection>
            );
          })}
        </section>
      </div>

      {statusMessage ? (
        <p className="mt-6 text-xs text-foreground-muted" role="status">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );

  const editor = isCustomLayoutEditorOpen ? (
    <CustomLayoutEditor
      onApply={(customLayout) => {
        patchSettings({
          layout: {
            customLayout: {
              ...normalizeCustomLayoutSettings(customLayout),
              enabled: true
            }
          }
        });
        setIsCustomLayoutEditorOpen(false);
      }}
      onReset={() => {
        patchSettings({ layout: { customLayout: getDefaultAppSettings().layout.customLayout } });
        setIsCustomLayoutEditorOpen(false);
      }}
      onClose={() => setIsCustomLayoutEditorOpen(false)}
      value={settings.layout.customLayout}
    />
  ) : null;

  return (
    <main className="workspace-page settings-page-scroll overflow-y-auto md:pl-60 lg:pb-28">
      {content}
      {editor}
    </main>
  );
}

function SettingsSection({
  title,
  badge,
  children
}: {
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-surface-border bg-surface/40 p-4 sm:p-5 backdrop-blur-xs">
      <div className="mb-2 flex items-center gap-2">
        {badge ? (
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            {badge}
          </span>
        ) : null}
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{title}</h2>
      </div>
      <div className="divide-y divide-surface-border/50">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2.5">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-foreground-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`inline-flex min-h-8 min-w-10 items-center justify-center select-none ${
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"
      }`}
      title={label}
    >
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors duration-200 ease-in-out peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${
          checked ? "bg-accent" : "bg-surface-hover"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out ${
            checked ? "translate-x-[19px]" : "translate-x-[3px]"
          }`}
        />
      </span>
    </label>
  );
}

// 通用图标系列 (大众行业通用隐喻，16x16，极简克制)
function GeneralIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
      />
    </svg>
  );
}

function PlaybackIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <polygon fill="currentColor" points="10 8 16 12 10 16 10 8" stroke="none" />
    </svg>
  );
}

function AppearanceIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" width="18" x="3" y="3" />
      <path d="M9 3v18M3 9h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NetworkIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StorageIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect height="6" rx="2" strokeLinecap="round" strokeLinejoin="round" width="18" x="3" y="4" />
      <rect height="6" rx="2" strokeLinecap="round" strokeLinejoin="round" width="18" x="3" y="14" />
      <line strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" x1="6" x2="6.01" y1="7" y2="7" />
      <line strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" x1="6" x2="6.01" y1="17" y2="17" />
    </svg>
  );
}

function AboutIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <line strokeLinecap="round" strokeLinejoin="round" x1="12" x2="12" y1="16" y2="12" />
      <line strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" x1="12" x2="12.01" y1="8" y2="8" />
    </svg>
  );
}

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function ClearIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function ChevronLeftIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
