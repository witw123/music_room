"use client";

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PlaybackSnapshot } from "@music-room/shared";
import {
  getCriticalBufferThresholdMs,
  hasActivePlaybackIntent,
  type ProgressiveHealthSnapshot,
  type ProgressivePlaybackSource
} from "../progressive-playback";
import {
  resolveInactivePlaybackSchedulerAction,
  resolveSlidingWindowLowBufferFallbackReason
} from "./pipeline";

type PlaybackSchedulerStateInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  isPageVisible: boolean;
  playbackCurrentTrackId: string | null;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  playbackStatus: PlaybackSnapshot["status"] | null;
  progressiveHealthSnapshot: ProgressiveHealthSnapshot;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
};

export function usePlaybackSchedulerState({
  activePlaybackSource,
  isPageVisible,
  playbackCurrentTrackId,
  playbackRef,
  playbackStatus,
  progressiveHealthSnapshot,
  setProgressiveFallbackReason,
  setSchedulerMode
}: PlaybackSchedulerStateInput) {
  useEffect(() => {
    const schedulerAction = resolveInactivePlaybackSchedulerAction({
      currentTrackId: playbackCurrentTrackId,
      playbackStatus,
      isPageVisible
    });
    if (schedulerAction) {
      setSchedulerMode(schedulerAction.schedulerMode);
    }
  }, [isPageVisible, playbackCurrentTrackId, playbackStatus, setSchedulerMode]);

  useEffect(() => {
    const fallbackReason = resolveSlidingWindowLowBufferFallbackReason({
      activePlaybackSource,
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
      startupReady: progressiveHealthSnapshot.startupReady,
      aheadBufferedMs: progressiveHealthSnapshot.aheadBufferedMs,
      criticalBufferThresholdMs: getCriticalBufferThresholdMs()
    });
    if (fallbackReason) {
      setProgressiveFallbackReason(fallbackReason);
    }
  }, [
    activePlaybackSource,
    playbackCurrentTrackId,
    playbackRef,
    playbackStatus,
    progressiveHealthSnapshot.aheadBufferedMs,
    progressiveHealthSnapshot.startupReady,
    setProgressiveFallbackReason
  ]);
}
