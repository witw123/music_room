"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { PlaybackMode } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { LocalStorageManagementCard } from "@/components/LocalStorageSettingsSection";
import { NeteaseSourcePanel } from "@/components/room/NeteaseSourcePanel";
import { QqMusicSourcePanel } from "@/components/room/QqMusicSourcePanel";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import {
  appSettingsChangeEvent,
  getDefaultAppSettings,
  getAppSettings,
  resetAppSettings,
  updateAppSettings,
  type AppSettings,
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

export function SettingsPage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/settings" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [settings, setSettings] = useState<AppSettings>(() => getDefaultAppSettings());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
    return <div className="min-h-screen bg-black" />;
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

  return (
    <main className="h-screen min-h-screen overflow-y-auto hide-scrollbar bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-screen w-full max-w-[1000px] flex-col px-4 pb-12 pt-6 sm:px-7 sm:pt-10 md:mx-0 md:px-10 md:pt-16">
        <header className="flex items-center justify-between gap-4 border-b border-white/[0.1] pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">设置</h1>
            <p className="mt-1 text-xs text-foreground-muted">调整播放和界面偏好。</p>
          </div>
          <Link className="text-xs text-foreground-muted transition hover:text-white" href="/app/profile">
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
            <SettingRow label="本地歌单播放方式" description="仅影响主页和本地歌单播放器。">
              <select
                aria-label="本地歌单播放方式"
                className="h-9 min-w-32 rounded-lg border border-surface-border bg-black px-2 text-xs text-white outline-none focus:border-accent"
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
                className="h-9 min-w-32 rounded-lg border border-surface-border bg-black px-2 text-xs text-white outline-none focus:border-accent"
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
                className="h-9 min-w-32 rounded-lg border border-surface-border bg-black px-2 text-xs text-white outline-none focus:border-accent"
                onChange={(event) => patchSettings({ playback: { lyricLines: Number(event.target.value) } })}
                value={settings.playback.lyricLines}
              >
                {[3, 5, 7].map((lineCount) => <option key={lineCount} value={lineCount}>{lineCount} 行</option>)}
              </select>
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
        </div>

        {statusMessage ? <p className="mt-6 text-xs text-foreground-muted" role="status">{statusMessage}</p> : null}
      </div>
    </main>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-surface-border pb-6">
      <h2 className="mb-3 text-sm font-semibold text-white">{title}</h2>
      <div className="divide-y divide-white/[0.07]">{children}</div>
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
        <p className="text-sm text-white/[0.86]">{label}</p>
        <p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center" title={label}>
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="relative h-6 w-11 rounded-full bg-white/[0.14] transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}
