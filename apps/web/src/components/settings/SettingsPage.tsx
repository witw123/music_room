"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { PersonalizationExclusion, PlaybackMode } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { CustomLayoutEditor } from "./CustomLayoutEditor";
import { LocalStorageManagementCard } from "./LocalStorageSettingsSection";
import { NeteaseSourcePanel } from "@/components/room/NeteaseSourcePanel";
import { QqMusicSourcePanel } from "@/components/room/QqMusicSourcePanel";
import { ProviderDataImportSection } from "./ProviderDataImportSection";
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
import { isCapacitorRuntime } from "@/lib/desktop/tauri";
import {
  getLocalAudioStorageState,
  requestLocalAudioDirectoryPermission,
  type LocalAudioStorageState
} from "@/features/library/local-audio-storage";
import { checkAnyProviderAccountBound } from "@/features/playback/provider-account-guard";

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

export function SettingsPage({
  embedded = false,
  onBack
}: {
  embedded?: boolean;
  onBack?: () => void;
}) {
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

  const refreshPermissions = async () => {
    const state = await queryNotificationPermissionState();
    setNotificationPermission(state);
    try {
      const storageState = await getLocalAudioStorageState();
      setDirectoryState(storageState);
    } catch {
      // Ignored
    }
  };

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
  }, []);

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

  if (!hydrated || !activeSession) {
    return <div className="min-h-[100dvh] bg-background" />;
  }

  function patchSettings(patch: Parameters<typeof updateAppSettings>[0]) {
    setSettings(updateAppSettings(patch));
    setStatusMessage("设置已保存");
  }

  function resetSettings() {
    if (!window.confirm("确定要恢复默认设置吗？本地歌曲和歌单不会被删除。")) return;
    setSettings(resetAppSettings());
    setStatusMessage("已恢复默认设置");
  }

  async function resetListeningProfile() {
    if (!window.confirm("确定要重置听歌画像吗？此操作会清除当前账号的聆听记录和画像统计。")) return;
    try {
      await musicRoomApi.clearPersonalizationProfile();
      setStatusMessage("听歌画像已重置");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "听歌画像重置失败。");
    }
  }

  const customLayoutEnabled = settings.layout.customLayout.enabled;

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Clear the local session even when the server cannot be reached.
    }
    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  const content = (
      <div className={embedded ? "min-w-0" : "workspace-page__inner pt-6 sm:pt-10 md:pt-16"}>
        <header className="workspace-page__header items-start">
          <div>
            <h1 className="workspace-page__title">设置</h1>
            <p className="workspace-page__description">调整播放和界面偏好。</p>
          </div>
          {embedded && onBack ? (
            <Button onClick={onBack} size="sm" type="button" variant="outline">返回我的</Button>
          ) : (
            <Link className="text-xs font-medium text-foreground-muted transition hover:text-foreground" href="/app/profile">
              账号与歌单
            </Link>
          )}
        </header>

        <div className="mt-6 space-y-8">
          <SettingsSection title="音乐平台账号">
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              {process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? (
                <NeteaseSourcePanel activeSession={activeSession} mode="account" />
              ) : null}
              {process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? (
                <QqMusicSourcePanel activeSession={activeSession} mode="account" />
              ) : null}
              {process.env.NEXT_PUBLIC_NETEASE_ENABLED !== "true" && process.env.NEXT_PUBLIC_QQMUSIC_ENABLED !== "true" ? (
                <div className="rounded-xl border border-surface-border bg-surface/40 p-6 text-sm text-foreground-muted">
                  当前没有启用第三方音乐平台。
                </div>
              ) : null}
            </div>
          </SettingsSection>

          <SettingsSection title="导入平台资料">
            <ProviderDataImportSection />
          </SettingsSection>

          <LocalStorageManagementCard />

          <SettingsSection title="通用">
            <SettingRow label="主题" description="选择应用的颜色主题，也可以跟随操作系统设置。">
              <div aria-label="主题" className="grid grid-cols-3 rounded-lg border border-surface-border bg-surface/60 p-1" role="group">
                {(Object.entries(themeLabels) as Array<[ThemePreference, string]>).map(([theme, label]) => (
                  <button
                    aria-pressed={settings.theme === theme}
                    className={`min-w-16 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${settings.theme === theme ? "bg-accent text-white shadow-sm" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                    key={theme}
                    onClick={() => patchSettings({ theme })}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="侧边栏默认收纳" description={customLayoutEnabled ? "自定义界面已启用，请在自定义面板中调整侧边栏宽度。" : "在桌面端优先为内容留出空间。"}>
              <Toggle
                checked={settings.layout.sidebarCollapsed}
                label="侧边栏默认收纳"
                disabled={customLayoutEnabled}
                onChange={(checked) => patchSettings({ layout: { sidebarCollapsed: checked } })}
              />
            </SettingRow>
            <SettingRow label="减少界面动画" description="降低页面切换和播放器动效。">
              <Toggle
                checked={settings.layout.reduceMotion}
                label="减少界面动画"
                onChange={(checked) => patchSettings({ layout: { reduceMotion: checked } })}
              />
            </SettingRow>
            <SettingRow label="开启完全动效" description="常态持续运行房间舞台微光、星空共鸣与黑胶旋转动效（适合高性能设备）。">
              <Toggle
                checked={settings.layout.fullMotion}
                label="开启完全动效"
                onChange={(checked) => patchSettings({ layout: { fullMotion: checked } })}
              />
            </SettingRow>
            <SettingRow label="恢复默认设置" description="只重置界面和播放偏好，不删除本地歌曲。">
              <Button onClick={resetSettings} size="sm" type="button" variant="outline">恢复默认</Button>
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="播放策略">
            <SettingRow label="禁止离线自动缓存" description="房间成员离线时不从网易云或 QQ 音乐下载歌曲；已有本地缓存仍可播放。">
              <Toggle
                checked={settings.playback.preventOfflineAutoLoad}
                label="禁止离线自动缓存"
                onChange={(checked) => patchSettings({ playback: { preventOfflineAutoLoad: checked } })}
              />
            </SettingRow>
            <SettingRow label="房间仅流式播放" description="房间歌曲不读取本机音频或平台缓存，始终使用实时流式播放，并停用离线自动缓存。">
              <Toggle
                checked={settings.playback.streamingOnlyPlayback}
                label="房间仅流式播放"
                onChange={(checked) => patchSettings({ playback: {
                  streamingOnlyPlayback: checked,
                  ...(checked ? { fullyCachedPlayback: false } : {})
                } })}
              />
            </SettingRow>
            <SettingRow label="平台歌曲缓存播放" description="房间中的网易云和 QQ 音乐歌曲下载到当前用户缓存后播放，不保存到正式本地曲库；与流式播放同时开启时以流式播放为准。">
              <Toggle
                checked={settings.playback.fullyCachedPlayback}
                label="平台歌曲缓存播放"
                onChange={(checked) => patchSettings({ playback: {
                  fullyCachedPlayback: checked,
                  ...(checked ? { streamingOnlyPlayback: false } : {})
                } })}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="界面">
            <SettingRow label="自定义界面" description="在桌面画布中调整页面区域的位置和大小。">
              <button
                aria-label="进入自定义界面编辑器"
                className="hidden min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-accent transition hover:bg-accent/10 hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:inline-flex"
                onClick={() => setIsCustomLayoutEditorOpen(true)}
                type="button"
              >
                <span>进入</span>
                <ChevronRightIcon />
              </button>
              {/* The editor canvas is authored for a 1440x900 desktop viewport
                  (min-w-[720px], pointer drag). On phones the entry would only
                  lead to a horizontally scrolling surface, so offer guidance
                  instead of a dead end. */}
              <span className="text-xs text-foreground-muted md:hidden">请使用桌面浏览器调整</span>
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="播放">
            <SettingRow label="默认音量" description="应用进入时使用的本地播放器音量。">
              <div className="flex w-44 items-center gap-3">
                <input
                  aria-label="默认音量"
                  className="min-w-0 flex-1 accent-accent"
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
            <SettingRow label="桌面歌词大小" description="缩放悬浮桌面歌词的字号与窗口尺寸。">
              <div className="flex w-44 items-center gap-3">
                <input
                  aria-label="桌面歌词大小"
                  className="min-w-0 flex-1 accent-accent"
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
            <SettingRow label="响度均衡" description="自动平衡不同歌曲的主观响度，仅影响当前设备。">
              <Toggle
                checked={settings.playback.loudnessNormalization}
                label="响度均衡"
                onChange={(checked) => patchSettings({ playback: { loudnessNormalization: checked } })}
              />
            </SettingRow>
            <SettingRow label="播放器样式" description="应用于底部、沉浸式和房间播放器。">
              <select
                aria-label="播放器样式"
                className="h-9 min-w-40 rounded-lg border border-surface-border bg-background-secondary px-2 text-xs text-foreground outline-none focus:border-accent"
                onChange={(event) => patchSettings({ playback: { playerStyle: event.target.value as PlayerStyle } })}
                value={settings.playback.playerStyle}
              >
                {Object.entries(playerStyleLabels).map(([style, label]) => (
                  <option key={style} value={style}>{label}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label="播放器自动取色" description="根据专辑封面提取播放器颜色；关闭后统一使用中性默认控件颜色。">
              <Toggle
                checked={!settings.playback.disableArtworkColor}
                label="播放器自动取色"
                onChange={(checked) => patchSettings({ playback: { disableArtworkColor: !checked } })}
              />
            </SettingRow>
            <SettingRow label="本地歌单播放方式" description="仅影响主页和本地歌单播放器。">
              <select
                aria-label="本地歌单播放方式"
                className="h-9 min-w-32 rounded-lg border border-surface-border bg-background-secondary px-2 text-xs text-foreground outline-none focus:border-accent"
                onChange={(event) => patchSettings({ playback: { localPlaybackMode: event.target.value as PlaybackMode } })}
                value={settings.playback.localPlaybackMode}
              >
                {Object.entries(playbackModeLabels).map(([mode, label]) => (
                  <option key={mode} value={mode}>{label}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow
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
                      window.alert("开启缓存播放必须先绑定网易云音乐或 QQ 音乐账号。请在上方「音乐平台账号」中完成绑定。");
                      return;
                    }
                    patchSettings({ playback: { fullyCachedPlayback: true } });
                  } else {
                    patchSettings({ playback: { fullyCachedPlayback: false } });
                  }
                }}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="通知与推送">
            <SettingRow label="系统通知权限" description="接收切歌、点歌、曲库更新和聊天消息的系统 Toast 通知。">
              <div className="flex flex-col items-end gap-2 w-full sm:w-auto">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                    notificationPermission === "granted"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : notificationPermission === "denied"
                        ? "bg-red-500/10 text-red-400 border-red-500/20"
                        : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      notificationPermission === "granted" ? "bg-green-400" : notificationPermission === "denied" ? "bg-red-400" : "bg-amber-400"
                    }`} />
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
                        <Button
                          onClick={() => void openMobileNotificationSettings()}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          打开系统设置
                        </Button>
                      ) : (
                        <Button
                          onClick={() => setShowNotificationHelp((prev) => !prev)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {showNotificationHelp ? "收起指引" : "解除拦截教程"}
                        </Button>
                      )}
                      <Button
                        onClick={() => void refreshPermissions()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
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
            {directoryState?.directoryName ? (
              <SettingRow label="本地曲库目录权限" description={`已选目录 “${directoryState.directoryName}” 的浏览器读写授权。`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                    directoryState.permission === "granted"
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${directoryState.permission === "granted" ? "bg-green-400" : "bg-amber-400"}`} />
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
            ) : null}
            <SettingRow label="切歌桌面通知" description="后台播放或窗口最小化切歌时，弹出系统级 Toast 歌曲通知。">
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
            <SettingRow label="房间点歌系统通知" description="点歌房其他成员点播新歌曲时，弹出系统级 Toast 提醒。">
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
            <SettingRow label="房间曲库更新通知" description="房间内其他成员上传或添加新歌曲到共享曲库时，弹出系统 Toast 提醒。">
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
            <SettingRow label="房间聊天消息推送" description="房间内其他成员发送聊天消息时，弹出系统级 Toast 提醒。">
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
            <SettingRow label="成员动态通知" description="房间内成员加入、离开或上下线状态变更时，弹出系统 Toast 提醒。">
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
            <SettingRow label="仅在后台时通知" description="在前台使用时免打扰，仅在窗口最小化或处于后台时弹出系统通知。">
              <Toggle
                checked={settings.playback.onlyNotifyInBackground}
                label="仅在后台时通知"
                onChange={(checked) => patchSettings({ playback: { onlyNotifyInBackground: checked } })}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection title="隐私与数据">
            <SettingRow label="重置听歌画像" description="清除当前账号在 Music Room 内产生的品味与推荐反馈，不会删除歌曲、收藏或缓存。">
              <Button onClick={() => void resetListeningProfile()} size="sm" type="button" variant="outline">重置画像</Button>
            </SettingRow>
            {recommendationExclusions.length ? <SettingRow label="已排除的推荐" description="这些歌曲不会出现在个性化推荐中。">
              <div className="flex max-w-sm flex-wrap justify-end gap-2">
                {recommendationExclusions.map((item) => <Button key={`${item.kind}:${item.key}`} onClick={() => void musicRoomApi.removePersonalizationExclusion(item.kind, item.key).then(() => {
                  setRecommendationExclusions((current) => current.filter((candidate) => candidate.key !== item.key || candidate.kind !== item.kind));
                  setStatusMessage("已恢复推荐。");
                }).catch((error) => setStatusMessage(error instanceof Error ? error.message : "恢复推荐失败。"))} size="sm" type="button" variant="outline">恢复 {item.label ?? item.key}</Button>)}
              </div>
            </SettingRow> : null}
          </SettingsSection>

          <AboutSettingsSection />

          <SettingsSection title="账号">
            <SettingRow label="退出登录" description="退出当前账号并返回登录页面。">
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
          </SettingsSection>
        </div>

        {statusMessage ? <p className="mt-6 text-xs text-foreground-muted" role="status">{statusMessage}</p> : null}
      </div>
  );

  const editor = isCustomLayoutEditorOpen ? (
        <CustomLayoutEditor
          onApply={(customLayout) => {
            patchSettings({ layout: { customLayout: { ...normalizeCustomLayoutSettings(customLayout), enabled: true } } });
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

  if (embedded) {
    return <>{content}{editor}</>;
  }

  return <main className="workspace-page settings-page-scroll overflow-y-auto md:pl-60 lg:pb-28">{content}{editor}</main>;
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-surface-border pb-6">
      <h2 className="mb-3 text-base font-semibold text-foreground">{title}</h2>
      <div className="divide-y divide-surface-border">{children}</div>
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
    <div className="flex min-h-16 items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={`inline-flex min-h-11 min-w-12 items-center justify-center ${disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`} title={label}>
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="relative h-7 w-12 rounded-full bg-surface-hover transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

function ChevronRightIcon() {
  return <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14"><path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}
