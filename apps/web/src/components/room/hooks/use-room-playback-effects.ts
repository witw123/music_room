"use client";

import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { getSlidingWindowPlaybackSource } from "@/features/playback/progressive-source-controller";
import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "@/features/playback/progressive-playback";
import { resolveSlidingWindowFormat } from "@/features/playback/sliding-window/format-detection";
import {
  getPlaybackSourceInitializationKey,
  shouldInitializePlaybackSource
} from "@/components/room/hooks/use-room-page-derived";
import { consumeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";
import { resolvePlaybackSourceResetReason } from "@/features/room/hooks/room-playback-topology";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";

type PlaybackTopologySnapshot = {
  currentTrackId: string;
  mediaEpoch: number | null;
  sourcePeerId: string | null;
  sourceSessionId: string | null;
} | null;

type UseRoomPlaybackEffectsInput = {
  cachedFullLocalPlaybackTrack: { trackId: string } | null | undefined;
  currentPlaybackTrackId: string | null;
  currentProgressiveEngineTypeForSource: ProgressiveEngineType;
  currentTrack: RoomSnapshot["tracks"][number] | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  ensureSourcePlaybackStarted: () => void | Promise<void>;
  hasPlayableFullLocalTrack: boolean;
  initialRoomId: string | null;
  isCurrentSourceOwner: boolean;
  playbackSourceInitializationKeyRef: MutableRefObject<string | null>;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null;
  playbackSurfaceKey: string | null;
  playbackTimelineKey: string | null;
  playbackTopologySnapshot: PlaybackTopologySnapshot;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
};

export function useRoomPlaybackEffects({
  cachedFullLocalPlaybackTrack,
  currentPlaybackTrackId,
  currentProgressiveEngineTypeForSource,
  currentTrack,
  dispatchRoomStateEvent,
  ensureSourcePlaybackStarted,
  hasPlayableFullLocalTrack,
  initialRoomId,
  isCurrentSourceOwner,
  playbackSourceInitializationKeyRef,
  playbackStatus,
  playbackSurfaceKey,
  playbackTimelineKey,
  playbackTopologySnapshot,
  recordPeerDiagnostic,
  setActivePlaybackSource,
  setProgressiveFallbackReason
}: UseRoomPlaybackEffectsInput) {
  useEffect(() => {
    if (
      isCurrentSourceOwner &&
      playbackStatus === "playing" &&
      currentPlaybackTrackId &&
      cachedFullLocalPlaybackTrack?.trackId === currentPlaybackTrackId
    ) {
      void ensureSourcePlaybackStarted();
    }
  }, [
    cachedFullLocalPlaybackTrack?.trackId,
    currentPlaybackTrackId,
    ensureSourcePlaybackStarted,
    isCurrentSourceOwner,
    playbackStatus
  ]);

  useEffect(() => {
    if (!initialRoomId) {
      return;
    }

    const handoffSnapshot = consumeRoomSnapshotHandoff(initialRoomId);
    if (!handoffSnapshot) {
      return;
    }

    dispatchRoomStateEvent({
      type: "bootstrap-handoff",
      snapshot: handoffSnapshot
    });
  }, [dispatchRoomStateEvent, initialRoomId]);

  useEffect(() => {
    const nextInitializationKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey,
      currentPlaybackTrackId,
      currentTrack,
      currentProgressiveEngineTypeForSource,
      hasPlayableFullLocalTrack
    });
    if (
      !shouldInitializePlaybackSource({
        previousInitializationKey: playbackSourceInitializationKeyRef.current,
        nextInitializationKey
      })
    ) {
      return;
    }
    playbackSourceInitializationKeyRef.current = nextInitializationKey;

    if (!currentPlaybackTrackId) {
      setActivePlaybackSource("progressive-local");
      setProgressiveFallbackReason(null);
      return;
    }

    setActivePlaybackSource(
      getSlidingWindowPlaybackSource({
        hasFullLocalTrack: hasPlayableFullLocalTrack,
        format: resolveSlidingWindowFormat({
          mimeType: currentTrack?.mimeType ?? null,
          codec: currentTrack?.codec ?? null,
          title: currentTrack?.title ?? null
        }),
        progressiveEngineType: currentProgressiveEngineTypeForSource
      })
    );
    setProgressiveFallbackReason(null);
  }, [
    playbackSurfaceKey,
    currentPlaybackTrackId,
    currentTrack,
    currentProgressiveEngineTypeForSource,
    hasPlayableFullLocalTrack,
    playbackSourceInitializationKeyRef,
    setActivePlaybackSource,
    setProgressiveFallbackReason
  ]);

  const previousPlaybackRef = useRef(playbackTopologySnapshot);

  useEffect(() => {
    const previousPlayback = previousPlaybackRef.current;
    const nextPlayback = playbackTopologySnapshot;
    const sourceResetReason = resolvePlaybackSourceResetReason({
      previousPlayback,
      nextPlayback
    });
    previousPlaybackRef.current = nextPlayback;

    recordPeerDiagnostic({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "playback-surface-state",
      summary: playbackSurfaceKey
        ? `播放面 ${playbackSurfaceKey}`
        : "当前没有活跃播放面",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          playbackSurfaceKey,
          playbackTimelineKey,
          sourceResetReason
        }
      })
    });
  }, [
    playbackSurfaceKey,
    playbackTimelineKey,
    recordPeerDiagnostic,
    playbackTopologySnapshot
  ]);
}
