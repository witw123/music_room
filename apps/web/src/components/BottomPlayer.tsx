"use client";

import React, { memo, useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { PlaybackSnapshot, QueueItem, TrackMeta } from "@music-room/shared";
import {
  DesktopBottomPlayerLayout,
  MobileBottomPlayerLayout
} from "@/components/bottom-player/bottom-player-layout";
import {
  resolveAnchoredProgressMs,
  resolveProgressRenderIntervalMs
} from "@/features/playback/render-scheduler";
import {
  isPendingSeekTargetReached,
  shouldResolvePendingSeek,
  type PendingSeek
} from "@/components/bottom-player/seek-state";
import { ImmersivePlayerOverlay } from "@/components/bottom-player/ImmersivePlayerOverlay";
import {
  MiniPlayerOverlay,
  requestMiniPlayerWindow
} from "@/components/bottom-player/MiniPlayerOverlay";
import { useArtworkPalette } from "@/components/bottom-player/artwork-colors";

type BottomPlayerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playback: PlaybackSnapshot | null;
  canControlPlayback: boolean;
  canSeekPlayback: boolean;
  progressMs: number;
  seekDraft: number | null;
  setSeekDraft: (v: number | null) => void;
  audioDurationMs: number;
  syncProgressFromAudio: () => void;
  syncDurationFromAudio: () => void;
  currentTrack: TrackMeta | null;
  visualizerSamples: number[];
  visualizerReducedMotion: boolean;
  visualizerMaxDevicePixelRatio?: number;
  onPlay: () => void;
  onPause: (positionMs?: number) => void | Promise<void>;
  onSeek: (positionMs: number) => Promise<PlaybackSnapshot | null>;
  onPrev: () => void;
  onNext: () => void;
  onCyclePlaybackMode: () => void | Promise<void>;
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentQueueItemId: string | null;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  isLyricsOpen?: boolean;
  onToggleLyrics?: () => void;
};

function clampProgressMs(progressMs: number, durationMs: number) {
  return durationMs > 0
    ? Math.min(Math.max(0, progressMs), durationMs)
    : Math.max(0, progressMs);
}

function BottomPlayerBase({
  audioRef,
  playback,
  canControlPlayback,
  canSeekPlayback,
  progressMs,
  seekDraft,
  setSeekDraft,
  audioDurationMs,
  syncProgressFromAudio,
  syncDurationFromAudio,
  currentTrack,
  onPlay,
  onPause,
  onSeek,
  onPrev,
  onNext,
  onCyclePlaybackMode,
  queue,
  tracks,
  currentQueueItemId,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  isLyricsOpen = false,
  onToggleLyrics
}: BottomPlayerProps) {
  const [isPending, startTransition] = useTransition();
  const [renderedProgressMs, setRenderedProgressMs] = useState(progressMs);
  const [isPageVisible, setIsPageVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden
  );
  const progressAnchorRef = useRef({
    progressMs,
    receivedAtMs: Date.now()
  });
  const seekCommitTargetRef = useRef<number | null>(null);
  const seekRequestIdRef = useRef(0);
  const [pendingSeek, setPendingSeek] = useState<PendingSeek | null>(null);
  const [isImmersiveOpen, setIsImmersiveOpen] = useState(false);
  const [isMiniOpen, setIsMiniOpen] = useState(false);
  const [miniPlayerWindow, setMiniPlayerWindow] = useState<Window | null>(null);
  const miniPlayerWindowRef = useRef<Window | null>(null);
  const miniPlayerRequestIdRef = useRef(0);
  const closeMiniPlayer = useCallback(() => {
    miniPlayerRequestIdRef.current += 1;
    miniPlayerWindowRef.current?.close();
    miniPlayerWindowRef.current = null;
    setMiniPlayerWindow(null);
    setIsMiniOpen(false);
  }, []);
  const toggleMiniPlayer = useCallback(() => {
    setIsImmersiveOpen(false);
    if (isMiniOpen) {
      closeMiniPlayer();
      return;
    }

    const requestId = miniPlayerRequestIdRef.current + 1;
    miniPlayerRequestIdRef.current = requestId;
    setIsMiniOpen(true);
    void requestMiniPlayerWindow()
      .then((nextWindow) => {
        if (!nextWindow) {
          return;
        }
        if (requestId !== miniPlayerRequestIdRef.current) {
          nextWindow.close();
          return;
        }
        miniPlayerWindowRef.current = nextWindow;
        setMiniPlayerWindow(nextWindow);
      })
      .catch(() => {
        // Keep the in-page fixed fallback when Document PiP is unavailable or denied.
      });
  }, [closeMiniPlayer, isMiniOpen]);

  useEffect(() => {
    return () => {
      miniPlayerWindowRef.current?.close();
    };
  }, []);
  const isPlaying = playback?.status === "playing";
  const currentTrackDuration = audioDurationMs;
  const effectiveProgressMs = Math.max(0, seekDraft ?? renderedProgressMs);
  const boundedProgressMs =
    currentTrackDuration > 0
      ? Math.min(effectiveProgressMs, currentTrackDuration)
      : effectiveProgressMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(boundedProgressMs / currentTrackDuration, 1) : 0;
  const title = currentTrack?.title ?? "等待选择歌曲";
  const artist = currentTrack?.artist ?? "从曲库或共享队列中选择一首歌";
  const playbackMode = playback?.playbackMode ?? "sequence";
  const artworkPalette = useArtworkPalette(currentTrack?.artworkUrl);
  const playerStyle = {
    backgroundColor: artworkPalette.surface,
    borderColor: artworkPalette.border
  };
  const progressRenderIntervalMs = resolveProgressRenderIntervalMs({ isPageVisible });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => setIsPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    progressAnchorRef.current = {
      progressMs,
      receivedAtMs: Date.now()
    };

    if (seekDraft !== null || !isPlaying) {
      setRenderedProgressMs(clampProgressMs(progressMs, currentTrackDuration));
    }
  }, [currentTrackDuration, isPlaying, progressMs, seekDraft]);

  useEffect(() => {
    if (seekDraft !== null || !isPlaying) {
      return;
    }

    const render = () => {
      const nextProgressMs = resolveAnchoredProgressMs({
        progressMs: progressAnchorRef.current.progressMs,
        receivedAtMs: progressAnchorRef.current.receivedAtMs,
        durationMs: currentTrackDuration,
        nowMs: Date.now()
      });
      setRenderedProgressMs((current) =>
        Math.abs(current - nextProgressMs) >= 200 ? nextProgressMs : current
      );
    };

    render();
    const timerId = window.setInterval(render, progressRenderIntervalMs);
    return () => {
      window.clearInterval(timerId);
    };
  }, [currentTrackDuration, isPlaying, progressRenderIntervalMs, seekDraft]);

  const clearPendingSeek = useCallback(
    (requestId: number) => {
      if (seekRequestIdRef.current !== requestId) {
        return;
      }

      seekCommitTargetRef.current = null;
      setPendingSeek(null);
      setSeekDraft(null);
    },
    [setSeekDraft]
  );

  useEffect(() => {
    if (!pendingSeek) {
      return;
    }

    if (!playback || playback.currentTrackId !== pendingSeek.trackId) {
      clearPendingSeek(pendingSeek.requestId);
      return;
    }

    if (!shouldResolvePendingSeek({ pendingSeek, playback })) {
      return;
    }

    if (isPendingSeekTargetReached({ pendingSeek, playback })) {
      setRenderedProgressMs(clampProgressMs(pendingSeek.targetPositionMs, currentTrackDuration));
      progressAnchorRef.current = {
        progressMs: pendingSeek.targetPositionMs,
        receivedAtMs: Date.now()
      };
    }
    clearPendingSeek(pendingSeek.requestId);
  }, [clearPendingSeek, currentTrackDuration, pendingSeek, playback]);

  const commitSeek = useCallback(() => {
    if (seekDraft !== null && canSeekPlayback && canControlPlayback) {
      const targetPositionMs = clampProgressMs(seekDraft, currentTrackDuration);
      if (seekCommitTargetRef.current === targetPositionMs) {
        return;
      }
      seekCommitTargetRef.current = targetPositionMs;
      const requestId = seekRequestIdRef.current + 1;
      seekRequestIdRef.current = requestId;
      setPendingSeek({
        requestId,
        trackId: playback?.currentTrackId ?? null,
        targetPositionMs,
        expectedPlaybackRevision: null
      });
      setRenderedProgressMs(targetPositionMs);
      progressAnchorRef.current = {
        progressMs: targetPositionMs,
        receivedAtMs: Date.now()
      };
      startTransition(() => {
        void onSeek(targetPositionMs)
          .then((nextPlayback) => {
            if (seekRequestIdRef.current !== requestId) {
              return;
            }

            if (!nextPlayback) {
              clearPendingSeek(requestId);
              return;
            }

            setPendingSeek((current) =>
              current?.requestId === requestId
                ? {
                    ...current,
                    expectedPlaybackRevision: nextPlayback.playbackRevision
                  }
                : current
            );
          })
          .catch(() => {
            clearPendingSeek(requestId);
          });
      });
    }
  }, [
    canControlPlayback,
    canSeekPlayback,
    clearPendingSeek,
    currentTrackDuration,
    onSeek,
    playback?.currentTrackId,
    seekDraft,
    setPendingSeek,
    startTransition
  ]);

  const getLiveProgressMs = useCallback(
    () =>
      resolveAnchoredProgressMs({
        progressMs: progressAnchorRef.current.progressMs,
        receivedAtMs: progressAnchorRef.current.receivedAtMs,
        durationMs: currentTrackDuration,
        nowMs: Date.now()
      }),
    [currentTrackDuration]
  );

  const togglePlayback = useCallback(() => {
    void (isPlaying ? onPause(getLiveProgressMs()) : onPlay());
  }, [getLiveProgressMs, isPlaying, onPause, onPlay]);

  const playPrev = useCallback(() => {
    void onPrev();
  }, [onPrev]);

  const playNext = useCallback(() => {
    void onNext();
  }, [onNext]);

  return (
    <>
    <footer
      className="fixed inset-x-3 bottom-3 z-[60] box-border flex min-h-0 flex-col justify-center overflow-visible rounded-2xl border border-surface-border bg-background-secondary/95 px-2.5 pb-[calc(env(safe-area-inset-bottom)_+_0.5rem)] pt-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-[background-color,border-color] duration-700 sm:px-4 sm:pt-3 lg:inset-x-0 lg:bottom-0 lg:min-h-[4.5rem] lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-t lg:px-8 lg:pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] lg:pt-3"
      style={playerStyle}
      data-testid="bottom-player"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-white/5 z-10" aria-hidden="true">
        <div
          className="h-full transition-[width,background-color,box-shadow] duration-150 ease-linear"
          style={{
            width: `${progressRatio * 100}%`,
            backgroundColor: artworkPalette.accent,
            boxShadow: `0 0 10px ${artworkPalette.accentGlow}`
          }}
        />
      </div>

      <div className="relative z-10 w-full flex flex-col justify-center">
      <MobileBottomPlayerLayout
        isPlaying={isPlaying}
        canControlPlayback={canControlPlayback}
        canSeekPlayback={canSeekPlayback && canControlPlayback}
        playbackTrackId={playback?.currentTrackId}
        title={title}
        artist={artist}
        boundedProgressMs={boundedProgressMs}
        currentTrackDuration={currentTrackDuration}
        setSeekDraft={setSeekDraft}
        commitSeek={commitSeek}
        onPrev={playPrev}
        onNext={playNext}
        onTogglePlay={togglePlayback}
        playbackMode={playbackMode}
        onCyclePlaybackMode={onCyclePlaybackMode}
        queue={queue}
        tracks={tracks}
        currentQueueItemId={currentQueueItemId}
        canReorderQueue={canReorderQueue}
        canRemoveQueue={canRemoveQueue}
        onPlayQueueItem={onPlayQueueItem}
        onRemoveQueueItem={onRemoveQueueItem}
        onReorderQueue={onReorderQueue}
        isImmersiveOpen={isImmersiveOpen}
        onToggleImmersive={() => setIsImmersiveOpen((current) => !current)}
        isMiniOpen={isMiniOpen}
        onToggleMini={toggleMiniPlayer}
        isLyricsOpen={isLyricsOpen}
        onToggleLyrics={onToggleLyrics}
        artworkAccent={artworkPalette.accent}
        artworkAccentSoft={artworkPalette.accentSoft}
        artworkUrl={currentTrack?.artworkUrl ?? null}
      />
      <DesktopBottomPlayerLayout
        isPlaying={isPlaying}
        canControlPlayback={canControlPlayback}
        canSeekPlayback={canSeekPlayback && canControlPlayback}
        playbackTrackId={playback?.currentTrackId}
        title={title}
        artist={artist}
        boundedProgressMs={boundedProgressMs}
        currentTrackDuration={currentTrackDuration}
        setSeekDraft={setSeekDraft}
        commitSeek={commitSeek}
        onPrev={playPrev}
        onNext={playNext}
        onTogglePlay={togglePlayback}
        playbackMode={playbackMode}
        onCyclePlaybackMode={onCyclePlaybackMode}
        queue={queue}
        tracks={tracks}
        currentQueueItemId={currentQueueItemId}
        canReorderQueue={canReorderQueue}
        canRemoveQueue={canRemoveQueue}
        onPlayQueueItem={onPlayQueueItem}
        onRemoveQueueItem={onRemoveQueueItem}
        onReorderQueue={onReorderQueue}
        isImmersiveOpen={isImmersiveOpen}
        onToggleImmersive={() => setIsImmersiveOpen((current) => !current)}
        isMiniOpen={isMiniOpen}
        onToggleMini={toggleMiniPlayer}
        isLyricsOpen={isLyricsOpen}
        onToggleLyrics={onToggleLyrics}
        artworkAccent={artworkPalette.accent}
        artworkAccentSoft={artworkPalette.accentSoft}
        artworkUrl={currentTrack?.artworkUrl ?? null}
      />
      </div>

      <audio
        ref={audioRef}
        className="hidden"
        playsInline
        onLoadedMetadata={() => {
          syncDurationFromAudio();
          syncProgressFromAudio();
        }}
        onDurationChange={syncDurationFromAudio}
        onPlay={syncProgressFromAudio}
        onPause={syncProgressFromAudio}
        onSeeked={syncProgressFromAudio}
      />

      {isPending ? (
        <div className="animate-fade-in absolute -top-8 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-3 py-1 text-xs text-foreground-muted shadow-lg backdrop-blur-md">
          <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
          同步中...
        </div>
      ) : null}
    </footer>
    <ImmersivePlayerOverlay
      isOpen={isImmersiveOpen}
      isPlaying={isPlaying}
      positionMs={boundedProgressMs}
      currentTrack={currentTrack}
      onClose={() => setIsImmersiveOpen(false)}
    />
    <MiniPlayerOverlay
      isOpen={isMiniOpen}
      isPlaying={isPlaying}
      canControlPlayback={canControlPlayback}
      canSeekPlayback={canSeekPlayback && canControlPlayback}
      playbackTrackId={playback?.currentTrackId}
      title={title}
      artist={artist}
      positionMs={boundedProgressMs}
      durationMs={currentTrackDuration}
      artworkUrl={currentTrack?.artworkUrl ?? null}
      setSeekDraft={setSeekDraft}
      commitSeek={commitSeek}
      onPrev={playPrev}
      onNext={playNext}
      onTogglePlay={togglePlayback}
      onOpenImmersive={() => {
        closeMiniPlayer();
        setIsImmersiveOpen(true);
      }}
      onClose={closeMiniPlayer}
      pipWindow={miniPlayerWindow}
    />
    </>
  );
}

export const BottomPlayer = memo(BottomPlayerBase);


