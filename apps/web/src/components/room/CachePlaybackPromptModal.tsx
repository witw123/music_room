"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { checkAnyProviderAccountBound } from "@/features/playback/provider-account-guard";
import { updateAppSettings } from "@/features/settings/settings-store";
import { resolveProviderTrackSource } from "@/features/library/provider-track-identity";

type CachePlaybackPromptModalProps = {
  isOpen: boolean;
  track: TrackMeta | null;
  isSourceOwner?: boolean;
  onClose: () => void;
  onEnabled?: () => void;
};

export function CachePlaybackPromptModal({
  isOpen,
  track,
  isSourceOwner = false,
  onClose,
  onEnabled
}: CachePlaybackPromptModalProps) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [requiresBinding, setRequiresBinding] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    triggerElementRef.current = document.activeElement as HTMLElement | null;

    const timer = setTimeout(() => {
      actionButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab" && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      triggerElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen || !track) return null;

  const providerSource = resolveProviderTrackSource(track);
  const platformName = providerSource?.provider === "qqmusic" ? "QQ 音乐" : "网易云音乐";

  const handleEnableCache = async () => {
    setChecking(true);
    try {
      const status = await checkAnyProviderAccountBound();
      if (!status.bound) {
        setRequiresBinding(true);
        setChecking(false);
        return;
      }

      updateAppSettings({ playback: { fullyCachedPlayback: true } });
      onEnabled?.();
      onClose();
    } catch {
      setRequiresBinding(true);
    } finally {
      setChecking(false);
    }
  };

  const handleGoToBind = () => {
    onClose();
    router.push("/app/settings" as Route);
  };

  const modalContent = (
    <div
      aria-describedby="cache-playback-prompt-desc"
      aria-labelledby="cache-playback-prompt-title"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#12141e]/95 p-6 shadow-2xl backdrop-blur-xl"
      >
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />

        <button
          aria-label="关闭"
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          onClick={onClose}
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex items-center gap-3 pr-6">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent/30 bg-accent/15 text-accent shadow-[0_0_20px_var(--accent-glow)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                <path d="M12 12v9" />
                <path d="m8 17 4 4 4-4" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-white tracking-tight" id="cache-playback-prompt-title">
                {requiresBinding ? "需要绑定平台账号" : isSourceOwner ? "歌曲源 OPS 资产缺失提示" : "开启缓存播放提示"}
              </h2>
              <p className="text-xs text-foreground-muted truncate">
                {track.title} {track.artist ? `· ${track.artist}` : ""}
              </p>
            </div>
          </div>

          <div id="cache-playback-prompt-desc">
            {requiresBinding ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs text-amber-200/90 leading-relaxed">
                <p className="font-medium text-amber-100">
                  ⚠️ 开启缓存播放必须先绑定网易云音乐或 QQ 音乐账号。
                </p>
                <p>
                  {isSourceOwner
                    ? `您是当前歌曲的播放源，歌曲来自 ${platformName}。绑定账号并开启缓存播放后，方可向房间内其他成员广播音频。`
                    : `当前歌曲来自 ${platformName}，绑定对应账号后即可从音乐平台自动拉取高质量音频并在本地高速缓存播放。`}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs text-white/80 leading-relaxed">
                <p>
                  {isSourceOwner ? (
                    <>
                      您正在播放的歌曲 <span className="font-semibold text-white">《{track.title}》</span> 未在房间曲库中预置 OPS 音频资产。
                    </>
                  ) : (
                    <>
                      当前播放的歌曲 <span className="font-semibold text-white">《{track.title}》</span> 未在房间曲库中预置 OPS 音频资产。
                    </>
                  )}
                </p>
                <p className="text-foreground-muted">
                  {isSourceOwner
                    ? `开启「缓存播放」后，将自动通过绑定的 ${platformName} 账号获取完整音频并向全房广播；若不开启，其他成员将无法听到该歌曲。`
                    : `开启「缓存播放」后，将自动通过您绑定的 ${platformName} 账号获取完整歌曲音频并在本地缓存播放，享受最高音质体验。`}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button
              onClick={onClose}
              size="sm"
              type="button"
              variant="ghost"
              className="text-white/70 hover:text-white"
            >
              {requiresBinding ? "稍后再说" : "暂不开启"}
            </Button>
            {requiresBinding ? (
              <Button
                ref={actionButtonRef}
                onClick={handleGoToBind}
                size="sm"
                type="button"
                className="bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/20"
              >
                前往设置绑定账号
              </Button>
            ) : (
              <Button
                ref={actionButtonRef}
                disabled={checking}
                onClick={handleEnableCache}
                size="sm"
                type="button"
                className="bg-accent text-white hover:bg-accent-hover shadow-lg shadow-accent/20"
              >
                {checking ? "正在检查账号..." : "开启缓存播放"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : modalContent;
}
