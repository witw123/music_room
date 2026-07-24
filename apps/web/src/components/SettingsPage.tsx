"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { PlaybackMode } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { CustomLayoutEditor } from "@/components/CustomLayoutEditor";
import { LocalStorageManagementCard } from "@/components/LocalStorageSettingsSection";
import { NeteaseSourcePanel } from "@/components/room/NeteaseSourcePanel";
import { QqMusicSourcePanel } from "@/components/room/QqMusicSourcePanel";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  appSettingsChangeEvent,
  getDefaultAppSettings,
  getAppSettings,
  resetAppSettings,
  updateAppSettings,
  type AppSettings,
  type DiscoverProvider,
  type PlayerStyle,
  type ThemePreference
} from "@/features/settings/settings-store";

const playbackModeLabels: Record<PlaybackMode, string> = {
  sequence: "顺序播放",
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

const discoverProviderLabels: Record<DiscoverProvider, string> = {
  netease: "网易云音乐",
  qqmusic: "QQ 音乐"
};

const enabledDiscoverProviders: DiscoverProvider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

export function SettingsPage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/settings" });
  const { activeSession, hydrated, clearIdentity } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [settings, setSettings] = useState<AppSettings>(() => getDefaultAppSettings());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isCustomLayoutEditorOpen, setIsCustomLayoutEditorOpen] = useState(false);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    const syncSettings = () => setSettings(getAppSettings());
    syncSettings();
    window.addEventListener(appSettingsChangeEvent, syncSettings);
    window.addEventListener("storage", syncSettings);
    return () => {
      window.removeEventListener(appSettingsChangeEvent, syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

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

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Clear the local session even when the server cannot be reached.
    }
    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  return (
    <main className="workspace-page settings-page-scroll overflow-y-auto md:pl-60 lg:pb-28">
      <div className="workspace-page__inner pt-6 sm:pt-10 md:pt-16">
        <header className="workspace-page__header items-start">
          <div>
            <h1 className="workspace-page__title">设置</h1>
            <p className="workspace-page__description">调整播放和界面偏好。</p>
          </div>
          <Link className="text-xs font-medium text-foreground-muted transition hover:text-foreground" href="/app/profile">
            账号与歌单
          </Link>
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

          <LocalStorageManagementCard />

          <SettingsSection title="通用">
            {enabledDiscoverProviders.length > 0 ? (
              <SettingRow label="发现来源" description="选择发现页展示的音乐平台内容。切换后会立即刷新。">
                <div aria-label="发现来源" className="grid grid-cols-2 rounded-lg border border-surface-border bg-surface/60 p-1" role="group">
                  {enabledDiscoverProviders.map((provider) => (
                    <button
                      aria-pressed={(enabledDiscoverProviders.includes(settings.discover.provider) ? settings.discover.provider : enabledDiscoverProviders[0]) === provider}
                      className={`min-w-24 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${(enabledDiscoverProviders.includes(settings.discover.provider) ? settings.discover.provider : enabledDiscoverProviders[0]) === provider ? "bg-accent text-white shadow-sm" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                      key={provider}
                      onClick={() => patchSettings({ discover: { provider } })}
                      type="button"
                    >
                      {discoverProviderLabels[provider]}
                    </button>
                  ))}
                </div>
              </SettingRow>
            ) : null}
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
            <SettingRow label="侧边栏默认收纳" description="在桌面端优先为内容留出空间。">
              <Toggle
                checked={settings.layout.sidebarCollapsed}
                label="侧边栏默认收纳"
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
          </SettingsSection>

          <SettingsSection title="界面">
            <SettingRow label="自定义界面" description="在桌面画布中调整页面区域的位置和大小。">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Toggle
                  checked={settings.layout.customLayout.enabled}
                  label="自定义界面"
                  onChange={(checked) => {
                    patchSettings({ layout: { customLayout: { ...settings.layout.customLayout, enabled: checked } } });
                    if (!checked) setIsCustomLayoutEditorOpen(false);
                  }}
                />
                <Button
                  disabled={!settings.layout.customLayout.enabled}
                  onClick={() => setIsCustomLayoutEditorOpen(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  打开编辑器
                </Button>
              </div>
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
            <SettingRow label="播放器自动取色" description="根据专辑封面提取播放器颜色；关闭后统一使用项目蓝色主题。">
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
            <SettingRow label="进入播放器时显示歌词" description="歌词按钮仍可在播放器中随时切换。">
              <Toggle
                checked={settings.playback.showLyricsByDefault}
                label="进入播放器时显示歌词"
                onChange={(checked) => patchSettings({ playback: { showLyricsByDefault: checked } })}
              />
            </SettingRow>
            <SettingRow label="歌词大小" description="应用于沉浸式播放器歌词。">
              <select
                aria-label="歌词大小"
                className="h-9 min-w-32 rounded-lg border border-surface-border bg-background-secondary px-2 text-xs text-foreground outline-none focus:border-accent"
                onChange={(event) => patchSettings({ playback: { lyricFontScale: event.target.value as AppSettings["playback"]["lyricFontScale"] } })}
                value={settings.playback.lyricFontScale}
              >
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </SettingRow>
            <SettingRow label="歌词显示行数" description="歌词区域同时保留的可见行数。">
              <select
                aria-label="歌词显示行数"
                className="h-9 min-w-32 rounded-lg border border-surface-border bg-background-secondary px-2 text-xs text-foreground outline-none focus:border-accent"
                onChange={(event) => patchSettings({ playback: { lyricLines: Number(event.target.value) } })}
                value={settings.playback.lyricLines}
              >
                {[3, 5, 7].map((lineCount) => <option key={lineCount} value={lineCount}>{lineCount} 行</option>)}
              </select>
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

          <SettingsSection title="数据管理">
            <SettingRow label="歌单与收藏" description="网络歌单、收藏专辑和本地歌单位于我的页面。">
              <Link className="text-xs font-medium text-accent transition hover:text-accent-hover" href="/app/profile">
                打开我的
              </Link>
            </SettingRow>
            <SettingRow label="恢复默认设置" description="只重置界面和播放偏好，不删除本地歌曲。">
              <Button onClick={resetSettings} size="sm" type="button" variant="outline">恢复默认</Button>
            </SettingRow>
          </SettingsSection>

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
      {isCustomLayoutEditorOpen ? (
        <CustomLayoutEditor
          onChange={(customLayout) => patchSettings({ layout: { customLayout } })}
          onClose={() => setIsCustomLayoutEditorOpen(false)}
          value={settings.layout.customLayout}
        />
      ) : null}
    </main>
  );
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

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex min-h-11 min-w-12 cursor-pointer items-center justify-center" title={label}>
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="relative h-7 w-12 rounded-full bg-surface-hover transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}
