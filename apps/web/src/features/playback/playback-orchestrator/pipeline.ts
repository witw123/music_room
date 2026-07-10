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
import {
  shouldPreferLocalTakeover,
  type ContinuousPlaybackSegment,
  type PlaybackDriftSample
} from "./playback-quality-policy";
import type {
  FullLocalPlaybackSessionState,
  PlaybackRecoveryStage,
  TransportGovernorMode
} from "./pipeline-types";

export * from "./pipeline-types";
export * from "./playback-diagnostics-policy";
export * from "./playback-quality-policy";

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

type PlaybackTimelineInput =
  | {
      currentTrackId?: string | null;
      mediaEpoch?: number | null;
      playbackRevision?: number | null;
      queueVersion?: number | null;
    }
  | null
  | undefined;

export function buildPlaybackPositionKey(playback: PlaybackPositionInput) {
  return [
    playback?.currentTrackId ?? "none",
    playback?.status ?? "none",
    playback?.positionMs ?? "unknown-position",
    playback?.startedAt ?? "not-started",
    playback?.mediaEpoch ?? "unknown-epoch"
  ].join("|");
}

export function resolvePlaybackTimelineIdentity(playback: PlaybackTimelineInput) {
  if (!playback?.currentTrackId) {
    return null;
  }

  const rawRevision = playback.playbackRevision ?? playback.queueVersion;
  if (typeof rawRevision !== "number" || !Number.isFinite(rawRevision)) {
    return null;
  }

  const mediaEpoch = typeof playback.mediaEpoch === "number" ? playback.mediaEpoch : "none";
  return {
    key: [playback.currentTrackId, mediaEpoch].join("|"),
    revision: rawRevision
  };
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

export function resolveLocalPlaybackClockSeconds(input: {
  activePlaybackSource: ProgressivePlaybackSource | "remote";
  pcmCurrentTimeSeconds: number | null | undefined;
  audioCurrentTimeSeconds: number | null | undefined;
}) {
  if (
    !isSlidingWindowPlaybackSource(input.activePlaybackSource) &&
    input.activePlaybackSource !== "full-local"
  ) {
    return null;
  }

  if (
    input.activePlaybackSource === "full-local" &&
    typeof input.audioCurrentTimeSeconds === "number" &&
    Number.isFinite(input.audioCurrentTimeSeconds)
  ) {
    return input.audioCurrentTimeSeconds;
  }

  if (
    typeof input.pcmCurrentTimeSeconds === "number" &&
    Number.isFinite(input.pcmCurrentTimeSeconds)
  ) {
    return input.pcmCurrentTimeSeconds;
  }

  return typeof input.audioCurrentTimeSeconds === "number" &&
    Number.isFinite(input.audioCurrentTimeSeconds)
    ? input.audioCurrentTimeSeconds
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

export function resolveSourceOwnerHasLocalTrackForPlayback(input: {
  isCurrentSourceOwner: boolean;
  hasUploadedTrack: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  forceSourceOwnerLocalPlayback: boolean;
}) {
  return (
    input.isCurrentSourceOwner &&
    input.hasUploadedTrack &&
    (input.activePlaybackSource === "full-local" ||
      input.forceSourceOwnerLocalPlayback)
  );
}

export function resolveFullLocalAudioSourceAction(input: {
  hasSrcObject: boolean;
  hasProgressiveRuntime?: boolean;
  currentSrc: string;
  nextSrc: string;
}) {
  const shouldAssignSource = input.currentSrc !== input.nextSrc || input.hasSrcObject;
  return {
    shouldDestroyRuntime: input.hasSrcObject || input.hasProgressiveRuntime === true,
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
  pcmOutputAudible?: boolean;
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
    if (input.pcmOutputAudible) {
      return {
        progressiveFallbackReason: null,
        mediaConnectionState: "live" as const,
        shouldConsumePlaybackStartIntent: true
      };
    }

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
    availableInSession: input.currentSession.availableInSession
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

  if (
    resolvePcmOutputAudible({
      pcmAudioContextState: input.pcmAudioContextState,
      pcmDirectOutputConnected: input.pcmDirectOutputConnected,
      pcmDecodedSegmentCount: input.pcmDecodedSegmentCount,
      pcmScheduledSegmentCount: input.pcmScheduledSegmentCount,
      localAudioHasSrcObject: input.localAudioHasSrcObject,
      localAudioPaused: input.localAudioPaused,
      localAudioMuted: input.localAudioMuted,
      localAudioVolume: input.localAudioVolume
    })
  ) {
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

export function resolveWarmupPcmSyncMode(
  _source: ProgressivePlaybackSource
): "snapshot-only" | "sync-playback" {
  return "sync-playback" as const;
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
  pcmOutputAudible: boolean;
}) {
  if (input.cancelled || (!input.playbackStarted && !input.pcmOutputAudible)) {
    return null;
  }

  return {
    shouldClearFallbackReason: true,
    mediaConnectionState: "live" as const,
    shouldConsumePlaybackStartIntent: true
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

export function resolvePcmOutputAudible(input: {
  pcmAudioContextState: string | null | undefined;
  pcmDirectOutputConnected: boolean | null | undefined;
  pcmDecodedSegmentCount: number | null | undefined;
  pcmScheduledSegmentCount: number | null | undefined;
  localAudioHasSrcObject?: boolean | null | undefined;
  localAudioPaused?: boolean | null | undefined;
  localAudioMuted?: boolean | null | undefined;
  localAudioVolume?: number | null | undefined;
}) {
  const pcmElementOutputAudible =
    input.localAudioHasSrcObject === true &&
    input.localAudioPaused === false &&
    input.localAudioMuted !== true &&
    input.localAudioVolume !== 0;

  return (
    input.pcmAudioContextState === "running" &&
    (input.pcmDecodedSegmentCount ?? 0) > 0 &&
    (input.pcmScheduledSegmentCount ?? 0) > 0 &&
    (input.pcmDirectOutputConnected !== false || pcmElementOutputAudible)
  );
}

export function resolveMediaElementPlaybackRole(input: {
  target: "local" | "remote";
  activePlaybackSource: ProgressivePlaybackSource;
  shadowWarmupActive: boolean;
  pcmOutputAudible?: boolean;
}) {
  if (input.target === "local") {
    if (
      input.pcmOutputAudible &&
      (isSlidingWindowPlaybackSource(input.activePlaybackSource) ||
        input.activePlaybackSource === "full-local")
    ) {
      return "inactive" as const;
    }

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
    (input.progressiveEngineType === "none" || input.progressiveEngineType === "pcm")
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
  localAudioPaused?: boolean | null;
  driftMs: number;
  maxDriftMs: number;
  fullLocalBlockedReason: string | null | undefined;
  progressiveEngineType: ProgressiveEngineType;
  aheadBufferedMs: number;
  requiredAheadMs: number;
}) {
  return (
    input.localReady &&
    (input.progressiveEngineType !== "pcm" || input.localAudioPaused !== true) &&
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

export function resolveFullLocalBufferedWarmupMuted(engineType: ProgressiveEngineType) {
  return engineType !== "none";
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
    })
  ) {
    return false;
  }

  return true;
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

