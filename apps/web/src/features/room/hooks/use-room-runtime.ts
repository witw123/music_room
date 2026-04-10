"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type {
  AuthSession,
  IceConfigResponse,
  PeerDiagnosticsSnapshot,
  PeerSignalMessage,
  RoomMediaClockPayload,
  RoomMediaConnectionState,
  RoomSubscribeAckPayload,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { Route } from "next";
import type { RoomSocket } from "@/lib/ws-client";
import { createRoomSocket } from "@/lib/ws-client";
import {
  ChunkScheduler,
  createPeerConnectionSupervisorState,
  getWebRTCIceServers,
  canRunRecoveryAction,
  markRecoveryAction,
  notePeerSignalState,
  observePeerTransport,
  P2PMesh,
  recordPeerPlayoutProgress,
  resetRecoveryStage,
  resolveTrackPieceManifest,
  resolvePreferredIceTransportPolicy,
  selectCanonicalTrackAvailabilityAnnouncement,
  RoomMediaMesh,
  resolveTransportHealth,
  toSupervisorDiagnosticPatch,
  type PeerConnectionSupervisorState
} from "@/features/p2p";
import {
  createRoomSnapshotResyncController,
  type RoomSnapshotResyncReason
} from "@/features/room/room-snapshot-resync";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { toUserFacingError } from "@/lib/music-room-ui";
import { musicRoomApi } from "@/lib/music-room-api";
import { queueTrackPieceManifestUpsert } from "@/lib/indexeddb";
import { captureAudioStream, getCapturedAudioStreamMode } from "@/features/upload/audio-utils";
import {
  resolveHostCaptureRefresh,
  hasUsableHostMediaStreamTrack,
  getHostMediaStreamTrackState,
  isAudioElementEffectivelyPlaying,
  isHostRelayAudioReadyForCapture,
  shouldDeferHostMediaStreamSync
} from "@/features/playback/host-media-sync";
import {
  canUseUploadedTrackForPlayback,
  enableManualTrackCaching,
  enablePlaybackCacheTakeover,
  enableTrackCaching
} from "@/features/playback/track-cache-policy";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { ProgressiveSchedulerPolicy } from "@/features/playback/progressive-playback";
import { shouldForceSourceOwnerLocalPlayback } from "@/features/playback/progressive-source-controller";
import type { ReceivedRoomMediaClock } from "@/features/playback/room-media-clock";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import {
  createSilentPrewarmHandle,
  type SilentPrewarmHandle
} from "@/features/playback/silent-prewarm-stream";
import {
  resolveHostPublishSource,
  type HostPublishReadiness,
  type HostPublishSourceTarget,
  type HostPublishTrackKind,
  type ResolvedPublishElement,
  type ResolvedPublishStreamKind
} from "@/features/room/host-relay-audio";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import type { UploadedTrack } from "@/features/upload/audio-utils";

type RoomRouter = {
  push: (href: Route) => void;
  replace: (href: Route) => void;
};

type UseRoomRuntimeInput = {
  workspaceOnly: boolean;
  initialRoomId: string | null;
  hydrated: boolean;
  authEntryHref: string;
  workspaceEntryHref: string;
  router: RoomRouter;
  lastRoomStorageKey: string;
  peerStorageKey: string;
  activeSession: AuthSession | null;
  activeSessionRef: MutableRefObject<AuthSession | null>;
  refreshSession: () => Promise<unknown>;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  peerId: string;
  setPeerId: Dispatch<SetStateAction<string>>;
  connectedPeers: string[];
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  mediaConnectedPeers: string[];
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  suppressRoomRecovery: boolean;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setIsRecoveringRoom: Dispatch<SetStateAction<boolean>>;
  isNavigatingRoomExit: boolean;
  setIsNavigatingRoomExit: Dispatch<SetStateAction<boolean>>;
  iceConfig: IceConfigResponse | null;
  setIceConfig: Dispatch<SetStateAction<IceConfigResponse | null>>;
  iceConfigResolved: boolean;
  setIceConfigResolved: Dispatch<SetStateAction<boolean>>;
  mediaConnectionState: RoomMediaConnectionState;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  isPageVisible: boolean;
  setIsPageVisible: Dispatch<SetStateAction<boolean>>;
  schedulerMode: "normal" | "conservative" | "idle";
  setSchedulerMode: Dispatch<SetStateAction<"normal" | "conservative" | "idle">>;
  schedulerPlaybackBucketMs: number;
  bufferHealth: "healthy" | "low" | "critical";
  transportGovernorMode: "bootstrap" | "segment-catchup" | "local-primary" | "emergency-fallback";
  activePlaybackSource: ProgressivePlaybackSource;
  progressiveSchedulerPolicy:
    | ProgressiveSchedulerPolicy
    | null;
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  getLocalPlaybackPositionMs?: () => number | null;
  getHostRelayStream?: () => MediaStream | null;
  getHostRelayClockState?: () => {
    mediaTimeMs: number;
    bufferedAheadMs: number;
    playoutState: "playing" | "buffering" | "paused";
  } | null;
  setAuthoritativeMediaClock: Dispatch<SetStateAction<ReceivedRoomMediaClock | null>>;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  roomRecoveryState: {
    phase:
      | "joining"
      | "resyncing"
      | "bootstrapping-data"
      | "bootstrapping-media"
      | "playing-local-fallback"
      | "steady";
    mode: "late-join" | "rejoin" | "steady";
    generation: number | null;
    bootstrapStartedAt: string | null;
    bootstrapSourcePeerId: string | null;
    pendingSnapshot: boolean;
    pendingData: boolean;
    pendingMedia: boolean;
    listenerBootstrapAttempts: number | null;
    fullLocalRecoveryActive: boolean;
  };
  setRoomRecoveryState: Dispatch<
    SetStateAction<{
      phase:
        | "joining"
        | "resyncing"
        | "bootstrapping-data"
        | "bootstrapping-media"
        | "playing-local-fallback"
        | "steady";
      mode: "late-join" | "rejoin" | "steady";
      generation: number | null;
      bootstrapStartedAt: string | null;
      bootstrapSourcePeerId: string | null;
      pendingSnapshot: boolean;
      pendingData: boolean;
      pendingMedia: boolean;
      listenerBootstrapAttempts: number | null;
      fullLocalRecoveryActive: boolean;
    }>
  >;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  setSourceStartState: Dispatch<
    SetStateAction<"idle" | "awaiting-unlock" | "starting" | "live" | "failed">
  >;
  lastSourceStartError: string | null;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  queueAvailability: (announcement: TrackAvailabilityAnnouncement) => void;
  mergeLocalPieceAvailability: (
    trackId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkSize: number
  ) => void;
  clearAvailabilityForPeer: (ownerPeerId: string) => void;
  flushPendingAvailability: () => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  uploadedTracks: Record<string, UploadedTrack>;
  uploadedTrackIds: string[];
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  manualCacheTrackIds: string[];
  announceLocalCache: (trackId: string) => Promise<void>;
  markManualCacheTrackDownloading: (trackId: string) => void;
  deleteUploadedTrackArtifacts: (trackId: string) => Promise<void> | void;
  deleteRoomTrackArtifacts: (trackIds: string[]) => Promise<void> | void;
  scheduleTrackHydration: (trackId: string, mimeType: string, totalChunks: number) => void;
  audioRef: RefObject<HTMLAudioElement | null>;
  remoteAudioRef: RefObject<HTMLAudioElement | null>;
  socketRef: MutableRefObject<RoomSocket | null>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  resetPlayerSurface: () => void;
  setStatusMessage: (value: string) => void;
  statusMessage: string;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
};

type UseRoomRuntimeResult = {
  scheduleRemotePlaybackRetry: (attempt?: number) => void;
  syncHostMediaStream: () => Promise<void>;
  ensureSourcePlaybackStarted: () => Promise<void>;
};

type PieceTransferSample = {
  timestampMs: number;
  bytes: number;
};

type PieceTransferWindow = {
  downloads: PieceTransferSample[];
  uploads: PieceTransferSample[];
};

type PieceRequestSample = {
  timestampMs: number;
  durationMs: number;
  outcome: "completed" | "timeout";
};

type SourceRecoveryCoordinatorState = {
  actionKey: string | null;
  action: "ice-restart" | "hard-recreate" | "full-resubscribe" | null;
  startedAtMs: number | null;
};

const pieceTransferWindowMs = 12_000;
const hostMediaSyncRetryDelayMs = 75;
const hostCaptureHealthCheckIntervalMs = 2_000;
const hostCaptureRefreshCooldownMs = 1_200;
const remoteStreamSwapGraceMs = 900;
const remotePlaybackRetryBackoffMs = [120, 240, 400] as const;
const maxRemotePlaybackRetryAttempts = 3;
const listenerSoftRecoveryDelayMs = 1_500;
const listenerHardRecoveryDelayMs = 5_000;
const listenerSoftRecoveryCooldownMs = 800;
const listenerHardRecoveryCooldownMs = 3_000;
const listenerMediaSupervisorIntervalMs = 150;
const connectionSupervisorForegroundIntervalMs = 500;
const connectionSupervisorBackgroundIntervalMs = 2_000;
const connectionSupervisorIceRestartNoProgressFloorMs = 6_000;
const connectionSupervisorHardRecreateNoProgressFloorMs = 15_000;
const steadyRoomMediaClockEmitIntervalMs = 120;
const recoveryRoomMediaClockEmitIntervalMs = 60;
const subscribeAckTimeoutMs = 4_000;
const subscribeRetryBackoffMs = [200, 500, 1_000, 2_000, 4_000] as const;
const stalledPieceSyncRecoveryThresholdMs = 20_000;
const recentAudibleProgressGraceMs = 2_500;
const recoveryBootstrapGraceMs = 5_000;
const recoverySoftRetryThresholdMs = 5_000;
const recoveryMediaRestartThresholdMs = 4_000;
const recoveryDataRestartThresholdMs = 8_000;
const recoveryFullResubscribeThresholdMs = 15_000;
const listenerBootstrapGraceMs = 1_800;

type ListenerMediaRecoveryReason =
  | "connected-but-no-track"
  | "track-received-but-not-bound"
  | "bound-but-not-playing"
  | "bound-but-muted-track";

type ListenerMediaRecoveryAction =
  | "rebind-element"
  | "retry-play"
  | "rebind-and-play";

type HostPublishStage = "idle" | "waiting-source-audio" | "capture-ready" | "published";
type MediaTransportState = "idle" | "prewarming" | "connected" | "publishing" | "failed";
type HostPublishedTrackKind = HostPublishTrackKind | "none";

export function shouldRedirectRoomRouteToAuth(input: {
  workspaceOnly: boolean;
  initialRoomId: string | null;
  hydrated: boolean;
  hasActiveSession: boolean;
  isNavigatingRoomExit: boolean;
  suppressRoomRecovery: boolean;
}) {
  return (
    input.workspaceOnly &&
    Boolean(input.initialRoomId) &&
    input.hydrated &&
    !input.hasActiveSession &&
    !input.isNavigatingRoomExit &&
    !input.suppressRoomRecovery
  );
}

export function resolveListenerMediaRecoveryReason(input: {
  traceKey: string;
  lastTrackTraceKey: string | null;
  lastBoundTraceKey: string | null;
  lastPlayAttemptTraceKey: string | null;
  lastPlayAttemptResult: "ok" | "rejected" | null;
  lastPlayingTraceKey: string | null;
  remoteAudioPaused: boolean | null;
  hasBoundSrcObject: boolean;
  remoteTrackMuted: boolean | null;
  remoteTrackEnabled: boolean | null;
  remoteTrackReadyState: MediaStreamTrackState | null;
}): ListenerMediaRecoveryReason | null {
  if (input.lastTrackTraceKey !== input.traceKey) {
    return "connected-but-no-track";
  }

  if (input.lastBoundTraceKey !== input.traceKey || !input.hasBoundSrcObject) {
    return "track-received-but-not-bound";
  }

  if (
    input.remoteTrackMuted === true ||
    input.remoteTrackEnabled === false ||
    input.remoteTrackReadyState === "ended"
  ) {
    return "bound-but-muted-track";
  }

  if (input.lastPlayingTraceKey === input.traceKey) {
    return null;
  }

  if (
    input.lastPlayAttemptTraceKey !== input.traceKey ||
    input.lastPlayAttemptResult !== "ok" ||
    input.remoteAudioPaused !== false
  ) {
    return "bound-but-not-playing";
  }

  return null;
}

export function resolveListenerMediaRecoveryAction(input: {
  reason: ListenerMediaRecoveryReason | null;
  bindAttempts: number;
  playAttempts: number;
}) {
  if (!input.reason) {
    return null;
  }

  if (input.reason === "connected-but-no-track") {
    return null;
  }

  if (input.reason === "track-received-but-not-bound") {
    return "rebind-element" satisfies ListenerMediaRecoveryAction;
  }

  if (input.reason === "bound-but-not-playing") {
    return "retry-play" satisfies ListenerMediaRecoveryAction;
  }

  return "rebind-and-play" satisfies ListenerMediaRecoveryAction;
}

function resolveListenerRecoveryDelayMs(input: {
  progressGapMs: number | null;
  remoteTrackReadyState: MediaStreamTrackState | null;
}) {
  if (input.remoteTrackReadyState === "ended") {
    return listenerHardRecoveryDelayMs;
  }

  if (typeof input.progressGapMs !== "number" || !Number.isFinite(input.progressGapMs)) {
    return listenerSoftRecoveryDelayMs;
  }

  return input.progressGapMs >= listenerHardRecoveryDelayMs
    ? listenerHardRecoveryDelayMs
    : listenerSoftRecoveryDelayMs;
}

function resolveRoomMediaClockEmitIntervalMs(input: {
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  relayPlayoutState: "playing" | "buffering" | "paused" | null;
}) {
  if (input.playbackStatus !== "playing" || input.sourceStartState !== "live") {
    return recoveryRoomMediaClockEmitIntervalMs;
  }

  return input.relayPlayoutState === "buffering"
    ? recoveryRoomMediaClockEmitIntervalMs
    : steadyRoomMediaClockEmitIntervalMs;
}

function formatDiagnosticsTimestamp(timestampMs: number | null) {
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? new Date(timestampMs).toISOString()
    : null;
}

function resolveConsecutiveNoProgressMs(...values: Array<number | null>) {
  const definedValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0
  );

  if (definedValues.length === 0) {
    return null;
  }

  return Math.max(0, Math.round(Math.min(...definedValues)));
}

export function shouldForcePieceSyncRecovery(input: {
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null;
  activePlaybackSource: ProgressivePlaybackSource;
  bufferHealth: "healthy" | "low" | "critical";
  localAvailableChunks: number;
  totalChunks: number;
  lastPieceActivityAtMs: number;
  now?: number;
}) {
  if (
    input.playbackStatus !== "playing" ||
    !input.currentTrackId ||
    input.activePlaybackSource !== "remote-stream"
  ) {
    return false;
  }

  const totalChunks = Math.max(0, input.totalChunks);
  const fullyBuffered = totalChunks > 0 && input.localAvailableChunks >= totalChunks;
  if (fullyBuffered || input.bufferHealth === "healthy") {
    return false;
  }

  return (input.now ?? Date.now()) - input.lastPieceActivityAtMs >= stalledPieceSyncRecoveryThresholdMs;
}

export function shouldResumeRemotePlaybackAfterAudioUnlock(input: {
  audioUnlocked: boolean;
  isCurrentSourceOwner: boolean;
  activePlaybackSource: ProgressivePlaybackSource;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null;
  hasRemoteSrcObject: boolean;
  remoteAudioPaused: boolean | null;
}) {
  return (
    input.audioUnlocked &&
    !input.isCurrentSourceOwner &&
    input.activePlaybackSource === "remote-stream" &&
    input.playbackStatus === "playing" &&
    !!input.currentTrackId &&
    input.hasRemoteSrcObject &&
    input.remoteAudioPaused !== false
  );
}

export function shouldManagePublishedMediaTransport(input: {
  roomId: string | null | undefined;
  peerId: string | null | undefined;
  isCurrentSourceOwner: boolean;
}) {
  return !!input.roomId && !!input.peerId && input.isCurrentSourceOwner;
}

export function shouldAcceptIncomingPeerSignalRecoveryGeneration(input: {
  payloadRecoveryGeneration: number | null | undefined;
  currentRecoveryGeneration: number | null;
}) {
  if (
    typeof input.payloadRecoveryGeneration !== "number" ||
    input.currentRecoveryGeneration === null
  ) {
    return true;
  }

  return input.payloadRecoveryGeneration === input.currentRecoveryGeneration;
}

function resolveCurrentRoomTrackTotalChunks(input: {
  trackId: string | null;
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
}) {
  if (!input.trackId) {
    return 0;
  }

  const roomId = input.roomSnapshot?.room.id ?? null;
  const activeMemberPeerIds = new Set(
    input.roomSnapshot?.room.members
      .map((member) => member.peerId)
      .filter((peerId): peerId is string => !!peerId) ?? []
  );
  const track = input.roomSnapshot?.tracks.find((entry) => entry.id === input.trackId) ?? null;
  const availability = selectCanonicalTrackAvailabilityAnnouncement(
    Object.values(input.availabilityByTrack[input.trackId] ?? {}).filter(
      (announcement) =>
        announcement.totalChunks > 0 &&
        announcement.chunkSize > 0 &&
        (!roomId || announcement.roomId === roomId) &&
        activeMemberPeerIds.has(announcement.ownerPeerId)
    )
  );

  return (
    resolveTrackPieceManifest({
      track,
      availability
    })?.totalChunks ?? 0
  );
}

function getPeerMedianRttMs(state: PeerConnectionSupervisorState | null | undefined) {
  if (!state?.samples?.length) {
    return null;
  }

  const values = state.samples
    .map((sample) => sample.currentRoundTripTimeMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length === 0) {
    return null;
  }

  return values[Math.floor(values.length / 2)] ?? null;
}

function resolveIceRestartNoProgressMs(state: PeerConnectionSupervisorState | null | undefined) {
  const rttMs = getPeerMedianRttMs(state) ?? 0;
  return Math.max(connectionSupervisorIceRestartNoProgressFloorMs, Math.round(rttMs * 4));
}

function resolveHardRecreateNoProgressMs(state: PeerConnectionSupervisorState | null | undefined) {
  const rttMs = getPeerMedianRttMs(state) ?? 0;
  return Math.max(connectionSupervisorHardRecreateNoProgressFloorMs, Math.round(rttMs * 8));
}

export function resolvePeerConnectionNoProgressMs(
  state: PeerConnectionSupervisorState,
  now = Date.now()
) {
  const latestProgressAt = Math.max(
    state.lastTransportProgressAtMs ?? 0,
    state.lastPlayoutProgressAtMs ?? 0
  );
  if (latestProgressAt > 0) {
    return Math.max(0, now - latestProgressAt);
  }

  return Math.max(0, now - (state.unhealthySignalStateStartedAtMs ?? state.lastSignalStateAtMs));
}

export function resolveMediaDiagnosticPeerId(input: {
  remotePeerId: string | null | undefined;
  connectedPeerIds: string[];
  currentSourcePeerId: string | null | undefined;
}) {
  return (
    input.remotePeerId ||
    input.connectedPeerIds[0] ||
    input.currentSourcePeerId ||
    "remote-media"
  );
}

function getSourceRecoveryActionRank(action: SourceRecoveryCoordinatorState["action"]) {
  if (action === "ice-restart") {
    return 1;
  }

  if (action === "hard-recreate") {
    return 2;
  }

  if (action === "full-resubscribe") {
    return 3;
  }

  return 0;
}

function prunePieceRequestSamples(samples: PieceRequestSample[], now: number) {
  return samples.filter((sample) => now - sample.timestampMs <= pieceTransferWindowMs);
}

function summarizePieceRequestSamples(samples: PieceRequestSample[], now = Date.now()) {
  const resolved = prunePieceRequestSamples(samples, now);
  const durations = resolved
    .filter((sample) => sample.outcome === "completed")
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const timeouts = resolved.filter((sample) => sample.outcome === "timeout").length;
  const total = resolved.length;

  return {
    samples: resolved,
    pieceRttMsP50: percentileFromSorted(durations, 0.5),
    pieceRttMsP95: percentileFromSorted(durations, 0.95),
    pieceTimeoutRate: total > 0 ? Math.round((timeouts / total) * 1000) / 10 : null
  };
}

function percentileFromSorted(values: number[], percentile: number) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * percentile)));
  return values[index] ?? null;
}

function getPieceTransferRates(
  transferWindows: Map<string, PieceTransferWindow>,
  peerId: string,
  now = Date.now()
) {
  const window = transferWindows.get(peerId);
  if (!window) {
    return {
      downloadRateKbps: null,
      uploadRateKbps: null
    };
  }

  window.downloads = prunePieceTransferSamples(window.downloads, now);
  window.uploads = prunePieceTransferSamples(window.uploads, now);

  return {
    downloadRateKbps: calculatePieceTransferRateKbps(window.downloads, now),
    uploadRateKbps: calculatePieceTransferRateKbps(window.uploads, now)
  };
}

function prunePieceTransferSamples(samples: PieceTransferSample[], now: number) {
  return samples.filter((sample) => now - sample.timestampMs <= pieceTransferWindowMs);
}

function calculatePieceTransferRateKbps(samples: PieceTransferSample[], now: number) {
  if (samples.length === 0) {
    return 0;
  }

  const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
  const durationMs = pieceTransferWindowMs;
  return Math.round(((totalBytes * 8) / durationMs) * 10) / 10;
}

function buildHostPublishKey(input: {
  currentTrackId: string | null;
  mediaEpoch: number;
  sourcePeerId: string | null;
  captureTrackId: string | null;
  listenerPeerIds: string[];
}) {
  if (!input.currentTrackId) {
    return null;
  }

  const listenerSetHash = [...input.listenerPeerIds].sort().join(",");
  return [
    input.currentTrackId,
    input.mediaEpoch,
    input.sourcePeerId ?? "none",
    input.captureTrackId ?? "none",
    listenerSetHash
  ].join("|");
}

function withResolvedTransportHealth(snapshot: PeerDiagnosticsSnapshot): PeerDiagnosticsSnapshot {
  return {
    ...snapshot,
    ...resolveTransportHealth(snapshot)
  };
}

function withSupervisorDiagnosticPatch(
  snapshot: PeerDiagnosticsSnapshot,
  state: PeerConnectionSupervisorState | null
): PeerDiagnosticsSnapshot {
  if (!state) {
    return snapshot;
  }

  return {
    ...snapshot,
    ...toSupervisorDiagnosticPatch(state)
  };
}

export function useRoomRuntime({
  workspaceOnly,
  initialRoomId,
  hydrated,
  authEntryHref,
  workspaceEntryHref,
  router,
  lastRoomStorageKey,
  peerStorageKey,
  activeSession,
  activeSessionRef,
  refreshSession,
  roomSnapshot,
  dispatchRoomStateEvent,
  currentRoomRef,
  peerId,
  setPeerId,
  connectedPeers,
  setConnectedPeers,
  mediaConnectedPeers,
  setMediaConnectedPeers,
  suppressRoomRecovery,
  setSuppressRoomRecovery,
  setIsRecoveringRoom,
  isNavigatingRoomExit,
  setIsNavigatingRoomExit,
  iceConfig,
  setIceConfig,
  iceConfigResolved,
  setIceConfigResolved,
  mediaConnectionState,
  setMediaConnectionState,
  isPageVisible,
  setIsPageVisible,
  schedulerMode,
  setSchedulerMode,
  schedulerPlaybackBucketMs,
  bufferHealth,
  transportGovernorMode,
  activePlaybackSource,
  progressiveSchedulerPolicy,
  isCurrentSourceOwner,
  audioUnlocked,
  getLocalPlaybackPositionMs,
  getHostRelayStream,
  getHostRelayClockState,
  setAuthoritativeMediaClock,
  setAudioUnlocked,
  roomRecoveryState,
  setRoomRecoveryState,
  sourceStartState,
  setSourceStartState,
  lastSourceStartError,
  setLastSourceStartError,
  availabilityByTrack,
  queueAvailability,
  mergeLocalPieceAvailability,
  clearAvailabilityForPeer,
  flushPendingAvailability,
  recordPeerDiagnostic,
  uploadedTracks,
  uploadedTrackIds,
  uploadedTrackIdsRef,
  manualCacheTrackIds,
  announceLocalCache,
  markManualCacheTrackDownloading,
  deleteUploadedTrackArtifacts,
  deleteRoomTrackArtifacts,
  scheduleTrackHydration,
  audioRef,
  remoteAudioRef,
  socketRef,
  chunkSchedulerRef,
  resetPlayerSurface,
  setStatusMessage,
  statusMessage,
  refreshAvailableRooms,
  refreshPlaylists
}: UseRoomRuntimeInput): UseRoomRuntimeResult {
  const meshRef = useRef<P2PMesh | null>(null);
  const mediaMeshRef = useRef<RoomMediaMesh | null>(null);
  const connectionSupervisorStatesRef = useRef<Map<string, PeerConnectionSupervisorState>>(new Map());
  const initialRecoveryAttemptRef = useRef<string | null>(null);
  const initialRoomSnapshotResyncKeyRef = useRef<string | null>(null);
  const previousInitialRoomIdRef = useRef<string | null>(initialRoomId);
  const activeRouteRoomIdRef = useRef<string | null>(initialRoomId);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const silentPrewarmHandleRef = useRef<SilentPrewarmHandle | null>(null);
  const mediaTransportEpochRef = useRef(0);
  const transportResetReasonRef = useRef<"source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none">(
    "none"
  );
  const hostMediaSyncRetryRef = useRef<number | null>(null);
  const lastHostCaptureRefreshAtRef = useRef<number>(0);
  const remotePlaybackRetryRef = useRef<number | null>(null);
  const remotePlaybackResumeAfterUnlockKeyRef = useRef<string | null>(null);
  const remoteStreamClearTimeoutRef = useRef<number | null>(null);
  const presenceIntervalRef = useRef<number | null>(null);
  const roomSnapshotWatchdogIntervalRef = useRef<number | null>(null);
  const recoveryWatchdogIntervalRef = useRef<number | null>(null);
  const resubscribeRoomRef = useRef<(() => void) | null>(null);
  const recoveryGenerationRef = useRef<number | null>(roomRecoveryState.generation);
  const roomRecoveryStateRef = useRef(roomRecoveryState);
  const activePlaybackSourceRef = useRef(activePlaybackSource);
  const lastSubscribeAckAtRef = useRef<number | null>(null);
  const latestSubscribeBootstrapRef = useRef<RoomSubscribeAckPayload["bootstrap"] | null>(null);
  const recoveryModeRef = useRef<"late-join" | "rejoin" | "steady">("steady");
  const recoveryWatchdogActionsRef = useRef<{
    snapshotResyncKey: string | null;
    softMediaRetryKey: string | null;
    dataRestartKey: string | null;
    mediaRestartKey: string | null;
    fullResubscribeKey: string | null;
  }>({
    snapshotResyncKey: null,
    softMediaRetryKey: null,
    dataRestartKey: null,
    mediaRestartKey: null,
    fullResubscribeKey: null
  });
  const presenceRepairKeyRef = useRef<string | null>(null);
  const trackMetadataRepairKeyRef = useRef<string | null>(null);
  const mediaTransportOwnerKeyRef = useRef<string | null>(null);
  const lastRealtimeRoomEventAtRef = useRef<number>(Date.now());
  const lastDataActivityAtRef = useRef<number | null>(null);
  const lastListenerBootstrapKeyRef = useRef<string | null>(null);
  const missingListenerSinceRef = useRef<Map<string, number>>(new Map());
  const hostMediaSyncStateRef = useRef<{
    inFlight: boolean;
    lastAppliedKey: string | null;
    pendingKey: string | null;
    lastCaptureRefreshKey: string | null;
    lastPublishKey: string | null;
    retryKey: string | null;
    publishGeneration: number;
    stage: HostPublishStage;
    lastPublishedListenerSet: string | null;
  }>({
    inFlight: false,
    lastAppliedKey: null,
    pendingKey: null,
    lastCaptureRefreshKey: null,
    lastPublishKey: null,
    retryKey: null,
    publishGeneration: 0,
    stage: "idle",
    lastPublishedListenerSet: null
  });
  const remoteStreamTrackingRef = useRef<{
    trackKey: string | null;
    accumulatedMs: number;
    segmentStartedAt: number | null;
  }>({
    trackKey: null,
    accumulatedMs: 0,
    segmentStartedAt: null
  });
  const listenerMediaLifecycleRef = useRef<{
    traceKey: string | null;
    lastTrackTraceKey: string | null;
    lastBoundTraceKey: string | null;
    lastPlayAttemptTraceKey: string | null;
    lastPlayAttemptResult: "ok" | "rejected" | null;
    lastPlayAttemptError: string | null;
    lastPlayingTraceKey: string | null;
    lastSoftRecoveryTraceKey: string | null;
    lastSoftRecoveryAt: number | null;
    lastHardRecoveryTraceKey: string | null;
    lastHardRecoveryAt: number | null;
    latestStream: MediaStream | null;
    currentGeneration: string | null;
    generationStartedAt: number | null;
    boundGeneration: string | null;
    playingGeneration: string | null;
    lastPlayoutProgressAt: number | null;
    lastTransportProgressAt: number | null;
    lastObservedRemoteCurrentTimeMs: number | null;
    recoveryStage:
      | "idle"
      | "waiting-track"
      | "rebind-element"
      | "retry-play"
      | "rebind-and-play";
    restartAttempt: number;
    bindAttempts: number;
    playAttempts: number;
  }>({
    traceKey: null,
    lastTrackTraceKey: null,
    lastBoundTraceKey: null,
    lastPlayAttemptTraceKey: null,
    lastPlayAttemptResult: null,
    lastPlayAttemptError: null,
    lastPlayingTraceKey: null,
    lastSoftRecoveryTraceKey: null,
    lastSoftRecoveryAt: null,
    lastHardRecoveryTraceKey: null,
    lastHardRecoveryAt: null,
    latestStream: null,
    currentGeneration: null,
    generationStartedAt: null,
    boundGeneration: null,
    playingGeneration: null,
    lastPlayoutProgressAt: null,
    lastTransportProgressAt: null,
    lastObservedRemoteCurrentTimeMs: null,
    recoveryStage: "idle",
    restartAttempt: 0,
    bindAttempts: 0,
    playAttempts: 0
  });
  const listenerMediaRecoveryTimeoutRef = useRef<number | null>(null);
  const hostMediaClockSequenceRef = useRef(0);
  const armListenerMediaRecoveryRef = useRef<(generation?: string | null) => void>(() => undefined);
  const pieceTransferRatesRef = useRef<Map<string, PieceTransferWindow>>(new Map());
  const pieceRequestSamplesRef = useRef<Map<string, PieceRequestSample[]>>(new Map());
  const sourceRecoveryCoordinatorRef = useRef<SourceRecoveryCoordinatorState>({
    actionKey: null,
    action: null,
    startedAtMs: null
  });
  const dataDegradedSinceRef = useRef<number | null>(null);
  const lastPieceReceivedAtRef = useRef<number>(Date.now());
  const lastAvailabilityGrowthAtRef = useRef<number>(Date.now());
  const currentTrackAvailabilityProgressRef = useRef<string | null>(null);
  const audioUnlockedRef = useRef(audioUnlocked);
  const setAudioUnlockedRef = useRef(setAudioUnlocked);
  const sourceStartStateRef = useRef(sourceStartState);
  const setSourceStartStateRef = useRef(setSourceStartState);
  const lastSourceStartErrorRef = useRef(lastSourceStartError);
  const setLastSourceStartErrorRef = useRef(setLastSourceStartError);
  const manualCacheTrackIdsRef = useRef(manualCacheTrackIds);
  const announceLocalCacheRef = useRef(announceLocalCache);
  const deleteUploadedTrackArtifactsRef = useRef(deleteUploadedTrackArtifacts);
  const deleteRoomTrackArtifactsRef = useRef(deleteRoomTrackArtifacts);
  const scheduleTrackHydrationRef = useRef(scheduleTrackHydration);
  const resetPlayerSurfaceRef = useRef(resetPlayerSurface);
  const queueAvailabilityRef = useRef(queueAvailability);
  const mergeLocalPieceAvailabilityRef = useRef(mergeLocalPieceAvailability);
  const clearAvailabilityForPeerRef = useRef(clearAvailabilityForPeer);
  const flushPendingAvailabilityRef = useRef(flushPendingAvailability);
  const recordPeerDiagnosticRef = useRef(recordPeerDiagnostic);

  const clearPendingRemoteStreamClear = useCallback(() => {
    if (remoteStreamClearTimeoutRef.current !== null) {
      window.clearTimeout(remoteStreamClearTimeoutRef.current);
      remoteStreamClearTimeoutRef.current = null;
    }
  }, []);

  const clearListenerMediaRecovery = useCallback(() => {
    if (listenerMediaRecoveryTimeoutRef.current !== null) {
      window.clearTimeout(listenerMediaRecoveryTimeoutRef.current);
      listenerMediaRecoveryTimeoutRef.current = null;
    }
  }, []);

  const buildSourceRecoveryActionKey = useCallback(
    (sourcePeerId: string | null | undefined, mediaEpoch: number | null | undefined) => {
      const roomId = currentRoomRef.current?.room.id ?? roomSnapshot?.room.id ?? null;
      if (!roomId || !sourcePeerId || typeof mediaEpoch !== "number") {
        return null;
      }

      return `${roomId}|${sourcePeerId}|${mediaEpoch}`;
    },
    [currentRoomRef, roomSnapshot?.room.id]
  );

  const beginSourceHardRecoveryAction = useCallback(
    (
      sourcePeerId: string | null | undefined,
      mediaEpoch: number | null | undefined,
      action: SourceRecoveryCoordinatorState["action"]
    ) => {
      const actionKey = buildSourceRecoveryActionKey(sourcePeerId, mediaEpoch);
      if (!actionKey || !action) {
        return false;
      }

      const current = sourceRecoveryCoordinatorRef.current;
      if (current.actionKey && current.actionKey === actionKey && current.action) {
        const currentRank = getSourceRecoveryActionRank(current.action);
        const nextRank = getSourceRecoveryActionRank(action);
        const canEscalate =
          nextRank > currentRank &&
          (current.startedAtMs === null ||
            Date.now() - current.startedAtMs >= listenerHardRecoveryCooldownMs);
        if (!canEscalate) {
          return false;
        }
      }

      sourceRecoveryCoordinatorRef.current = {
        actionKey,
        action,
        startedAtMs: Date.now()
      };
      return true;
    },
    [buildSourceRecoveryActionKey]
  );

  const clearSourceHardRecoveryAction = useCallback(
    (sourcePeerId: string | null | undefined, mediaEpoch: number | null | undefined) => {
      const actionKey = buildSourceRecoveryActionKey(sourcePeerId, mediaEpoch);
      if (!actionKey) {
        sourceRecoveryCoordinatorRef.current = {
          actionKey: null,
          action: null,
          startedAtMs: null
        };
        return;
      }

      if (sourceRecoveryCoordinatorRef.current.actionKey !== actionKey) {
        return;
      }

      sourceRecoveryCoordinatorRef.current = {
        actionKey: null,
        action: null,
        startedAtMs: null
      };
    },
    [buildSourceRecoveryActionKey]
  );

  const resolveRemoteAudioContinuityState = useCallback(
    (now = Date.now()) => {
      const remoteAudio = remoteAudioRef.current;
      const remoteStream =
        (remoteAudio?.srcObject as MediaStream | null | undefined) ?? null;
      const remoteTrack =
        typeof remoteStream?.getAudioTracks === "function"
          ? (remoteStream.getAudioTracks()[0] ?? null)
          : null;
      const hasLiveRemoteTrack =
        !!remoteTrack && remoteTrack.enabled && remoteTrack.readyState !== "ended";
      const hasPlayableRemoteElement =
        !!remoteAudio &&
        !!remoteStream &&
        remoteAudio.paused === false &&
        remoteAudio.readyState >= 2;
      const hasRecentPlayoutProgress =
        listenerMediaLifecycleRef.current.lastPlayoutProgressAt !== null &&
        now - listenerMediaLifecycleRef.current.lastPlayoutProgressAt <=
          recentAudibleProgressGraceMs;
      const hasRecentTransportProgress =
        listenerMediaLifecycleRef.current.lastTransportProgressAt !== null &&
        now - listenerMediaLifecycleRef.current.lastTransportProgressAt <=
          recentAudibleProgressGraceMs;

      return {
        hasPlayableRemoteElement,
        hasLiveRemoteTrack,
        hasRecentPlayoutProgress,
        hasRecentTransportProgress,
        hasRecentRemoteProgress: hasRecentPlayoutProgress || hasRecentTransportProgress
      };
    },
    [remoteAudioRef]
  );

  const resolveCurrentAudibleSource = useCallback(
    (now = Date.now()): PeerDiagnosticsSnapshot["audibleSource"] => {
      const playback = currentRoomRef.current?.room.playback;
      if (isCurrentSourceOwner || playback?.status !== "playing") {
        return null;
      }

      if (activePlaybackSource === "progressive-local" || activePlaybackSource === "full-local") {
        return activePlaybackSource;
      }

      if (
        activePlaybackSource === "remote-stream" &&
        (() => {
          const remoteContinuity = resolveRemoteAudioContinuityState(now);
          return remoteContinuity.hasRecentRemoteProgress;
        })()
      ) {
        return "remote-stream";
      }

      return null;
    },
    [
      activePlaybackSource,
      currentRoomRef,
      isCurrentSourceOwner,
      resolveRemoteAudioContinuityState
    ]
  );

  const resolveSourceContinuityState = useCallback(
    (now = Date.now()) => {
      const audibleSource = resolveCurrentAudibleSource(now);
      const remoteContinuity = resolveRemoteAudioContinuityState(now);
      const lastAudibleProgressAtMs = listenerMediaLifecycleRef.current.lastPlayoutProgressAt;
      const lastMediaStatsProgressAtMs = listenerMediaLifecycleRef.current.lastTransportProgressAt;
      const lastDataActivityAtMs = lastDataActivityAtRef.current;
      const consecutiveNoProgressMs =
        audibleSource === "progressive-local" || audibleSource === "full-local"
          ? 0
          : resolveConsecutiveNoProgressMs(
              typeof lastAudibleProgressAtMs === "number" ? now - lastAudibleProgressAtMs : null,
              typeof lastMediaStatsProgressAtMs === "number"
                ? now - lastMediaStatsProgressAtMs
                : null
            );

      return {
        audibleSource,
        lastAudibleProgressAtMs,
        lastMediaStatsProgressAtMs,
        lastDataActivityAtMs,
        bufferingWhileAudible:
          audibleSource === "remote-stream" &&
          (mediaConnectionState === "buffering" || mediaConnectionState === "connecting"),
        remoteAudioPlayable: remoteContinuity.hasPlayableRemoteElement,
        remoteAudioRecentlyProgressing: remoteContinuity.hasRecentRemoteProgress,
        consecutiveNoProgressMs
      };
    },
    [mediaConnectionState, resolveCurrentAudibleSource, resolveRemoteAudioContinuityState]
  );

  const resolveSourceRecoverySuppressedReason = useCallback(
    (now = Date.now()) => {
      const playback = currentRoomRef.current?.room.playback;
      if (playback?.status !== "playing") {
        return null;
      }

      if (!isPageVisible) {
        return "page-hidden";
      }

      const continuity = resolveSourceContinuityState(now);
      const remoteNoProgressMs =
        continuity.consecutiveNoProgressMs ??
        (lastSubscribeAckAtRef.current !== null ? now - lastSubscribeAckAtRef.current : null);
      if (continuity.audibleSource === "progressive-local" || continuity.audibleSource === "full-local") {
        return "full-local-active";
      }

      if (
        continuity.audibleSource === "remote-stream" &&
        remoteNoProgressMs !== null &&
        remoteNoProgressMs < connectionSupervisorHardRecreateNoProgressFloorMs
      ) {
        return continuity.remoteAudioRecentlyProgressing
          ? "audible-progressing"
          : "protected-audible-source";
      }

      if (
        lastSubscribeAckAtRef.current !== null &&
        now - lastSubscribeAckAtRef.current < recoveryBootstrapGraceMs
      ) {
        return "bootstrap-grace";
      }

      return null;
    },
    [currentRoomRef, isPageVisible, resolveSourceContinuityState]
  );

  const resolveSoftRecoveryMediaState = useCallback(
    (fallback: "buffering" | "reconnecting" = "reconnecting") => {
      const continuity = resolveSourceContinuityState();
      if (continuity.audibleSource !== null || continuity.bufferingWhileAudible) {
        return "buffering" as const;
      }

      return fallback;
    },
    [resolveSourceContinuityState]
  );

  const getRemoteAudioDiagnostics = useCallback(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return {
        audioPaused: null,
        audioMuted: null,
        audioReadyState: null,
        hasSrcObject: null,
        currentSrc: null,
        audioVolume: null,
        trackId: null,
        trackMuted: null,
        trackEnabled: null,
        trackReadyState: null
      };
    }

    const audioTracks =
      typeof (remoteAudio.srcObject as MediaStream | null | undefined)?.getAudioTracks === "function"
        ? (remoteAudio.srcObject as MediaStream).getAudioTracks()
        : [];
    const primaryTrack = audioTracks[0] ?? null;

    return {
      audioPaused: remoteAudio.paused,
      audioMuted: remoteAudio.muted,
      audioReadyState: remoteAudio.readyState,
      hasSrcObject: !!remoteAudio.srcObject,
      currentSrc: remoteAudio.currentSrc || null,
      audioVolume: remoteAudio.volume,
      trackId: primaryTrack?.id ?? null,
      trackMuted: primaryTrack?.muted ?? null,
      trackEnabled: primaryTrack?.enabled ?? null,
      trackReadyState: primaryTrack?.readyState ?? null
    };
  }, [remoteAudioRef]);

  const getRemoteMediaTraceContext = useCallback(
    (remotePeerId?: string | null) => {
      const playback = currentRoomRef.current?.room.playback;
      const currentTrackId = playback?.currentTrackId ?? null;
      const mediaEpoch = playback?.mediaEpoch ?? null;
      const sourcePeerId = playback?.sourcePeerId ?? null;
      const resolvedRemotePeerId = remotePeerId ?? sourcePeerId ?? null;
      return {
        currentTrackId,
        mediaEpoch,
        sourcePeerId,
        remotePeerId: resolvedRemotePeerId,
        traceKey:
          currentTrackId && mediaEpoch !== null
            ? `${currentTrackId}|${mediaEpoch}|${sourcePeerId ?? "none"}|${peerId ?? "none"}`
            : null
      };
    },
    [currentRoomRef, peerId]
  );

  const updateRemoteMediaDiagnostic = useCallback(
    (
      summary: string,
      update?: (snapshot: PeerDiagnosticsSnapshot) => PeerDiagnosticsSnapshot,
      options?: { event?: string; recordEvent?: boolean; level?: "info" | "warning" | "error" }
    ) => {
      recordPeerDiagnosticRef.current({
        peerId: "remote-media",
        channelKind: "media",
        direction: "local",
        event: options?.event ?? "remote-media-state",
        summary,
        recordEvent: options?.recordEvent ?? false,
        level: options?.level,
        update
      });
    },
    []
  );

  useEffect(() => {
    const remoteAudio = remoteAudioRef.current;
    if (!remoteAudio) {
      return;
    }

    const syncRemoteAudioEvent = (
      eventName: "playing" | "waiting" | "pause" | "error",
      summary: string
    ) => {
      const traceContext = getRemoteMediaTraceContext();
      if (eventName === "playing") {
        listenerMediaLifecycleRef.current.lastPlayingTraceKey = traceContext.traceKey;
        listenerMediaLifecycleRef.current.playingGeneration = listenerMediaLifecycleRef.current.currentGeneration;
        listenerMediaLifecycleRef.current.recoveryStage = "idle";
        listenerMediaLifecycleRef.current.lastPlayoutProgressAt = Date.now();
        listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs =
          Number.isFinite(remoteAudio.currentTime) && remoteAudio.currentTime >= 0
            ? Math.round(remoteAudio.currentTime * 1000)
            : listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs;
        clearListenerMediaRecovery();
      }
        updateRemoteMediaDiagnostic(
          summary,
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState:
            eventName === "playing"
              ? "live"
              : eventName === "error"
                ? "failed"
                : "buffering",
          recoveryActionLevel:
            eventName === "playing"
              ? "observe"
              : eventName === "error"
                ? "hard-reconnect"
                : "observe",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics(),
              lastAudioEvent: eventName,
            currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
            boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
            playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
            recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
            restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
          }
        }),
        {
          event: `remote-audio-${eventName}`
        }
      );
      if (eventName !== "playing" && traceContext.traceKey) {
        armListenerMediaRecoveryRef.current(traceContext.traceKey);
      }
    };

    const handlePlaying = () => syncRemoteAudioEvent("playing", "远端音频元素开始播放");
    const handleWaiting = () => syncRemoteAudioEvent("waiting", "远端音频元素进入等待");
    const handlePause = () => syncRemoteAudioEvent("pause", "远端音频元素暂停");
    const handleError = () => syncRemoteAudioEvent("error", "远端音频元素播放失败");

    remoteAudio.addEventListener("playing", handlePlaying);
    remoteAudio.addEventListener("waiting", handleWaiting);
    remoteAudio.addEventListener("pause", handlePause);
    remoteAudio.addEventListener("error", handleError);

    return () => {
      remoteAudio.removeEventListener("playing", handlePlaying);
      remoteAudio.removeEventListener("waiting", handleWaiting);
      remoteAudio.removeEventListener("pause", handlePause);
      remoteAudio.removeEventListener("error", handleError);
    };
  }, [
    clearListenerMediaRecovery,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    remoteAudioRef,
    updateRemoteMediaDiagnostic
  ]);

  const resetRemoteAudioElement = useCallback(
    (
      stream: MediaStream | null,
      options?: { deferNullReset?: boolean; generation?: string | null; reason?: string }
    ) => {
      const remoteAudio = remoteAudioRef.current;
      if (!remoteAudio) {
        return;
      }
      const lifecycle = listenerMediaLifecycleRef.current;
      const generation = options?.generation ?? lifecycle.currentGeneration;

      if (stream) {
        if (generation && lifecycle.currentGeneration && generation !== lifecycle.currentGeneration) {
          return;
        }
        clearPendingRemoteStreamClear();
        const traceContext = getRemoteMediaTraceContext();
        if (remoteAudio.srcObject !== stream) {
          remoteAudio.pause();
          if (remoteAudio.srcObject) {
            remoteAudio.srcObject = null;
          }
          remoteAudio.srcObject = stream;
        }
        lifecycle.latestStream = stream;
        lifecycle.boundGeneration = generation ?? null;
        lifecycle.bindAttempts += 1;
        listenerMediaLifecycleRef.current.lastBoundTraceKey = traceContext.traceKey;
        updateRemoteMediaDiagnostic(
          options?.reason ? `远端音频元素已绑定新流：${options.reason}` : "远端音频元素已绑定新流",
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "buffering",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics()
            ,
              boundToAudioElement: true,
              lastBoundAt: new Date().toISOString(),
              boundGeneration: generation ?? null,
              currentGeneration: lifecycle.currentGeneration,
              recoveryStage: lifecycle.recoveryStage,
              restartAttempt: lifecycle.restartAttempt
            }
          }),
          {
            event: "remote-audio-element-state"
          }
        );
        return;
      }

      const clearStream = () => {
        if (generation && listenerMediaLifecycleRef.current.currentGeneration !== generation) {
          remoteStreamClearTimeoutRef.current = null;
          return;
        }
        remoteAudio.pause();
        if (remoteAudio.srcObject) {
          remoteAudio.srcObject = null;
        }
        remoteAudio.load();
        remoteStreamClearTimeoutRef.current = null;
        listenerMediaLifecycleRef.current.latestStream = null;
        listenerMediaLifecycleRef.current.boundGeneration = null;
        updateRemoteMediaDiagnostic(
          "远端音频元素已清空媒体流",
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "idle",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...getRemoteMediaTraceContext(),
              ...getRemoteAudioDiagnostics(),
              boundToAudioElement: false,
              boundGeneration: null,
              currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
              recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
            },
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              mediaTransportState: snapshot.progressivePlaybackStatus?.mediaTransportState ?? "idle",
              dataRequiredForPlayback: enableTrackCaching,
              firstAudibleAt: snapshot.progressivePlaybackStatus?.firstAudibleAt ?? null
            }
          }),
          {
            event: "remote-audio-element-state"
          }
        );
      };

      if (options?.deferNullReset && remoteAudio.srcObject) {
        clearPendingRemoteStreamClear();
        remoteStreamClearTimeoutRef.current = window.setTimeout(
          clearStream,
          remoteStreamSwapGraceMs
        );
        return;
      }

      clearPendingRemoteStreamClear();
      clearStream();
    },
    [
      clearPendingRemoteStreamClear,
      getRemoteAudioDiagnostics,
      getRemoteMediaTraceContext,
      remoteAudioRef,
      updateRemoteMediaDiagnostic
    ]
  );

  const clearHostMediaSyncRetry = useCallback(() => {
    if (hostMediaSyncRetryRef.current !== null) {
      window.clearTimeout(hostMediaSyncRetryRef.current);
      hostMediaSyncRetryRef.current = null;
    }
  }, []);

  const getSilentPrewarmHandle = useCallback(() => {
    if (!silentPrewarmHandleRef.current) {
      silentPrewarmHandleRef.current = createSilentPrewarmHandle();
    }

    return silentPrewarmHandleRef.current;
  }, []);

  const disposeSilentPrewarmHandle = useCallback(() => {
    silentPrewarmHandleRef.current?.close();
    silentPrewarmHandleRef.current = null;
  }, []);

  const bumpMediaTransportEpoch = useCallback(
    (
      reason: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none" = "explicit-hard-reset"
    ) => {
      transportResetReasonRef.current = reason;
      mediaTransportEpochRef.current += 1;
      return mediaTransportEpochRef.current;
    },
    []
  );

  const updateSourceStartState = useCallback(
    (
      nextState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed",
      options?: { error?: string | null; recordEvent?: boolean; summary?: string; level?: "info" | "warning" | "error" }
    ) => {
      setSourceStartStateRef.current(nextState);
      sourceStartStateRef.current = nextState;
      const nextError = options?.error ?? null;
      setLastSourceStartErrorRef.current(nextError);
      lastSourceStartErrorRef.current = nextError;
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: `source-start-${nextState}`,
        summary:
          options?.summary ??
          (nextState === "awaiting-unlock"
            ? "音源端等待本机音频解锁"
            : nextState === "starting"
              ? "音源端正在启动本地音频"
              : nextState === "live"
                ? "音源端已开始稳定分发"
                : nextState === "failed"
                  ? "音源端本机音频启动失败"
                  : "音源端处于待机状态"),
        level: options?.level ?? (nextState === "failed" ? "error" : "info"),
        recordEvent: options?.recordEvent ?? false,
        update: (snapshot) => ({
          ...snapshot,
          lastError: nextState === "failed" && nextError ? `音源端启动失败：${nextError}` : snapshot.lastError,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            audioUnlocked: audioUnlockedRef.current,
            sourceStartState: nextState,
            lastSourceStartError: nextError,
            hostPublishingReady: nextState === "live",
            mediaBootstrapState:
              nextState === "live"
                ? "steady"
                : nextState === "starting"
                  ? "bootstrapping"
                  : nextState === "failed"
                    ? "failed"
                    : snapshot.progressivePlaybackStatus?.mediaBootstrapState ?? "idle"
          }
        })
      });
    },
    []
  );

  const updateHostCaptureDiagnostics = useCallback(
    (input: {
      refreshKey: string | null;
      forcedRefresh: boolean;
      captureMode: "native" | "audio-context" | null;
      mediaEpoch: number | null;
      transportEpoch?: number | null;
      mediaTransportState?: MediaTransportState | null;
      usingSilentPrewarmTrack?: boolean;
      publishedTrackKind?: HostPublishedTrackKind | null;
      hostPublishSource?: HostPublishSourceTarget | null;
      hostPublishReadiness?: HostPublishReadiness | null;
      hostPublishFailureReason?: string | null;
      resolvedPublishElement?: ResolvedPublishElement | null;
      resolvedPublishStreamKind?: ResolvedPublishStreamKind | null;
      mediaBootstrapState?: "idle" | "bootstrapping" | "recovering" | "failed" | "steady" | null;
      mediaFailureReason?: string | null;
      transportResetReason?: "source-changed" | "socket-reconnect" | "explicit-hard-reset" | "none" | null;
      hostPublishingReady?: boolean;
      listenerRecoveryAttempt?: number | null;
      mediaNegotiationRole?: "publisher" | "listener" | null;
      listenerAwaitingPublisherOffer?: boolean;
      lastIgnoredOfferReason?: "offer-collision" | "stale-generation" | "wrong-role" | "none" | null;
      publisherBootstrapRequestedAt?: string | null;
      publisherBootstrapAttempts?: number | null;
      dataRequiredForPlayback?: boolean;
      firstTransportConnectedAt?: string | null;
      firstAudibleAt?: string | null;
      captureTrackState?: ReturnType<typeof getHostMediaStreamTrackState> | null;
      publishGeneration?: number | null;
      publishKey?: string | null;
      publishStage?: HostPublishStage;
      publishedListenerSet?: string | null;
      attachedTrackId?: string | null;
      negotiatedTrackId?: string | null;
      makingOffer?: boolean | null;
      signalingState?: string | null;
      summary: string;
    }) => {
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "host-capture-state",
        summary: input.summary,
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          progressivePlaybackStatus: {
            ...(
              snapshot.progressivePlaybackStatus ??
              createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
            ),
            hostCaptureRefreshKey: input.refreshKey,
            hostCaptureForcedRefresh: input.forcedRefresh,
            hostCaptureMode: input.captureMode,
            hostCaptureMediaEpoch: input.mediaEpoch,
            mediaTransportState:
              input.mediaTransportState ??
              snapshot.progressivePlaybackStatus?.mediaTransportState ??
              "idle",
            transportEpoch:
              input.transportEpoch ?? snapshot.progressivePlaybackStatus?.transportEpoch ?? null,
            usingSilentPrewarmTrack:
              input.usingSilentPrewarmTrack ??
              snapshot.progressivePlaybackStatus?.usingSilentPrewarmTrack ??
              false,
            publishedTrackKind:
              input.publishedTrackKind ??
              snapshot.progressivePlaybackStatus?.publishedTrackKind ??
              "none",
            hostPublishSource:
              input.hostPublishSource ??
              snapshot.progressivePlaybackStatus?.hostPublishSource ??
              "none",
            hostPublishReadiness:
              input.hostPublishReadiness ??
              snapshot.progressivePlaybackStatus?.hostPublishReadiness ??
              "idle",
            hostPublishFailureReason:
              input.hostPublishFailureReason ??
              snapshot.progressivePlaybackStatus?.hostPublishFailureReason ??
              null,
            resolvedPublishElement:
              input.resolvedPublishElement ??
              snapshot.progressivePlaybackStatus?.resolvedPublishElement ??
              "none",
            resolvedPublishStreamKind:
              input.resolvedPublishStreamKind ??
              snapshot.progressivePlaybackStatus?.resolvedPublishStreamKind ??
              "none",
            mediaBootstrapState:
              input.mediaBootstrapState ??
              snapshot.progressivePlaybackStatus?.mediaBootstrapState ??
              "idle",
            mediaFailureReason:
              input.mediaFailureReason ??
              snapshot.progressivePlaybackStatus?.mediaFailureReason ??
              null,
            transportResetReason:
              input.transportResetReason ??
              snapshot.progressivePlaybackStatus?.transportResetReason ??
              transportResetReasonRef.current,
            hostPublishingReady:
              input.hostPublishingReady ??
              snapshot.progressivePlaybackStatus?.hostPublishingReady ??
              false,
            listenerRecoveryAttempt:
              input.listenerRecoveryAttempt ??
              snapshot.progressivePlaybackStatus?.listenerRecoveryAttempt ??
              null,
            mediaNegotiationRole:
              input.mediaNegotiationRole ??
              snapshot.progressivePlaybackStatus?.mediaNegotiationRole ??
              null,
            listenerAwaitingPublisherOffer:
              input.listenerAwaitingPublisherOffer ??
              snapshot.progressivePlaybackStatus?.listenerAwaitingPublisherOffer ??
              false,
            lastIgnoredOfferReason:
              input.lastIgnoredOfferReason ??
              snapshot.progressivePlaybackStatus?.lastIgnoredOfferReason ??
              "none",
            publisherBootstrapRequestedAt:
              input.publisherBootstrapRequestedAt ??
              snapshot.progressivePlaybackStatus?.publisherBootstrapRequestedAt ??
              null,
            publisherBootstrapAttempts:
              input.publisherBootstrapAttempts ??
              snapshot.progressivePlaybackStatus?.publisherBootstrapAttempts ??
              null,
            dataRequiredForPlayback:
              input.dataRequiredForPlayback ??
              snapshot.progressivePlaybackStatus?.dataRequiredForPlayback ??
              enableTrackCaching,
            firstTransportConnectedAt:
              input.firstTransportConnectedAt ??
              snapshot.progressivePlaybackStatus?.firstTransportConnectedAt ??
              null,
            firstAudibleAt:
              input.firstAudibleAt ??
              snapshot.progressivePlaybackStatus?.firstAudibleAt ??
              null,
            hostCaptureTrackId: input.captureTrackState?.trackId ?? null,
            hostCaptureTrackMuted: input.captureTrackState?.trackMuted ?? null,
            hostCaptureTrackEnabled: input.captureTrackState?.trackEnabled ?? null,
            hostCaptureTrackReadyState: input.captureTrackState?.trackReadyState ?? null,
            hostCaptureTrackCount: input.captureTrackState?.trackCount ?? null,
            publishGeneration: input.publishGeneration ?? null,
            hostPublishKey: input.publishKey ?? null,
            hostPublishStage: input.publishStage ?? "idle",
            hostPublishedListenerSet: input.publishedListenerSet ?? null,
            attachedTrackId: input.attachedTrackId ?? null,
            negotiatedTrackId: input.negotiatedTrackId ?? null,
            makingOffer: input.makingOffer ?? null,
            signalingState: input.signalingState ?? null
          }
        })
      });
    },
    []
  );

  const stopPresenceHeartbeat = useCallback(() => {
    if (presenceIntervalRef.current !== null) {
      window.clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
    }
  }, []);

  const stopRoomSnapshotWatchdog = useCallback(() => {
    if (roomSnapshotWatchdogIntervalRef.current !== null) {
      window.clearInterval(roomSnapshotWatchdogIntervalRef.current);
      roomSnapshotWatchdogIntervalRef.current = null;
    }
  }, []);

  const stopRecoveryWatchdog = useCallback(() => {
    if (recoveryWatchdogIntervalRef.current !== null) {
      window.clearInterval(recoveryWatchdogIntervalRef.current);
      recoveryWatchdogIntervalRef.current = null;
    }
  }, []);

  const emitPresence = useCallback(() => {
    const currentSession = activeSessionRef.current;
    const currentRoomId = currentRoomRef.current?.room.id;
    if (!currentRoomId || !currentSession?.userId || !peerId) {
      return;
    }

    socketRef.current?.emit("room.presence", {
      roomId: currentRoomId,
      sessionId: currentSession.userId,
      peerId
    });
  }, [activeSessionRef, currentRoomRef, peerId, socketRef]);

  const startPresenceHeartbeat = useCallback(() => {
    emitPresence();
    stopPresenceHeartbeat();
    presenceIntervalRef.current = window.setInterval(emitPresence, 10_000);
  }, [emitPresence, stopPresenceHeartbeat]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession, activeSessionRef]);

  useEffect(() => {
    currentRoomRef.current = roomSnapshot;
  }, [roomSnapshot, currentRoomRef]);

  useEffect(() => {
    const roomId = roomSnapshot?.room.id ?? null;
    const sourcePeerId = roomSnapshot?.room.playback.sourcePeerId ?? null;
    const ownerKey = roomId ? `${roomId}|${sourcePeerId ?? "none"}` : null;
    if (!ownerKey) {
      mediaTransportOwnerKeyRef.current = null;
      mediaTransportEpochRef.current = 0;
      return;
    }

    if (mediaTransportOwnerKeyRef.current === null) {
      mediaTransportOwnerKeyRef.current = ownerKey;
      return;
    }

    if (mediaTransportOwnerKeyRef.current !== ownerKey) {
      mediaTransportOwnerKeyRef.current = ownerKey;
      const nextTransportEpoch = bumpMediaTransportEpoch("source-changed");
      mediaMeshRef.current?.setTransportEpoch(nextTransportEpoch);
      hostMediaSyncStateRef.current.lastAppliedKey = null;
      hostMediaSyncStateRef.current.pendingKey = null;
      missingListenerSinceRef.current.clear();
      lastListenerBootstrapKeyRef.current = null;
    }
  }, [bumpMediaTransportEpoch, roomSnapshot?.room.id, roomSnapshot?.room.playback.sourcePeerId]);

  useEffect(() => {
    missingListenerSinceRef.current.clear();
    lastListenerBootstrapKeyRef.current = null;
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourcePeerId
  ]);

  useEffect(() => {
    recoveryGenerationRef.current = roomRecoveryState.generation;
    recoveryModeRef.current = roomRecoveryState.mode;
    roomRecoveryStateRef.current = roomRecoveryState;
  }, [roomRecoveryState]);

  useEffect(() => {
    activePlaybackSourceRef.current = activePlaybackSource;
  }, [activePlaybackSource]);

  useEffect(() => {
    recordPeerDiagnosticRef.current({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "room-recovery-state",
      summary: `恢复阶段 ${roomRecoveryState.phase}`,
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          recoveryPhase: roomRecoveryState.phase,
          recoveryMode: roomRecoveryState.mode,
          recoveryGeneration: roomRecoveryState.generation,
          bootstrapStartedAt: roomRecoveryState.bootstrapStartedAt,
          bootstrapSourcePeerId: roomRecoveryState.bootstrapSourcePeerId,
          pendingSnapshot: roomRecoveryState.pendingSnapshot,
          pendingData: roomRecoveryState.pendingData,
          pendingMedia: roomRecoveryState.pendingMedia,
          dataRequiredForPlayback: enableTrackCaching,
          listenerBootstrapAttempts: roomRecoveryState.listenerBootstrapAttempts,
          listenerRecoveryAttempt: roomRecoveryState.listenerBootstrapAttempts,
          fullLocalRecoveryActive: roomRecoveryState.fullLocalRecoveryActive
        }
      })
    });
  }, [roomRecoveryState]);

  useEffect(() => {
    if (roomSnapshot?.room.id) {
      return;
    }

    hostMediaClockSequenceRef.current = 0;
    setAuthoritativeMediaClock(null);
  }, [roomSnapshot?.room.id, setAuthoritativeMediaClock]);

  useEffect(() => {
    uploadedTrackIdsRef.current = uploadedTrackIds;
  }, [uploadedTrackIds, uploadedTrackIdsRef]);

  useEffect(() => {
    manualCacheTrackIdsRef.current = manualCacheTrackIds;
  }, [manualCacheTrackIds]);

  useEffect(() => {
    audioUnlockedRef.current = audioUnlocked;
  }, [audioUnlocked]);

  useEffect(() => {
    setAudioUnlockedRef.current = setAudioUnlocked;
  }, [setAudioUnlocked]);

  useEffect(() => {
    sourceStartStateRef.current = sourceStartState;
  }, [sourceStartState]);

  useEffect(() => {
    setSourceStartStateRef.current = setSourceStartState;
  }, [setSourceStartState]);

  useEffect(() => {
    lastSourceStartErrorRef.current = lastSourceStartError;
  }, [lastSourceStartError]);

  useEffect(() => {
    setLastSourceStartErrorRef.current = setLastSourceStartError;
  }, [setLastSourceStartError]);

  useEffect(() => {
    recordPeerDiagnosticRef.current({
      peerId: "system",
      channelKind: "system",
      direction: "local",
      event: "audio-unlock-state",
      summary: audioUnlocked ? "房间音频已解锁" : "房间音频尚未解锁",
      recordEvent: false,
      update: (snapshot) => ({
        ...snapshot,
        progressivePlaybackStatus: {
          ...(
            snapshot.progressivePlaybackStatus ??
            createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
          ),
          audioUnlocked,
          sourceStartState: sourceStartStateRef.current,
          lastSourceStartError: lastSourceStartErrorRef.current
        }
      })
    });
  }, [audioUnlocked]);

  useEffect(() => {
    announceLocalCacheRef.current = announceLocalCache;
  }, [announceLocalCache]);

  useEffect(() => {
    deleteUploadedTrackArtifactsRef.current = deleteUploadedTrackArtifacts;
  }, [deleteUploadedTrackArtifacts]);

  useEffect(() => {
    deleteRoomTrackArtifactsRef.current = deleteRoomTrackArtifacts;
  }, [deleteRoomTrackArtifacts]);

  useEffect(() => {
    scheduleTrackHydrationRef.current = scheduleTrackHydration;
  }, [scheduleTrackHydration]);

  useEffect(() => {
    resetPlayerSurfaceRef.current = resetPlayerSurface;
  }, [resetPlayerSurface]);

  useEffect(() => {
    queueAvailabilityRef.current = queueAvailability;
  }, [queueAvailability]);

  useEffect(() => {
    mergeLocalPieceAvailabilityRef.current = mergeLocalPieceAvailability;
  }, [mergeLocalPieceAvailability]);

  useEffect(() => {
    clearAvailabilityForPeerRef.current = clearAvailabilityForPeer;
  }, [clearAvailabilityForPeer]);

  useEffect(() => {
    flushPendingAvailabilityRef.current = flushPendingAvailability;
  }, [flushPendingAvailability]);

  useEffect(() => {
    recordPeerDiagnosticRef.current = recordPeerDiagnostic;
  }, [recordPeerDiagnostic]);

  useEffect(() => {
    return () => {
      disposeSilentPrewarmHandle();
    };
  }, [disposeSilentPrewarmHandle]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    if (!currentTrackId) {
      currentTrackAvailabilityProgressRef.current = null;
      return;
    }

    const localAvailability = availabilityByTrack[currentTrackId]?.[peerId];
    const totalChunks = resolveCurrentRoomTrackTotalChunks({
      trackId: currentTrackId,
      roomSnapshot,
      availabilityByTrack
    });
    const nextProgressKey = [
      currentTrackId,
      localAvailability?.availableChunks.length ?? 0,
      totalChunks
    ].join("|");

    if (currentTrackAvailabilityProgressRef.current !== nextProgressKey) {
      currentTrackAvailabilityProgressRef.current = nextProgressKey;
      lastAvailabilityGrowthAtRef.current = Date.now();
    }
  }, [availabilityByTrack, peerId, roomSnapshot?.room.playback.currentTrackId, roomSnapshot?.tracks]);

  const exitCurrentRoom = useCallback(
    (message: string) => {
      setIsNavigatingRoomExit(true);
      setSuppressRoomRecovery(true);
      dispatchRoomStateEvent({ type: "local-reset" });
      resetPlayerSurface();
      window.localStorage.removeItem(lastRoomStorageKey);
      setStatusMessage(message);
      if (workspaceOnly) {
        router.replace(workspaceEntryHref as Route);
        return;
      }

      setIsNavigatingRoomExit(false);
    },
    [
      lastRoomStorageKey,
      resetPlayerSurface,
      router,
      dispatchRoomStateEvent,
      setIsNavigatingRoomExit,
      setStatusMessage,
      setSuppressRoomRecovery,
      workspaceEntryHref,
      workspaceOnly
    ]
  );

  const applyResyncedRoomSnapshot = useCallback(
    (expectedRoomId: string, snapshot: RoomSnapshot, reason: RoomSnapshotResyncReason) => {
      if (
        snapshot.room.id !== expectedRoomId ||
        activeRouteRoomIdRef.current !== expectedRoomId
      ) {
        return;
      }

      dispatchRoomStateEvent({
        type: "recover-snapshot",
        snapshot
      });

      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "room-snapshot-resync",
        summary: `房间状态已全量刷新（${reason}）`,
        recordEvent: false
      });
    },
    [dispatchRoomStateEvent, recordPeerDiagnostic]
  );

  const handleRoomSnapshotResyncError = useCallback(
    (roomId: string, reason: RoomSnapshotResyncReason, error: unknown) => {
      if (activeRouteRoomIdRef.current !== roomId || isNavigatingRoomExit) {
        return;
      }

      const message = toUserFacingError(error);
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "room-snapshot-resync-failed",
        level: "warning",
        summary: `房间状态刷新失败（${reason}）：${message}`,
        update: (snapshot) => ({
          ...snapshot,
          lastError: `房间状态刷新失败：${message}`
        })
      });

      if (
        message.includes("房间不存在") ||
        message.includes("已经被删除") ||
        message.includes("房间已不可用")
      ) {
        exitCurrentRoom("这个房间已不可用，请返回音乐房重新加入。");
        return;
      }

      setStatusMessage(`房间状态刷新失败：${message}`);
    },
    [exitCurrentRoom, isNavigatingRoomExit, recordPeerDiagnostic, setStatusMessage]
  );

  const roomSnapshotResyncController = useMemo(
    () =>
      createRoomSnapshotResyncController({
        loadSnapshot: (roomId: string) => musicRoomApi.getRoom(roomId),
        applySnapshot: applyResyncedRoomSnapshot,
        onError: handleRoomSnapshotResyncError
      }),
    [applyResyncedRoomSnapshot, handleRoomSnapshotResyncError]
  );

  useEffect(() => () => roomSnapshotResyncController.reset(), [roomSnapshotResyncController]);

  const requestRoomSnapshotResync = useCallback(
    async (reason: RoomSnapshotResyncReason, roomId = activeRouteRoomIdRef.current) => {
      if (
        !roomId ||
        !hydrated ||
        !activeSessionRef.current?.userId ||
        isNavigatingRoomExit
      ) {
        return;
      }

      await roomSnapshotResyncController.request(roomId, reason);
    },
    [activeSessionRef, hydrated, isNavigatingRoomExit, roomSnapshotResyncController]
  );

  const applySubscribeBootstrap = useCallback(
    (ack: RoomSubscribeAckPayload) => {
      if (!ack.bootstrap || ack.bootstrap.roomId !== activeRouteRoomIdRef.current) {
        return;
      }

      latestSubscribeBootstrapRef.current = ack.bootstrap;
      lastSubscribeAckAtRef.current = Date.now();
      const nextRecoveryMode =
        recoveryGenerationRef.current === null ? "late-join" : "rejoin";
      recoveryGenerationRef.current = ack.recoveryGeneration ?? null;
      recoveryModeRef.current = nextRecoveryMode;
      sourceRecoveryCoordinatorRef.current = {
        actionKey: null,
        action: null,
        startedAtMs: null
      };

      const currentMembers = currentRoomRef.current?.room.members ?? [];
      const mergedMembers = ack.bootstrap.members.map((member) => {
        const existing = currentMembers.find((entry) => entry.id === member.id);
        return {
          id: member.id,
          nickname: existing?.nickname ?? (member.role === "host" ? "房主" : "成员"),
          role: member.role,
          joinedAt: existing?.joinedAt ?? new Date().toISOString(),
          peerId: member.peerId ?? null,
          presenceState: member.presenceState
        };
      });

      dispatchRoomStateEvent({
        type: "subscribe-bootstrap",
        roomId: ack.bootstrap.roomId,
        members: mergedMembers,
        playback: ack.bootstrap.playback,
        presenceRevision: ack.bootstrap.presenceRevision,
        roomRevision: ack.bootstrap.roomRevision
      });

      const currentTrackId = ack.bootstrap.playback.currentTrackId ?? null;
      const hasFullLocalTrack =
        enableTrackCaching && !!(currentTrackId && uploadedTracks[currentTrackId]);
      setRoomRecoveryState((current) => ({
        ...current,
        phase: hasFullLocalTrack && audioUnlocked ? "playing-local-fallback" : "resyncing",
        mode: nextRecoveryMode,
        generation: ack.recoveryGeneration ?? null,
        bootstrapStartedAt: ack.serverNow ?? new Date().toISOString(),
        bootstrapSourcePeerId: ack.bootstrap?.playback.sourcePeerId ?? null,
        pendingSnapshot: true,
        pendingData: enableTrackCaching && !hasFullLocalTrack,
        pendingMedia: !hasFullLocalTrack,
        listenerBootstrapAttempts: current.listenerBootstrapAttempts ?? 0,
        fullLocalRecoveryActive: hasFullLocalTrack
      }));
    },
    [
      audioUnlocked,
      dispatchRoomStateEvent,
      setRoomRecoveryState,
      uploadedTracks
    ]
  );

  useEffect(() => {
    activeRouteRoomIdRef.current = initialRoomId;

    if (!workspaceOnly || !initialRoomId) {
      previousInitialRoomIdRef.current = initialRoomId;
      return;
    }

    if (previousInitialRoomIdRef.current === initialRoomId) {
      return;
    }

    previousInitialRoomIdRef.current = initialRoomId;
    initialRecoveryAttemptRef.current = null;
    setSuppressRoomRecovery(false);
    setIsRecoveringRoom(false);
    setIsNavigatingRoomExit(false);
    resetPlayerSurfaceRef.current();

    if (roomSnapshot?.room.id && roomSnapshot.room.id !== initialRoomId) {
      dispatchRoomStateEvent({ type: "local-reset" });
    }
  }, [
    dispatchRoomStateEvent,
    workspaceOnly,
    initialRoomId,
    roomSnapshot?.room.id,
    setIsNavigatingRoomExit,
    setIsRecoveringRoom,
    setSuppressRoomRecovery
  ]);

  const armListenerMediaRecovery = useCallback(
    (generation?: string | null) => {
      clearListenerMediaRecovery();

      const expectedGeneration = generation ?? listenerMediaLifecycleRef.current.currentGeneration;
      const playback = currentRoomRef.current?.room.playback;
      if (
        !expectedGeneration ||
        !playback?.currentTrackId ||
        playback.status !== "playing" ||
        isCurrentSourceOwner ||
        activePlaybackSource !== "remote-stream" ||
        !playback.sourcePeerId
      ) {
        return;
      }

      const lastProgressAt = Math.max(
        listenerMediaLifecycleRef.current.generationStartedAt ?? 0,
        listenerMediaLifecycleRef.current.lastPlayoutProgressAt ?? 0,
        listenerMediaLifecycleRef.current.lastTransportProgressAt ?? 0
      );
      const progressGapMs = lastProgressAt > 0 ? Date.now() - lastProgressAt : null;
      const remoteTrackReadyState = getRemoteAudioDiagnostics().trackReadyState;
      const recoveryDelayMs = resolveListenerRecoveryDelayMs({
        progressGapMs,
        remoteTrackReadyState
      });

      listenerMediaRecoveryTimeoutRef.current = window.setTimeout(() => {
        const lifecycle = listenerMediaLifecycleRef.current;
        const latestPlayback = currentRoomRef.current?.room.playback;
        const remoteAudio = remoteAudioRef.current;
        if (
          !latestPlayback?.currentTrackId ||
          latestPlayback.status !== "playing" ||
          lifecycle.currentGeneration !== expectedGeneration ||
          expectedGeneration !== lifecycle.traceKey
        ) {
          return;
        }

        const now = Date.now();
        const latestProgressAt = Math.max(
          lifecycle.generationStartedAt ?? 0,
          lifecycle.lastPlayoutProgressAt ?? 0,
          lifecycle.lastTransportProgressAt ?? 0
        );
        const latestProgressGapMs = latestProgressAt > 0 ? now - latestProgressAt : null;
        const remoteTrack =
          typeof (remoteAudio?.srcObject as MediaStream | null | undefined)?.getAudioTracks === "function"
            ? ((remoteAudio?.srcObject as MediaStream).getAudioTracks()[0] ?? null)
            : null;
        const reason = resolveListenerMediaRecoveryReason({
          traceKey: expectedGeneration,
          lastTrackTraceKey: lifecycle.lastTrackTraceKey,
          lastBoundTraceKey: lifecycle.lastBoundTraceKey,
          lastPlayAttemptTraceKey: lifecycle.lastPlayAttemptTraceKey,
          lastPlayAttemptResult: lifecycle.lastPlayAttemptResult,
          lastPlayingTraceKey: lifecycle.lastPlayingTraceKey,
          remoteAudioPaused: remoteAudio?.paused ?? null,
          hasBoundSrcObject: !!remoteAudio?.srcObject,
          remoteTrackMuted: remoteTrack?.muted ?? null,
          remoteTrackEnabled: remoteTrack?.enabled ?? null,
          remoteTrackReadyState: remoteTrack?.readyState ?? null
        });
        const hardRecoveryRequired =
          remoteTrack?.readyState === "ended" ||
          (typeof latestProgressGapMs === "number" &&
            latestProgressGapMs >= listenerHardRecoveryDelayMs);
        if (
          reason === "connected-but-no-track" &&
          !hardRecoveryRequired
        ) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        if (
          reason &&
          !hardRecoveryRequired &&
          typeof latestProgressGapMs === "number" &&
          latestProgressGapMs < listenerSoftRecoveryDelayMs
        ) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        const action = resolveListenerMediaRecoveryAction({
          reason,
          bindAttempts: lifecycle.bindAttempts,
          playAttempts: lifecycle.playAttempts
        });
        if (hardRecoveryRequired && !action) {
          lifecycle.recoveryStage = "waiting-track";
          setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
          updateRemoteMediaDiagnostic(
            `监听端等待连接监督恢复媒体链路${reason ? ` · ${reason}` : ""}`,
            (snapshot) => ({
              ...snapshot,
              mediaConnectionState: resolveSoftRecoveryMediaState("reconnecting"),
              recoveryActionLevel: "observe",
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                ...getRemoteMediaTraceContext(latestPlayback.sourcePeerId),
                ...getRemoteAudioDiagnostics(),
                currentGeneration: lifecycle.currentGeneration,
                boundGeneration: lifecycle.boundGeneration,
                playingGeneration: lifecycle.playingGeneration,
                recoveryStage: lifecycle.recoveryStage,
                restartAttempt: lifecycle.restartAttempt
              }
            }),
            {
              event: "remote-media-await-supervisor",
              recordEvent: false,
              level: "warning"
            }
          );
          return;
        }
        if (!action) {
          lifecycle.recoveryStage = "idle";
          return;
        }
        const lastRecoveryTraceKey = lifecycle.lastSoftRecoveryTraceKey;
        const lastRecoveryAt = lifecycle.lastSoftRecoveryAt;
        const recoveryCooldownMs = listenerSoftRecoveryCooldownMs;
        if (
          lastRecoveryTraceKey === expectedGeneration &&
          lastRecoveryAt !== null &&
          now - lastRecoveryAt < recoveryCooldownMs
        ) {
          armListenerMediaRecoveryRef.current(expectedGeneration);
          return;
        }

        lifecycle.lastSoftRecoveryTraceKey = expectedGeneration;
        lifecycle.lastSoftRecoveryAt = now;
        lifecycle.recoveryStage =
          action === "rebind-element"
            ? "rebind-element"
            : action === "rebind-and-play"
              ? "rebind-and-play"
              : "retry-play";

        updateRemoteMediaDiagnostic(
          `监听端执行媒体恢复：${action}${reason ? ` · ${reason}` : ""}`,
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: "buffering",
            recoveryActionLevel: "soft-media-retry",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...getRemoteMediaTraceContext(latestPlayback.sourcePeerId),
              ...getRemoteAudioDiagnostics(),
              currentGeneration: lifecycle.currentGeneration,
              boundGeneration: lifecycle.boundGeneration,
              playingGeneration: lifecycle.playingGeneration,
              recoveryStage: lifecycle.recoveryStage,
              restartAttempt: lifecycle.restartAttempt
            }
          }),
          {
            event: "remote-media-recover",
            recordEvent: true,
            level: "warning"
          }
        );

        if (lifecycle.latestStream) {
          resetRemoteAudioElement(lifecycle.latestStream, {
            generation: expectedGeneration,
            reason: action
          });
        }

        if (action === "retry-play" || action === "rebind-and-play") {
          scheduleRemotePlaybackRetryRef.current(0, expectedGeneration);
          return;
        }

        armListenerMediaRecoveryRef.current(expectedGeneration);
      }, recoveryDelayMs);
    },
    [
      activePlaybackSource,
      clearListenerMediaRecovery,
      currentRoomRef,
      getRemoteAudioDiagnostics,
      getRemoteMediaTraceContext,
      isCurrentSourceOwner,
      remoteAudioRef,
      resetRemoteAudioElement,
      resolveSoftRecoveryMediaState,
      updateRemoteMediaDiagnostic
    ]
  );

  const scheduleRemotePlaybackRetry = useCallback(
    (attempt = 0, expectedGeneration?: string | null) => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
        remotePlaybackRetryRef.current = null;
      }

      const remoteAudio = remoteAudioRef.current;
      const playback = currentRoomRef.current?.room.playback;

      if (
        !remoteAudio ||
        !remoteAudio.srcObject ||
        !playback?.currentTrackId ||
        playback.status !== "playing"
      ) {
        return;
      }
      const generation = expectedGeneration ?? listenerMediaLifecycleRef.current.currentGeneration;
      if (!generation || listenerMediaLifecycleRef.current.currentGeneration !== generation) {
        return;
      }
      listenerMediaLifecycleRef.current.playAttempts += 1;

      void roomAudioOutput.playElement(remoteAudio).then((result) => {
        const now = new Date().toISOString();
        const traceContext = getRemoteMediaTraceContext();
        listenerMediaLifecycleRef.current.lastPlayAttemptTraceKey = traceContext.traceKey;
        listenerMediaLifecycleRef.current.lastPlayAttemptResult = result.ok ? "ok" : "rejected";
        listenerMediaLifecycleRef.current.lastPlayAttemptError = result.ok
          ? null
          : result.error ?? "play-rejected";
        if (result.ok) {
          listenerMediaLifecycleRef.current.playingGeneration = generation;
          listenerMediaLifecycleRef.current.recoveryStage = "idle";
          listenerMediaLifecycleRef.current.lastPlayoutProgressAt = Date.now();
          listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs =
            Number.isFinite(remoteAudio.currentTime) && remoteAudio.currentTime >= 0
              ? Math.round(remoteAudio.currentTime * 1000)
              : listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs;
        }
        updateRemoteMediaDiagnostic(
          result.ok ? "远端音频自动拉起成功" : `远端音频自动拉起失败：${result.error ?? "未知错误"}`,
          (snapshot) => ({
            ...snapshot,
            mediaConnectionState: result.ok && remoteAudio.paused === false ? "live" : "buffering",
            recoveryActionLevel: result.ok ? "observe" : "soft-media-retry",
            remoteTrackStatus: {
              ...snapshot.remoteTrackStatus,
              ...traceContext,
              ...getRemoteAudioDiagnostics(),
              lastPlayAttemptAt: now,
              lastPlayAttemptResult: result.ok ? "ok" : "rejected",
              lastPlayAttemptError: result.ok ? null : result.error ?? "play-rejected",
              currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
              boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
              playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
              recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
              restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
            }
          }),
          {
            event: "remote-play-attempt",
            recordEvent: !result.ok,
            level: result.ok ? "info" : "warning"
          }
        );
        if (result.ok) {
          clearListenerMediaRecovery();
          return;
        }

        if (attempt >= maxRemotePlaybackRetryAttempts) {
          setStatusMessage("远端音频连接已建立，但播放未稳定，请点击一次播放继续。");
          return;
        }

        remotePlaybackRetryRef.current = window.setTimeout(() => {
          scheduleRemotePlaybackRetry(attempt + 1, generation);
        }, remotePlaybackRetryBackoffMs[Math.min(attempt, remotePlaybackRetryBackoffMs.length - 1)]);
      });
    },
    [
      clearListenerMediaRecovery,
      currentRoomRef,
      getRemoteAudioDiagnostics,
      getRemoteMediaTraceContext,
      remoteAudioRef,
      setStatusMessage,
      updateRemoteMediaDiagnostic
    ]
  );

  useEffect(() => {
    armListenerMediaRecoveryRef.current = armListenerMediaRecovery;
  }, [armListenerMediaRecovery]);

  const ensureMediaTransportConnected = useCallback(
    async (options?: { forceResync?: boolean; reason?: string; preferPublishedTrack?: boolean }) => {
      const forceResync = options?.forceResync ?? false;
      const currentRoom = currentRoomRef.current;
      if (
        !shouldManagePublishedMediaTransport({
          roomId: currentRoom?.room.id,
          peerId,
          isCurrentSourceOwner
        })
      ) {
        clearHostMediaSyncRetry();
        return;
      }
      if (!currentRoom) {
        clearHostMediaSyncRetry();
        return;
      }

      const playback = currentRoom.room.playback;
      const listenerPeerIds =
        currentRoom.room.members
          .map((member) => member.peerId)
          .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];
      const listenerSetHash = [...listenerPeerIds].sort().join(",");
      const transportEpoch = mediaTransportEpochRef.current;
      const syncState = hostMediaSyncStateRef.current;
      const { captureRefreshKey, forceRefresh: shouldForceCaptureRefresh } = resolveHostCaptureRefresh({
        currentTrackId: playback.currentTrackId,
        mediaEpoch: playback.mediaEpoch,
        activePlaybackSource,
        lastCaptureRefreshKey: syncState.lastCaptureRefreshKey
      });

      let publishKey: string | null = [
        currentRoom.room.id,
        transportEpoch,
        listenerSetHash,
        options?.preferPublishedTrack ? "publish" : "transport"
      ].join("|");

      if (!forceResync && (syncState.lastAppliedKey === publishKey || syncState.pendingKey === publishKey)) {
        return;
      }

      if (syncState.inFlight) {
        syncState.pendingKey = publishKey;
        return;
      }

      syncState.inFlight = true;
      syncState.pendingKey = publishKey;
      let awaitingLocalAudioTrack = false;
      let blockedUntilSourcePlaybackReady = false;

      try {
        if (listenerPeerIds.length === 0) {
          syncState.lastCaptureRefreshKey = null;
          syncState.lastPublishKey = null;
          syncState.lastPublishedListenerSet = null;
          syncState.stage = "idle";
          hostStreamRef.current = null;
          updateHostCaptureDiagnostics({
            refreshKey: null,
            forcedRefresh: false,
            captureMode: null,
            mediaEpoch: playback.mediaEpoch,
            transportEpoch,
            mediaTransportState: "idle",
            usingSilentPrewarmTrack: false,
            publishedTrackKind: "none",
            hostPublishSource: "none",
            hostPublishReadiness: "idle",
            hostPublishFailureReason: null,
            resolvedPublishElement: "none",
            resolvedPublishStreamKind: "none",
            mediaBootstrapState: "idle",
            mediaFailureReason: null,
            transportResetReason: transportResetReasonRef.current,
            hostPublishingReady: false,
            dataRequiredForPlayback: enableTrackCaching,
            captureTrackState: null,
            publishGeneration: syncState.publishGeneration,
            publishKey: null,
            publishStage: "idle",
            publishedListenerSet: null,
            summary: "房主媒体传输已停止，当前没有在线监听成员"
          });
          await mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch, transportEpoch);
          syncState.lastAppliedKey = publishKey;
          return;
        }

        const directRelayStream =
          typeof getHostRelayStream === "function" ? getHostRelayStream() : null;
        const shouldPublishCurrentTrack =
          options?.preferPublishedTrack !== false &&
          playback.status === "playing" &&
          !!playback.currentTrackId &&
          isCurrentSourceOwner;

        const currentTrackUpload =
          playback.currentTrackId && canUseUploadedTrackForPlayback(uploadedTracks[playback.currentTrackId] ?? null)
            ? uploadedTracks[playback.currentTrackId] ?? null
            : null;
        const hasPlayableLiveUpload = !!currentTrackUpload;
        const forceSourceOwnerLocalPublish = shouldForceSourceOwnerLocalPlayback({
          isCurrentSourceOwner,
          activePlaybackSource,
          hasFullLocalTrack: hasPlayableLiveUpload
        });
        const currentTrackObjectUrl = currentTrackUpload?.objectUrl ?? null;
        const publishSource = resolveHostPublishSource({
          activePlaybackSource,
          isCurrentSourceOwner,
          forceSourceOwnerLocalPlayback: forceSourceOwnerLocalPublish,
          localAudio: audioRef.current,
          remoteAudio: remoteAudioRef.current,
          hostRelayStream: directRelayStream,
          hasPlayableLiveUpload
        });
        const relayAudio = publishSource.audioElement;

        let usedForcedRefresh = shouldForceCaptureRefresh || forceResync;
        let selectedStream: MediaStream | null = null;
        let captureTrackState: ReturnType<typeof getHostMediaStreamTrackState> | null = null;
        let captureMode: "native" | "audio-context" | null =
          relayAudio ? getCapturedAudioStreamMode(relayAudio) : null;
        let mediaTransportState: MediaTransportState = "connected";
        let publishedTrackKind: HostPublishedTrackKind = "none";
        let usingSilentPrewarmTrack = false;
        let hostPublishSource: HostPublishSourceTarget = publishSource.publishTarget;
        let hostPublishReadiness: HostPublishReadiness = publishSource.readiness;
        let hostPublishFailureReason = publishSource.reason;
        let resolvedPublishElement: ResolvedPublishElement = publishSource.resolvedPublishElement;
        let resolvedPublishStreamKind: ResolvedPublishStreamKind =
          publishSource.resolvedPublishStreamKind;

        if (shouldPublishCurrentTrack && hostPublishReadiness !== "ready") {
          awaitingLocalAudioTrack = hostPublishReadiness === "awaiting-audio";
          blockedUntilSourcePlaybackReady = hostPublishReadiness !== "failed";
        }

        if (
          shouldPublishCurrentTrack &&
          !blockedUntilSourcePlaybackReady &&
          publishSource.publishTarget === "local-audio" &&
          relayAudio &&
          !isHostRelayAudioReadyForCapture({
            activePlaybackSource: "full-local",
            relayAudio,
            currentTrackObjectUrl
          })
        ) {
          blockedUntilSourcePlaybackReady = true;
          hostPublishReadiness = "awaiting-audio";
          hostPublishFailureReason = "local-audio-not-ready-for-capture";
        }

        if (shouldPublishCurrentTrack && !blockedUntilSourcePlaybackReady && (publishSource.stream || relayAudio)) {
          const preferAudioContextCapture = true;
          let capture =
            publishSource.stream ??
            captureAudioStream(relayAudio!, {
              forceRefresh: usedForcedRefresh,
              preferAudioContext: preferAudioContextCapture
            });
          captureTrackState = getHostMediaStreamTrackState(capture);

          if (
            playback.status === "playing" &&
            (publishSource.stream || isAudioElementEffectivelyPlaying(relayAudio)) &&
            !hasUsableHostMediaStreamTrack(capture)
          ) {
            usedForcedRefresh = true;
            capture =
              publishSource.stream ??
              captureAudioStream(relayAudio!, {
                forceRefresh: true,
                preferAudioContext: preferAudioContextCapture
              });
            captureTrackState = getHostMediaStreamTrackState(capture);
          }

          if (capture && hasUsableHostMediaStreamTrack(capture)) {
            selectedStream = capture;
            publishedTrackKind = publishSource.trackKind;
            mediaTransportState = "publishing";
            hostPublishReadiness = "ready";
          } else {
            awaitingLocalAudioTrack = true;
            blockedUntilSourcePlaybackReady = true;
            hostPublishReadiness = "awaiting-audio";
            hostPublishFailureReason = `${publishSource.publishTarget}-capture-track-unavailable`;
          }
        }

        if (!selectedStream) {
          const silentPrewarmHandle = getSilentPrewarmHandle();
          if (!silentPrewarmHandle?.stream) {
            syncState.stage = "idle";
            updateHostCaptureDiagnostics({
              refreshKey: captureRefreshKey,
              forcedRefresh: usedForcedRefresh,
              captureMode,
              mediaEpoch: playback.mediaEpoch,
              transportEpoch,
              mediaTransportState: "failed",
              usingSilentPrewarmTrack: false,
              publishedTrackKind: "none",
              hostPublishSource,
              hostPublishReadiness: "failed",
              hostPublishFailureReason: "silent-prewarm-creation-failed",
              resolvedPublishElement,
              resolvedPublishStreamKind,
              mediaBootstrapState: "failed",
              mediaFailureReason: "peer-closed-before-stream",
              transportResetReason: transportResetReasonRef.current,
              hostPublishingReady: false,
              dataRequiredForPlayback: enableTrackCaching,
              captureTrackState,
              publishGeneration: syncState.publishGeneration,
              publishKey: syncState.lastPublishKey,
              publishStage: "idle",
              publishedListenerSet: syncState.lastPublishedListenerSet,
              summary: "房主媒体预热失败，未能创建静音预热轨"
            });
            setStatusMessage("当前浏览器无法创建音频预热流，请使用最新版 Chrome 或 Edge。");
            return;
          }

          selectedStream = silentPrewarmHandle.stream;
          captureTrackState = getHostMediaStreamTrackState(selectedStream);
          usingSilentPrewarmTrack = true;
          publishedTrackKind = "silent-prewarm";
          mediaTransportState = "prewarming";
          resolvedPublishStreamKind = "silent-prewarm";
          syncState.stage = blockedUntilSourcePlaybackReady ? "waiting-source-audio" : "capture-ready";
          publishKey = [
            currentRoom.room.id,
            transportEpoch,
            listenerSetHash,
            "silent-prewarm"
          ].join("|");
          syncState.pendingKey = publishKey;
        } else {
          syncState.stage = "published";
          publishKey = buildHostPublishKey({
            currentTrackId: playback.currentTrackId,
            mediaEpoch: playback.mediaEpoch,
            sourcePeerId: playback.sourcePeerId ?? null,
            captureTrackId: captureTrackState?.trackId ?? null,
            listenerPeerIds
          });
          syncState.pendingKey = publishKey;
        }

        if (
          !usingSilentPrewarmTrack &&
          selectedStream &&
          shouldDeferHostMediaStreamSync({
            stream: selectedStream,
            listenerPeerCount: listenerPeerIds.length,
            playbackStatus: playback.status === "playing" ? "playing" : "idle"
          })
        ) {
          awaitingLocalAudioTrack = true;
          blockedUntilSourcePlaybackReady = true;
          const silentPrewarmHandle = getSilentPrewarmHandle();
          if (silentPrewarmHandle?.stream) {
            selectedStream = silentPrewarmHandle.stream;
            captureTrackState = getHostMediaStreamTrackState(selectedStream);
            usingSilentPrewarmTrack = true;
            publishedTrackKind = "silent-prewarm";
            mediaTransportState = "prewarming";
            resolvedPublishStreamKind = "silent-prewarm";
            syncState.stage = "waiting-source-audio";
            publishKey = [
              currentRoom.room.id,
              transportEpoch,
              listenerSetHash,
              "silent-prewarm"
            ].join("|");
            syncState.pendingKey = publishKey;
          }
        }

        syncState.lastCaptureRefreshKey = captureRefreshKey;
        hostStreamRef.current = selectedStream;
        lastHostCaptureRefreshAtRef.current = Date.now();
        await mediaMeshRef.current?.syncHostPeers(
          listenerPeerIds,
          selectedStream,
          playback.mediaEpoch,
          transportEpoch
        );

        if (publishKey && publishKey !== syncState.lastPublishKey) {
          syncState.publishGeneration += 1;
        }
        syncState.lastPublishKey = publishKey;
        syncState.lastPublishedListenerSet = listenerSetHash;

        updateHostCaptureDiagnostics({
          refreshKey: captureRefreshKey,
          forcedRefresh: usedForcedRefresh,
          captureMode,
          mediaEpoch: playback.mediaEpoch,
          transportEpoch,
          mediaTransportState,
          usingSilentPrewarmTrack,
          publishedTrackKind,
          hostPublishSource,
          hostPublishReadiness,
          hostPublishFailureReason,
          resolvedPublishElement,
          resolvedPublishStreamKind,
          mediaBootstrapState:
            publishedTrackKind === "host-capture" || publishedTrackKind === "relay-stream"
              ? "steady"
              : blockedUntilSourcePlaybackReady
                ? "recovering"
                : "bootstrapping",
          mediaFailureReason:
            blockedUntilSourcePlaybackReady ? hostPublishFailureReason ?? "no-playout-progress" : null,
          transportResetReason: transportResetReasonRef.current,
          hostPublishingReady:
            publishedTrackKind === "host-capture" || publishedTrackKind === "relay-stream",
          dataRequiredForPlayback: enableTrackCaching,
          captureTrackState,
          publishGeneration: syncState.publishGeneration,
          publishKey,
          publishStage: syncState.stage,
          publishedListenerSet: listenerSetHash,
          summary:
            publishedTrackKind === "host-capture" || publishedTrackKind === "relay-stream"
              ? "房主真实音轨已发布到当前监听集合"
              : blockedUntilSourcePlaybackReady
                ? `房主媒体链路已预热，等待真实音轨切入：${hostPublishFailureReason ?? hostPublishSource}`
                : "房主媒体链路已预连，当前使用静音预热轨保持连接"
        });

        clearHostMediaSyncRetry();
        syncState.lastAppliedKey = publishKey;
      } catch (error) {
        const message = toUserFacingError(error);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "host-media-sync-failed",
          level: "error",
          summary: `房主实时音频同步失败：${message}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: `房主实时音频同步失败：${message}`
          })
        });
        setStatusMessage("房主实时音频同步失败，已停止本次推流重试。");
        await mediaMeshRef.current?.syncHostPeers([], null, playback.mediaEpoch, transportEpoch).catch(
          () => undefined
        );
        hostStreamRef.current = null;
        lastHostCaptureRefreshAtRef.current = 0;
        syncState.lastCaptureRefreshKey = null;
        syncState.lastPublishKey = null;
        syncState.lastPublishedListenerSet = null;
        syncState.stage = "idle";
        updateHostCaptureDiagnostics({
          refreshKey: null,
          forcedRefresh: false,
          captureMode: null,
          mediaEpoch: playback.mediaEpoch,
          transportEpoch,
          mediaTransportState: "failed",
          usingSilentPrewarmTrack: false,
          publishedTrackKind: "none",
          hostPublishSource: "none",
          hostPublishReadiness: "failed",
          hostPublishFailureReason: message,
          resolvedPublishElement: "none",
          resolvedPublishStreamKind: "none",
          mediaBootstrapState: "failed",
          mediaFailureReason: "no-playout-progress",
          transportResetReason: transportResetReasonRef.current,
          hostPublishingReady: false,
          dataRequiredForPlayback: enableTrackCaching,
          captureTrackState: null,
          publishGeneration: syncState.publishGeneration,
          publishKey: null,
          publishStage: "idle",
          publishedListenerSet: null,
          summary: `房主实时音频同步失败：${message}`
        });
      } finally {
        const nextPendingKey = syncState.pendingKey;
        syncState.inFlight = false;

        if (awaitingLocalAudioTrack || blockedUntilSourcePlaybackReady) {
          clearHostMediaSyncRetry();
          hostMediaSyncRetryRef.current = window.setTimeout(() => {
            hostMediaSyncRetryRef.current = null;
            void ensureMediaTransportConnected({
              preferPublishedTrack: true
            });
          }, hostMediaSyncRetryDelayMs);
          syncState.pendingKey = null;
          return;
        }

        if (nextPendingKey && nextPendingKey !== syncState.lastAppliedKey) {
          syncState.pendingKey = null;
          queueMicrotask(() => {
            void ensureMediaTransportConnected({
              preferPublishedTrack: options?.preferPublishedTrack
            });
          });
          return;
        }

        syncState.pendingKey = null;
      }
    },
    [
      activePlaybackSource,
      activeSessionRef,
      audioRef,
      clearHostMediaSyncRetry,
      currentRoomRef,
      getHostRelayStream,
      getSilentPrewarmHandle,
      isCurrentSourceOwner,
      peerId,
      remoteAudioRef,
      setStatusMessage,
      uploadedTracks,
      updateHostCaptureDiagnostics
    ]
  );

  const syncHostMediaStream = useCallback(
    async (options?: { forceResync?: boolean; reason?: string }) => {
      await ensureMediaTransportConnected({
        ...options,
        preferPublishedTrack: true
      });
    },
    [ensureMediaTransportConnected]
  );

  const ensureSourcePlaybackStarted = useCallback(async () => {
    const currentRoom = currentRoomRef.current;
    if (!currentRoom?.room.id || !peerId || !isCurrentSourceOwner) {
      updateSourceStartState("idle");
      return;
    }

    const playback = currentRoom.room.playback;
    if (playback.status !== "playing" || !playback.currentTrackId) {
      updateSourceStartState("idle");
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (!audioUnlockedRef.current && !roomAudioOutput.isActivated()) {
      updateSourceStartState("awaiting-unlock", {
        summary: "音源端等待本机任意交互后自动启动",
        level: "warning"
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (!audioUnlockedRef.current && roomAudioOutput.isActivated()) {
      setAudioUnlockedRef.current(true);
      audioUnlockedRef.current = true;
    }

    const currentTrackUpload =
      playback.currentTrackId && canUseUploadedTrackForPlayback(uploadedTracks[playback.currentTrackId] ?? null)
        ? uploadedTracks[playback.currentTrackId] ?? null
        : null;
    const directRelayStream =
      typeof getHostRelayStream === "function" ? getHostRelayStream() : null;
    const publishSource = resolveHostPublishSource({
      activePlaybackSource,
      isCurrentSourceOwner,
      forceSourceOwnerLocalPlayback: shouldForceSourceOwnerLocalPlayback({
        isCurrentSourceOwner,
        activePlaybackSource,
        hasFullLocalTrack: !!currentTrackUpload
      }),
      localAudio: audioRef.current,
      remoteAudio: remoteAudioRef.current,
      hostRelayStream: directRelayStream,
      hasPlayableLiveUpload: !!currentTrackUpload
    });

    if (publishSource.publishTarget === "none") {
      updateSourceStartState("failed", {
        error: publishSource.reason ?? "missing-publish-source",
        summary: "音源端缺少可用的真实发布源",
        recordEvent: true,
        level: "error"
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (publishSource.readiness !== "ready") {
      const nextSummary =
        publishSource.readiness === "failed"
          ? `音源端已起播，但发布源不可用：${publishSource.reason ?? publishSource.publishTarget}`
          : `音源端已解锁，等待真实发布源就绪：${publishSource.reason ?? publishSource.publishTarget}`;
      updateSourceStartState(publishSource.readiness === "failed" ? "failed" : "starting", {
        error: publishSource.readiness === "failed" ? publishSource.reason ?? "publish-source-failed" : null,
        summary: nextSummary,
        recordEvent: publishSource.readiness === "failed",
        level: publishSource.readiness === "failed" ? "error" : "warning"
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: publishSource.readiness !== "failed"
      });
      return;
    }

    const publishAudio = publishSource.audioElement;
    const isElementPlaying = publishAudio ? isAudioElementEffectivelyPlaying(publishAudio) : true;
    if (!isElementPlaying) {
      updateSourceStartState("starting", {
        summary: `音源端已解锁，正在等待${publishSource.publishTarget}真正起播`
      });
      await ensureMediaTransportConnected({
        preferPublishedTrack: false
      });
      return;
    }

    if (!audioUnlockedRef.current) {
      setAudioUnlockedRef.current(true);
      audioUnlockedRef.current = true;
    }

    setLastSourceStartErrorRef.current(null);
    lastSourceStartErrorRef.current = null;
    await ensureMediaTransportConnected({
      preferPublishedTrack: true
    });
    updateSourceStartState(
      hostMediaSyncStateRef.current.stage === "published" ? "live" : "starting",
      hostMediaSyncStateRef.current.stage === "published"
        ? undefined
        : {
            summary: "音源端已起播，正在等待真实音轨完成发布"
          }
    );
  }, [
    activePlaybackSource,
    audioRef,
    currentRoomRef,
    ensureMediaTransportConnected,
    getHostRelayStream,
    isCurrentSourceOwner,
    peerId,
    remoteAudioRef,
    uploadedTracks,
    updateSourceStartState
  ]);

  useEffect(() => {
    const roomId = roomSnapshot?.room.id;
    const playback = roomSnapshot?.room.playback;
    if (
      !roomId ||
      !playback?.currentTrackId ||
      !peerId ||
      !isCurrentSourceOwner ||
      playback.sourcePeerId !== peerId
    ) {
      hostMediaClockSequenceRef.current = 0;
      return;
    }

    const listenerPeerIds =
      roomSnapshot.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];
    if (listenerPeerIds.length === 0) {
      return;
    }

    const emitRoomMediaClock = () => {
      const latestRoom = currentRoomRef.current;
      const socket = socketRef.current;
      const latestPlayback = latestRoom?.room.playback;
      if (
        !socket?.connected ||
        activeRouteRoomIdRef.current !== roomId ||
        !latestPlayback?.currentTrackId ||
        latestPlayback.sourcePeerId !== peerId
      ) {
        return;
      }

      const relayClockState =
        typeof getHostRelayClockState === "function" ? getHostRelayClockState() : null;
      const publishSource = resolveHostPublishSource({
        activePlaybackSource,
        isCurrentSourceOwner,
        forceSourceOwnerLocalPlayback: shouldForceSourceOwnerLocalPlayback({
          isCurrentSourceOwner,
          activePlaybackSource,
          hasFullLocalTrack:
            !!(
              latestPlayback.currentTrackId &&
              canUseUploadedTrackForPlayback(uploadedTracks[latestPlayback.currentTrackId] ?? null)
            )
        }),
        localAudio: audioRef.current,
        remoteAudio: remoteAudioRef.current,
        hostRelayStream: typeof getHostRelayStream === "function" ? getHostRelayStream() : null,
        hasPlayableLiveUpload:
          !!(
            latestPlayback.currentTrackId &&
            canUseUploadedTrackForPlayback(uploadedTracks[latestPlayback.currentTrackId] ?? null)
          )
      });
      const relayAudio = publishSource.audioElement;
      if (!relayAudio && !relayClockState) {
        return;
      }
      const localPlaybackPositionMs =
        relayClockState?.mediaTimeMs ??
        (activePlaybackSource !== "remote-stream" && typeof getLocalPlaybackPositionMs === "function"
          ? getLocalPlaybackPositionMs()
          : null);
      const fallbackMediaTimeMs =
        relayAudio && Number.isFinite(relayAudio.currentTime) && relayAudio.currentTime >= 0
          ? Math.round(relayAudio.currentTime * 1000)
          : null;
      const mediaTimeMs =
        typeof localPlaybackPositionMs === "number" && Number.isFinite(localPlaybackPositionMs)
          ? Math.max(0, Math.round(localPlaybackPositionMs))
          : fallbackMediaTimeMs;
      if (mediaTimeMs === null) {
        return;
      }

      const playbackRate =
        relayAudio && Number.isFinite(relayAudio.playbackRate) && relayAudio.playbackRate > 0
          ? relayAudio.playbackRate
          : 1;
      const advancing =
        relayClockState
          ? relayClockState.playoutState === "playing"
          : latestPlayback.status === "playing" &&
            (activePlaybackSource !== "remote-stream"
              ? typeof localPlaybackPositionMs === "number" ||
                isAudioElementEffectivelyPlaying(relayAudio)
              : isAudioElementEffectivelyPlaying(relayAudio));
      const payload: RoomMediaClockPayload = {
        roomId,
        mediaEpoch: latestPlayback.mediaEpoch,
        sourcePeerId: peerId,
        relayGeneration: hostMediaSyncStateRef.current.publishGeneration,
        mediaTimeMs,
        playbackRate,
        advancing,
        playoutState: relayClockState?.playoutState ?? (advancing ? "playing" : latestPlayback.status),
        bufferedAheadMs: relayClockState?.bufferedAheadMs ?? 0,
        sequence: ++hostMediaClockSequenceRef.current,
        emittedAt: new Date().toISOString()
      };
      socket.emit("room.media.clock", payload);
      setAuthoritativeMediaClock((current) => {
        if (
          current &&
          current.mediaEpoch === payload.mediaEpoch &&
          current.sourcePeerId === payload.sourcePeerId &&
          current.relayGeneration > payload.relayGeneration
        ) {
          return current;
        }

        if (
          current &&
          current.mediaEpoch === payload.mediaEpoch &&
          current.sourcePeerId === payload.sourcePeerId &&
          current.relayGeneration === payload.relayGeneration &&
          current.sequence > payload.sequence
        ) {
          return current;
        }

        return {
          ...payload,
          receivedAtMs: Date.now()
        };
      });
    };

    emitRoomMediaClock();
    let timerId = 0;
    const scheduleNextEmit = () => {
      const relayClockState =
        typeof getHostRelayClockState === "function" ? getHostRelayClockState() : null;
      timerId = window.setTimeout(() => {
        emitRoomMediaClock();
        scheduleNextEmit();
      }, resolveRoomMediaClockEmitIntervalMs({
        playbackStatus: playback.status,
        sourceStartState,
        relayPlayoutState: relayClockState?.playoutState ?? null
      }));
    };
    scheduleNextEmit();

    return () => {
      window.clearTimeout(timerId);
    };
  }, [
    activePlaybackSource,
    audioRef,
    currentRoomRef,
    getHostRelayClockState,
    getHostRelayStream,
    getLocalPlaybackPositionMs,
    isCurrentSourceOwner,
    peerId,
    remoteAudioRef,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback,
    setAuthoritativeMediaClock,
    socketRef,
    sourceStartState,
    uploadedTracks
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const traceContext =
      !isCurrentSourceOwner &&
      activePlaybackSource === "remote-stream" &&
      playback?.status === "playing" &&
      playback.currentTrackId
        ? getRemoteMediaTraceContext(playback.sourcePeerId)
        : {
            currentTrackId: null,
            mediaEpoch: null,
            sourcePeerId: null,
            traceKey: null
          };
    const lifecycle = listenerMediaLifecycleRef.current;
    if (lifecycle.traceKey === traceContext.traceKey) {
      return;
    }

    lifecycle.traceKey = traceContext.traceKey;
    lifecycle.lastTrackTraceKey = null;
    lifecycle.lastBoundTraceKey = null;
    lifecycle.lastPlayAttemptTraceKey = null;
    lifecycle.lastPlayAttemptResult = null;
    lifecycle.lastPlayAttemptError = null;
    lifecycle.lastPlayingTraceKey = null;
    lifecycle.lastSoftRecoveryTraceKey = null;
    lifecycle.lastSoftRecoveryAt = null;
    lifecycle.lastHardRecoveryTraceKey = null;
    lifecycle.lastHardRecoveryAt = null;
    lifecycle.latestStream = null;
    lifecycle.currentGeneration = traceContext.traceKey;
    lifecycle.generationStartedAt = traceContext.traceKey ? Date.now() : null;
    lifecycle.boundGeneration = null;
    lifecycle.playingGeneration = null;
    lifecycle.lastPlayoutProgressAt = null;
    lifecycle.lastTransportProgressAt = null;
    lifecycle.lastObservedRemoteCurrentTimeMs = null;
    lifecycle.recoveryStage = traceContext.traceKey ? "waiting-track" : "idle";
    lifecycle.restartAttempt = 0;
    lifecycle.bindAttempts = 0;
    lifecycle.playAttempts = 0;
    clearListenerMediaRecovery();

    updateRemoteMediaDiagnostic(
      traceContext.traceKey ? "监听端播放 trace 已切换" : "监听端播放 trace 已清空",
      (snapshot) => ({
        ...snapshot,
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          ...traceContext,
          ...getRemoteAudioDiagnostics(),
          currentGeneration: traceContext.traceKey,
          boundGeneration: null,
          playingGeneration: null,
          recoveryStage: lifecycle.recoveryStage,
          restartAttempt: lifecycle.restartAttempt
        }
      }),
      {
        event: "remote-media-trace"
      }
    );
    if (traceContext.traceKey) {
      armListenerMediaRecoveryRef.current(traceContext.traceKey);
    }
  }, [
    activePlaybackSource,
    armListenerMediaRecovery,
    clearListenerMediaRecovery,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    isCurrentSourceOwner,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourcePeerId,
    roomSnapshot?.room.playback.status,
    updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    if (
      !roomSnapshot?.room.id ||
      !peerId ||
      isCurrentSourceOwner ||
      activePlaybackSource !== "remote-stream" ||
      playback?.status !== "playing" ||
      !playback.currentTrackId ||
      !playback.sourcePeerId
    ) {
      clearListenerMediaRecovery();
      return;
    }

    const traceContext = getRemoteMediaTraceContext(playback.sourcePeerId);
    if (!traceContext.traceKey) {
      clearListenerMediaRecovery();
      return;
    }
    armListenerMediaRecoveryRef.current(traceContext.traceKey);

    return () => {
      clearListenerMediaRecovery();
    };
  }, [
    activePlaybackSource,
    armListenerMediaRecovery,
    clearListenerMediaRecovery,
    getRemoteMediaTraceContext,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourcePeerId,
    roomSnapshot?.room.playback.status
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    if (
      !roomSnapshot?.room.id ||
      !peerId ||
      isCurrentSourceOwner ||
      activePlaybackSource !== "remote-stream" ||
      playback?.status !== "playing"
    ) {
      listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs = null;
      return;
    }

    const timerId = window.setInterval(() => {
      const remoteAudio = remoteAudioRef.current;
      if (!remoteAudio?.srcObject || remoteAudio.paused) {
        return;
      }

      const currentTimeMs =
        Number.isFinite(remoteAudio.currentTime) && remoteAudio.currentTime >= 0
          ? Math.round(remoteAudio.currentTime * 1000)
          : null;
      if (currentTimeMs === null) {
        return;
      }

      const previousTimeMs = listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs;
      listenerMediaLifecycleRef.current.lastObservedRemoteCurrentTimeMs = currentTimeMs;
      if (previousTimeMs === null || currentTimeMs > previousTimeMs + 20) {
        listenerMediaLifecycleRef.current.lastPlayoutProgressAt = Date.now();
        if (playback?.sourcePeerId) {
          updateConnectionSupervisorPlayout(playback.sourcePeerId);
        }
      }
    }, listenerMediaSupervisorIntervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    activePlaybackSource,
    isCurrentSourceOwner,
    peerId,
    remoteAudioRef,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.status,
    updateConnectionSupervisorPlayout
  ]);

  const updateDataTransportStats = useCallback(
    (input: {
      peerId: string;
      sample: {
        candidateType: string | null;
        protocol: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
        mediaReceiveBitrateKbps: number | null;
        mediaSendBitrateKbps: number | null;
        packetLossRate?: number | null;
        packetsLost?: number | null;
        jitterMs: number | null;
      };
    }) => {
      const supervisorState = updateConnectionSupervisorTransport({
        peerId: input.peerId,
        channelKind: "data",
        sample: input.sample
      });
      const pieceTransferRates = getPieceTransferRates(pieceTransferRatesRef.current, input.peerId);
      const hasRecentDataActivity =
        (typeof pieceTransferRates.downloadRateKbps === "number" &&
          pieceTransferRates.downloadRateKbps > 0) ||
        (typeof pieceTransferRates.uploadRateKbps === "number" &&
          pieceTransferRates.uploadRateKbps > 0);
      if (hasRecentDataActivity) {
        lastDataActivityAtRef.current = Date.now();
      }
      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "data",
        direction: "local",
        event: "transport-stats",
        summary: "Data transport stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
            dataCandidateType: input.sample.candidateType ?? snapshot.dataCandidateType,
            currentRoundTripTimeMs:
              input.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
            availableOutgoingBitrateKbps:
              input.sample.availableOutgoingBitrateKbps ??
              snapshot.availableOutgoingBitrateKbps,
            pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
            pieceUploadRateKbps: pieceTransferRates.uploadRateKbps,
            lastDataActivityAt: formatDiagnosticsTimestamp(lastDataActivityAtRef.current)
          })
        })
      });
    },
    [recordPeerDiagnostic, updateConnectionSupervisorTransport]
  );

  const updateMediaTransportStats = useCallback(
    (input: {
      peerId: string;
      sample: {
        candidateType: string | null;
        protocol: string | null;
        currentRoundTripTimeMs: number | null;
        availableOutgoingBitrateKbps: number | null;
        targetAudioBitrateKbps?: number | null;
        packetLossRate?: number | null;
        receiverJitterTargetMs?: number | null;
        mediaReceiveBitrateKbps: number | null;
        mediaSendBitrateKbps: number | null;
        packetsLost: number | null;
        jitterMs: number | null;
      };
    }) => {
      const now = Date.now();
      const currentPlayback = currentRoomRef.current?.room.playback;
      const hasInboundMediaProgress =
        typeof input.sample.mediaReceiveBitrateKbps === "number" &&
        input.sample.mediaReceiveBitrateKbps > 0;
      const hasOutboundMediaProgress =
        typeof input.sample.mediaSendBitrateKbps === "number" &&
        input.sample.mediaSendBitrateKbps > 0;
      if (
        (currentPlayback?.sourcePeerId === input.peerId && hasInboundMediaProgress) ||
        (isCurrentSourceOwner && hasOutboundMediaProgress)
      ) {
        listenerMediaLifecycleRef.current.lastTransportProgressAt = now;
      }

      const supervisorState = updateConnectionSupervisorTransport({
        peerId: input.peerId,
        channelKind: "media",
        sample: input.sample
      });

      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "media",
        direction: "local",
        event: "transport-stats",
        summary: "Media transport stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
            mediaCandidateType: input.sample.candidateType ?? snapshot.mediaCandidateType,
            mediaProtocol: input.sample.protocol ?? snapshot.mediaProtocol,
            currentRoundTripTimeMs:
              input.sample.currentRoundTripTimeMs ?? snapshot.currentRoundTripTimeMs,
            availableOutgoingBitrateKbps:
              input.sample.availableOutgoingBitrateKbps ??
              snapshot.availableOutgoingBitrateKbps,
            targetAudioBitrateKbps:
              input.sample.targetAudioBitrateKbps ?? snapshot.targetAudioBitrateKbps,
            packetLossRate: input.sample.packetLossRate ?? snapshot.packetLossRate,
            receiverJitterTargetMs:
              input.sample.receiverJitterTargetMs ?? snapshot.receiverJitterTargetMs,
            mediaReceiveBitrateKbps:
              input.sample.mediaReceiveBitrateKbps ?? snapshot.mediaReceiveBitrateKbps,
            mediaSendBitrateKbps: input.sample.mediaSendBitrateKbps ?? snapshot.mediaSendBitrateKbps,
            packetsLost: input.sample.packetsLost ?? snapshot.packetsLost,
            jitterMs: input.sample.jitterMs ?? snapshot.jitterMs,
            lastAudibleProgressAt: formatDiagnosticsTimestamp(
              listenerMediaLifecycleRef.current.lastPlayoutProgressAt
            ),
            lastMediaStatsProgressAt: formatDiagnosticsTimestamp(
              listenerMediaLifecycleRef.current.lastTransportProgressAt
            ),
            lastDataActivityAt: formatDiagnosticsTimestamp(lastDataActivityAtRef.current),
            audibleSource: resolveCurrentAudibleSource(now),
            bufferingWhileAudible:
              resolveCurrentAudibleSource(now) === "remote-stream" &&
              mediaConnectionState === "buffering",
            consecutiveNoProgressMs: resolveSourceContinuityState(now).consecutiveNoProgressMs
          })
        })
      });
    },
    [
      currentRoomRef,
      isCurrentSourceOwner,
      mediaConnectionState,
      recordPeerDiagnostic,
      resolveCurrentAudibleSource,
      resolveSourceContinuityState,
      updateConnectionSupervisorTransport
    ]
  );

  const recordPieceTransfer = useCallback(
    (input: {
      peerId: string;
      direction: "download" | "upload";
      bytes: number;
    }) => {
      if (!input.peerId || input.bytes <= 0) {
        return;
      }

      lastDataActivityAtRef.current = Date.now();

      const window =
        pieceTransferRatesRef.current.get(input.peerId) ??
        (() => {
          const initial: PieceTransferWindow = {
            downloads: [],
            uploads: []
          };
          pieceTransferRatesRef.current.set(input.peerId, initial);
          return initial;
        })();
      const bucket = input.direction === "download" ? window.downloads : window.uploads;
      bucket.push({
        timestampMs: Date.now(),
        bytes: input.bytes
      });

      const pieceTransferRates = getPieceTransferRates(pieceTransferRatesRef.current, input.peerId);
      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "data",
        direction: "local",
        event: "piece-transfer-stats",
        summary: "Piece transfer stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            pieceDownloadRateKbps: pieceTransferRates.downloadRateKbps,
            pieceUploadRateKbps: pieceTransferRates.uploadRateKbps,
            lastPieceReceivedAt:
              input.direction === "download" ? new Date().toISOString() : snapshot.lastPieceReceivedAt
          })
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const recordPieceRequestSample = useCallback(
    (input: {
      peerId: string;
      outcome: "completed" | "timeout";
      durationMs: number;
    }) => {
      if (!input.peerId || input.durationMs < 0) {
        return;
      }

      const samples = pieceRequestSamplesRef.current.get(input.peerId) ?? [];
      samples.push({
        timestampMs: Date.now(),
        durationMs: input.durationMs,
        outcome: input.outcome
      });
      const summary = summarizePieceRequestSamples(samples);
      pieceRequestSamplesRef.current.set(input.peerId, summary.samples);

      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: "data",
        direction: "local",
        event: "piece-request-stats",
        summary: "Piece request stats updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            pieceRttMsP50: summary.pieceRttMsP50,
            pieceRttMsP95: summary.pieceRttMsP95,
            pieceTimeoutRate: summary.pieceTimeoutRate
          })
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const updatePeerBufferedAmount = useCallback(
    (peerId: string, bufferedAmountBytes: number) => {
      if (!peerId) {
        return;
      }

      recordPeerDiagnostic({
        peerId,
        channelKind: "data",
        direction: "local",
        event: "data-buffered-amount",
        summary: "Data buffered amount updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          dataBufferedAmountBytes: bufferedAmountBytes
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const updateRemoteStreamTime = useCallback(
    (timeOnRemoteStreamMs: number | null) => {
      recordPeerDiagnostic({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "remote-stream-time",
        summary: "Remote stream time updated",
        recordEvent: false,
        update: (snapshot) => ({
          ...snapshot,
          timeOnRemoteStreamMs
        })
      });
    },
    [recordPeerDiagnostic]
  );

  const reportRealtimeFailure = useCallback(
    (input: {
      peerId: string;
      channelKind: "data" | "media" | "system";
      event: string;
      summary: string;
      error: unknown;
      mediaConnectionState?: RoomMediaConnectionState;
    }) => {
      const message = toUserFacingError(input.error);
      const nextSummary = `${input.summary}: ${message}`;

      recordPeerDiagnostic({
        peerId: input.peerId,
        channelKind: input.channelKind,
        direction: "local",
        event: input.event,
        level: "error",
        summary: nextSummary,
        update: (snapshot) => ({
          ...snapshot,
          lastError: nextSummary
        })
      });

      if (input.mediaConnectionState) {
        setMediaConnectionState(input.mediaConnectionState);
      }
    },
    [recordPeerDiagnostic, setMediaConnectionState]
  );

  function ensureConnectionSupervisorState(remotePeerId: string) {
    const roomId = currentRoomRef.current?.room.id ?? roomSnapshot?.room.id ?? null;
    if (!roomId || !remotePeerId || remotePeerId === "system") {
      return null;
    }

    const current = connectionSupervisorStatesRef.current.get(remotePeerId);
    if (current && current.roomId === roomId) {
      return current;
    }

    const next = createPeerConnectionSupervisorState({
      roomId,
      peerId: remotePeerId
    });
    connectionSupervisorStatesRef.current.set(remotePeerId, next);
    return next;
  }

  function commitConnectionSupervisorState(
    peerId: string,
    channelKind: "data" | "media" | "system",
    nextState: PeerConnectionSupervisorState
  ) {
    const previousState = connectionSupervisorStatesRef.current.get(peerId) ?? null;
    connectionSupervisorStatesRef.current.set(peerId, nextState);
    const previousPatch = previousState ? toSupervisorDiagnosticPatch(previousState) : null;
    const nextPatch = toSupervisorDiagnosticPatch(nextState);
    const patchChanged =
      !previousPatch ||
      previousPatch.transportScore !== nextPatch.transportScore ||
      previousPatch.stableTransportKind !== nextPatch.stableTransportKind ||
      previousPatch.lastFailureReason !== nextPatch.lastFailureReason ||
      previousPatch.lastRecoveryAction !== nextPatch.lastRecoveryAction ||
      previousPatch.iceRestartCount !== nextPatch.iceRestartCount ||
      previousPatch.hardRecreateCount !== nextPatch.hardRecreateCount ||
      previousState?.recoveryStage !== nextState.recoveryStage;

    if (patchChanged) {
      recordPeerDiagnostic({
        peerId,
        channelKind,
        direction: "local",
        event: "connection-supervisor",
        summary: `Connection supervisor: ${nextState.transportScore} / ${nextState.recoveryStage}`,
        recordEvent: false,
        update: (snapshot) => withSupervisorDiagnosticPatch(snapshot, nextState)
      });
    }
    return nextState;
  }

  function updateConnectionSupervisorSignalState(input: {
    peerId: string;
    channelKind: "data" | "media";
    dataChannelState?: string | null;
    dataConnectionState?: string | null;
    mediaConnectionState?: string | null;
    dataIceState?: string | null;
    mediaIceState?: string | null;
    lastFailureReason?: string | null;
  }) {
    const current = ensureConnectionSupervisorState(input.peerId);
    if (!current) {
      return null;
    }

    const next = notePeerSignalState({
      state: current,
      dataChannelState: input.dataChannelState,
      dataConnectionState: input.dataConnectionState,
      mediaConnectionState: input.mediaConnectionState,
      dataIceState: input.dataIceState,
      mediaIceState: input.mediaIceState,
      lastFailureReason: input.lastFailureReason
    });
    return commitConnectionSupervisorState(input.peerId, input.channelKind, next);
  }

  function updateConnectionSupervisorTransport(input: {
    peerId: string;
    channelKind: "data" | "media";
    sample: {
      candidateType: string | null;
      protocol: string | null;
      currentRoundTripTimeMs: number | null;
      availableOutgoingBitrateKbps: number | null;
      mediaReceiveBitrateKbps: number | null;
      mediaSendBitrateKbps: number | null;
      packetLossRate?: number | null;
      packetsLost?: number | null;
      jitterMs: number | null;
    };
  }) {
    const current = ensureConnectionSupervisorState(input.peerId);
    if (!current) {
      return null;
    }

    const next = observePeerTransport({
      state: current,
      sample: {
        ...input.sample,
        packetsLost: input.sample.packetsLost ?? null,
        packetLossRate: input.sample.packetLossRate ?? null
      },
      diagnostics: {
        dataChannelState: current.dataChannelState,
        dataConnectionState: current.dataConnectionState,
        mediaConnectionState: current.mediaConnectionState,
        dataIceState: current.dataIceState,
        mediaIceState: current.mediaIceState
      }
    });
    return commitConnectionSupervisorState(input.peerId, input.channelKind, next);
  }

  function updateConnectionSupervisorPlayout(peerId: string) {
    const current = ensureConnectionSupervisorState(peerId);
    if (!current) {
      return null;
    }

    const next = recordPeerPlayoutProgress(current);
    return commitConnectionSupervisorState(peerId, "media", next);
  }

  const requestRoomSnapshotResyncRef = useRef(requestRoomSnapshotResync);
  const scheduleRemotePlaybackRetryRef = useRef(scheduleRemotePlaybackRetry);
  const ensureMediaTransportConnectedRef = useRef(ensureMediaTransportConnected);
  const syncHostMediaStreamRef = useRef(syncHostMediaStream);
  const ensureSourcePlaybackStartedRef = useRef(ensureSourcePlaybackStarted);
  const updateDataTransportStatsRef = useRef(updateDataTransportStats);
  const updateMediaTransportStatsRef = useRef(updateMediaTransportStats);
  const reportRealtimeFailureRef = useRef(reportRealtimeFailure);
  const recordPieceTransferRef = useRef(recordPieceTransfer);
  const recordPieceRequestSampleRef = useRef(recordPieceRequestSample);
  const updatePeerBufferedAmountRef = useRef(updatePeerBufferedAmount);

  useEffect(() => {
    requestRoomSnapshotResyncRef.current = requestRoomSnapshotResync;
  }, [requestRoomSnapshotResync]);

  useEffect(() => {
    scheduleRemotePlaybackRetryRef.current = scheduleRemotePlaybackRetry;
  }, [scheduleRemotePlaybackRetry]);

  useEffect(() => {
    ensureMediaTransportConnectedRef.current = ensureMediaTransportConnected;
  }, [ensureMediaTransportConnected]);

  useEffect(() => {
    syncHostMediaStreamRef.current = syncHostMediaStream;
  }, [syncHostMediaStream]);

  useEffect(() => {
    ensureSourcePlaybackStartedRef.current = ensureSourcePlaybackStarted;
  }, [ensureSourcePlaybackStarted]);

  useEffect(
    () => () => {
      clearPendingRemoteStreamClear();
    },
    [clearPendingRemoteStreamClear]
  );

  useEffect(() => {
    updateDataTransportStatsRef.current = updateDataTransportStats;
  }, [updateDataTransportStats]);

  useEffect(() => {
    updateMediaTransportStatsRef.current = updateMediaTransportStats;
  }, [updateMediaTransportStats]);

  useEffect(() => {
    reportRealtimeFailureRef.current = reportRealtimeFailure;
  }, [reportRealtimeFailure]);

  useEffect(() => {
    recordPieceTransferRef.current = recordPieceTransfer;
  }, [recordPieceTransfer]);

  useEffect(() => {
    recordPieceRequestSampleRef.current = recordPieceRequestSample;
  }, [recordPieceRequestSample]);

  useEffect(() => {
    updatePeerBufferedAmountRef.current = updatePeerBufferedAmount;
  }, [updatePeerBufferedAmount]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const hasActiveTrack = !!playback?.currentTrackId;
    const isPlaying = playback?.status === "playing";
    const mediaStatsMode =
      !hasActiveTrack || (!isPageVisible && !isPlaying)
        ? "off"
        : isCurrentSourceOwner || activePlaybackSource !== "remote-stream" || bufferHealth !== "healthy"
          ? "active"
          : "steady";
    const dataStatsMode =
      !hasActiveTrack || (!isPageVisible && !isPlaying)
        ? "off"
        : bufferHealth !== "healthy"
          ? "active"
          : "steady";

    mediaMeshRef.current?.setStatsSamplingMode(mediaStatsMode);
    meshRef.current?.setStatsSamplingMode(dataStatsMode);
  }, [
    activePlaybackSource,
    bufferHealth,
    isCurrentSourceOwner,
    isPageVisible,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      connectionSupervisorStatesRef.current.clear();
      return;
    }

    const tickIntervalMs = isPageVisible
      ? connectionSupervisorForegroundIntervalMs
      : connectionSupervisorBackgroundIntervalMs;
    const timerId = window.setInterval(() => {
      const currentRoom = currentRoomRef.current;
      if (!currentRoom?.room.id) {
        return;
      }

      const now = Date.now();
      const expectedPeerIds = currentRoom.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId);
      const expectedPeerSet = new Set(expectedPeerIds);
      for (const [remotePeerId, state] of connectionSupervisorStatesRef.current.entries()) {
        if (state.roomId !== currentRoom.room.id || !expectedPeerSet.has(remotePeerId)) {
          connectionSupervisorStatesRef.current.delete(remotePeerId);
        }
      }

      const playback = currentRoom.room.playback;
      const sourcePeerId = playback.sourcePeerId ?? null;
      const sourceGeneration = listenerMediaLifecycleRef.current.currentGeneration;
      const sourceLifecycle = listenerMediaLifecycleRef.current;

      for (const remotePeerId of expectedPeerIds) {
        const currentState = ensureConnectionSupervisorState(remotePeerId);
        if (!currentState) {
          continue;
        }

        let nextState: PeerConnectionSupervisorState = currentState;
        const isSourcePeer = remotePeerId === sourcePeerId;
        const iceRestartNoProgressMs = resolveIceRestartNoProgressMs(nextState);
        const hardRecreateNoProgressMs = resolveHardRecreateNoProgressMs(nextState);
        const sourceContinuity = isSourcePeer ? resolveSourceContinuityState(now) : null;
        const noTransportProgressMs =
          isSourcePeer && sourceLifecycle.lastTransportProgressAt !== null
            ? now - sourceLifecycle.lastTransportProgressAt
            : null;
        const noAudibleProgressMs =
          isSourcePeer && sourceLifecycle.lastPlayoutProgressAt !== null
            ? now - sourceLifecycle.lastPlayoutProgressAt
            : null;
        const consecutiveNoProgressMs = isSourcePeer
          ? sourceContinuity?.consecutiveNoProgressMs ??
            resolveConsecutiveNoProgressMs(noTransportProgressMs, noAudibleProgressMs)
          : resolvePeerConnectionNoProgressMs(nextState, now);
        const sourceRecoverySuppressedReason = isSourcePeer
          ? resolveSourceRecoverySuppressedReason(now)
          : null;
        if (isSourcePeer) {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "source-progress",
            summary:
              typeof consecutiveNoProgressMs === "number"
                ? `源媒体 ${Math.round(consecutiveNoProgressMs)}ms 无连续进展`
                : "源媒体传输正常",
            recordEvent: false,
            update: (snapshot) => ({
              ...snapshot,
              zeroProgressMs:
                typeof consecutiveNoProgressMs === "number" && Number.isFinite(consecutiveNoProgressMs)
                  ? Math.max(0, Math.round(consecutiveNoProgressMs))
                  : null,
              consecutiveNoProgressMs:
                typeof consecutiveNoProgressMs === "number" && Number.isFinite(consecutiveNoProgressMs)
                  ? Math.max(0, Math.round(consecutiveNoProgressMs))
                  : null,
              lastAudibleProgressAt: formatDiagnosticsTimestamp(
                sourceContinuity?.lastAudibleProgressAtMs ?? null
              ),
              lastMediaStatsProgressAt: formatDiagnosticsTimestamp(
                sourceContinuity?.lastMediaStatsProgressAtMs ?? null
              ),
              lastDataActivityAt: formatDiagnosticsTimestamp(
                sourceContinuity?.lastDataActivityAtMs ?? null
              ),
              audibleSource: sourceContinuity?.audibleSource ?? null,
              bufferingWhileAudible: sourceContinuity?.bufferingWhileAudible ?? false,
              recoverySuppressedReason: sourceRecoverySuppressedReason
            })
          });
        }
        const hasMediaHardRecoverySignal =
          nextState.mediaIceState === "failed" ||
          (((nextState.mediaConnectionState === "failed" ||
            nextState.mediaConnectionState === "closed") &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= hardRecreateNoProgressMs)) ||
          ((nextState.mediaConnectionState === "connecting" ||
            nextState.mediaIceState === "checking") &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= hardRecreateNoProgressMs) ||
          (isSourcePeer &&
            playback.status === "playing" &&
            activePlaybackSource === "remote-stream" &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= hardRecreateNoProgressMs);
        const hasDataHardRecoverySignal =
          nextState.dataConnectionState === "failed" ||
          nextState.dataConnectionState === "closed" ||
          nextState.dataIceState === "failed" ||
          nextState.dataChannelState === "closed";
        const hasHardRecoverySignal = isSourcePeer
          ? hasMediaHardRecoverySignal
          : hasMediaHardRecoverySignal || hasDataHardRecoverySignal;
        const hasImmediateMediaHardRecoverySignal = nextState.mediaIceState === "failed";
        const hasImmediateDataHardRecoverySignal =
          nextState.dataConnectionState === "failed" ||
          nextState.dataConnectionState === "closed" ||
          nextState.dataIceState === "failed" ||
          nextState.dataChannelState === "closed";
        const hasImmediateHardRecoverySignal = isSourcePeer
          ? hasImmediateMediaHardRecoverySignal
          : hasImmediateMediaHardRecoverySignal || hasImmediateDataHardRecoverySignal;

        const hasMediaIceRestartFailureSignal =
          (nextState.transportScore === "failed" && hasMediaHardRecoverySignal) ||
          (nextState.transportScore === "unstable" &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= iceRestartNoProgressMs) ||
          ((nextState.mediaConnectionState === "connecting" ||
            nextState.mediaIceState === "checking") &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= iceRestartNoProgressMs) ||
          ((nextState.mediaIceState === "disconnected" ||
            nextState.mediaConnectionState === "disconnected") &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= iceRestartNoProgressMs) ||
          (nextState.lastFailureReason === "ice-failed" && nextState.mediaIceState === "failed");
        const hasDataIceRestartFailureSignal =
          ((nextState.dataIceState === "disconnected" ||
            nextState.dataConnectionState === "disconnected") &&
            typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= iceRestartNoProgressMs) ||
          nextState.lastFailureReason === "data-failed";
        const hasIceRestartFailureSignal = isSourcePeer
          ? hasMediaIceRestartFailureSignal
          : hasMediaIceRestartFailureSignal || hasDataIceRestartFailureSignal;
        const sourcePeerAllowsIceRestart =
          !isSourcePeer ||
          (!sourceRecoverySuppressedReason &&
            (typeof consecutiveNoProgressMs !== "number" ||
              consecutiveNoProgressMs >= iceRestartNoProgressMs));
        const needsIceRestart =
          !hasHardRecoverySignal && hasIceRestartFailureSignal && sourcePeerAllowsIceRestart;
        const canAttemptIceRestart = canRunRecoveryAction({
          state: nextState,
          action: "ice-restart",
          generation: sourceGeneration
        });

        if (needsIceRestart && canAttemptIceRestart) {
          const recoveryChannel = hasMediaIceRestartFailureSignal ? "media" : "data";
          nextState = markRecoveryAction({
            state: nextState,
            action: "ice-restart",
            generation: sourceGeneration,
            failureReason: nextState.lastFailureReason ?? "ice-restart-required"
          });
          commitConnectionSupervisorState(remotePeerId, recoveryChannel, nextState);

          if (recoveryChannel === "media") {
            if (
              !beginSourceHardRecoveryAction(
                remotePeerId,
                playback.mediaEpoch,
                "ice-restart"
              )
            ) {
              continue;
            }
            const restartPromise = isSourcePeer
              ? mediaMeshRef.current?.restartListenerIce(remotePeerId)
              : mediaMeshRef.current?.restartPublishingIce(remotePeerId, hostStreamRef.current);
            void restartPromise?.catch((error) => {
              clearSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch);
              reportRealtimeFailureRef.current({
                peerId: remotePeerId,
                channelKind: "media",
                event: "supervisor-ice-restart-failed",
                summary: "Failed to ICE restart media peer",
                error,
                mediaConnectionState: resolveSoftRecoveryMediaState("reconnecting")
              });
            });
          } else {
            void meshRef.current?.restartIce(remotePeerId).catch((error) => {
              reportRealtimeFailureRef.current({
                peerId: remotePeerId,
                channelKind: "data",
                event: "supervisor-ice-restart-failed",
                summary: "Failed to ICE restart data peer",
                error
              });
            });
          }
          continue;
        }

        const hardRecoveryWindowSatisfied =
          hasImmediateHardRecoverySignal ||
          nextState.consecutiveUnstableWindows >= 2 ||
          nextState.transportScore === "failed" ||
          (typeof consecutiveNoProgressMs === "number" &&
            consecutiveNoProgressMs >= hardRecreateNoProgressMs);
        const needsHardRecovery =
          hasHardRecoverySignal &&
          hardRecoveryWindowSatisfied &&
          (!sourceRecoverySuppressedReason || hasImmediateHardRecoverySignal);

        if (
          needsHardRecovery &&
          canRunRecoveryAction({
            state: nextState,
            action: "hard-recreate",
            generation: sourceGeneration
          })
        ) {
          const recoveryChannel = hasMediaHardRecoverySignal ? "media" : "data";
          nextState = markRecoveryAction({
            state: nextState,
            action: "hard-recreate",
            generation: sourceGeneration,
            failureReason: nextState.lastFailureReason ?? "peer-stalled"
          });
          commitConnectionSupervisorState(remotePeerId, recoveryChannel, nextState);

          if (recoveryChannel === "media") {
            if (
              !beginSourceHardRecoveryAction(
                remotePeerId,
                playback.mediaEpoch,
                "hard-recreate"
              )
            ) {
              continue;
            }
            if (isSourcePeer) {
              setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
            }
            const recreatePromise = isSourcePeer
              ? mediaMeshRef.current?.resetListenerPeer(remotePeerId)
              : mediaMeshRef.current?.restartPublishingPeer(remotePeerId, hostStreamRef.current);
            void recreatePromise?.catch((error) => {
              clearSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch);
              reportRealtimeFailureRef.current({
                peerId: remotePeerId,
                channelKind: "media",
                event: "supervisor-hard-recreate-failed",
                summary: "Failed to hard recreate media peer",
                error,
                mediaConnectionState: resolveSoftRecoveryMediaState("reconnecting")
              });
            });
          } else {
            void meshRef.current?.restartPeer(remotePeerId).catch((error) => {
              reportRealtimeFailureRef.current({
                peerId: remotePeerId,
                channelKind: "data",
                event: "supervisor-hard-recreate-failed",
                summary: "Failed to hard recreate data peer",
                error
              });
            });
          }
          continue;
        }

        const looksHealthy =
          (nextState.transportScore === "healthy" || nextState.transportScore === "degraded") &&
          (nextState.dataChannelState === null || nextState.dataChannelState === "open") &&
          (nextState.dataConnectionState === null || nextState.dataConnectionState === "connected") &&
          (nextState.mediaConnectionState === null ||
            nextState.mediaConnectionState === "connected" ||
            nextState.mediaConnectionState === "connecting") &&
          (nextState.dataIceState === null || nextState.dataIceState === "connected") &&
          (nextState.mediaIceState === null || nextState.mediaIceState === "connected");

        if (looksHealthy && nextState.recoveryStage !== "idle") {
          nextState = resetRecoveryStage(nextState);
          commitConnectionSupervisorState(remotePeerId, isSourcePeer ? "media" : "data", nextState);
          if (isSourcePeer) {
            clearSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch);
          }
        }
      }

      const sourceState =
        sourcePeerId ? connectionSupervisorStatesRef.current.get(sourcePeerId) ?? null : null;
      const sourceContinuityForResubscribe = sourcePeerId ? resolveSourceContinuityState(now) : null;
      if (
        sourcePeerId &&
        sourceState &&
        !resolveSourceRecoverySuppressedReason(now) &&
        sourceContinuityForResubscribe !== null &&
        typeof sourceContinuityForResubscribe.consecutiveNoProgressMs === "number" &&
        sourceContinuityForResubscribe.consecutiveNoProgressMs >=
          recoveryFullResubscribeThresholdMs &&
        now - lastRealtimeRoomEventAtRef.current >= 15_000 &&
        canRunRecoveryAction({
          state: sourceState,
          action: "full-resubscribe",
          generation: sourceGeneration
        })
      ) {
        const nextState = markRecoveryAction({
          state: sourceState,
          action: "full-resubscribe",
          generation: sourceGeneration,
          failureReason: "room-control-stale"
        });
        commitConnectionSupervisorState(sourcePeerId, "media", nextState);
        if (
          beginSourceHardRecoveryAction(
            sourcePeerId,
            playback.mediaEpoch,
            "full-resubscribe"
          )
        ) {
          resubscribeRoomRef.current?.();
        }
      }
    }, tickIntervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    activePlaybackSource,
    beginSourceHardRecoveryAction,
    clearSourceHardRecoveryAction,
    commitConnectionSupervisorState,
    currentRoomRef,
    ensureConnectionSupervisorState,
    isCurrentSourceOwner,
    isPageVisible,
    peerId,
    resolveSoftRecoveryMediaState,
    resolveSourceContinuityState,
    resolveSourceRecoverySuppressedReason,
    roomSnapshot?.room.id,
    setMediaConnectionState
  ]);

  useEffect(() => {
    return () => {
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
      }
      stopRoomSnapshotWatchdog();
    };
  }, [stopRoomSnapshotWatchdog]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    const mediaEpoch = roomSnapshot?.room.playback.mediaEpoch ?? 0;
    const trackingKey = currentTrackId ? `${currentTrackId}:${mediaEpoch}` : null;
    const tracking = remoteStreamTrackingRef.current;

    if (tracking.trackKey !== trackingKey) {
      tracking.trackKey = trackingKey;
      tracking.accumulatedMs = 0;
      tracking.segmentStartedAt = null;
    }

    if (!currentTrackId) {
      updateRemoteStreamTime(null);
      return;
    }

    const shouldTrackRemoteStream =
      roomSnapshot?.room.playback.status === "playing" && activePlaybackSource === "remote-stream";

    if (!shouldTrackRemoteStream) {
      if (tracking.segmentStartedAt !== null) {
        tracking.accumulatedMs += Date.now() - tracking.segmentStartedAt;
        tracking.segmentStartedAt = null;
      }
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs)));
      return;
    }

    if (tracking.segmentStartedAt === null) {
      tracking.segmentStartedAt = Date.now();
    }

    const syncRemoteStreamTime = () => {
      const activeSegmentMs =
        tracking.segmentStartedAt === null ? 0 : Date.now() - tracking.segmentStartedAt;
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs + activeSegmentMs)));
    };

    syncRemoteStreamTime();
    const timerId = window.setInterval(syncRemoteStreamTime, 1_000);

    return () => {
      window.clearInterval(timerId);
      if (tracking.segmentStartedAt !== null) {
        tracking.accumulatedMs += Date.now() - tracking.segmentStartedAt;
        tracking.segmentStartedAt = null;
      }
      updateRemoteStreamTime(Math.max(0, Math.round(tracking.accumulatedMs)));
    };
  }, [
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.status,
    activePlaybackSource,
    updateRemoteStreamTime
  ]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setStatusMessage("");
    }, 4_000);

    return () => window.clearTimeout(timer);
  }, [setStatusMessage, statusMessage]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshSession();
  }, [activeSession, refreshSession]);

  useEffect(() => {
    if (
      !shouldRedirectRoomRouteToAuth({
        workspaceOnly,
        initialRoomId,
        hydrated,
        hasActiveSession: Boolean(activeSession),
        isNavigatingRoomExit,
        suppressRoomRecovery
      })
    ) {
      return;
    }

    router.replace(authEntryHref as Route);
  }, [
    workspaceOnly,
    initialRoomId,
    hydrated,
    activeSession,
    isNavigatingRoomExit,
    suppressRoomRecovery,
    router,
    authEntryHref
  ]);

  useEffect(() => {
    const storedPeerId = window.sessionStorage.getItem(peerStorageKey);
    if (storedPeerId) {
      setPeerId(storedPeerId);
      return;
    }

    const nextPeerId = `peer_${crypto.randomUUID()}`;
    window.sessionStorage.setItem(peerStorageKey, nextPeerId);
    setPeerId(nextPeerId);
  }, [peerStorageKey, setPeerId]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshAvailableRooms();
    void refreshPlaylists();
  }, [activeSession, refreshAvailableRooms, refreshPlaylists]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const nextVisible = !document.hidden;
      setIsPageVisible(nextVisible);
      if (nextVisible) {
        setSchedulerMode((current) => (current === "idle" ? "normal" : current));
        emitPresence();
        void requestRoomSnapshotResync(
          "visibility-visible",
          currentRoomRef.current?.room.id ?? null
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [currentRoomRef, emitPresence, requestRoomSnapshotResync, setIsPageVisible, setSchedulerMode]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession) {
      setIceConfig(null);
      setIceConfigResolved(false);
      return;
    }

    let cancelled = false;
    setIceConfigResolved(false);

    void (async () => {
      try {
        const nextIceConfig = await musicRoomApi.getIceConfig();
        if (cancelled) {
          return;
        }

        setIceConfig(nextIceConfig);
        setIceConfigResolved(true);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "ice-config",
          summary: `ICE 配置来源：${nextIceConfig.source}`,
          update: (snapshot) => ({
            ...snapshot,
            mediaConnectionState: nextIceConfig.source,
            iceConfigSource: nextIceConfig.source
          })
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIceConfig(null);
        setIceConfigResolved(true);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "ice-config-fallback",
          level: "warning",
          summary: `ICE 配置获取失败，已回退静态配置：${toUserFacingError(error)}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: toUserFacingError(error),
            iceConfigSource: "stun-only"
          })
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    roomSnapshot?.room.id,
    activeSession?.userId,
    setIceConfig,
    setIceConfigResolved,
    recordPeerDiagnostic
  ]);

  useEffect(() => {
    if (
      suppressRoomRecovery ||
      !workspaceOnly ||
      !initialRoomId ||
      !hydrated ||
      !activeSession ||
      isNavigatingRoomExit
    ) {
      return;
    }

    const recoveryKey = `${activeSession.userId}:${initialRoomId}`;
    if (initialRecoveryAttemptRef.current === recoveryKey) {
      return;
    }
    initialRecoveryAttemptRef.current = recoveryKey;

    let cancelled = false;
    setIsRecoveringRoom(true);

    void (async () => {
      try {
        const snapshot = await musicRoomApi.recoverRoom(initialRoomId);
        if (!snapshot || cancelled) {
          if (!cancelled) {
            setSuppressRoomRecovery(true);
            setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
            setIsRecoveringRoom(false);
          }
          return;
        }

        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot
        });
        setStatusMessage(`已进入房间 ${snapshot.room.joinCode}。`);
        await refreshPlaylists();
      } catch {
        if (!cancelled) {
          setStatusMessage("未找到可恢复的房间状态，请返回音乐房重新创建或加入房间。");
        }
      } finally {
        if (!cancelled) {
          setIsRecoveringRoom(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceOnly,
    initialRoomId,
    hydrated,
    activeSession?.userId,
    suppressRoomRecovery,
    isNavigatingRoomExit,
    refreshPlaylists,
    dispatchRoomStateEvent,
    setIsRecoveringRoom,
    setSuppressRoomRecovery,
    setStatusMessage
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId) {
      return;
    }

    window.localStorage.setItem(lastRoomStorageKey, roomSnapshot.room.id);
  }, [roomSnapshot?.room.id, peerId, lastRoomStorageKey]);

  useEffect(() => {
    if (
      !roomSnapshot?.room.id ||
      !hydrated ||
      !activeSession?.userId ||
      isNavigatingRoomExit ||
      roomSnapshot.room.members.length <= 1
    ) {
      stopRoomSnapshotWatchdog();
      return;
    }

    lastRealtimeRoomEventAtRef.current = Date.now();
    stopRoomSnapshotWatchdog();
    roomSnapshotWatchdogIntervalRef.current = window.setInterval(() => {
      const activeRoomId = activeRouteRoomIdRef.current;
      const socket = socketRef.current;
      if (!activeRoomId || activeRoomId !== roomSnapshot.room.id || !socket?.connected) {
        return;
      }

      if (Date.now() - lastRealtimeRoomEventAtRef.current < 8_000) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      void requestRoomSnapshotResyncRef.current("stale-watchdog", roomSnapshot.room.id);
    }, 4_000);

    return () => {
      stopRoomSnapshotWatchdog();
    };
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.members.length,
    hydrated,
    activeSession?.userId,
    isNavigatingRoomExit,
    stopRoomSnapshotWatchdog
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !hydrated || !iceConfigResolved) {
      return;
    }

    const socket = createRoomSocket();
    socketRef.current = socket;
    const roomId = roomSnapshot.room.id;
    let subscribeRetryId: number | null = null;
    let subscribeAckTimeoutId: number | null = null;
    pieceTransferRatesRef.current.clear();
    pieceRequestSamplesRef.current.clear();
    sourceRecoveryCoordinatorRef.current = {
      actionKey: null,
      action: null,
      startedAtMs: null
    };
    const iceServers = getWebRTCIceServers(iceConfig);
    const emitPeerSignal = (payload: PeerSignalMessage) => {
      const traceContext =
        payload.channelKind === "media" ? getRemoteMediaTraceContext(payload.toPeerId) : null;
      recordPeerDiagnosticRef.current({
        peerId: payload.toPeerId,
        channelKind: payload.channelKind,
        direction: "sent",
        event: payload.type,
        summary:
          payload.channelKind === "media" && traceContext?.traceKey
            ? `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type} · ${traceContext.traceKey}`
            : `向 ${payload.toPeerId} 发送 ${payload.channelKind} ${payload.type}`,
        update: (snapshot) => ({
          ...snapshot,
          remoteTrackStatus:
            payload.channelKind === "media"
              ? {
                  ...snapshot.remoteTrackStatus,
                  ...traceContext
                }
              : snapshot.remoteTrackStatus,
          signalStats: {
            ...snapshot.signalStats,
            sentOffers:
              snapshot.signalStats.sentOffers + (payload.type === "offer" ? 1 : 0),
            sentAnswers:
              snapshot.signalStats.sentAnswers + (payload.type === "answer" ? 1 : 0),
            sentCandidates:
              snapshot.signalStats.sentCandidates + (payload.type === "candidate" ? 1 : 0)
          }
        })
      });
      socket.emit("peer.signal", payload);
    };
    const resolveSocketRecoveryMediaState = () => {
      const source = activePlaybackSourceRef.current;
      if (
        source === "progressive-local" ||
        source === "full-local" ||
        roomRecoveryStateRef.current.fullLocalRecoveryActive
      ) {
        return "buffering" as const;
      }

      return "reconnecting" as const;
    };
    const handleSignalFailure = (payload: PeerSignalMessage, error: unknown) => {
      reportRealtimeFailureRef.current({
        peerId: payload.fromPeerId,
        channelKind: payload.channelKind,
        event: "signal-handle-failed",
        summary: `Failed to apply ${payload.channelKind} ${payload.type} from ${payload.fromPeerId}`,
        error,
        mediaConnectionState:
          payload.channelKind === "media" ? resolveSocketRecoveryMediaState() : undefined
      });
    };

    const mesh = new P2PMesh(
      roomId,
      peerId,
      emitPeerSignal,
      {
        onPieceReceived: ({
          peerId: sourcePeerId,
          trackId,
          chunkIndex,
          totalChunks,
          chunkSize,
          mimeType,
          payloadBytes,
          requestRttMs
        }) => {
          lastPieceReceivedAtRef.current = Date.now();
          recordPieceTransferRef.current({
            peerId: sourcePeerId,
            direction: "download",
            bytes: payloadBytes
          });
          if (typeof requestRttMs === "number" && Number.isFinite(requestRttMs)) {
            recordPieceRequestSampleRef.current({
              peerId: sourcePeerId,
              outcome: "completed",
              durationMs: requestRttMs
            });
          }
          const shouldProcessPieceForCache =
            enablePlaybackCacheTakeover ||
            manualCacheTrackIdsRef.current.includes(trackId);
          if (!shouldProcessPieceForCache) {
            return;
          }
          markManualCacheTrackDownloading(trackId);
          const currentTrack =
            currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
          if (currentTrack) {
            void queueTrackPieceManifestUpsert({
              trackId,
              fileHash: currentTrack.fileHash,
              mimeType: currentTrack.mimeType || mimeType || "audio/mpeg",
              codec: currentTrack.codec ?? null,
              sizeBytes: currentTrack.sizeBytes ?? null,
              durationMs: currentTrack.durationMs,
              totalChunks,
              chunkSize
            });
          }
          chunkSchedulerRef.current?.markPieceReceived(trackId, chunkIndex, totalChunks);
          mergeLocalPieceAvailabilityRef.current(trackId, chunkIndex, totalChunks, chunkSize);
          scheduleTrackHydrationRef.current(trackId, mimeType, totalChunks);
        },
        onPieceSent: ({ peerId: targetPeerId, payloadBytes }) => {
          recordPieceTransferRef.current({
            peerId: targetPeerId,
            direction: "upload",
            bytes: payloadBytes
          });
        },
        onPieceRequestTimeout: ({
          trackId,
          chunkIndex,
          peerId: timedOutPeerId,
          requestDurationMs
        }) => {
          recordPieceRequestSampleRef.current({
            peerId: timedOutPeerId,
            outcome: "timeout",
            durationMs: requestDurationMs
          });
          chunkSchedulerRef.current?.markRequestTimeout(trackId, chunkIndex, timedOutPeerId);
        },
        onPeerConnectionChange: ({ peerId: remotePeerId, state }) => {
          const supervisorState = updateConnectionSupervisorSignalState({
            peerId: remotePeerId,
            channelKind: "data",
            dataConnectionState: state,
            lastFailureReason:
              state === "failed" || state === "closed" ? "data-failed" : undefined
          });
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "connection-state",
            summary: `Data 连接状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
                dataConnectionState: state
              })
            })
          });
          if (state === "closed" || state === "failed" || state === "disconnected") {
            setConnectedPeers((current) => current.filter((peer) => peer !== remotePeerId));
          }
        },
        onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
          const supervisorState = updateConnectionSupervisorSignalState({
            peerId: remotePeerId,
            channelKind: "data",
            dataIceState: state,
            lastFailureReason: state === "failed" ? "ice-failed" : undefined
          });
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "ice-state",
            summary: `Data ICE 状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
                dataIceState: state
              })
            })
          });
        },
        onDataChannelStateChange: ({ peerId: remotePeerId, state }) => {
          const supervisorState = updateConnectionSupervisorSignalState({
            peerId: remotePeerId,
            channelKind: "data",
            dataChannelState: state,
            lastFailureReason: state === "closed" ? "data-channel-closed" : undefined
          });
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "data",
            direction: "local",
            event: "data-channel",
            summary: `DataChannel 状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
                dataChannelState: state
              })
            })
          });
          setConnectedPeers((current) => {
            const next = new Set(current);
            if (state === "open") {
              next.add(remotePeerId);
            } else {
              next.delete(remotePeerId);
            }
            return [...next];
          });
          if (state === "open") {
            flushPendingAvailabilityRef.current();
            if (enableTrackCaching) {
              for (const trackId of uploadedTrackIdsRef.current) {
                void announceLocalCacheRef.current(trackId);
              }
            }
          }
        },
        onDataBufferedAmountChange: ({ peerId: remotePeerId, bufferedAmountBytes }) => {
          updatePeerBufferedAmountRef.current(remotePeerId, bufferedAmountBytes);
        },
        onStatsSample: ({ peerId: remotePeerId, sample }) => {
          updateDataTransportStatsRef.current({
            peerId: remotePeerId,
            sample
          });
        },
        onPeerStalled: ({ peerId: remotePeerId, reason }) => {
          updateConnectionSupervisorSignalState({
            peerId: remotePeerId,
            channelKind: "data",
            lastFailureReason: reason
          });
        }
      },
      iceServers,
      {
        autoReconnect: false,
        resolveConnectionConfig: (remotePeerId) => ({
          iceTransportPolicy: resolvePreferredIceTransportPolicy(
            connectionSupervisorStatesRef.current.get(remotePeerId)
          )
        })
      }
    );
    meshRef.current = mesh;
    mesh.setStatsSamplingMode(
      !roomSnapshot?.room.playback.currentTrackId || (!isPageVisible && roomSnapshot?.room.playback.status !== "playing")
        ? "off"
        : bufferHealth !== "healthy"
          ? "active"
          : "steady"
    );
    chunkSchedulerRef.current = new ChunkScheduler(peerId, {
      requestPieces: ({ peerId: remotePeerId, trackId, chunkIndexes, totalChunks, timeoutMs }) =>
        mesh.requestPieces(remotePeerId, trackId, chunkIndexes, totalChunks, timeoutMs),
      resolvePeerRequestWindow: (remotePeerId) => {
        const supervisorState = connectionSupervisorStatesRef.current.get(remotePeerId) ?? null;
        const pieceTransferRates = getPieceTransferRates(pieceTransferRatesRef.current, remotePeerId);
        return {
          currentRoundTripTimeMs: getPeerMedianRttMs(supervisorState),
          downloadRateKbps: pieceTransferRates.downloadRateKbps,
          candidateType: supervisorState?.lastObservedTransportKind ?? null,
          protocol:
            supervisorState?.samples[supervisorState.samples.length - 1]?.protocol ?? null,
          transportScore: supervisorState?.transportScore ?? null
        };
      }
    });

    const mediaMesh = new RoomMediaMesh(
      roomId,
      peerId,
      emitPeerSignal,
      iceServers,
      {
        onPeerRuntimeState: ({
          peerId: remotePeerId,
          transportEpoch,
          negotiationRole,
          publishGeneration,
          attachedTrackId,
          negotiatedTrackId,
          makingOffer,
          signalingState,
          pendingRestart,
          ignoreOffer,
          listenerAwaitingPublisherOffer,
          lastIgnoredOfferReason
        }) => {
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "peer-runtime-state",
            summary: `媒体协商状态：${signalingState}${makingOffer ? " · making-offer" : ""}`,
            recordEvent: false,
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                publishGeneration,
                attachedTrackId,
                negotiatedTrackId,
                makingOffer,
                signalingState
              },
              progressivePlaybackStatus: {
                ...(
                  snapshot.progressivePlaybackStatus ??
                  createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                ),
                transportEpoch,
                mediaNegotiationRole: negotiationRole,
                listenerAwaitingPublisherOffer,
                lastIgnoredOfferReason,
                publishGeneration,
                attachedTrackId,
                negotiatedTrackId,
                makingOffer,
                signalingState
              },
              lastError: ignoreOffer
                ? `媒体 offer 已被忽略：${lastIgnoredOfferReason}`
                : listenerAwaitingPublisherOffer
                  ? "等待房主重新发起音频协商"
                : pendingRestart
                  ? "媒体协商等待当前轮完成后重启"
                  : snapshot.lastError
            })
          });
          if (isCurrentSourceOwner) {
            recordPeerDiagnosticRef.current({
              peerId: "system",
              channelKind: "system",
              direction: "local",
              event: "host-media-publish-state",
              summary: `房主媒体发布代次 ${publishGeneration}`,
              recordEvent: false,
              update: (snapshot) => ({
                ...snapshot,
                progressivePlaybackStatus: {
                  ...(
                    snapshot.progressivePlaybackStatus ??
                    createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                  ),
                  transportEpoch,
                  mediaNegotiationRole: negotiationRole,
                  listenerAwaitingPublisherOffer,
                  lastIgnoredOfferReason,
                  publishGeneration,
                  attachedTrackId,
                  negotiatedTrackId,
                  makingOffer,
                  signalingState
                }
              })
            });
          } else {
            updateRemoteMediaDiagnostic(
              `成员端媒体协商状态：${signalingState}`,
              (snapshot) => ({
                ...snapshot,
                remoteTrackStatus: {
                  ...snapshot.remoteTrackStatus,
                  ...getRemoteMediaTraceContext(remotePeerId),
                  publishGeneration,
                  attachedTrackId,
                  negotiatedTrackId,
                  makingOffer,
                  signalingState,
                  listenerAwaitingPublisherOffer,
                  currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
                  boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
                  playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
                  recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
                  restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
                },
                progressivePlaybackStatus: {
                  ...(
                  snapshot.progressivePlaybackStatus ??
                    createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                  ),
                  transportEpoch,
                  mediaNegotiationRole: negotiationRole,
                  listenerAwaitingPublisherOffer,
                  lastIgnoredOfferReason
                }
              }),
              {
                event: "remote-peer-runtime"
              }
            );
          }
        },
        onRemoteStream: (stream) => {
          const remoteAudio = remoteAudioRef.current;
          if (!remoteAudio) {
            return;
          }
          const traceContext = getRemoteMediaTraceContext();
          listenerMediaLifecycleRef.current.latestStream = stream;

          if (remoteAudio.srcObject !== stream) {
            resetRemoteAudioElement(stream, {
              deferNullReset:
                !stream && currentRoomRef.current?.room.playback.status === "playing",
              generation: listenerMediaLifecycleRef.current.currentGeneration
            });
            updateRemoteMediaDiagnostic(
              stream ? "远端媒体流已绑定到音频元素" : "远端媒体流已清空",
              (snapshot) => ({
                ...snapshot,
                remoteTrackStatus: {
                  ...snapshot.remoteTrackStatus,
                  ...traceContext,
                  ...getRemoteAudioDiagnostics(),
                  boundToAudioElement: !!stream,
                  lastBoundAt: stream
                    ? new Date().toISOString()
                    : snapshot.remoteTrackStatus.lastBoundAt,
                  currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
                  boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
                  playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
                  recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
                  restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
                }
              }),
              {
                event: "remote-stream-bound"
              }
            );
          }

          if (stream) {
            armListenerMediaRecoveryRef.current(listenerMediaLifecycleRef.current.currentGeneration);
            scheduleRemotePlaybackRetryRef.current(
              0,
              listenerMediaLifecycleRef.current.currentGeneration
            );
          }
        },
        onConnectionStateChange: ({
          peerId: remotePeerId,
          state,
          connectedPeerIds,
          recoverableFailure
        }) => {
          const currentSourcePeerId = currentRoomRef.current?.room.playback.sourcePeerId ?? null;
          const diagnosticPeerId = resolveMediaDiagnosticPeerId({
            remotePeerId,
            connectedPeerIds,
            currentSourcePeerId
          });
          const supervisorState =
            diagnosticPeerId !== "remote-media"
              ? updateConnectionSupervisorSignalState({
                  peerId: diagnosticPeerId,
                  channelKind: "media",
                  mediaConnectionState: state,
                  lastFailureReason:
                    state === "failed" || state === "closed" ? "media-failed" : undefined
                })
              : null;
          recordPeerDiagnosticRef.current({
            peerId: diagnosticPeerId,
            channelKind: "media",
            direction: "local",
            event: "connection-state",
            summary: `Media 连接状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
                mediaConnectionState: state
              }),
              progressivePlaybackStatus: {
                ...(
                  snapshot.progressivePlaybackStatus ??
                  createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                ),
                mediaBootstrapState:
                  state === "connected"
                    ? "steady"
                    : state === "connecting" || state === "new"
                      ? "bootstrapping"
                      : recoverableFailure || state === "disconnected"
                        ? "recovering"
                        : state === "failed" || state === "closed"
                          ? "failed"
                          : snapshot.progressivePlaybackStatus?.mediaBootstrapState ?? "idle",
                mediaFailureReason:
                  state === "disconnected"
                    ? "ice-disconnected-grace"
                    : state === "closed" && recoverableFailure
                      ? "peer-closed-before-stream"
                      : state === "failed" && recoverableFailure
                        ? "no-playout-progress"
                        : snapshot.progressivePlaybackStatus?.mediaFailureReason ?? null,
                mediaTransportState:
                  state === "connected"
                    ? "connected"
                    : state === "failed" || state === "closed"
                      ? "failed"
                    : state === "connecting" || state === "new"
                        ? "prewarming"
                        : snapshot.progressivePlaybackStatus?.mediaTransportState ?? "idle",
                transportEpoch: mediaTransportEpochRef.current,
                dataRequiredForPlayback: enableTrackCaching,
                firstTransportConnectedAt:
                  state === "connected"
                    ? snapshot.progressivePlaybackStatus?.firstTransportConnectedAt ??
                      new Date().toISOString()
                    : snapshot.progressivePlaybackStatus?.firstTransportConnectedAt ?? null
              }
            })
          });
          setMediaConnectedPeers(connectedPeerIds);

          if (state === "connected") {
            setMediaConnectionState((current) => (current === "live" ? current : "buffering"));
            armListenerMediaRecoveryRef.current(listenerMediaLifecycleRef.current.currentGeneration);
            scheduleRemotePlaybackRetryRef.current(
              0,
              listenerMediaLifecycleRef.current.currentGeneration
            );
            return;
          }

          if (state === "connecting" || state === "new") {
            setMediaConnectionState((current) =>
              current === "live" || current === "buffering" ? current : "connecting"
            );
            return;
          }

          if (state === "failed") {
            setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
            return;
          }

          if (state === "disconnected" || state === "closed") {
            setMediaConnectionState((current) =>
              recoverableFailure || current === "live" || current === "buffering"
                ? resolveSoftRecoveryMediaState("reconnecting")
                : "idle"
            );
          }
        },
        onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
          const supervisorState = updateConnectionSupervisorSignalState({
            peerId: remotePeerId,
            channelKind: "media",
            mediaIceState: state,
            lastFailureReason: state === "failed" ? "ice-failed" : undefined
          });
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "ice-state",
            summary: `Media ICE 状态：${state}`,
            update: (snapshot) => ({
              ...withResolvedTransportHealth({
                ...withSupervisorDiagnosticPatch(snapshot, supervisorState),
                mediaIceState: state
              })
            })
          });
        },
        onRemoteTrack: ({
          peerId: remotePeerId,
          trackId,
          trackMuted,
          trackEnabled,
          trackReadyState
        }) => {
          const now = new Date().toISOString();
          const traceContext = getRemoteMediaTraceContext(remotePeerId);
          listenerMediaLifecycleRef.current.lastTrackTraceKey = traceContext.traceKey;
          listenerMediaLifecycleRef.current.recoveryStage = "waiting-track";
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "remote-track",
            summary: traceContext.traceKey
              ? `收到远端 track ${trackId} · ${traceContext.traceKey}`
              : `收到远端 track ${trackId}`,
            update: (snapshot) => ({
              ...snapshot,
              remoteTrackStatus: {
                ...snapshot.remoteTrackStatus,
                ...traceContext,
                trackId,
                trackMuted,
                trackEnabled,
                trackReadyState,
                received: true,
                lastTrackAt: now,
                currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
                boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
                playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
                recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
                restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
              }
            })
          });
          updateRemoteMediaDiagnostic(
            `成员端收到远端 track ${trackId}`,
            (snapshot) => ({
              ...snapshot,
               remoteTrackStatus: {
                 ...snapshot.remoteTrackStatus,
                 ...traceContext,
                 trackId,
                 trackMuted,
                 trackEnabled,
                 trackReadyState,
                 received: true,
                 lastTrackAt: now,
                 currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
                 boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
                 playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
                 recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
                 restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
               }
            }),
            {
              event: "remote-track"
            }
          );
          armListenerMediaRecoveryRef.current(listenerMediaLifecycleRef.current.currentGeneration);
        },
        onSourcePeerFailed: ({ peerId: remotePeerId, mediaEpoch }) => {
          updateConnectionSupervisorSignalState({
            peerId: remotePeerId,
            channelKind: "media",
            mediaConnectionState: "failed",
            lastFailureReason: "media-failed"
          });
          if (currentRoomRef.current?.room.playback.sourcePeerId === remotePeerId) {
            listenerMediaLifecycleRef.current.latestStream = null;
            listenerMediaLifecycleRef.current.boundGeneration = null;
            listenerMediaLifecycleRef.current.lastBoundTraceKey = null;
            resetRemoteAudioElement(null, {
              generation: listenerMediaLifecycleRef.current.currentGeneration,
              reason: "source-peer-failed"
            });
          }
          recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "source-peer-failed",
            level: "warning",
            summary: `媒体源 ${remotePeerId} 失效，mediaEpoch=${mediaEpoch}`,
            update: (snapshot) => ({
              ...snapshot,
              lastError: `媒体源 ${remotePeerId} 已失效`
            })
          });
          setMediaConnectionState(resolveSoftRecoveryMediaState("reconnecting"));
        },
        onStatsSample: ({ peerId: remotePeerId, sample }) => {
          updateMediaTransportStatsRef.current({
            peerId: remotePeerId,
            sample
          });
        }
      },
      {
        resolveConnectionConfig: (remotePeerId) => ({
          iceTransportPolicy: resolvePreferredIceTransportPolicy(
            connectionSupervisorStatesRef.current.get(remotePeerId)
          )
        })
      }
    );
    mediaMeshRef.current = mediaMesh;
    mediaMesh.setStatsSamplingMode(
      !roomSnapshot?.room.playback.currentTrackId || (!isPageVisible && roomSnapshot?.room.playback.status !== "playing")
        ? "off"
        : isCurrentSourceOwner || activePlaybackSource !== "remote-stream" || bufferHealth !== "healthy"
          ? "active"
          : "steady"
    );

    const resyncRealtimePeers = (
      members: Array<{ peerId: string | null }> = currentRoomRef.current?.room.members ?? []
    ) => {
      const remotePeerIds = members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId);

      void mesh.syncPeers(remotePeerIds).catch((error) => {
        reportRealtimeFailureRef.current({
          peerId: "system",
          channelKind: "system",
          event: "mesh-resync-failed",
          summary: "Failed to resync data peers",
          error
        });
      });
    };

    const clearSubscribeRetry = () => {
      if (subscribeRetryId !== null) {
        window.clearTimeout(subscribeRetryId);
        subscribeRetryId = null;
      }
      if (subscribeAckTimeoutId !== null) {
        window.clearTimeout(subscribeAckTimeoutId);
        subscribeAckTimeoutId = null;
      }
    };

    const scheduleSubscribeRetry = (attempt: number) => {
      if (subscribeRetryId !== null) {
        return;
      }

      const delay =
        subscribeRetryBackoffMs[Math.min(attempt, subscribeRetryBackoffMs.length - 1)] ??
        subscribeRetryBackoffMs[subscribeRetryBackoffMs.length - 1];
      subscribeRetryId = window.setTimeout(() => {
        subscribeRetryId = null;
        subscribeToRoom(attempt);
      }, delay);
    };

    const subscribeToRoom = (attempt = 0) => {
      const currentSession = activeSessionRef.current;
      if (!socket.connected || !currentSession?.userId || !peerId) {
        scheduleSubscribeRetry(attempt + 1);
        return;
      }

      setRoomRecoveryState((current) => ({
        ...current,
        phase: "joining",
        mode: current.generation === null ? "late-join" : "rejoin",
        pendingSnapshot: true,
        pendingData: enableTrackCaching,
        pendingMedia: true,
        bootstrapStartedAt: null,
        bootstrapSourcePeerId: null,
        listenerBootstrapAttempts: 0,
        fullLocalRecoveryActive: false
      }));

      if (subscribeAckTimeoutId !== null) {
        window.clearTimeout(subscribeAckTimeoutId);
      }
      subscribeAckTimeoutId = window.setTimeout(() => {
        subscribeAckTimeoutId = null;
        scheduleSubscribeRetry(attempt + 1);
      }, subscribeAckTimeoutMs);

      socket.emit(
        "room.subscribe",
        {
          roomId,
          sessionId: currentSession.userId,
          peerId
        },
        (response?: RoomSubscribeAckPayload) => {
          if (subscribeAckTimeoutId !== null) {
            window.clearTimeout(subscribeAckTimeoutId);
            subscribeAckTimeoutId = null;
          }
          if (!response?.ok) {
            scheduleSubscribeRetry(attempt + 1);
            return;
          }

          clearSubscribeRetry();
          applySubscribeBootstrap(response);
          startPresenceHeartbeat();
          resyncRealtimePeers(response.bootstrap?.members ?? undefined);
          flushPendingAvailabilityRef.current();
          if (enableTrackCaching) {
            for (const trackId of uploadedTrackIdsRef.current) {
              void announceLocalCacheRef.current(trackId);
            }
          }
          if (currentRoomRef.current?.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
            void ensureSourcePlaybackStartedRef.current();
          }
          void requestRoomSnapshotResyncRef.current("subscribe-ack", roomId);
        }
      );
    };
    resubscribeRoomRef.current = () => {
      if (!socket.connected) {
        socket.connect();
      }
      subscribeToRoom();
      emitPresence();
      void requestRoomSnapshotResyncRef.current("subscribe-ack", roomId);
    };
    const exitAndStopPresence = (message: string) => {
      stopPresenceHeartbeat();
      exitCurrentRoom(message);
    };

    socket.on("connect", () => {
      subscribeToRoom();
      flushPendingAvailabilityRef.current();
      if (enableTrackCaching) {
        for (const trackId of uploadedTrackIdsRef.current) {
          void announceLocalCacheRef.current(trackId);
        }
      }
      resyncRealtimePeers();
      if (currentRoomRef.current?.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
        void ensureSourcePlaybackStartedRef.current();
      }
      void requestRoomSnapshotResyncRef.current("socket-connect", roomId);
      const joinCode = currentRoomRef.current?.room.joinCode;
      if (joinCode) {
        setStatusMessage(`已连接到房间 ${joinCode}。`);
      }
    });
    let didReplayLocalAvailability = false;

    socket.on("room.snapshot", (snapshot: RoomSnapshot) => {
      if (snapshot.room.id !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-snapshot",
        snapshot
      });
      setRoomRecoveryState((current) => ({
        ...current,
        phase:
          enableTrackCaching && current.fullLocalRecoveryActive
            ? "playing-local-fallback"
            : "resyncing",
        pendingSnapshot: false
      }));
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);

      if (!didReplayLocalAvailability) {
        didReplayLocalAvailability = true;
        if (enableTrackCaching) {
          for (const trackId of uploadedTrackIdsRef.current) {
            void announceLocalCacheRef.current(trackId);
          }
        }
      }

      flushPendingAvailabilityRef.current();
      resyncRealtimePeers(snapshot.room.members);
      if (snapshot.room.playback.sourceSessionId === activeSessionRef.current?.userId) {
        window.setTimeout(() => {
          if (activeRouteRoomIdRef.current === roomId) {
            void ensureSourcePlaybackStartedRef.current();
          }
        }, 0);
      }
    });
    socket.on("room.playback.patch", ({ playback }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      dispatchRoomStateEvent({
        type: "server-playback-patch",
        roomId,
        playback
      });
    });
    socket.on("room.media.clock", (payload: RoomMediaClockPayload) => {
      if (payload.roomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      const currentPlayback = currentRoomRef.current?.room.playback;
      if (
        !currentPlayback ||
        payload.mediaEpoch !== currentPlayback.mediaEpoch ||
        (currentPlayback.sourcePeerId && payload.sourcePeerId !== currentPlayback.sourcePeerId)
      ) {
        return;
      }

      setAuthoritativeMediaClock((current) => {
        if (
          current &&
          current.mediaEpoch === payload.mediaEpoch &&
          current.sourcePeerId === payload.sourcePeerId &&
          current.relayGeneration > payload.relayGeneration
        ) {
          return current;
        }

        if (
          current &&
          current.mediaEpoch === payload.mediaEpoch &&
          current.sourcePeerId === payload.sourcePeerId &&
          current.relayGeneration === payload.relayGeneration &&
          current.sequence > payload.sequence
        ) {
          return current;
        }

        return {
          ...payload,
          receivedAtMs: Date.now()
        };
      });
    });
    socket.on("room.queue.patch", ({ queue, playback, roomRevision }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-queue-patch",
        roomId,
        queue,
        playback,
        roomRevision
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);
    });
    socket.on("room.presence.patch", ({ members, playback, presenceRevision, roomRevision }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-presence-patch",
        roomId,
        members,
        playback,
        presenceRevision,
        roomRevision
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);
      resyncRealtimePeers(members);
      if (playback.sourceSessionId === activeSessionRef.current?.userId) {
        window.setTimeout(() => {
          if (activeRouteRoomIdRef.current === roomId) {
            void ensureSourcePlaybackStartedRef.current();
          }
        }, 0);
      }
    });
    socket.on("room.library.patch", ({ tracks, queue, playback, roomRevision }) => {
      if (activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      lastRealtimeRoomEventAtRef.current = Date.now();
      dispatchRoomStateEvent({
        type: "server-library-patch",
        roomId,
        tracks,
        queue,
        playback,
        roomRevision
      });
      void requestRoomSnapshotResyncRef.current("realtime-room-event", roomId);
    });
    socket.on("peer.signal", (payload) => {
      if (payload.roomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }

      if (
        !shouldAcceptIncomingPeerSignalRecoveryGeneration({
          payloadRecoveryGeneration: payload.recoveryGeneration,
          currentRecoveryGeneration: recoveryGenerationRef.current
        })
      ) {
        recordPeerDiagnosticRef.current({
          peerId: payload.fromPeerId,
          channelKind: payload.channelKind,
          direction: "received",
          event: "stale-signal-dropped",
          summary: `丢弃旧恢复代次信令 ${payload.recoveryGeneration}`,
          level: "warning",
          recordEvent: false
        });
        return;
      }

      const traceContext =
        payload.channelKind === "media" ? getRemoteMediaTraceContext(payload.fromPeerId) : null;
      recordPeerDiagnosticRef.current({
        peerId: payload.fromPeerId,
        channelKind: payload.channelKind,
        direction: "received",
        event: payload.type,
        summary:
          payload.channelKind === "media" && traceContext?.traceKey
            ? `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type} · ${traceContext.traceKey}`
            : `收到 ${payload.fromPeerId} 的 ${payload.channelKind} ${payload.type}`,
        update: (snapshot) => ({
          ...snapshot,
          remoteTrackStatus:
            payload.channelKind === "media"
              ? {
                  ...snapshot.remoteTrackStatus,
                  ...traceContext
                }
              : snapshot.remoteTrackStatus,
          signalStats: {
            ...snapshot.signalStats,
            receivedOffers:
              snapshot.signalStats.receivedOffers + (payload.type === "offer" ? 1 : 0),
            receivedAnswers:
              snapshot.signalStats.receivedAnswers + (payload.type === "answer" ? 1 : 0),
            receivedCandidates:
              snapshot.signalStats.receivedCandidates + (payload.type === "candidate" ? 1 : 0)
          }
        })
      });
      if (payload.channelKind === "media") {
        void mediaMesh.handleSignal(payload).catch((error) => {
          handleSignalFailure(payload, error);
        });
        return;
      }

      void mesh.handleSignal(payload).catch((error) => {
        handleSignalFailure(payload, error);
      });
    });
    socket.on("piece.availability", (announcement: TrackAvailabilityAnnouncement) => {
      if (announcement.roomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }
      if (!enableTrackCaching) {
        return;
      }
      recordPeerDiagnosticRef.current({
        peerId: announcement.ownerPeerId,
        channelKind: "data",
        direction: "received",
        event: "piece-availability",
        summary: `收到 ${announcement.ownerPeerId} 的分片公告`,
        recordEvent: false,
        update: (snapshot) => ({
          ...withResolvedTransportHealth({
            ...snapshot,
            lastAvailabilitySeenAt: new Date().toISOString()
          })
        })
      });
      queueAvailabilityRef.current(announcement);
    });
    socket.on("piece.availability.clear", ({ roomId: clearedRoomId, ownerPeerId }) => {
      if (clearedRoomId !== roomId || activeRouteRoomIdRef.current !== roomId) {
        return;
      }
      if (!enableTrackCaching) {
        return;
      }
      clearAvailabilityForPeerRef.current(ownerPeerId);
    });
    socket.on("room.session.replaced", ({ roomId: replacedRoomId }) => {
      if (replacedRoomId !== roomId) {
        return;
      }

      socket.disconnect();
      exitAndStopPresence("同一账号已在其他标签页或设备进入这个房间，当前页面已退出房间。");
    });
    socket.on("room.deleted", ({ roomId: deletedRoomId, trackIds }) => {
      if (deletedRoomId !== roomId) {
        return;
      }

      const roomTrackIds =
        trackIds.length > 0
          ? trackIds
          : (currentRoomRef.current?.tracks.map((track) => track.id) ?? []);
      void Promise.resolve(deleteRoomTrackArtifactsRef.current(roomTrackIds));
      exitAndStopPresence("房间已解散，当前房间的歌单和本地缓存已清理。");
    });
    socket.on("room.snapshot.missing", () => {
      if (isNavigatingRoomExit) {
        return;
      }

      exitAndStopPresence("这个房间已不可用，请返回音乐房重新加入。");
    });
    socket.on("connect_error", (error) => {
      recordPeerDiagnosticRef.current({
        peerId: "system",
        channelKind: "system",
        direction: "local",
        event: "socket-connect-error",
        level: "error",
        summary: `实时连接失败：${toUserFacingError(error)}`,
        update: (snapshot) => ({
          ...snapshot,
          lastError: toUserFacingError(error)
        })
      });
      setStatusMessage(`实时连接失败：${toUserFacingError(error)}`);
    });
    socket.on("disconnect", (reason) => {
      stopPresenceHeartbeat();
      stopRecoveryWatchdog();
      bumpMediaTransportEpoch("socket-reconnect");
      hostMediaSyncStateRef.current.lastAppliedKey = null;
      hostMediaSyncStateRef.current.pendingKey = null;
      setConnectedPeers([]);
      setMediaConnectedPeers([]);
      setAuthoritativeMediaClock(null);
      resetRemoteAudioElement(null);
      setMediaConnectionState(
        currentRoomRef.current?.room.playback.status === "playing"
          ? resolveSocketRecoveryMediaState()
          : "idle"
      );
      setRoomRecoveryState((current) => ({
        ...current,
        phase:
          enableTrackCaching && current.fullLocalRecoveryActive
            ? "playing-local-fallback"
            : "joining",
        mode: current.generation === null ? current.mode : "rejoin",
        pendingSnapshot: true,
        pendingData: enableTrackCaching,
        pendingMedia: !(enableTrackCaching && current.fullLocalRecoveryActive)
      }));

      if (reason === "io client disconnect") {
        return;
      }
      setStatusMessage("实时连接已断开，正在尝试重新连接…");
    });

    return () => {
      stopPresenceHeartbeat();
      stopRecoveryWatchdog();
      clearSubscribeRetry();
      if (remotePlaybackRetryRef.current !== null) {
        window.clearTimeout(remotePlaybackRetryRef.current);
        remotePlaybackRetryRef.current = null;
      }
      clearListenerMediaRecovery();
      clearHostMediaSyncRetry();
      socket.emit("room.unsubscribe", { roomId });
      socket.disconnect();
      socketRef.current = null;
      resubscribeRoomRef.current = null;
      mesh.destroy();
      meshRef.current = null;
      chunkSchedulerRef.current = null;
      mediaMesh.destroy();
      mediaMeshRef.current = null;
      connectionSupervisorStatesRef.current.clear();
      pieceRequestSamplesRef.current.clear();
      sourceRecoveryCoordinatorRef.current = {
        actionKey: null,
        action: null,
        startedAtMs: null
      };
      hostStreamRef.current = null;
      hostMediaSyncStateRef.current = {
        inFlight: false,
        lastAppliedKey: null,
        pendingKey: null,
        lastCaptureRefreshKey: null,
        lastPublishKey: null,
        retryKey: null,
        publishGeneration: 0,
        stage: "idle",
        lastPublishedListenerSet: null
      };
      setConnectedPeers([]);
      setMediaConnectedPeers([]);
      setAuthoritativeMediaClock(null);
      setMediaConnectionState("idle");
      setRoomRecoveryState((current) => ({
        ...current,
        phase: "joining",
        mode: "steady",
        generation: null,
        bootstrapStartedAt: null,
        bootstrapSourcePeerId: null,
        pendingSnapshot: false,
        pendingData: false,
        pendingMedia: false,
        listenerBootstrapAttempts: null,
        fullLocalRecoveryActive: false
      }));
    };
  }, [
    applySubscribeBootstrap,
    roomSnapshot?.room.id,
    hydrated,
    iceConfig,
    iceConfigResolved,
    peerId,
    activeSessionRef,
    currentRoomRef,
    uploadedTrackIdsRef,
    clearHostMediaSyncRetry,
    clearListenerMediaRecovery,
    stopRecoveryWatchdog,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    chunkSchedulerRef,
    emitPresence,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    remoteAudioRef,
    resetRemoteAudioElement,
    isNavigatingRoomExit,
    setConnectedPeers,
    setMediaConnectedPeers,
    setAuthoritativeMediaClock,
    setMediaConnectionState,
    setRoomRecoveryState,
    exitCurrentRoom,
    setStatusMessage,
    updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback ?? null;
    const currentTrackId = playback?.currentTrackId ?? null;
    const sourcePeerId = playback?.sourcePeerId ?? null;
    const hasFullLocalTrack =
      enableTrackCaching && !!(currentTrackId && uploadedTracks[currentTrackId]);
    const dataReady = !enableTrackCaching || !!(sourcePeerId && connectedPeers.includes(sourcePeerId));
    const continuity = resolveSourceContinuityState();
    const mediaNoProgressMs =
      continuity.consecutiveNoProgressMs ??
      (lastSubscribeAckAtRef.current !== null ? Date.now() - lastSubscribeAckAtRef.current : null);
    const remoteMediaStillProtected =
      continuity.audibleSource === "remote-stream" &&
      (mediaNoProgressMs === null || mediaNoProgressMs < recoveryMediaRestartThresholdMs);
    const mediaReady =
      !!(sourcePeerId && mediaConnectedPeers.includes(sourcePeerId)) ||
      mediaConnectionState === "live" ||
      remoteMediaStillProtected ||
      continuity.audibleSource === "progressive-local" ||
      continuity.audibleSource === "full-local";

    if (
      !roomSnapshot?.room.id ||
      !playback ||
      !playback.currentTrackId ||
      !roomRecoveryState.generation ||
      isCurrentSourceOwner
    ) {
      stopRecoveryWatchdog();
      recoveryWatchdogActionsRef.current = {
        snapshotResyncKey: null,
        softMediaRetryKey: null,
        dataRestartKey: null,
        mediaRestartKey: null,
        fullResubscribeKey: null
      };
      return;
    }

    setRoomRecoveryState((current) => {
      const nextPhase =
        enableTrackCaching && current.fullLocalRecoveryActive && hasFullLocalTrack
          ? "playing-local-fallback"
          : current.pendingSnapshot
            ? "resyncing"
            : !dataReady
              ? "bootstrapping-data"
              : !mediaReady
                ? "bootstrapping-media"
                : "steady";
      const nextFullLocalRecoveryActive =
        enableTrackCaching && (current.fullLocalRecoveryActive || hasFullLocalTrack);
      if (
        current.phase === nextPhase &&
        current.pendingData === !dataReady &&
        current.pendingMedia === !mediaReady &&
        current.fullLocalRecoveryActive === nextFullLocalRecoveryActive
      ) {
        return current;
      }

      return {
        ...current,
        phase: nextPhase,
        pendingData: !dataReady,
        pendingMedia: !mediaReady,
        fullLocalRecoveryActive: nextFullLocalRecoveryActive
      };
    });

    if (playback.status !== "playing" || lastSubscribeAckAtRef.current === null) {
      stopRecoveryWatchdog();
      return;
    }

    stopRecoveryWatchdog();
    recoveryWatchdogIntervalRef.current = window.setInterval(() => {
      const ackAt = lastSubscribeAckAtRef.current;
      const currentPlayback = currentRoomRef.current?.room.playback;
      const latestTrackId = currentPlayback?.currentTrackId ?? null;
      const latestSourcePeerId = currentPlayback?.sourcePeerId ?? null;
      const latestGeneration = recoveryGenerationRef.current;
      if (!ackAt || !currentPlayback || !latestTrackId || !latestSourcePeerId || latestGeneration === null) {
        return;
      }

      const now = Date.now();
      const ageMs = now - ackAt;
      const recoveryKey = [
        roomSnapshot.room.id,
        latestTrackId,
        currentPlayback.mediaEpoch,
        latestGeneration,
        latestSourcePeerId
      ].join("|");
      const latestHasFullLocalTrack = enableTrackCaching && !!uploadedTracks[latestTrackId];
      const latestDataReady = !enableTrackCaching || connectedPeers.includes(latestSourcePeerId);
      const continuity = resolveSourceContinuityState(now);
      const noProgressMs = continuity.consecutiveNoProgressMs ?? ageMs;
      const noDataProgressMs =
        lastDataActivityAtRef.current !== null ? now - lastDataActivityAtRef.current : ageMs;
      const hasProtectedAudibleSource =
        continuity.audibleSource === "progressive-local" ||
        continuity.audibleSource === "full-local" ||
        (continuity.audibleSource === "remote-stream" &&
          noProgressMs < recoveryMediaRestartThresholdMs);
      const latestMediaReady =
        mediaConnectedPeers.includes(latestSourcePeerId) ||
        mediaConnectionState === "live" ||
        hasProtectedAudibleSource;

      if (roomRecoveryState.pendingSnapshot && ageMs >= 1_500) {
        const snapshotResyncKey = `${recoveryKey}|snapshot`;
        if (recoveryWatchdogActionsRef.current.snapshotResyncKey !== snapshotResyncKey) {
          recoveryWatchdogActionsRef.current.snapshotResyncKey = snapshotResyncKey;
          void requestRoomSnapshotResyncRef.current("subscribe-ack", roomSnapshot.room.id);
        }
      }

      if (!latestMediaReady && noProgressMs >= recoverySoftRetryThresholdMs) {
        const mediaRetryKey = `${recoveryKey}|soft-media`;
        if (recoveryWatchdogActionsRef.current.softMediaRetryKey !== mediaRetryKey) {
          recoveryWatchdogActionsRef.current.softMediaRetryKey = mediaRetryKey;
          setRoomRecoveryState((current) => ({
            ...current,
            phase: latestHasFullLocalTrack ? "playing-local-fallback" : "bootstrapping-media",
            fullLocalRecoveryActive: latestHasFullLocalTrack,
            listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
          }));
          if (latestHasFullLocalTrack) {
            return;
          }
          scheduleRemotePlaybackRetryRef.current(0, listenerMediaLifecycleRef.current.currentGeneration);
        }
      }

      if (!latestDataReady && noDataProgressMs >= recoveryDataRestartThresholdMs) {
        const dataRestartKey = `${recoveryKey}|data`;
        if (recoveryWatchdogActionsRef.current.dataRestartKey !== dataRestartKey) {
          recoveryWatchdogActionsRef.current.dataRestartKey = dataRestartKey;
          setRoomRecoveryState((current) => ({
            ...current,
            phase: "bootstrapping-data",
            listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
          }));
          void meshRef.current?.restartPeer(latestSourcePeerId);
        }
      }

      if (!latestMediaReady && noProgressMs >= recoveryMediaRestartThresholdMs) {
        if (latestHasFullLocalTrack) {
          setRoomRecoveryState((current) => ({
            ...current,
            phase: "playing-local-fallback",
            fullLocalRecoveryActive: true,
            pendingMedia: true
          }));
        } else if (!hasProtectedAudibleSource) {
          const mediaRestartKey = `${recoveryKey}|media`;
          if (recoveryWatchdogActionsRef.current.mediaRestartKey !== mediaRestartKey) {
            recoveryWatchdogActionsRef.current.mediaRestartKey = mediaRestartKey;
            setRoomRecoveryState((current) => ({
              ...current,
              phase: "bootstrapping-media",
              listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
            }));
            void mediaMeshRef.current?.restartListenerIce(latestSourcePeerId);
          }
        }
      }

      if (
        !latestDataReady &&
        !latestMediaReady &&
        noProgressMs >= recoveryFullResubscribeThresholdMs &&
        noDataProgressMs >= recoveryFullResubscribeThresholdMs &&
        !hasProtectedAudibleSource &&
        !latestHasFullLocalTrack
      ) {
        const fullResubscribeKey = `${recoveryKey}|resubscribe`;
        if (recoveryWatchdogActionsRef.current.fullResubscribeKey !== fullResubscribeKey) {
          recoveryWatchdogActionsRef.current.fullResubscribeKey = fullResubscribeKey;
          setRoomRecoveryState((current) => ({
            ...current,
            phase: latestHasFullLocalTrack ? "playing-local-fallback" : "resyncing",
            pendingSnapshot: true,
            listenerBootstrapAttempts: (current.listenerBootstrapAttempts ?? 0) + 1
          }));
          resubscribeRoomRef.current?.();
          void meshRef.current?.restartPeer(latestSourcePeerId);
          const nextTransportEpoch = bumpMediaTransportEpoch("explicit-hard-reset");
          mediaMeshRef.current?.setTransportEpoch(nextTransportEpoch);
          void mediaMeshRef.current?.resetListenerPeer(latestSourcePeerId);
        }
      }
    }, 500);

    return () => {
      stopRecoveryWatchdog();
    };
  }, [
    connectedPeers,
    isCurrentSourceOwner,
    mediaConnectedPeers,
    mediaConnectionState,
    resolveSourceContinuityState,
    roomRecoveryState.fullLocalRecoveryActive,
    roomRecoveryState.generation,
    roomRecoveryState.pendingSnapshot,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback,
    setRoomRecoveryState,
    stopRecoveryWatchdog,
    uploadedTracks
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !activeSession?.userId || !peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }

    const localMember =
      roomSnapshot.room.members.find((member) => member.id === activeSession.userId) ?? null;
    if (!localMember) {
      presenceRepairKeyRef.current = null;
      return;
    }

    if (localMember.presenceState === "online" && localMember.peerId === peerId) {
      presenceRepairKeyRef.current = null;
      return;
    }

    const repairKey = [
      roomSnapshot.room.id,
      roomSnapshot.room.presenceRevision,
      localMember.peerId ?? "none",
      localMember.presenceState,
      peerId
    ].join("|");
    if (presenceRepairKeyRef.current === repairKey) {
      return;
    }
    presenceRepairKeyRef.current = repairKey;

    const socket = socketRef.current;
    if (!socket?.connected) {
      return;
    }

    startPresenceHeartbeat();
    emitPresence();
    void requestRoomSnapshotResync("subscribe-ack", roomSnapshot.room.id);
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.presenceRevision,
    activeSession?.userId,
    peerId,
    emitPresence,
    requestRoomSnapshotResync,
    startPresenceHeartbeat
  ]);

  useEffect(() => {
    if (
      !initialRoomId ||
      !hydrated ||
      !activeSession?.userId ||
      isNavigatingRoomExit ||
      roomSnapshot?.room.id !== initialRoomId
    ) {
      if (!initialRoomId || roomSnapshot?.room.id !== initialRoomId) {
        initialRoomSnapshotResyncKeyRef.current = null;
      }
      return;
    }

    const resyncKey = `${activeSession.userId}:${initialRoomId}`;
    if (initialRoomSnapshotResyncKeyRef.current === resyncKey) {
      return;
    }
    initialRoomSnapshotResyncKeyRef.current = resyncKey;

    void requestRoomSnapshotResync("subscribe-ack", initialRoomId);
  }, [
    initialRoomId,
    hydrated,
    activeSession?.userId,
    isNavigatingRoomExit,
    roomSnapshot?.room.id,
    requestRoomSnapshotResync
  ]);

  useEffect(() => {
    const roomId = roomSnapshot?.room.id ?? null;
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    const playbackQueueVersion = roomSnapshot?.room.playback.queueVersion ?? 0;

    if (!roomId || !currentTrackId) {
      trackMetadataRepairKeyRef.current = null;
      return;
    }

    if (roomSnapshot?.tracks.some((track) => track.id === currentTrackId)) {
      trackMetadataRepairKeyRef.current = null;
      return;
    }

    const repairKey = [
      roomId,
      currentTrackId,
      playbackQueueVersion
    ].join("|");
    if (trackMetadataRepairKeyRef.current === repairKey) {
      return;
    }
    trackMetadataRepairKeyRef.current = repairKey;

    void requestRoomSnapshotResync("subscribe-ack", roomId);
  }, [
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.queueVersion,
    roomSnapshot?.tracks,
    requestRoomSnapshotResync
  ]);

  useEffect(() => {
    const currentTrackId = roomSnapshot?.room.playback.currentTrackId ?? null;
    if (!enableTrackCaching || !currentTrackId) {
      return;
    }

    if (!uploadedTracks[currentTrackId]) {
      return;
    }

    void announceLocalCacheRef.current(currentTrackId);
  }, [roomSnapshot?.room.playback.currentTrackId, uploadedTracks]);

  useEffect(() => {
    const playback = roomSnapshot?.room.playback;
    const remoteAudio = remoteAudioRef.current;
    const generation = listenerMediaLifecycleRef.current.currentGeneration;
    const shouldResume = shouldResumeRemotePlaybackAfterAudioUnlock({
      audioUnlocked,
      isCurrentSourceOwner,
      activePlaybackSource,
      playbackStatus: playback?.status,
      currentTrackId: playback?.currentTrackId ?? null,
      hasRemoteSrcObject: !!remoteAudio?.srcObject,
      remoteAudioPaused: remoteAudio?.paused ?? null
    });

    if (!shouldResume || !generation || listenerMediaLifecycleRef.current.currentGeneration !== generation) {
      remotePlaybackResumeAfterUnlockKeyRef.current = null;
      return;
    }

    const resumeKey = [
      roomSnapshot?.room.id ?? "room",
      playback?.currentTrackId ?? "track",
      playback?.mediaEpoch ?? 0,
      generation
    ].join("|");
    if (remotePlaybackResumeAfterUnlockKeyRef.current === resumeKey) {
      return;
    }
    remotePlaybackResumeAfterUnlockKeyRef.current = resumeKey;

    updateRemoteMediaDiagnostic(
      "房间音频解锁后重新拉起远端播放",
      (snapshot) => ({
        ...snapshot,
        mediaConnectionState: "buffering",
        remoteTrackStatus: {
          ...snapshot.remoteTrackStatus,
          ...getRemoteMediaTraceContext(playback?.sourcePeerId ?? null),
          ...getRemoteAudioDiagnostics(),
          currentGeneration: listenerMediaLifecycleRef.current.currentGeneration,
          boundGeneration: listenerMediaLifecycleRef.current.boundGeneration,
          playingGeneration: listenerMediaLifecycleRef.current.playingGeneration,
          recoveryStage: listenerMediaLifecycleRef.current.recoveryStage,
          restartAttempt: listenerMediaLifecycleRef.current.restartAttempt
        }
      }),
      {
        event: "remote-play-after-unlock",
        recordEvent: false
      }
    );
    scheduleRemotePlaybackRetry(0, generation);
  }, [
    activePlaybackSource,
    audioUnlocked,
    getRemoteAudioDiagnostics,
    getRemoteMediaTraceContext,
    isCurrentSourceOwner,
    remoteAudioRef,
    roomSnapshot?.room.id,
    roomSnapshot?.room.playback,
    scheduleRemotePlaybackRetry,
    updateRemoteMediaDiagnostic
  ]);

  useEffect(() => {
    const room = roomSnapshot?.room;
    if (
      !shouldManagePublishedMediaTransport({
        roomId: room?.id,
        peerId,
        isCurrentSourceOwner
      })
    ) {
      return;
    }

    if (!room) {
      return;
    }

    const listenerPeerIds = room.members
      .filter((member) => !!member.peerId && member.peerId !== peerId)
      .map((member) => member.peerId as string);
    if (listenerPeerIds.length === 0) {
      return;
    }

    void ensureMediaTransportConnectedRef.current({
      preferPublishedTrack: room.playback.status === "playing" && isCurrentSourceOwner
    });
  }, [
    activeSession?.userId,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.hostId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.status
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      updateSourceStartState("idle");
      return;
    }

    void ensureSourcePlaybackStarted();
  }, [
    audioUnlocked,
    ensureSourcePlaybackStarted,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.sourceSessionId,
    roomSnapshot?.room.playback.status,
    updateSourceStartState,
    activePlaybackSource
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      return;
    }

    if (
      !audioUnlocked ||
      roomSnapshot.room.playback.status !== "playing" ||
      sourceStartState !== "live"
    ) {
      return;
    }

    void syncHostMediaStream();
  }, [
    audioUnlocked,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.status,
    roomSnapshot?.room.playback.sourceSessionId,
    roomSnapshot?.room.playback.mediaEpoch,
    activePlaybackSource,
    sourceStartState,
    syncHostMediaStream
  ]);

  useEffect(() => {
    if (
      !roomSnapshot?.room.id ||
      !peerId ||
      !isCurrentSourceOwner ||
      !audioUnlocked ||
      roomSnapshot.room.playback.status !== "playing" ||
      sourceStartState !== "live"
    ) {
      lastListenerBootstrapKeyRef.current = null;
      return;
    }

    const listenerPeerIds = roomSnapshot.room.members
      .filter((member) => !!member.peerId && member.peerId !== peerId)
      .map((member) => member.peerId as string)
      .sort();
    if (listenerPeerIds.length === 0) {
      lastListenerBootstrapKeyRef.current = null;
      return;
    }

    const now = Date.now();
    const connectedPeerSet = new Set(mediaConnectedPeers);
    for (const listenerPeerId of listenerPeerIds) {
      if (connectedPeerSet.has(listenerPeerId)) {
        missingListenerSinceRef.current.delete(listenerPeerId);
      } else if (!missingListenerSinceRef.current.has(listenerPeerId)) {
        missingListenerSinceRef.current.set(listenerPeerId, now);
      }
    }
    for (const trackedPeerId of [...missingListenerSinceRef.current.keys()]) {
      if (!listenerPeerIds.includes(trackedPeerId)) {
        missingListenerSinceRef.current.delete(trackedPeerId);
      }
    }

    const stableMissingListenerPeerIds = listenerPeerIds.filter((listenerPeerId) => {
      if (connectedPeerSet.has(listenerPeerId)) {
        return false;
      }
      const missingSince = missingListenerSinceRef.current.get(listenerPeerId);
      return typeof missingSince === "number" && now - missingSince >= listenerBootstrapGraceMs;
    });
    if (stableMissingListenerPeerIds.length === 0) {
      lastListenerBootstrapKeyRef.current = null;
      return;
    }

    const bootstrapKey = [
      roomSnapshot.room.id,
      roomSnapshot.room.playback.mediaEpoch,
      mediaTransportEpochRef.current,
      roomSnapshot.room.presenceRevision,
      ...stableMissingListenerPeerIds
    ].join("|");
    if (lastListenerBootstrapKeyRef.current === bootstrapKey) {
      return;
    }
    lastListenerBootstrapKeyRef.current = bootstrapKey;

    const retryPlan = [
      { delayMs: 0, attempt: 1 },
      { delayMs: 800, attempt: 2 },
      { delayMs: 2400, attempt: 3 }
    ];
    const timerIds = retryPlan.map(({ delayMs, attempt }) =>
      window.setTimeout(() => {
        if (activeRouteRoomIdRef.current !== roomSnapshot.room.id) {
          return;
        }
        const requestedAt = new Date().toISOString();
        updateHostCaptureDiagnostics({
          refreshKey: hostMediaSyncStateRef.current.lastCaptureRefreshKey,
          forcedRefresh: true,
          captureMode: null,
          mediaEpoch: roomSnapshot.room.playback.mediaEpoch,
          transportEpoch: mediaTransportEpochRef.current,
          publisherBootstrapRequestedAt: requestedAt,
          publisherBootstrapAttempts: attempt,
          summary: `房主定向补发实时音频协商，第 ${attempt} 次`
        });
        void syncHostMediaStreamRef.current({ forceResync: true, reason: "listener-bootstrap" });
        for (const listenerPeerId of stableMissingListenerPeerIds) {
          void mediaMeshRef.current?.restartPublishingPeer(listenerPeerId, hostStreamRef.current);
        }
      }, delayMs)
    );

    return () => {
      for (const timerId of timerIds) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    audioUnlocked,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    mediaConnectedPeers,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.status,
    roomSnapshot?.room.presenceRevision,
    sourceStartState,
    updateHostCaptureDiagnostics
  ]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || !isCurrentSourceOwner) {
      lastHostCaptureRefreshAtRef.current = 0;
      return;
    }

    if (
      !audioUnlocked ||
      sourceStartState !== "live" ||
      roomSnapshot.room.playback.status !== "playing" ||
      !roomSnapshot.room.playback.currentTrackId
    ) {
      lastHostCaptureRefreshAtRef.current = 0;
      return;
    }

    const listenerPeerCount =
      roomSnapshot.room.members.filter((member) => !!member.peerId && member.peerId !== peerId).length;
    if (listenerPeerCount <= 0) {
      lastHostCaptureRefreshAtRef.current = 0;
      return;
    }

    const ensureHealthyHostCapture = () => {
      if (hasUsableHostMediaStreamTrack(hostStreamRef.current)) {
        return;
      }

      const now = Date.now();
      if (now - lastHostCaptureRefreshAtRef.current < hostCaptureRefreshCooldownMs) {
        return;
      }

      lastHostCaptureRefreshAtRef.current = now;
      void syncHostMediaStream({
        forceResync: true,
        reason: "capture-track-degraded"
      });
    };

    ensureHealthyHostCapture();
    const timerId = window.setInterval(
      ensureHealthyHostCapture,
      hostCaptureHealthCheckIntervalMs
    );

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    audioUnlocked,
    isCurrentSourceOwner,
    peerId,
    roomSnapshot?.room.id,
    roomSnapshot?.room.members,
    roomSnapshot?.room.playback.currentTrackId,
    roomSnapshot?.room.playback.mediaEpoch,
    roomSnapshot?.room.playback.status,
    sourceStartState,
    syncHostMediaStream
  ]);

  useEffect(() => {
    const remotePeerIds =
      roomSnapshot?.room.members
        .map((member) => member.peerId)
        .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId) ?? [];

    const syncPromise = meshRef.current?.syncPeers(remotePeerIds);
    if (!syncPromise) {
      return;
    }

    void syncPromise.catch((error) => {
      reportRealtimeFailure({
        peerId: "system",
        channelKind: "system",
        event: "mesh-sync-failed",
        summary: "Failed to sync data peers",
        error
      });
    });
  }, [roomSnapshot?.room.members, peerId, reportRealtimeFailure]);

  useEffect(() => {
    if (mediaConnectedPeers.length > 0 && connectedPeers.length === 0) {
      if (dataDegradedSinceRef.current === null) {
        dataDegradedSinceRef.current = Date.now();
      }
      return;
    }

    dataDegradedSinceRef.current = null;
  }, [connectedPeers.length, mediaConnectedPeers.length]);

  useEffect(() => {
    if (!roomSnapshot?.room.id || !peerId || isCurrentSourceOwner || bufferHealth === "healthy") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const remotePeerIds =
        currentRoomRef.current?.room.members
          .map((member) => member.peerId)
          .filter(
            (memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== peerId
          ) ?? [];
      const playback = currentRoomRef.current?.room.playback;
      const currentTrackId = playback?.currentTrackId ?? null;
      const localAvailability = currentTrackId ? availabilityByTrack[currentTrackId]?.[peerId] : null;
      const totalChunks = resolveCurrentRoomTrackTotalChunks({
        trackId: currentTrackId,
        roomSnapshot: currentRoomRef.current,
        availabilityByTrack
      });
      const localAvailableChunks = localAvailability?.availableChunks.length ?? 0;
      const shouldRecoverPieceSync = shouldForcePieceSyncRecovery({
        playbackStatus: playback?.status,
        currentTrackId,
        activePlaybackSource,
        bufferHealth,
        localAvailableChunks,
        totalChunks,
        lastPieceActivityAtMs: Math.max(
          lastPieceReceivedAtRef.current,
          lastAvailabilityGrowthAtRef.current
        )
      });
      const shouldRecoverDataPeers =
        activePlaybackSource === "remote-stream" &&
        playback?.status === "playing" &&
        !!currentTrackId &&
        (totalChunks <= 0 || localAvailableChunks < totalChunks);
      const sourceRecoveryKey = buildSourceRecoveryActionKey(
        playback?.sourcePeerId ?? null,
        playback?.mediaEpoch ?? null
      );
      const sourceHardRecoveryInFlight =
        !!sourceRecoveryKey &&
        sourceRecoveryCoordinatorRef.current.actionKey === sourceRecoveryKey &&
        sourceRecoveryCoordinatorRef.current.action !== null;
      const degradedIceMode = iceConfig?.source === "stun-only" && (playback?.mediaEpoch ?? 0) > 0;

      if (remotePeerIds.length === 0) {
        return;
      }

      if (sourceHardRecoveryInFlight || degradedIceMode) {
        const suppressedReason = sourceHardRecoveryInFlight
          ? `suppressed-by-${sourceRecoveryCoordinatorRef.current.action}`
          : "suppressed-by-stun-only-ice";
        if (playback?.sourcePeerId) {
          recordPeerDiagnostic({
            peerId: playback.sourcePeerId,
            channelKind: "data",
            direction: "local",
            event: "mesh-recovery-suppressed",
            summary: `Data recovery suppressed: ${suppressedReason}`,
            recordEvent: false,
            update: (snapshot) => ({
              ...snapshot,
              recoverySuppressedReason: suppressedReason
            })
          });
        }
        return;
      }

      if (playback?.sourcePeerId) {
        recordPeerDiagnostic({
          peerId: playback.sourcePeerId,
          channelKind: "data",
          direction: "local",
          event: "mesh-recovery-suppressed",
          summary: "Data recovery suppression cleared",
          recordEvent: false,
          update: (snapshot) => ({
            ...snapshot,
            recoverySuppressedReason: null
          })
        });
      }

      const degradedSince = dataDegradedSinceRef.current;
      if (degradedSince && shouldRecoverDataPeers && Date.now() - degradedSince >= 6_000) {
        void meshRef.current?.syncPeers(remotePeerIds, { forceReconnectDegraded: true }).catch((error) => {
          reportRealtimeFailure({
            peerId: "system",
            channelKind: "system",
            event: "mesh-watchdog-resync-failed",
            summary: "Failed to recover degraded data peers",
            error
          });
        });
        dataDegradedSinceRef.current = Date.now();
        return;
      }
      if (!shouldRecoverPieceSync) {
        return;
      }

      void meshRef.current?.syncPeers(remotePeerIds, { forceReconnectDegraded: true }).catch((error) => {
        reportRealtimeFailure({
          peerId: "system",
          channelKind: "system",
          event: "mesh-activity-watchdog-failed",
          summary: "Failed to recover stalled piece sync",
          error
        });
      });
      lastPieceReceivedAtRef.current = Date.now();
      lastAvailabilityGrowthAtRef.current = Date.now();
    }, 2_000);

    return () => window.clearInterval(intervalId);
  }, [
    activePlaybackSource,
    availabilityByTrack,
    bufferHealth,
    buildSourceRecoveryActionKey,
    currentRoomRef,
    iceConfig?.source,
    isCurrentSourceOwner,
    peerId,
    reportRealtimeFailure,
    recordPeerDiagnostic,
    roomSnapshot?.room.id
  ]);

  const playbackClockSource = useMemo(
    () =>
      roomSnapshot?.room.playback.status === "playing"
        ? activePlaybackSource !== "remote-stream"
          ? "local"
          : "remote"
        : "snapshot",
    [roomSnapshot?.room.playback.status, activePlaybackSource]
  );

  useEffect(() => {
    if (!enablePlaybackCacheTakeover && manualCacheTrackIds.length === 0) {
      return;
    }

    const effectiveSchedulerMode =
      playbackClockSource === "remote" && transportGovernorMode === "bootstrap"
        ? schedulerMode === "idle"
          ? "idle"
          : "conservative"
        : schedulerMode;

    chunkSchedulerRef.current?.sync({
      roomSnapshot,
      availabilityByTrack,
      connectedPeerIds: connectedPeers,
      uploadedTrackIds: Object.keys(uploadedTracks),
      playbackPositionMs: schedulerPlaybackBucketMs,
      playbackStatus: roomSnapshot?.room.playback.status ?? null,
      pageVisible: isPageVisible,
      mode: effectiveSchedulerMode,
      bufferHealth,
      playbackClockSource,
      manualTrackIds: enableManualTrackCaching ? manualCacheTrackIds : [],
      policy: progressiveSchedulerPolicy ?? "startup"
    });
  }, [
    availabilityByTrack,
    connectedPeers,
    manualCacheTrackIds,
    uploadedTracks,
    roomSnapshot,
    schedulerPlaybackBucketMs,
    isPageVisible,
    schedulerMode,
    bufferHealth,
    transportGovernorMode,
    playbackClockSource,
    progressiveSchedulerPolicy,
    chunkSchedulerRef
  ]);

  return {
    scheduleRemotePlaybackRetry,
    syncHostMediaStream,
    ensureSourcePlaybackStarted
  };
}
