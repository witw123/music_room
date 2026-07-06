import type {
  PeerDiagnosticsSnapshot,
  PlaybackSnapshot,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import { selectCanonicalTrackAvailabilityAnnouncement } from "@/features/p2p";
import type {
  ProgressiveEngineType,
  ProgressivePlaybackSource
} from "../progressive-playback";
import type { ProgressivePcmEngineSnapshot } from "../progressive-pcm-engine";

export type PlaybackRecoveryStage =
  | "startup-buffering"
  | "steady"
  | "degraded"
  | "shadow-catchup"
  | "audible-local-fallback";

export type SchedulerBudgetTier = "critical" | "protected" | "comfort" | "expanded";

export type TransportGovernorMode =
  | "bootstrap"
  | "segment-catchup"
  | "local-primary"
  | "emergency-fallback";

export type FullLocalPlaybackSessionState = {
  key: string | null;
  availableInSession: boolean;
};

const fullLocalMaxDriftMs = 180;
const haveCurrentDataReadyState = 2;

type TrackFormatInput = Pick<
  TrackMeta,
  "id" | "fileHash" | "durationMs" | "mimeType" | "codec"
> | null | undefined;

export function buildCurrentTrackFormatKey(track: TrackFormatInput) {
  return [
    track?.id ?? "none",
    track?.fileHash ?? "none",
    track?.durationMs ?? "unknown-duration",
    track?.mimeType ?? "unknown-mime",
    track?.codec ?? "unknown-codec"
  ].join("|");
}

type PlaybackPositionInput = Pick<
  PlaybackSnapshot,
  "status" | "currentTrackId" | "positionMs" | "startedAt" | "mediaEpoch"
> | null | undefined;

export function buildPlaybackPositionKey(playback: PlaybackPositionInput) {
  return [
    playback?.currentTrackId ?? "none",
    playback?.status ?? "none",
    playback?.positionMs ?? "unknown-position",
    playback?.startedAt ?? "not-started",
    playback?.mediaEpoch ?? "unknown-epoch"
  ].join("|");
}

export function buildAvailableChunksKey(chunks: readonly number[] | null | undefined) {
  return chunks?.join(",") ?? "none";
}

export function resolveActiveMemberPeerIds(
  members: readonly { peerId?: string | null }[] | null | undefined
) {
  return new Set(
    members
      ?.map((member) => member.peerId)
      .filter((memberPeerId): memberPeerId is string => !!memberPeerId) ?? []
  );
}

export function resolveAggregatePieceDownloadRateKbps(input: {
  peerDiagnostics: readonly Pick<
    PeerDiagnosticsSnapshot,
    "peerId" | "pieceDownloadRateKbps"
  >[];
  activeMemberPeerIds: ReadonlySet<string>;
}) {
  const values = input.peerDiagnostics
    .filter((snapshot) => input.activeMemberPeerIds.has(snapshot.peerId))
    .map((snapshot) => snapshot.pieceDownloadRateKbps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0));
}

export function resolveCurrentBufferedFullLocalTrack<TFullLocal, TUploaded>(input: {
  currentTrackId: string | null | undefined;
  fullLocalPlaybackTracks: Record<string, TFullLocal>;
  uploadedTracks: Record<string, TUploaded>;
}): TFullLocal | TUploaded | null {
  return input.currentTrackId
    ? input.fullLocalPlaybackTracks[input.currentTrackId] ??
        input.uploadedTracks[input.currentTrackId] ??
        null
    : null;
}

export function resolveTrackAvailabilityAnnouncement<TAnnouncement>(input: {
  currentTrackId: string | null | undefined;
  availabilityByTrack: Record<string, Record<string, TAnnouncement>>;
  peerId: string;
}): TAnnouncement | null {
  return input.currentTrackId
    ? input.availabilityByTrack[input.currentTrackId]?.[input.peerId] ?? null
    : null;
}

export function resolveTrackAvailabilityManifestHint(input: {
  currentTrackId: string | null | undefined;
  roomId: string | null | undefined;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  activeMemberPeerIds: ReadonlySet<string>;
  fallbackAnnouncement: TrackAvailabilityAnnouncement | null;
}) {
  if (!input.currentTrackId || !input.roomId) {
    return input.fallbackAnnouncement;
  }

  return (
    selectCanonicalTrackAvailabilityAnnouncement(
      Object.values(input.availabilityByTrack[input.currentTrackId] ?? {}).filter(
        (announcement) =>
          announcement.roomId === input.roomId &&
          input.activeMemberPeerIds.has(announcement.ownerPeerId)
      )
    ) ?? input.fallbackAnnouncement
  );
}

export function resolveNextQueueTrackPrefetch(input: {
  queue: readonly { id: string; trackId: string }[] | null | undefined;
  currentQueueItemId: string | null | undefined;
  currentTrackId: string | null | undefined;
  tracks: readonly { id: string; title: string }[] | null | undefined;
  availabilityByTrack: Record<
    string,
    Record<string, { availableChunks?: readonly unknown[]; totalChunks?: number }>
  >;
  peerId: string;
}) {
  if (!input.queue?.length) {
    return null;
  }

  const currentQueueIndex = input.currentQueueItemId
    ? input.queue.findIndex((item) => item.id === input.currentQueueItemId)
    : input.currentTrackId
      ? input.queue.findIndex((item) => item.trackId === input.currentTrackId)
      : -1;
  const nextQueueItem =
    currentQueueIndex >= 0 ? input.queue[currentQueueIndex + 1] ?? null : null;
  if (!nextQueueItem) {
    return null;
  }

  const nextTrack = input.tracks?.find((track) => track.id === nextQueueItem.trackId) ?? null;
  if (!nextTrack) {
    return null;
  }

  const localAvailability = input.availabilityByTrack[nextTrack.id]?.[input.peerId] ?? null;
  const bufferedChunks = localAvailability?.availableChunks?.length ?? 0;
  const totalChunks = localAvailability?.totalChunks ?? 0;

  return `${nextTrack.title} ${bufferedChunks}/${totalChunks}`;
}

export function isSlidingWindowPlaybackSource(source: ProgressivePlaybackSource | "remote") {
  return source === "progressive-local" || source === "lossless-local";
}

export function resolveLocalPlaybackPositionMs(input: {
  activePlaybackSource: ProgressivePlaybackSource | "remote";
  currentTimeSeconds: number | null | undefined;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    input.activePlaybackSource !== "full-local"
  ) {
    return null;
  }

  return Number.isFinite(input.currentTimeSeconds)
    ? Math.round((input.currentTimeSeconds ?? 0) * 1000)
    : null;
}

export function resolveTransportGovernorMode(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  mediaConnectedPeersCount: number;
  connectedPeersCount: number;
  pendingPlaybackIntent: boolean;
  progressiveFallbackReason: string | null;
  progressiveLocalEligible: boolean;
}): TransportGovernorMode {
  if (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    input.activePlaybackSource === "full-local"
  ) {
    return "local-primary";
  }

  if (
    input.progressiveFallbackReason ||
    input.pendingPlaybackIntent ||
    input.connectedPeersCount <= 0 ||
    !input.progressiveLocalEligible
  ) {
    return "bootstrap";
  }

  return "segment-catchup";
}

export function resolveSourceOwnerIdentity(input: {
  members: readonly { id: string; peerId?: string | null }[] | null | undefined;
  peerId: string;
  playbackSourceSessionId: string | null | undefined;
  playbackSourcePeerId: string | null | undefined;
  isSourceOwner: boolean;
}) {
  return {
    currentSessionUserId:
      input.members?.find((member) => member.peerId === input.peerId)?.id ?? null,
    playbackSourceSessionId: input.playbackSourceSessionId ?? null,
    currentPeerId: input.peerId || null,
    playbackSourcePeerId: input.playbackSourcePeerId ?? null,
    isSourceOwner: input.isSourceOwner
  };
}

export function getSlidingWindowPlayBlockedReason(source: ProgressivePlaybackSource) {
  return source === "lossless-local"
    ? "lossless-local-play-blocked"
    : "progressive-local-play-blocked";
}

export function resolvePlaybackStartFailureReason(source: ProgressivePlaybackSource) {
  return source === "full-local"
    ? "full-local-play-blocked"
    : getSlidingWindowPlayBlockedReason(source);
}

export function shouldReportPlaybackStartFailure(input: {
  pendingIntent: boolean;
  attempt: number;
  maxRetryAttempts: number;
}) {
  return input.pendingIntent || input.attempt >= input.maxRetryAttempts;
}

export function resolvePlaybackStartFailureMessage(input: {
  intentMatchesPlayback: boolean;
  blockedMessage: string;
}) {
  return input.intentMatchesPlayback
    ? "当前点击未能激活音频，请再次点击播放"
    : input.blockedMessage;
}

export function resolvePlaybackStartFailureIntentAction(input: {
  reportFailure: boolean;
  intentMatchesPlayback: boolean;
  blockedMessage: string;
}) {
  if (!input.reportFailure) {
    return {
      shouldMarkFailure: false,
      statusMessage: null
    };
  }

  return {
    shouldMarkFailure: true,
    statusMessage: resolvePlaybackStartFailureMessage({
      intentMatchesPlayback: input.intentMatchesPlayback,
      blockedMessage: input.blockedMessage
    })
  };
}

export function resolvePlaybackStartIntentTimeoutPreflight(input: {
  hasIntent: boolean;
  intentPending: boolean;
  expiresAtMs: number;
  nowMs: number;
}) {
  if (!input.hasIntent || !input.intentPending) {
    return null;
  }

  return {
    timeoutMs: Math.max(0, input.expiresAtMs - input.nowMs)
  };
}

export function resolvePlaybackStartIntentTimeoutResult(input: {
  hasCurrentIntent: boolean;
  currentIntentId: string | null | undefined;
  targetIntentId: string;
  currentIntentPending: boolean;
}) {
  return input.hasCurrentIntent &&
    input.currentIntentId === input.targetIntentId &&
    input.currentIntentPending
    ? "fail" as const
    : "keep" as const;
}

export function resolvePlaybackStartRetryPreflight(input: {
  playbackHasActiveIntent: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  requestedSource: ProgressivePlaybackSource;
  pendingIntent: boolean;
  attempt: number;
  maxRetryAttempts: number;
}) {
  if (!input.playbackHasActiveIntent || input.activePlaybackSource !== input.requestedSource) {
    return null;
  }

  return {
    failureReason: resolvePlaybackStartFailureReason(input.requestedSource),
    reportFailure: shouldReportPlaybackStartFailure({
      pendingIntent: input.pendingIntent,
      attempt: input.attempt,
      maxRetryAttempts: input.maxRetryAttempts
    })
  };
}

export function resolvePlaybackStartRetryResult(input: {
  playbackStarted: boolean;
  attempt: number;
  maxRetryAttempts: number;
}) {
  if (input.playbackStarted) {
    return {
      shouldClearRetry: true,
      shouldScheduleRetry: false
    };
  }

  return {
    shouldClearRetry: false,
    shouldScheduleRetry: input.attempt < input.maxRetryAttempts
  };
}

export function resolvePlaybackStartRetryClearAction(playbackHasActiveIntent: boolean) {
  return !playbackHasActiveIntent;
}

export function resolvePcmRuntimeFailureResetAction(input: {
  hasLatchedFailure: boolean;
  latchedTrackId: string | null | undefined;
  currentManifestTrackId: string | null | undefined;
}) {
  return (
    input.hasLatchedFailure &&
    input.latchedTrackId !== input.currentManifestTrackId
  );
}

export function resolvePcmRuntimeFailureAction(input: {
  currentManifestTrackId: string | null | undefined;
  reason: string | null | undefined;
  shouldLatchFailure: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  canUseFullLocalForPlaybackSession: boolean;
}) {
  if (!input.currentManifestTrackId || !input.reason || !input.shouldLatchFailure) {
    return null;
  }

  return {
    latchedFailure: {
      trackId: input.currentManifestTrackId,
      reason: input.reason
    },
    shouldDestroyPcmEngine: true,
    fallbackReason: "progressive-init-failed" as const,
    nextSource: resolvePlaybackSourceAfterLatchedPcmRuntimeFailure({
      activePlaybackSource: input.activePlaybackSource,
      canUseFullLocalForPlaybackSession: input.canUseFullLocalForPlaybackSession
    })
  };
}

export function resolveListenerMediaConnectionState(input: {
  currentTrackId: string | null | undefined;
  isCurrentSourceOwner: boolean;
  playbackHasActiveIntent: boolean;
  localPlaybackReady: boolean;
}): RoomMediaConnectionState | null {
  if (!input.currentTrackId) {
    return "idle";
  }

  if (input.isCurrentSourceOwner) {
    return null;
  }

  if (!input.playbackHasActiveIntent) {
    return "idle";
  }

  return input.localPlaybackReady ? "live" : "buffering";
}

export function resolveLocalPlaybackReady(input: {
  hasAudio: boolean;
  localAudioPaused: boolean;
  localAudioReadyState: number;
  localAudioHasSrcObject: boolean;
  localAudioHasCurrentSrc: boolean;
}) {
  return (
    input.hasAudio &&
    !input.localAudioPaused &&
    (input.localAudioReadyState >= haveCurrentDataReadyState ||
      input.localAudioHasSrcObject ||
      input.localAudioHasCurrentSrc)
  );
}

export function resolvePlayingMediaConnectionState(input: {
  currentState: RoomMediaConnectionState;
  currentTrackId: string | null | undefined;
}): RoomMediaConnectionState {
  return input.currentState === "idle" && !input.currentTrackId ? input.currentState : "live";
}

export function resolveBufferingMediaConnectionState(
  currentState: RoomMediaConnectionState
): RoomMediaConnectionState {
  return currentState === "failed" ? currentState : "buffering";
}

export function resolveInactivePlaybackSchedulerMode(isPageVisible: boolean) {
  return isPageVisible ? "normal" as const : "idle" as const;
}

export function resolveInactivePlaybackSchedulerAction(input: {
  currentTrackId: string | null | undefined;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  isPageVisible: boolean;
}) {
  if (input.currentTrackId && input.playbackStatus !== "paused" && input.playbackStatus !== null) {
    return null;
  }

  return {
    schedulerMode: resolveInactivePlaybackSchedulerMode(input.isPageVisible)
  };
}

export function resolvePlaybackSurfaceResetMediaConnectionState(
  playbackHasActiveIntent: boolean
): RoomMediaConnectionState {
  return playbackHasActiveIntent ? "buffering" : "idle";
}

export function resolveLocalReadyPlaybackAction(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackHasActiveIntent: boolean;
  localAudioPaused: boolean;
}) {
  return {
    shouldEnsurePlaybackStart:
      input.activePlaybackSource === "full-local" ||
      isSlidingWindowPlaybackSource(input.activePlaybackSource),
    shouldAttemptFullLocalPlayback:
      input.activePlaybackSource === "full-local" &&
      input.playbackHasActiveIntent &&
      input.localAudioPaused
  };
}

export function resolveFullLocalReadyPlaybackResult(playbackStarted: boolean) {
  return playbackStarted
    ? {
        mediaConnectionState: "live" as const,
        diagnosticEvent: "full-local-ready-played" as const,
        diagnosticSummary: "本地完整缓存 ready 后已启动播放",
        recordEvent: false
      }
    : {
        mediaConnectionState: "buffering" as const,
        diagnosticEvent: "full-local-ready-play-failed" as const,
        diagnosticSummary: "本地完整缓存 ready 后播放启动失败",
        recordEvent: true
      };
}

export function resolvePlaybackStartMediaConnectionState(
  playbackStarted: boolean
): RoomMediaConnectionState {
  return playbackStarted ? "live" : "buffering";
}

export function resolveFullLocalPlaybackSelection(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  forceSourceOwnerLocalPlayback: boolean;
  sourceOwnerHasLocalTrack: boolean;
  hasUploadedTrack: boolean;
}) {
  return (
    input.hasUploadedTrack &&
    (input.activePlaybackSource === "full-local" ||
      input.forceSourceOwnerLocalPlayback ||
      input.sourceOwnerHasLocalTrack)
  );
}

export function resolveFullLocalAudioSourceAction(input: {
  hasSrcObject: boolean;
  currentSrc: string;
  nextSrc: string;
}) {
  const shouldAssignSource = input.currentSrc !== input.nextSrc || input.hasSrcObject;
  return {
    shouldClearSrcObject: input.hasSrcObject,
    shouldAssignSource,
    shouldLoadSource: shouldAssignSource
  };
}

export function resolveFullLocalPlaybackActivationAction(input: {
  shouldPlayPlayback: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
}) {
  if (!input.shouldPlayPlayback) {
    return null;
  }

  const shouldSetSourceToFullLocal = input.activePlaybackSource !== "full-local";
  return {
    shouldSetSourceToFullLocal,
    shouldClearFallbackReason: shouldSetSourceToFullLocal,
    shouldAttemptPlaybackStart: true
  };
}

export function resolveFullLocalPausedPlaybackAction(
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined
) {
  if (playbackStatus !== "paused") {
    return null;
  }

  return {
    shouldPausePlayback: true,
    shouldResetPlaybackRate: true,
    mediaConnectionState: "idle" as const
  };
}

export function resolveMainPlaybackPreflight(input: {
  hasAudio: boolean;
  currentTrackId: string | null | undefined;
}) {
  if (!input.hasAudio) {
    return "skip" as const;
  }

  return input.currentTrackId ? "run" as const : "reset-idle" as const;
}

export function resolveMainPlaybackResetIdleAction(
  preflight: "skip" | "reset-idle" | "run"
) {
  if (preflight !== "reset-idle") {
    return null;
  }

  return {
    shouldDestroyRuntime: true,
    shouldPauseAudio: true,
    shouldClearAudioSource: true,
    shouldClearPlaybackStartIntent: true,
    mediaConnectionState: "idle" as const
  };
}

export function resolveMainPausedPlaybackAction(
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined
) {
  if (playbackStatus !== "paused") {
    return null;
  }

  return {
    shouldPausePlayback: true,
    shouldResetPlaybackRate: true
  };
}

export function resolvePcmSyncPlaybackOutcome(input: {
  shouldPlayPlayback: boolean;
  localReady: boolean;
  shouldLatchFailure: boolean;
}) {
  if (input.shouldLatchFailure) {
    return {
      mediaConnectionState: "buffering" as const,
      playbackStartFailureKind: "init-failed" as const
    };
  }

  if (input.shouldPlayPlayback && !input.localReady) {
    return {
      progressiveFallbackReason: "buffer-underrun" as const,
      mediaConnectionState: "buffering" as const,
      playbackStartFailureKind: "buffer-underrun" as const
    };
  }

  if (input.shouldPlayPlayback && input.localReady) {
    return {
      progressiveFallbackReason: null,
      mediaConnectionState: "live" as const,
      shouldEnsurePlaybackStart: true
    };
  }

  return null;
}

export function resolveSlidingWindowNativeSyncOutcome(input: {
  shouldPlayPlayback: boolean;
  localReady: boolean;
}) {
  if (input.shouldPlayPlayback && !input.localReady) {
    return {
      mediaConnectionState: "buffering" as const,
      playbackStartFailureKind: "buffer-underrun" as const
    };
  }

  if (input.shouldPlayPlayback && input.localReady) {
    return {
      progressiveFallbackReason: null,
      mediaConnectionState: "live" as const,
      shouldEnsurePlaybackStart: true
    };
  }

  return {
    shouldPausePlayback: true
  };
}

export function resolveSlidingWindowFallbackPlaybackAction(input: {
  shouldPlayPlayback: boolean;
  startupReady: boolean;
}) {
  if (!input.shouldPlayPlayback) {
    return {
      shouldClearFallbackReason: false,
      shouldEnsurePlaybackStart: false,
      shouldPausePlayback: true
    };
  }

  return {
    shouldClearFallbackReason: input.startupReady,
    shouldEnsurePlaybackStart: true,
    shouldPausePlayback: false
  };
}

export function resolveSlidingWindowNoEngineHoldAction(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  hasPcmEngine: boolean;
  hasMseEngine: boolean;
  localAudioHasSource: boolean;
}) {
  const shouldHold = shouldHoldSlidingWindowPlaybackForEngine(input);
  return {
    shouldHold,
    shouldPauseAudio: shouldHold,
    shouldClearAudioSource: shouldHold && input.localAudioHasSource,
    mediaConnectionState: shouldHold ? "buffering" as const : null
  };
}

export function resolveProgressiveEngineAttachFailureAction(isPcmEngine: boolean) {
  return isPcmEngine ? "pcm-runtime-failure" as const : "progressive-init-failed" as const;
}

export function resolveProgressiveEngineAttachResultAction(input: {
  isCurrentEngine: boolean;
  attached: boolean;
  isPcmEngine: boolean;
}) {
  if (!input.isCurrentEngine) {
    return null;
  }

  if (!input.attached) {
    return {
      kind: "failure" as const,
      failureAction: resolveProgressiveEngineAttachFailureAction(input.isPcmEngine)
    };
  }

  return {
    kind: "attached" as const,
    shouldSyncEngine: true
  };
}

export function resolveProgressiveEngineAttachErrorAction(input: {
  isCurrentEngine: boolean;
  isPcmEngine: boolean;
}) {
  if (!input.isCurrentEngine) {
    return null;
  }

  return {
    kind: "failure" as const,
    failureAction: resolveProgressiveEngineAttachFailureAction(input.isPcmEngine)
  };
}

export function resolveProgressiveEngineSetupPreflight(input: {
  hasAudio: boolean;
  canPrepareProgressiveLocal: boolean;
  hasManifest: boolean;
}) {
  if (!input.hasAudio) {
    return "skip" as const;
  }

  if (!input.canPrepareProgressiveLocal || !input.hasManifest) {
    return "destroy-existing" as const;
  }

  return "create" as const;
}

export function resolveProgressiveEngineAttachSuccessFallbackReason(
  currentReason: string | null
) {
  return currentReason === "progressive-init-failed" ? null : currentReason;
}

export function resolvePlayingPlaybackEventAction(input: {
  role: ReturnType<typeof resolveMediaElementPlaybackRole>;
  currentMediaConnectionState: RoomMediaConnectionState;
  currentTrackId: string | null | undefined;
  nowIso: string;
}) {
  if (input.role === "inactive") {
    return null;
  }

  return {
    schedulerMode: "normal" as const,
    bufferHealth: "healthy" as const,
    shouldMarkContinuousPlaybackStarted: true,
    nextStablePlaybackAt: input.nowIso,
    mediaConnectionState: resolvePlayingMediaConnectionState({
      currentState: input.currentMediaConnectionState,
      currentTrackId: input.currentTrackId
    })
  };
}

export function resolveWaitingFallbackReason(input: {
  role: ReturnType<typeof resolveMediaElementPlaybackRole>;
  activePlaybackSource: ProgressivePlaybackSource;
  aheadBufferedMs: number;
  criticalBufferThresholdMs: number;
}) {
  if (
    input.role !== "audible-local" ||
    (!isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
      input.activePlaybackSource !== "full-local")
  ) {
    return null;
  }

  return input.aheadBufferedMs < input.criticalBufferThresholdMs / 2
    ? "buffer-underrun"
    : null;
}

export function resolveWaitingPlaybackEventAction(input: {
  role: ReturnType<typeof resolveMediaElementPlaybackRole>;
  activePlaybackSource: ProgressivePlaybackSource;
  aheadBufferedMs: number;
  criticalBufferThresholdMs: number;
  currentMediaConnectionState?: RoomMediaConnectionState;
}) {
  if (input.role === "inactive") {
    return null;
  }

  return {
    shouldMarkContinuousPlaybackInterrupted: true,
    qualityEvent: "waiting" as const,
    schedulerMode: "conservative" as const,
    bufferHealth: "low" as const,
    fallbackReason: resolveWaitingFallbackReason(input),
    mediaConnectionState: resolveBufferingMediaConnectionState(
      input.currentMediaConnectionState ?? "live"
    )
  };
}

export function resolveStalledFallbackReason(
  role: ReturnType<typeof resolveMediaElementPlaybackRole>
) {
  return role === "audible-local" ? "stalled" : null;
}

export function resolveStalledPlaybackEventAction(
  role: ReturnType<typeof resolveMediaElementPlaybackRole>,
  currentMediaConnectionState: RoomMediaConnectionState = "live"
) {
  if (role === "inactive") {
    return null;
  }

  return {
    shouldMarkContinuousPlaybackInterrupted: true,
    qualityEvent: "stalled" as const,
    schedulerMode: "conservative" as const,
    bufferHealth: "critical" as const,
    fallbackReason: resolveStalledFallbackReason(role),
    mediaConnectionState: resolveBufferingMediaConnectionState(currentMediaConnectionState)
  };
}

export function resolvePausedPlaybackRecoveryState(input: {
  playbackHasActiveIntent: boolean;
  isPageVisible: boolean;
}) {
  if (input.playbackHasActiveIntent) {
    return null;
  }

  return {
    schedulerMode: resolveInactivePlaybackSchedulerMode(input.isPageVisible),
    bufferHealth: "healthy" as const
  };
}

export function resolvePausedPlaybackEventAction(input: {
  role: ReturnType<typeof resolveMediaElementPlaybackRole>;
  playbackHasActiveIntent: boolean;
  isPageVisible: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
}) {
  if (input.role === "inactive") {
    return null;
  }

  return {
    shouldMarkContinuousPlaybackInterrupted: true,
    diagnosticEvent: "local-audio-pause" as const,
    diagnosticSummary: `本地音频暂停 role=${input.role} source=${input.activePlaybackSource} status=${input.playbackStatus ?? "unknown"}`,
    recordEvent: false,
    ...(
      resolvePausedPlaybackRecoveryState({
        playbackHasActiveIntent: input.playbackHasActiveIntent,
        isPageVisible: input.isPageVisible
      }) ?? {}
    )
  };
}

export function resolveSeekedPlaybackPolicy(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  hasProgressiveManifest: boolean;
  soughtPositionMs: number;
  contiguousBufferedMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !input.hasProgressiveManifest ||
    input.soughtPositionMs <= input.contiguousBufferedMs
  ) {
    return null;
  }

  return {
    schedulerMode: "conservative" as const,
    bufferHealth: "critical" as const,
    fallbackReason: "seek-outside-buffer" as const
  };
}

export function resolveSeekedPlaybackEventAction(input: {
  hasAudio: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  hasProgressiveManifest: boolean;
  soughtPositionMs: number;
  contiguousBufferedMs: number;
}) {
  if (!input.hasAudio) {
    return null;
  }

  return resolveSeekedPlaybackPolicy(input);
}

export function resolveSlidingWindowLowBufferFallbackReason(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackHasActiveIntent: boolean;
  startupReady: boolean;
  aheadBufferedMs: number;
  criticalBufferThresholdMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !input.playbackHasActiveIntent ||
    !input.startupReady ||
    input.aheadBufferedMs >= input.criticalBufferThresholdMs
  ) {
    return null;
  }

  return "seek-outside-buffer" as const;
}

export function resolveObservedPlaybackSeconds(input: {
  activePlaybackSource: ProgressivePlaybackSource | "remote";
  localPlaybackPositionMs: number | null | undefined;
  audioCurrentTimeSeconds: number | null | undefined;
  audioPaused: boolean;
}) {
  if (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    Number.isFinite(input.localPlaybackPositionMs)
  ) {
    return (input.localPlaybackPositionMs ?? 0) / 1000;
  }

  if (!input.audioPaused && Number.isFinite(input.audioCurrentTimeSeconds)) {
    return input.audioCurrentTimeSeconds ?? null;
  }

  return null;
}

export function resolveDriftSamplingPreflight(input: {
  currentTrackId: string | null | undefined;
  hasPlaybackState: boolean;
  playbackHasActiveIntent: boolean;
}) {
  return !!input.currentTrackId && input.hasPlaybackState && input.playbackHasActiveIntent;
}

export function resolveDriftSampleAction(input: {
  expectedSeconds: number;
  observedSeconds: number | null;
}) {
  if (input.observedSeconds === null) {
    return null;
  }

  return {
    driftMs: (input.expectedSeconds - input.observedSeconds) * 1000
  };
}

export function isRecoverableProgressiveFallbackReason(reason: string | null | undefined) {
  return reason === "buffer-underrun" || reason === "stalled" || reason === "seek-outside-buffer";
}

export function shouldPublishProgressiveDiagnostic(input: {
  previousSignature: string | null;
  nextSignature: string;
}) {
  return input.previousSignature !== input.nextSignature;
}

export function shouldHoldSlidingWindowPlaybackForEngine(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  hasPcmEngine: boolean;
  hasMseEngine: boolean;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  return (
    isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    hasActiveIntent &&
    !input.hasPcmEngine &&
    !input.hasMseEngine
  );
}

export function shouldResetAudioForPlaybackSurfaceChange(input: {
  previousPlaybackSurfaceKey: string | null | undefined;
  nextPlaybackSurfaceKey: string | null | undefined;
}) {
  return (
    !!input.previousPlaybackSurfaceKey &&
    input.previousPlaybackSurfaceKey !== input.nextPlaybackSurfaceKey
  );
}

export function resolvePlaybackSurfaceResetAction(input: {
  previousPlaybackSurfaceKey: string | null | undefined;
  nextPlaybackSurfaceKey: string | null | undefined;
  hasAudio: boolean;
  playbackHasActiveIntent: boolean;
}) {
  if (!shouldResetAudioForPlaybackSurfaceChange(input)) {
    return null;
  }

  return {
    shouldDestroyRuntime: true,
    shouldClearPcmLastBlockedReason: true,
    shouldResetAudioElement: input.hasAudio,
    mediaConnectionState: input.hasAudio
      ? resolvePlaybackSurfaceResetMediaConnectionState(input.playbackHasActiveIntent)
      : null
  };
}

export function resolvePlaybackSourceAfterProgressiveRuntimeFailure(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  hasProgressiveRuntimeFailure: boolean;
}) {
  if (
    input.hasProgressiveRuntimeFailure &&
    input.activePlaybackSource === "lossless-local"
  ) {
    return "progressive-local" satisfies ProgressivePlaybackSource;
  }

  return input.activePlaybackSource;
}

export function resolvePlaybackSourceAfterLatchedPcmRuntimeFailure(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  canUseFullLocalForPlaybackSession: boolean;
}) {
  return input.canUseFullLocalForPlaybackSession
    ? "full-local"
    : resolvePlaybackSourceAfterProgressiveRuntimeFailure({
        activePlaybackSource: input.activePlaybackSource,
        hasProgressiveRuntimeFailure: true
      });
}

export function resolveFullLocalPlaybackSessionState(input: {
  currentSession: FullLocalPlaybackSessionState;
  playbackSurfaceKey: string | null;
  hasBufferedFullLocalTrack: boolean;
}): FullLocalPlaybackSessionState {
  if (input.currentSession.key !== input.playbackSurfaceKey) {
    return {
      key: input.playbackSurfaceKey,
      availableInSession: input.hasBufferedFullLocalTrack
    };
  }

  return {
    key: input.playbackSurfaceKey,
    availableInSession:
      input.currentSession.availableInSession || input.hasBufferedFullLocalTrack
  };
}

export function shouldPreferImmediateFullLocalRecovery(input: {
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  hasBufferedFullLocalTrack: boolean;
  fullLocalRecoveryActive: boolean;
  recoveryPhase:
    | "joining"
    | "resyncing"
    | "bootstrapping-data"
    | "playing-local-fallback"
    | "steady";
  recoveryMode: "late-join" | "rejoin" | "steady";
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
}) {
  return (
    !input.isCurrentSourceOwner &&
    input.audioUnlocked &&
    input.hasBufferedFullLocalTrack &&
    input.fullLocalRecoveryActive &&
    input.recoveryPhase !== "steady" &&
    input.playbackStatus === "playing"
  );
}

export function shouldEnableFullLocalHandoff(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackRecoveryStage: PlaybackRecoveryStage;
  startupGatePending: boolean;
  localReady: boolean;
  driftMs: number;
  cooldownMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    input.activePlaybackSource !== "full-local"
  ) {
    return false;
  }

  if (!input.localReady || input.cooldownMs > 0 || !Number.isFinite(input.driftMs)) {
    return false;
  }

  if (Math.abs(input.driftMs) > fullLocalMaxDriftMs) {
    return false;
  }

  if (input.activePlaybackSource === "full-local") {
    return true;
  }

  if (input.startupGatePending) {
    return false;
  }

  return input.playbackRecoveryStage !== "startup-buffering";
}

export function resolveFullLocalBlockedReason(input: {
  hasBufferedFullLocalTrack: boolean;
  canUseFullLocalForPlaybackSession: boolean;
  isCurrentSourceOwner: boolean;
  listenerLocalTakeoverEnabled: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  startupGatePending: boolean;
  fullLocalRecoveryActive: boolean;
}) {
  if (!input.hasBufferedFullLocalTrack) {
    return "track-not-fully-cached";
  }

  if (!input.canUseFullLocalForPlaybackSession) {
    return "full-local-not-available-at-playback-start";
  }

  if (
    !input.isCurrentSourceOwner &&
    !input.listenerLocalTakeoverEnabled &&
    input.activePlaybackSource !== "full-local"
  ) {
    return "listener-handoff-disabled";
  }

  if (input.startupGatePending && !input.fullLocalRecoveryActive) {
    return "cache-recovery-window";
  }

  return null;
}

export function resolveFullLocalEligibility(input: {
  fullLocalReady: boolean;
  fullLocalBlockedReason: string | null;
}) {
  return input.fullLocalReady && input.fullLocalBlockedReason === null;
}

export function resolveImmediateFullLocalRecoveryAction(input: {
  immediateFullLocalRecoveryEligible: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  hasBufferedFullLocalTrack: boolean;
}) {
  if (
    !input.immediateFullLocalRecoveryEligible ||
    input.activePlaybackSource === "full-local" ||
    !input.hasBufferedFullLocalTrack
  ) {
    return null;
  }

  return {
    nextSource: "full-local" as const,
    clearFallbackReason: true
  };
}

export function resolveForceSourceOwnerLocalPlaybackAction(
  forceSourceOwnerLocalPlayback: boolean
) {
  return forceSourceOwnerLocalPlayback
    ? {
        nextSource: "full-local" as const
      }
    : null;
}

export function resolveLocalTakeoverCooldownResetAction() {
  return {
    nextCooldownUntilMs: 0
  };
}

export function resolveLocalTakeoverCooldownArmAction(input: {
  nowMs: number;
  cooldownMs: number;
}) {
  return {
    nextCooldownUntilMs: input.nowMs + input.cooldownMs
  };
}

export function resolvePlaybackTimelineResetAction() {
  return {
    nextProgressiveWarmupReadyAt: null,
    nextFullLocalWarmupReadyAt: null,
    nextWaitingEventTimestamps: [] as number[],
    nextStalledEventTimestamps: [] as number[],
    nextDriftSamples: [] as PlaybackDriftSample[],
    nextContinuousPlaybackStartedAt: null,
    nextContinuousPlaybackSegments: [] as ContinuousPlaybackSegment[],
    nextPcmSlidingWindowPlayAttemptAt: null,
    shouldClearFallbackReason: true
  };
}

export function resolvePlaybackSourceTransitionAction(input: {
  currentSource: ProgressivePlaybackSource;
  nextSource: ProgressivePlaybackSource;
  fallbackReason?: string | null;
  clearFallbackReason?: boolean;
  armCooldown?: boolean;
}) {
  return {
    shouldArmCooldown: input.armCooldown === true,
    fallbackReason: input.fallbackReason,
    shouldClearFallbackReason: input.clearFallbackReason === true,
    shouldSetSource: input.nextSource !== input.currentSource
  };
}

export function shouldRecoverPausedFullLocalPlayback(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  audioUnlocked: boolean;
  localAudioPaused: boolean | null | undefined;
  localAudioReadyState: number | null | undefined;
  localAudioHasSrc: boolean;
  localAudioHasSrcObject: boolean;
}) {
  if (
    input.activePlaybackSource !== "full-local" ||
    input.playbackStatus !== "playing" ||
    !input.currentTrackId ||
    input.localAudioPaused !== true
  ) {
    return false;
  }

  return (
    input.localAudioHasSrcObject ||
    input.localAudioHasSrc ||
    (typeof input.localAudioReadyState === "number" &&
      input.localAudioReadyState >= haveCurrentDataReadyState) ||
    input.audioUnlocked
  );
}

export function resolveFullLocalPausedRecoveryPreflight(input: {
  currentTrackId: string | null | undefined;
  hasPlaybackState: boolean;
  hasAudio: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
}) {
  return (
    !!input.currentTrackId &&
    input.hasPlaybackState &&
    input.hasAudio &&
    input.activePlaybackSource === "full-local"
  );
}

export function resolveFullLocalPausedRecoveryAttemptAction(input: {
  cancelled: boolean;
  recoveryInFlight: boolean;
  shouldRecover: boolean;
}) {
  return !input.cancelled && !input.recoveryInFlight && input.shouldRecover;
}

export function resolveFullLocalPausedRecoveryResult(playbackStarted: boolean) {
  return playbackStarted
    ? {
        mediaConnectionState: "live" as const,
        diagnosticEvent: "full-local-paused-recovered" as const,
        diagnosticSummary: "已自动恢复本地完整缓存播放",
        recordEvent: false
      }
    : {
        mediaConnectionState: "buffering" as const,
        diagnosticEvent: "full-local-paused-recovery-failed" as const,
        diagnosticSummary: "本地完整缓存自动恢复播放失败",
        recordEvent: true
      };
}

export function shouldRecoverSilentSlidingWindowWithFullLocal(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  canUseFullLocalForPlaybackSession: boolean;
  fullLocalBlockedReason: string | null | undefined;
  slidingWindowStartupReady: boolean;
  localAudioPaused: boolean | null | undefined;
  localAudioMuted: boolean | null | undefined;
  localAudioVolume: number | null | undefined;
  localAudioReadyState: number | null | undefined;
  localAudioHasSrc: boolean;
  localAudioHasSrcObject: boolean;
  pcmAudioContextState: string | null | undefined;
  pcmDirectOutputConnected: boolean | null | undefined;
  pcmDecodedSegmentCount: number | null | undefined;
  pcmScheduledSegmentCount: number | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    !hasActiveIntent ||
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !input.canUseFullLocalForPlaybackSession ||
    input.fullLocalBlockedReason !== null ||
    !input.slidingWindowStartupReady
  ) {
    return false;
  }

  const pcmElementOutputAudible =
    input.localAudioHasSrcObject &&
    input.localAudioPaused === false &&
    input.localAudioMuted !== true &&
    input.localAudioVolume !== 0;
  const pcmOutputAudible =
    input.pcmAudioContextState === "running" &&
    (input.pcmDecodedSegmentCount ?? 0) > 0 &&
    (input.pcmScheduledSegmentCount ?? 0) > 0 &&
    (input.pcmDirectOutputConnected !== false || pcmElementOutputAudible);
  if (pcmOutputAudible) {
    return false;
  }

  const hasPlayableElementOutput =
    (input.localAudioReadyState ?? 0) >= haveCurrentDataReadyState ||
    input.localAudioHasSrcObject ||
    input.localAudioHasSrc;

  return (
    input.localAudioPaused !== false ||
    input.localAudioMuted === true ||
    input.localAudioVolume === 0 ||
    !hasPlayableElementOutput
  );
}

export function resolveSilentSlidingWindowFullLocalRecoveryAction(shouldRecover: boolean) {
  if (!shouldRecover) {
    return null;
  }

  return {
    nextSource: "full-local" as const,
    clearFallbackReason: true,
    mediaConnectionState: "buffering" as const
  };
}

export function resolveAudibleLocalFallbackActive(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource | "remote";
  progressiveFallbackReason: string | null | undefined;
}) {
  return (
    !input.isCurrentSourceOwner &&
    (isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
      input.activePlaybackSource === "full-local") &&
    shouldPreferLocalTakeover({
      progressiveFallbackReason: input.progressiveFallbackReason
    })
  );
}

export function shouldAllowLocalTakeover(input: {
  listenerLocalTakeoverEnabled: boolean;
  nowMs: number;
  cooldownUntilMs: number;
  immediateFullLocalRecoveryEligible: boolean;
  canUseFullLocalForPlaybackSession: boolean;
  connectedPeersCount: number;
}) {
  return (
    input.listenerLocalTakeoverEnabled &&
    input.nowMs >= input.cooldownUntilMs &&
    (input.immediateFullLocalRecoveryEligible ||
      input.canUseFullLocalForPlaybackSession ||
      input.connectedPeersCount > 0)
  );
}

export function shouldSkipSecondaryPcmWarmupSync(input: {
  engineType: ProgressiveEngineType;
  engineReady: boolean;
  localReady: boolean;
}) {
  return input.engineType === "pcm" && (!input.engineReady || !input.localReady);
}

export function resolveWarmupPcmSyncMode(source: ProgressivePlaybackSource) {
  return isSlidingWindowPlaybackSource(source) ? "snapshot-only" as const : "sync-playback" as const;
}

export function resolveWarmupPcmAudioStartAction(input: {
  hasSyncResult: boolean;
  shouldStartAudioElement: boolean;
  nowMs: number;
}) {
  if (!input.hasSyncResult || !input.shouldStartAudioElement) {
    return null;
  }

  return {
    lastAttemptAtMs: input.nowMs,
    shouldAttemptPlaybackStart: true
  };
}

export function resolveWarmupPcmAudioStartResultAction(input: {
  cancelled: boolean;
  playbackStarted: boolean;
}) {
  if (input.cancelled || !input.playbackStarted) {
    return null;
  }

  return {
    shouldClearFallbackReason: true,
    mediaConnectionState: "live" as const
  };
}

export function resolveWarmupMseCatchupAction(input: {
  localReady: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  shadowWarmupReady: boolean;
}) {
  const shouldCatchup =
    input.localReady &&
    (isSlidingWindowPlaybackSource(input.activePlaybackSource) || input.shadowWarmupReady);

  return {
    shouldCatchup,
    shouldMuteAudio: shouldCatchup
      ? !isSlidingWindowPlaybackSource(input.activePlaybackSource)
      : null,
    shouldPlayElement: shouldCatchup
  };
}

export function resolveWarmupPreflight(input: {
  currentTrackId: string | null | undefined;
  hasAudio: boolean;
  hasProgressiveEngine: boolean;
  hasManifest: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
}) {
  const shouldRun =
    !!input.currentTrackId &&
    input.hasAudio &&
    input.hasProgressiveEngine &&
    input.hasManifest &&
    input.activePlaybackSource !== "full-local";

  return {
    shouldRun,
    shouldResetWarmupReadyAt: !shouldRun
  };
}

export function resolveWarmupUnavailableAction(input: {
  engineType: ProgressiveEngineType;
  engineReady: boolean;
  localReady: boolean;
  hasPcmEngine: boolean;
}) {
  if (input.engineReady && input.localReady) {
    return null;
  }

  if (
    input.hasPcmEngine &&
    !shouldSkipSecondaryPcmWarmupSync({
      engineType: input.engineType,
      engineReady: input.engineReady,
      localReady: input.localReady
    })
  ) {
    return {
      shouldRunSecondaryPcmSync: true,
      shouldPauseAudio: false
    };
  }

  return {
    shouldRunSecondaryPcmSync: false,
    shouldPauseAudio: !input.hasPcmEngine
  };
}

export function resolveWarmupInactivePlaybackAction(input: {
  playbackHasActiveIntent: boolean;
  hasPcmEngine: boolean;
}) {
  if (input.playbackHasActiveIntent) {
    return null;
  }

  return {
    shouldSyncPcmPlayback: input.hasPcmEngine,
    shouldPauseAudio: true,
    shouldResetWarmupReadyAt: true
  };
}

export function resolveWarmupTakeoverBlockedReason(input: {
  shouldAttemptTakeover: boolean;
  progressiveLocalBlockedReason: string | null | undefined;
}) {
  return input.shouldAttemptTakeover ? null : input.progressiveLocalBlockedReason ?? null;
}

export function resolveWarmupHoldState(input: {
  directProgressiveTakeoverEnabled: boolean;
  localTakeoverAllowed: boolean;
  shouldAttemptTakeover: boolean;
  shadowWarmupReady: boolean;
  localReady: boolean;
  progressiveFallbackReason: string | null | undefined;
  playbackRecoveryStage: PlaybackRecoveryStage;
  nowMs: number;
}) {
  const shouldHold =
    !input.directProgressiveTakeoverEnabled ||
    !input.localTakeoverAllowed ||
    !input.shouldAttemptTakeover;

  if (!shouldHold) {
    return {
      shouldHold: false,
      nextWarmupReadyAt: null,
      shouldClearFallbackReason: false
    };
  }

  return {
    shouldHold: true,
    nextWarmupReadyAt: input.shadowWarmupReady && input.localReady ? input.nowMs : null,
    shouldClearFallbackReason:
      !!input.progressiveFallbackReason &&
      input.localTakeoverAllowed &&
      (input.playbackRecoveryStage === "steady" || input.shouldAttemptTakeover)
  };
}

export function resolveFullLocalUpgradePreflight(input: {
  currentTrackId: string | null | undefined;
  hasPlaybackState: boolean;
  hasBufferedFullLocalObjectUrl: boolean;
  canWarmBufferedFullLocal: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackHasActiveIntent: boolean;
}) {
  const shouldRun =
    !!input.currentTrackId &&
    input.hasPlaybackState &&
    input.hasBufferedFullLocalObjectUrl &&
    input.canWarmBufferedFullLocal &&
    isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    input.playbackHasActiveIntent;

  return {
    shouldRun,
    shouldResetWarmupReadyAt: !shouldRun
  };
}

export function getAudibleElementVolume(userVolume: number) {
  if (!Number.isFinite(userVolume) || userVolume <= 0) {
    return 0.72;
  }

  return Math.min(1, userVolume);
}

export function resolveLocalAudioDiagnostics(
  localAudio:
    | Pick<
        HTMLAudioElement,
        "paused" | "muted" | "volume" | "readyState" | "currentSrc" | "srcObject"
      >
    | null
    | undefined
) {
  if (!localAudio) {
    return {
      localAudioPaused: null,
      localAudioMuted: null,
      localAudioVolume: null,
      localAudioReadyState: null,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: null
    };
  }

  return {
    localAudioPaused: localAudio.paused,
    localAudioMuted: localAudio.muted,
    localAudioVolume: localAudio.volume,
    localAudioReadyState: localAudio.readyState,
    localAudioCurrentSrc: localAudio.currentSrc || null,
    localAudioHasSrcObject: !!localAudio.srcObject
  };
}

export type ProgressiveDiagnosticSignatureInput = {
  activeSource: ProgressivePlaybackSource;
  playbackSurfaceKey: string | null;
  playbackTimelineKey: string | null;
  recoveryPhase: string;
  recoveryMode: string;
  recoveryGeneration: number | null;
  fullLocalRecoveryActive: boolean;
  transportGovernorMode: TransportGovernorMode;
  engineType: ProgressiveEngineType;
  contiguousBufferedMs: string | number;
  aheadBufferedMs: string | number;
  schedulerPolicy: string | null;
  startupReady: boolean;
  fallbackReason: string | null | undefined;
  estimatedFillTimeMs: string | number;
  remainingPlaybackMs: string | number;
  bufferSafetyMarginMs: string | number;
  playbackStartIntentLabel: string | null | undefined;
  intentMatchedSource: ProgressivePlaybackSource | null | undefined;
  lastPlayStartFailure: string | null | undefined;
  nextQueueTrackPrefetch: string | null | undefined;
  localTakeoverCooldownActive: boolean;
  progressiveLocalEligible: boolean;
  progressiveLocalBlockedReason: string | null | undefined;
  fullLocalReady: boolean;
  fullLocalEligible: boolean;
  fullLocalBlockedReason: string | null | undefined;
  currentSessionUserId: string | null | undefined;
  playbackSourceSessionId: string | null | undefined;
  currentPeerId: string | null | undefined;
  playbackSourcePeerId: string | null | undefined;
  isSourceOwner: boolean;
  localAudioPaused: boolean | null;
  localAudioMuted: boolean | null;
  localAudioVolume: number | null;
  localAudioReadyState: number | null;
  localAudioCurrentSrc: string | null;
  localAudioHasSrcObject: boolean | null;
  pcmEngineStatus: string | null | undefined;
  pcmAudioContextState: string | null | undefined;
  pcmDirectOutputConnected: boolean | null | undefined;
  pcmLastDecodeError: string | null | undefined;
  pcmDecodedSegmentCount: number | null | undefined;
  pcmScheduledSegmentCount: number | null | undefined;
  pcmLastBlockedReason: string | null | undefined;
  startupBufferMs: number;
  comfortBufferedMs: number;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
  shadowWarmupActive: boolean;
  playbackRecoveryStage: PlaybackRecoveryStage;
  audibleLocalFallbackActive: boolean;
  schedulerBudgetTier: SchedulerBudgetTier;
  lastStablePlaybackAt: string | null | undefined;
};

export function resolveProgressiveDiagnosticSignature(
  input: ProgressiveDiagnosticSignatureInput
) {
  return [
    input.activeSource,
    input.playbackSurfaceKey,
    input.playbackTimelineKey,
    input.recoveryPhase,
    input.recoveryMode,
    input.recoveryGeneration,
    input.fullLocalRecoveryActive,
    input.transportGovernorMode,
    input.engineType,
    input.contiguousBufferedMs,
    input.aheadBufferedMs,
    input.schedulerPolicy,
    input.startupReady,
    input.fallbackReason ?? "",
    input.estimatedFillTimeMs,
    input.remainingPlaybackMs,
    input.bufferSafetyMarginMs,
    input.playbackStartIntentLabel ?? "",
    input.intentMatchedSource ?? "",
    input.lastPlayStartFailure ?? "",
    input.nextQueueTrackPrefetch ?? "",
    input.localTakeoverCooldownActive ? "cooldown" : "no-cooldown",
    input.progressiveLocalEligible,
    input.progressiveLocalBlockedReason ?? "",
    input.fullLocalReady,
    input.fullLocalEligible,
    input.fullLocalBlockedReason ?? "",
    input.currentSessionUserId ?? "",
    input.playbackSourceSessionId ?? "",
    input.currentPeerId ?? "",
    input.playbackSourcePeerId ?? "",
    input.isSourceOwner,
    input.localAudioPaused ?? "",
    input.localAudioMuted ?? "",
    input.localAudioVolume ?? "",
    input.localAudioReadyState ?? "",
    input.localAudioCurrentSrc ? "src" : "no-src",
    input.localAudioHasSrcObject ?? "",
    input.pcmEngineStatus ?? "",
    input.pcmAudioContextState ?? "",
    input.pcmDirectOutputConnected ?? "",
    input.pcmLastDecodeError ?? "",
    (input.pcmDecodedSegmentCount ?? 0) > 0 ? "decoded" : "no-decoded",
    (input.pcmScheduledSegmentCount ?? 0) > 0 ? "scheduled" : "no-scheduled",
    input.pcmLastBlockedReason ?? "",
    input.startupBufferMs,
    input.comfortBufferedMs,
    input.waitingEventsLast30s,
    input.stalledEventsLast30s,
    input.shadowWarmupActive,
    input.playbackRecoveryStage,
    input.audibleLocalFallbackActive,
    input.schedulerBudgetTier,
    input.lastStablePlaybackAt ?? ""
  ].join("|");
}

export function bucketDiagnosticDurationMs(
  value: number | null | undefined,
  bucketMs: number
) {
  if (value === null || typeof value === "undefined" || !Number.isFinite(value)) {
    return "";
  }

  return Math.round(value / bucketMs) * bucketMs;
}

export function resolveProgressiveDiagnosticBuckets(input: {
  contiguousBufferedMs: number | null | undefined;
  aheadBufferedMs: number | null | undefined;
  estimatedFillTimeMs: number | null | undefined;
  remainingPlaybackMs: number | null | undefined;
  bufferSafetyMarginMs: number | null | undefined;
}) {
  return {
    contiguousBufferedMs: bucketDiagnosticDurationMs(input.contiguousBufferedMs, 1_000),
    aheadBufferedMs: bucketDiagnosticDurationMs(input.aheadBufferedMs, 1_000),
    estimatedFillTimeMs: bucketDiagnosticDurationMs(input.estimatedFillTimeMs, 2_000),
    remainingPlaybackMs: bucketDiagnosticDurationMs(input.remainingPlaybackMs, 5_000),
    bufferSafetyMarginMs: bucketDiagnosticDurationMs(input.bufferSafetyMarginMs, 1_000)
  };
}

export function resolveFullLocalPlaybackMode(input: {
  activeSource: ProgressivePlaybackSource;
  localAudioHasSrcObject: boolean | null | undefined;
  localAudioCurrentSrc: string | null | undefined;
}) {
  if (input.activeSource !== "full-local") {
    return null;
  }

  if (input.localAudioHasSrcObject) {
    return "pcm-engine" as const;
  }

  return input.localAudioCurrentSrc ? "native-blob" as const : "none" as const;
}

export function getPcmEngineDiagnosticsKey(
  snapshot: ProgressivePcmEngineSnapshot | null | undefined
) {
  if (!snapshot) {
    return "none";
  }

  return [
    snapshot.status,
    snapshot.audioContextState ?? "none",
    snapshot.directOutputConnected ? "direct" : "no-direct",
    snapshot.decodedSegmentCount > 0 ? "decoded" : "no-decoded",
    snapshot.scheduledSegmentCount > 0 ? "scheduled" : "no-scheduled",
    snapshot.lastDecodeError ?? "none"
  ].join("|");
}

export function resolveMediaElementPlaybackRole(input: {
  target: "local" | "remote";
  activePlaybackSource: ProgressivePlaybackSource;
  shadowWarmupActive: boolean;
}) {
  if (input.target === "local") {
    return "audible-local" as const;
  }

  return "inactive" as const;
}

export function shouldWarmFullLocalWithSharedAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  isCurrentSourceOwner: boolean;
}) {
  return (
    input.canUseFullLocalForPlaybackSession &&
    !input.isCurrentSourceOwner &&
    input.activePlaybackSource !== "full-local" &&
    input.progressiveEngineType === "none"
  );
}

export function hasSufficientBackingForFullLocalWarmup(input: {
  progressiveEngineType: ProgressiveEngineType;
  aheadBufferedMs: number;
  requiredAheadMs: number;
}) {
  if (input.progressiveEngineType === "none") {
    return true;
  }

  return input.aheadBufferedMs >= input.requiredAheadMs;
}

export function resolveFullLocalWarmupReadiness(input: {
  localReady: boolean;
  driftMs: number;
  maxDriftMs: number;
  fullLocalBlockedReason: string | null | undefined;
  progressiveEngineType: ProgressiveEngineType;
  aheadBufferedMs: number;
  requiredAheadMs: number;
}) {
  return (
    input.localReady &&
    input.driftMs <= input.maxDriftMs &&
    input.fullLocalBlockedReason === null &&
    hasSufficientBackingForFullLocalWarmup({
      progressiveEngineType: input.progressiveEngineType,
      aheadBufferedMs: input.aheadBufferedMs,
      requiredAheadMs: input.requiredAheadMs
    })
  );
}

export function resolveFullLocalBufferedWarmupPreflight(input: {
  currentTrackId: string | null | undefined;
  hasPlaybackState: boolean;
  hasAudio: boolean;
  hasBufferedFullLocalObjectUrl: boolean;
  canWarmBufferedFullLocal: boolean;
}) {
  const shouldRun = Boolean(
    input.currentTrackId &&
      input.hasPlaybackState &&
      input.hasAudio &&
      input.hasBufferedFullLocalObjectUrl &&
      input.canWarmBufferedFullLocal
  );
  return {
    shouldRun,
    shouldResetWarmupReadyAt: !shouldRun
  };
}

export function resolveFullLocalWarmupMissingTrackAction(input: {
  hasBufferedFullLocalTrack: boolean;
  playbackHasActiveIntent: boolean;
}) {
  if (input.hasBufferedFullLocalTrack && input.playbackHasActiveIntent) {
    return null;
  }

  return {
    shouldPauseAudio: true,
    shouldResetWarmupReadyAt: true
  };
}

export function resolveFullLocalWarmupHoldState(input: {
  localTakeoverAllowed: boolean;
  shouldAttemptFullLocalHandoff: boolean;
  readyForFullLocal: boolean;
  nowMs: number;
}) {
  const shouldHold = !input.localTakeoverAllowed || !input.shouldAttemptFullLocalHandoff;
  return {
    shouldHold,
    nextWarmupReadyAt: shouldHold && input.readyForFullLocal ? input.nowMs : null
  };
}

export function resolveFullLocalWarmupTransitionAction(input: {
  currentSource: ProgressivePlaybackSource;
  nextSource: ProgressivePlaybackSource;
  nextWarmupReadyAt: number | null;
  clearFallbackReason: boolean;
}) {
  return {
    nextWarmupReadyAt: input.nextWarmupReadyAt,
    transition:
      input.nextSource === input.currentSource
        ? null
        : {
            nextSource: input.nextSource,
            clearFallbackReason: input.clearFallbackReason
          }
  };
}

export function resolveIdleFullLocalUpgradeArmState(input: {
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  fullLocalBlockedReason: string | null | undefined;
  localTakeoverAllowed: boolean;
  aheadBufferedMs: number;
  comfortBufferMs: number;
}) {
  return (
    input.progressiveEngineType === "none" &&
    input.canUseFullLocalForPlaybackSession &&
    input.fullLocalBlockedReason === null &&
    input.localTakeoverAllowed &&
    hasSufficientBackingForFullLocalWarmup({
      progressiveEngineType: input.progressiveEngineType,
      aheadBufferedMs: input.aheadBufferedMs,
      requiredAheadMs: input.comfortBufferMs
    })
  );
}

export function shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  canUseFullLocalForPlaybackSession: boolean;
  fullLocalBlockedReason: string | null | undefined;
  localTakeoverAllowed: boolean;
  aheadBufferedMs: number;
  comfortBufferMs: number;
  warmupReadyAt: number | null;
  now: number;
  switchDelayMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    input.progressiveEngineType !== "none"
  ) {
    return false;
  }

  if (
    !input.canUseFullLocalForPlaybackSession ||
    input.fullLocalBlockedReason !== null ||
    !input.localTakeoverAllowed ||
    !hasSufficientBackingForFullLocalWarmup({
      progressiveEngineType: input.progressiveEngineType,
      aheadBufferedMs: input.aheadBufferedMs,
      requiredAheadMs: input.comfortBufferMs
    }) ||
    input.warmupReadyAt === null
  ) {
    return false;
  }

  return input.now - input.warmupReadyAt >= input.switchDelayMs;
}

export function resolveFullLocalUpgradeAction(input: {
  shouldUpgrade: boolean;
  canArmIdleFullLocalUpgrade: boolean;
  currentWarmupReadyAt: number | null;
  now: number;
}) {
  if (input.shouldUpgrade) {
    return {
      kind: "transition" as const,
      nextSource: "full-local" as const
    };
  }

  if (!input.canArmIdleFullLocalUpgrade) {
    return {
      kind: "set-warmup-ready-at" as const,
      nextWarmupReadyAt: null
    };
  }

  if (input.currentWarmupReadyAt === null) {
    return {
      kind: "set-warmup-ready-at" as const,
      nextWarmupReadyAt: input.now
    };
  }

  return {
    kind: "none" as const
  };
}

export function shouldPrepareProgressiveRuntimeForSource(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
}) {
  return (
    input.progressiveEngineType !== "none" &&
    input.activePlaybackSource !== "full-local"
  );
}

export function shouldPrepareProgressiveRuntime(input: {
  trackCachingEnabled: boolean;
  hasProgressiveManifest: boolean;
  progressivePlaybackSupported: boolean;
  shouldRetryAfterRuntimeFailure: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
}) {
  return (
    input.trackCachingEnabled &&
    input.hasProgressiveManifest &&
    input.progressivePlaybackSupported &&
    input.shouldRetryAfterRuntimeFailure &&
    shouldPrepareProgressiveRuntimeForSource({
      activePlaybackSource: input.activePlaybackSource,
      progressiveEngineType: input.progressiveEngineType
    })
  );
}

export function shouldStartListenerProgressivePlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    input.isCurrentSourceOwner ||
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !hasActiveIntent ||
    input.engineType === "none" ||
    input.progressiveFallbackReason === "progressive-init-failed"
  ) {
    return false;
  }

  return input.startupReady;
}

export function shouldAttemptProgressiveLocalPlayback(input: {
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
}) {
  const hasActiveIntent =
    input.playbackStatus === "playing" || input.playbackStatus === "buffering";
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    !hasActiveIntent ||
    input.engineType === "none" ||
    input.progressiveFallbackReason === "progressive-init-failed"
  ) {
    return false;
  }

  if (input.isCurrentSourceOwner) {
    return true;
  }

  return shouldStartListenerProgressivePlayback(input);
}

export function resolveProgressiveLocalBlockedReason(input: {
  hasManifest: boolean;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
  localTakeoverCooldownMs: number;
  connectedPeersCount: number;
  aggregatePieceDownloadRateKbps: number | null;
  progressiveTakeoverReady: boolean;
}) {
  if (!input.hasManifest || input.engineType === "none") {
    return "progressive-engine-unavailable";
  }

  if (input.playbackStatus !== "playing" && input.playbackStatus !== "buffering") {
    return "playback-paused";
  }

  if (
    input.progressiveFallbackReason &&
    !isRecoverableProgressiveFallbackReason(input.progressiveFallbackReason)
  ) {
    return input.progressiveFallbackReason;
  }

  if (
    shouldAttemptProgressiveLocalPlayback({
      isCurrentSourceOwner: input.isCurrentSourceOwner,
      activePlaybackSource: input.activePlaybackSource,
      playbackStatus: input.playbackStatus,
      engineType: input.engineType,
      startupReady: input.startupReady,
      hasFullLocalTrack: input.hasFullLocalTrack,
      progressiveFallbackReason: input.progressiveFallbackReason
    })
  ) {
    return null;
  }

  if (input.localTakeoverCooldownMs > 0) {
    return "takeover-cooldown";
  }

  if (input.connectedPeersCount <= 0) {
    return "data-channel-not-ready";
  }

  if (
    input.aggregatePieceDownloadRateKbps === null ||
    !Number.isFinite(input.aggregatePieceDownloadRateKbps) ||
    input.aggregatePieceDownloadRateKbps <= 0
  ) {
    return "piece-download-not-ready";
  }

  if (!input.progressiveTakeoverReady) {
    return "local-prefix-not-ready";
  }

  return null;
}

export function resolveProgressiveLocalReadinessPreflight(input: {
  hasManifest: boolean;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  engineType: ProgressiveEngineType;
  startupReady: boolean;
  hasFullLocalTrack: boolean;
  progressiveFallbackReason: string | null | undefined;
  localTakeoverCooldownMs: number;
  connectedPeersCount: number;
  aggregatePieceDownloadRateKbps: number | null;
}) {
  const staticBlockedReason = resolveProgressiveLocalBlockedReason({
    ...input,
    progressiveTakeoverReady: true
  });
  if (staticBlockedReason !== null) {
    return {
      blockedReason: staticBlockedReason,
      shouldProbeTakeoverReady: false
    };
  }

  if (
    shouldAttemptProgressiveLocalPlayback({
      isCurrentSourceOwner: input.isCurrentSourceOwner,
      activePlaybackSource: input.activePlaybackSource,
      playbackStatus: input.playbackStatus,
      engineType: input.engineType,
      startupReady: input.startupReady,
      hasFullLocalTrack: input.hasFullLocalTrack,
      progressiveFallbackReason: input.progressiveFallbackReason
    })
  ) {
    return {
      blockedReason: null,
      shouldProbeTakeoverReady: false
    };
  }

  return {
    blockedReason: null,
    shouldProbeTakeoverReady: true
  };
}

export function shouldStartPcmSlidingWindowAudioElement(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  localReady: boolean;
  audioPaused: boolean;
  lastAttemptAtMs: number | null;
  nowMs: number;
  retryIntervalMs: number;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
    (input.playbackStatus !== "playing" && input.playbackStatus !== "buffering") ||
    !input.localReady ||
    !input.audioPaused
  ) {
    return false;
  }

  return (
    input.lastAttemptAtMs === null ||
    input.nowMs - input.lastAttemptAtMs >= input.retryIntervalMs
  );
}

export function shouldUsePcmEngineForFullLocal(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  forceSourceOwnerLocalPlayback: boolean;
  sourceOwnerHasLocalTrack: boolean;
  hasFullLocalTrack: boolean;
  progressiveEngineType: ProgressiveEngineType;
}) {
  const wantsFullLocalPlayback =
    input.activePlaybackSource === "full-local" ||
    input.forceSourceOwnerLocalPlayback ||
    input.sourceOwnerHasLocalTrack;

  return (
    wantsFullLocalPlayback &&
    !input.hasFullLocalTrack &&
    input.progressiveEngineType === "pcm"
  );
}

export function resolvePlaybackRecoveryStage(input: {
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  startupGatePending: boolean;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
  shadowWarmupActive: boolean;
  audibleLocalFallbackActive: boolean;
}) {
  if (input.audibleLocalFallbackActive) {
    return "audible-local-fallback" as const;
  }

  if (input.playbackStatus !== "playing" || input.startupGatePending) {
    return "startup-buffering" as const;
  }

  if (input.stalledEventsLast30s > 0 || input.waitingEventsLast30s > 0) {
    return "degraded" as const;
  }

  return "steady" as const;
}

export function resolveSchedulerBudgetTier(input: {
  bufferHealth: "healthy" | "low" | "critical";
  activePlaybackSource: ProgressivePlaybackSource;
  playbackRecoveryStage: PlaybackRecoveryStage;
}) {
  if (input.bufferHealth === "critical" || input.playbackRecoveryStage === "audible-local-fallback") {
    return "critical" as const;
  }

  if (
    input.playbackRecoveryStage === "startup-buffering" ||
    input.playbackRecoveryStage === "degraded"
  ) {
    return "protected" as const;
  }

  return "expanded" as const;
}

export function resolveSchedulerBufferHealth(input: {
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
}) {
  if (input.stalledEventsLast30s > 0) {
    return "critical" as const;
  }

  if (input.waitingEventsLast30s > 0) {
    return "low" as const;
  }

  return "healthy" as const;
}

export function resolveEffectiveStartupBufferMs(input: {
  baseStartupBufferMs: number;
  waitingEventsLast30s: number;
  stalledEventsLast30s: number;
}) {
  if (input.stalledEventsLast30s > 0) {
    return input.baseStartupBufferMs + 220;
  }

  if (input.waitingEventsLast30s >= 2) {
    return input.baseStartupBufferMs + 140;
  }

  if (input.waitingEventsLast30s > 0) {
    return input.baseStartupBufferMs + 80;
  }

  return input.baseStartupBufferMs;
}

export function resolvePlaybackQualityMetrics(input: {
  nowMs: number;
  windowMs: number;
  waitingEventTimestamps: readonly number[];
  stalledEventTimestamps: readonly number[];
  driftSamples: readonly { timestampMs: number; driftMs: number }[];
  maxContinuousPlaybackMsLast30s: number;
}) {
  const waitingEvents = input.waitingEventTimestamps.filter(
    (timestampMs) => input.nowMs - timestampMs <= input.windowMs
  );
  const stalledEvents = input.stalledEventTimestamps.filter(
    (timestampMs) => input.nowMs - timestampMs <= input.windowMs
  );
  const driftSamples = input.driftSamples.filter(
    (sample) => input.nowMs - sample.timestampMs <= input.windowMs
  );
  const averageDriftMs =
    driftSamples.length > 0
      ? Math.round(
          driftSamples.reduce((sum, sample) => sum + sample.driftMs, 0) / driftSamples.length
        )
      : null;
  const maxDriftMs =
    driftSamples.length > 0
      ? Math.round(driftSamples.reduce((max, sample) => Math.max(max, sample.driftMs), 0))
      : null;

  return {
    waitingEventsLast30s: waitingEvents.length,
    stalledEventsLast30s: stalledEvents.length,
    averageDriftMs,
    maxDriftMs,
    maxContinuousPlaybackMsLast30s: input.maxContinuousPlaybackMsLast30s
  };
}

export type ContinuousPlaybackSegment = {
  startedAtMs: number;
  endedAtMs: number;
};

export function resolveContinuousPlaybackStart(input: {
  activeStartedAtMs: number | null;
  timestampMs: number;
}) {
  return input.activeStartedAtMs ?? input.timestampMs;
}

export function prunePlaybackQualityTimestamps(
  timestamps: readonly number[],
  nowMs: number,
  windowMs: number
) {
  return timestamps.filter((timestampMs) => nowMs - timestampMs <= windowMs);
}

export function appendPlaybackQualityTimestamp(input: {
  timestamps: readonly number[];
  timestampMs: number;
  windowMs: number;
}) {
  return prunePlaybackQualityTimestamps(
    [...input.timestamps, input.timestampMs],
    input.timestampMs,
    input.windowMs
  );
}

export function pruneContinuousPlaybackSegments(
  segments: readonly ContinuousPlaybackSegment[],
  nowMs: number,
  windowMs: number
) {
  const windowStart = nowMs - windowMs;
  return segments.filter((segment) => segment.endedAtMs >= windowStart);
}

export function resolveContinuousPlaybackInterruption(input: {
  segments: readonly ContinuousPlaybackSegment[];
  activeStartedAtMs: number | null;
  timestampMs: number;
  windowMs: number;
}) {
  if (input.activeStartedAtMs === null) {
    return {
      segments: [...input.segments],
      activeStartedAtMs: null
    };
  }

  return {
    segments: pruneContinuousPlaybackSegments(
      [
        ...input.segments,
        {
          startedAtMs: input.activeStartedAtMs,
          endedAtMs: input.timestampMs
        }
      ],
      input.timestampMs,
      input.windowMs
    ),
    activeStartedAtMs: null
  };
}

export function resolveMaxContinuousPlaybackMs(input: {
  segments: readonly ContinuousPlaybackSegment[];
  activeStartedAtMs: number | null;
  nowMs: number;
  windowMs: number;
}) {
  const windowStart = input.nowMs - input.windowMs;
  let maxDurationMs = 0;

  for (const segment of input.segments) {
    const startedAtMs = Math.max(segment.startedAtMs, windowStart);
    const endedAtMs = Math.min(segment.endedAtMs, input.nowMs);
    if (endedAtMs > startedAtMs) {
      maxDurationMs = Math.max(maxDurationMs, endedAtMs - startedAtMs);
    }
  }

  if (input.activeStartedAtMs !== null) {
    maxDurationMs = Math.max(
      maxDurationMs,
      input.nowMs - Math.max(input.activeStartedAtMs, windowStart)
    );
  }

  return maxDurationMs;
}

export function resolveContinuousPlaybackWindowMetrics(input: {
  segments: readonly ContinuousPlaybackSegment[];
  activeStartedAtMs: number | null;
  nowMs: number;
  windowMs: number;
}) {
  const segments = pruneContinuousPlaybackSegments(
    input.segments,
    input.nowMs,
    input.windowMs
  );

  return {
    segments,
    maxContinuousPlaybackMs: resolveMaxContinuousPlaybackMs({
      segments,
      activeStartedAtMs: input.activeStartedAtMs,
      nowMs: input.nowMs,
      windowMs: input.windowMs
    })
  };
}

export type PlaybackDriftSample = {
  timestampMs: number;
  driftMs: number;
};

export function appendPlaybackDriftSample(input: {
  samples: readonly PlaybackDriftSample[];
  driftMs: number;
  timestampMs: number;
  windowMs: number;
}) {
  if (!Number.isFinite(input.driftMs)) {
    return input.samples;
  }

  return [
    ...input.samples,
    {
      timestampMs: input.timestampMs,
      driftMs: Math.abs(input.driftMs)
    }
  ].filter((sample) => input.timestampMs - sample.timestampMs <= input.windowMs);
}

export function resolveBufferSafetyMarginMs(input: {
  aheadBufferedMs: number;
  estimatedFillTimeMs: number | null;
}) {
  if (input.estimatedFillTimeMs === null) {
    return null;
  }

  return input.aheadBufferedMs - input.estimatedFillTimeMs;
}

export function shouldPreferLocalTakeover(input: {
  progressiveFallbackReason: string | null | undefined;
}) {
  return (
    input.progressiveFallbackReason === "buffer-underrun" ||
    input.progressiveFallbackReason === "stalled" ||
    input.progressiveFallbackReason === "seek-outside-buffer"
  );
}

export function buildProgressiveWarmupTimerKey(input: {
  playbackCurrentTrackId: string | null;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null;
  playbackMediaEpoch: number | null;
  currentTrackFormatKey: string;
  progressiveManifestKey: string;
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveEngineType: ProgressiveEngineType;
  startupBufferMs: number;
}) {
  return [
    input.playbackCurrentTrackId ?? "none",
    input.playbackStatus ?? "none",
    input.playbackMediaEpoch ?? "none",
    input.currentTrackFormatKey,
    input.progressiveManifestKey,
    input.activePlaybackSource,
    input.progressiveEngineType,
    input.startupBufferMs
  ].join("|");
}
