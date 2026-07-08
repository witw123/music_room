"use client";

import {
  useCallback,
  useMemo,
  useRef,
  type MutableRefObject
} from "react";
import type {
  PeerDiagnosticsSnapshot,
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  canUseProgressivePlayback,
  getEffectivePlaybackPositionMs,
  getProgressiveEngineType,
  getProgressiveTrackManifestKey,
  isTakeoverReady,
  type ProgressivePlaybackSource,
  type ProgressiveTrackManifest
} from "../progressive-playback";
import {
  shouldRetryPcmRuntimeAfterFailure
} from "../pcm-runtime-failure";
import {
  isPlaybackStartIntentPending,
  type PlaybackStartIntent
} from "../playback-start-intent";
import {
  shouldForceSourceOwnerLocalPlayback
} from "../progressive-source-controller";
import {
  buildCurrentTrackFormatKey,
  buildPlaybackPositionKey,
  resolveActiveMemberPeerIds,
  resolveAggregatePieceDownloadRateKbps,
  resolveCurrentBufferedFullLocalTrack,
  resolveFullLocalPlaybackSessionState,
  resolveTrackAvailabilityAnnouncement,
  resolveTrackAvailabilityManifestHint,
  shouldPrepareProgressiveRuntime,
  shouldWarmFullLocalWithSharedAudioElement,
  type FullLocalPlaybackSessionState
} from "./pipeline";
import type { FullLocalPlaybackTrack } from "./runtime-types";
import {
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey
} from "@/features/room/hooks/room-playback-topology";

type PlaybackRuntimeInputStateInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  currentTrack: TrackMeta | null;
  fullLocalPlaybackTracks: Record<string, FullLocalPlaybackTrack>;
  isCurrentSourceOwner: boolean;
  pcmRuntimeFailureRef: MutableRefObject<{ trackId: string; reason: string } | null>;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerId: string;
  playbackStartIntent: PlaybackStartIntent | null;
  progressiveFallbackReason: string | null;
  roomSnapshot: RoomSnapshot | null;
  trackCachingEnabled: boolean;
  uploadedTracks: Record<string, UploadedTrack>;
};

export function usePlaybackRuntimeInputState({
  activePlaybackSource,
  availabilityByTrack,
  currentTrack,
  fullLocalPlaybackTracks,
  isCurrentSourceOwner,
  pcmRuntimeFailureRef,
  peerDiagnostics,
  peerId,
  playbackStartIntent,
  progressiveFallbackReason,
  roomSnapshot,
  trackCachingEnabled,
  uploadedTracks
}: PlaybackRuntimeInputStateInput) {
  const fullLocalPlaybackSessionRef = useRef<FullLocalPlaybackSessionState>({
    key: null,
    availableInSession: false
  });
  const currentProgressiveManifestRef = useRef<{
    key: string;
    manifest: ProgressiveTrackManifest | null;
  }>({
    key: "none",
    manifest: null
  });

  const roomId = roomSnapshot?.room.id ?? null;
  const playback = roomSnapshot?.room.playback;
  const playbackRevision = playback?.playbackRevision ?? playback?.queueVersion ?? 0;
  const playbackCurrentTrackId = playback?.currentTrackId ?? null;
  const playbackStatus = playback?.status ?? null;
  const playbackMediaEpoch = playback?.mediaEpoch ?? null;
  const playbackPositionKey = buildPlaybackPositionKey(playback);
  const playbackSurfaceKey = resolvePlaybackSurfaceKey(playback);
  const playbackTimelineKey = resolvePlaybackTimelineKey(playback);

  const currentBufferedFullLocalTrack = useMemo(
    () =>
      resolveCurrentBufferedFullLocalTrack({
        currentTrackId: currentTrack?.id,
        fullLocalPlaybackTracks,
        uploadedTracks
      }),
    [currentTrack?.id, fullLocalPlaybackTracks, uploadedTracks]
  );
  const playbackRef = useRef<RoomSnapshot["room"]["playback"] | null | undefined>(playback);
  playbackRef.current = playback;
  const currentTrackRef = useRef<TrackMeta | null>(currentTrack);
  currentTrackRef.current = currentTrack;
  const currentBufferedFullLocalTrackRef =
    useRef<FullLocalPlaybackTrack | null | undefined>(currentBufferedFullLocalTrack);
  currentBufferedFullLocalTrackRef.current = currentBufferedFullLocalTrack;

  const currentTrackDurationMs = currentTrack?.durationMs ?? null;
  const currentTrackFormatKey = buildCurrentTrackFormatKey(currentTrack);
  const currentBufferedFullLocalTrackObjectUrl =
    currentBufferedFullLocalTrack?.objectUrl ?? null;
  fullLocalPlaybackSessionRef.current = resolveFullLocalPlaybackSessionState({
    currentSession: fullLocalPlaybackSessionRef.current,
    playbackSurfaceKey,
    hasBufferedFullLocalTrack: !!currentBufferedFullLocalTrack
  });
  const canUseFullLocalForPlaybackSession =
    fullLocalPlaybackSessionRef.current.availableInSession && !!currentBufferedFullLocalTrack;
  const forceSourceOwnerLocalPlayback = shouldForceSourceOwnerLocalPlayback({
    isCurrentSourceOwner,
    activePlaybackSource,
    hasFullLocalTrack: canUseFullLocalForPlaybackSession
  });
  const activeMemberPeerIds = useMemo(
    () => resolveActiveMemberPeerIds(roomSnapshot?.room.members),
    [roomSnapshot?.room.members]
  );
  const currentTrackAvailabilityAnnouncement = useMemo(
    () =>
      resolveTrackAvailabilityAnnouncement({
        currentTrackId: currentTrack?.id,
        availabilityByTrack,
        peerId
      }),
    [availabilityByTrack, currentTrack?.id, peerId]
  );
  const currentTrackAvailableChunksRef = useRef<number[]>([]);
  currentTrackAvailableChunksRef.current =
    currentTrackAvailabilityAnnouncement?.availableChunks ?? [];
  const currentTrackAvailableChunksKey =
    currentTrackAvailabilityAnnouncement?.availableChunks.join(",") ?? "";
  const currentTrackAvailabilityManifestHint = useMemo(
    () =>
      resolveTrackAvailabilityManifestHint({
        currentTrackId: currentTrack?.id,
        roomId,
        availabilityByTrack,
        activeMemberPeerIds,
        fallbackAnnouncement: currentTrackAvailabilityAnnouncement
      }),
    [
      activeMemberPeerIds,
      availabilityByTrack,
      currentTrack?.id,
      currentTrackAvailabilityAnnouncement,
      roomId
    ]
  );
  const currentProgressiveManifestKey = getProgressiveTrackManifestKey(
    currentTrack,
    currentTrackAvailabilityAnnouncement,
    currentTrackAvailabilityManifestHint
  );
  const nextCurrentProgressiveManifest = buildProgressiveTrackManifest(
    currentTrack,
    currentTrackAvailabilityAnnouncement,
    currentTrackAvailabilityManifestHint
  );
  if (currentProgressiveManifestRef.current.key !== currentProgressiveManifestKey) {
    currentProgressiveManifestRef.current = {
      key: currentProgressiveManifestKey,
      manifest: nextCurrentProgressiveManifest
    };
  }
  const currentProgressiveManifest = currentProgressiveManifestRef.current.manifest;
  const currentProgressiveEngineType = useMemo(
    () => getProgressiveEngineType(currentProgressiveManifest),
    [currentProgressiveManifest]
  );
  const aggregatePieceDownloadRateKbps = useMemo(
    () =>
      resolveAggregatePieceDownloadRateKbps({
        activeMemberPeerIds,
        peerDiagnostics
      }),
    [activeMemberPeerIds, peerDiagnostics]
  );
  const progressiveHealthSnapshot = buildProgressiveHealthSnapshot({
    playback,
    activeSource: activePlaybackSource,
    manifest: currentProgressiveManifest,
    localAvailability: currentTrackAvailabilityAnnouncement,
    fallbackReason: progressiveFallbackReason,
    currentPieceDownloadRateKbps: aggregatePieceDownloadRateKbps
  });
  const progressiveSchedulerPolicy = progressiveHealthSnapshot.schedulerPolicy;
  const isProgressiveTakeoverReady = useCallback(
    (now = Date.now()) => {
      if (!currentProgressiveManifest) {
        return false;
      }

      return isTakeoverReady({
        manifest: currentProgressiveManifest,
        availableChunks: currentTrackAvailableChunksRef.current,
        playbackPositionMs: getEffectivePlaybackPositionMs(
          playbackRef.current,
          currentProgressiveManifest.durationMs,
          now
        )
      });
    },
    [currentProgressiveManifest]
  );
  const canPrepareProgressiveLocal = shouldPrepareProgressiveRuntime({
    trackCachingEnabled,
    hasProgressiveManifest: !!currentProgressiveManifest,
    progressivePlaybackSupported: canUseProgressivePlayback(),
    shouldRetryAfterRuntimeFailure: shouldRetryPcmRuntimeAfterFailure({
      currentTrackId: currentProgressiveManifest?.trackId,
      failureTrackId: pcmRuntimeFailureRef.current?.trackId,
      failureReason: pcmRuntimeFailureRef.current?.reason
    }),
    activePlaybackSource,
    progressiveEngineType: currentProgressiveEngineType
  });
  const canWarmBufferedFullLocal = shouldWarmFullLocalWithSharedAudioElement({
    activePlaybackSource,
    progressiveEngineType: currentProgressiveEngineType,
    canUseFullLocalForPlaybackSession,
    isCurrentSourceOwner
  });
  const pendingPlaybackIntent = isPlaybackStartIntentPending(playbackStartIntent);

  return {
    aggregatePieceDownloadRateKbps,
    canPrepareProgressiveLocal,
    canUseFullLocalForPlaybackSession,
    canWarmBufferedFullLocal,
    currentBufferedFullLocalTrack,
    currentBufferedFullLocalTrackObjectUrl,
    currentBufferedFullLocalTrackRef,
    currentProgressiveEngineType,
    currentProgressiveManifest,
    currentProgressiveManifestKey,
    currentProgressiveManifestRef,
    currentTrackAvailableChunksKey,
    currentTrackDurationMs,
    currentTrackFormatKey,
    currentTrackRef,
    forceSourceOwnerLocalPlayback,
    fullLocalReady: canUseFullLocalForPlaybackSession,
    isProgressiveTakeoverReady,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackPositionKey,
    playbackRef,
    playbackRevision,
    playbackStatus,
    playbackSurfaceKey,
    playbackTimelineKey,
    pendingPlaybackIntent,
    progressiveHealthSnapshot,
    progressiveSchedulerPolicy
  };
}
