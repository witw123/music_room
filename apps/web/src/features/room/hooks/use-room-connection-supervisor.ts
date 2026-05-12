"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  PeerDiagnosticsSnapshot,
  RoomMediaConnectionState,
  RoomSnapshot
} from "@music-room/shared";
import {
  canRunRecoveryAction,
  createPeerConnectionSupervisorState,
  markRecoveryAction,
  notePeerSignalState,
  observePeerTransport,
  recordPeerPlayoutProgress,
  resetRecoveryStage,
  resolveTransportHealth,
  toSupervisorDiagnosticPatch,
  type PeerConnectionSupervisorState
} from "@/features/p2p";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import type { PlaybackRecoveryRecommendation } from "./room-runtime-types";

export type SourceRecoveryCoordinatorState = {
  actionKey: string | null;
  action: "ice-restart" | "hard-recreate" | "full-resubscribe" | null;
  startedAtMs: number | null;
};

const listenerHardRecoveryCooldownMs = 3_000;
const connectionSupervisorHardRecreateNoProgressFloorMs = 45_000;
const recoveryBootstrapGraceMs = 5_000;
const sourceGenerationBootstrapGraceMs = 3_500;
const connectionSupervisorForegroundIntervalMs = 500;
const connectionSupervisorBackgroundIntervalMs = 2_000;

function resolveConsecutiveNoProgressMs(...values: Array<number | null>) {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && value >= 0);
  if (finiteValues.length === 0) {
    return null;
  }

  return Math.min(...finiteValues);
}

function getSourceRecoveryActionRank(action: SourceRecoveryCoordinatorState["action"]) {
  switch (action) {
    case "ice-restart":
      return 1;
    case "hard-recreate":
      return 2;
    case "full-resubscribe":
      return 3;
    default:
      return 0;
  }
}

export function withResolvedTransportHealth(
  snapshot: PeerDiagnosticsSnapshot
): PeerDiagnosticsSnapshot {
  return {
    ...snapshot,
    ...resolveTransportHealth(snapshot)
  };
}

export function withSupervisorDiagnosticPatch(
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

export function shouldSuppressSourceRecoveryDuringGenerationBootstrap(input: {
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentGeneration: string | null;
  generationStartedAt: number | null;
  playingGeneration: string | null;
  now?: number;
  graceMs?: number;
}) {
  if (
    input.playbackStatus !== "playing" ||
    !input.currentGeneration ||
    typeof input.generationStartedAt !== "number"
  ) {
    return false;
  }

  if (input.playingGeneration === input.currentGeneration) {
    return false;
  }

  const now = input.now ?? Date.now();
  const graceMs = input.graceMs ?? sourceGenerationBootstrapGraceMs;
  return now - input.generationStartedAt < graceMs;
}

export function useRoomConnectionSupervisor(input: {
  roomSnapshot: RoomSnapshot | null;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  listenerMediaLifecycleRef: MutableRefObject<{
    currentGeneration: string | null;
    generationStartedAt: number | null;
    playingGeneration: string | null;
    lastPlayoutProgressAt: number | null;
    lastTransportProgressAt: number | null;
  }>;
  lastDataActivityAtRef: MutableRefObject<number | null>;
  mediaConnectionState: RoomMediaConnectionState;
  activePlaybackSource: ProgressivePlaybackSource;
  isCurrentSourceOwner: boolean;
  isPageVisible: boolean;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
}) {
  const connectionSupervisorStatesRef = useRef<Map<string, PeerConnectionSupervisorState>>(new Map());
  const sourceRecoveryCoordinatorRef = useRef<SourceRecoveryCoordinatorState>({
    actionKey: null,
    action: null,
    startedAtMs: null
  });

  const buildSourceRecoveryActionKey = useCallback(
    (sourcePeerId: string | null | undefined, mediaEpoch: number | null | undefined) => {
      const roomId = input.currentRoomRef.current?.room.id ?? input.roomSnapshot?.room.id ?? null;
      if (!roomId || !sourcePeerId || typeof mediaEpoch !== "number") {
        return null;
      }

      return `${roomId}|${sourcePeerId}|${mediaEpoch}`;
    },
    [input.currentRoomRef, input.roomSnapshot?.room.id]
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

  const resolveCurrentAudibleSource = useCallback(
    (now = Date.now()): PeerDiagnosticsSnapshot["audibleSource"] => {
      const playback = input.currentRoomRef.current?.room.playback;
      if (input.isCurrentSourceOwner || playback?.status !== "playing") {
        return null;
      }

      if (
        input.activePlaybackSource === "progressive-local" ||
        input.activePlaybackSource === "full-local"
      ) {
        return input.activePlaybackSource;
      }

      return null;
    },
    [input.activePlaybackSource, input.currentRoomRef, input.isCurrentSourceOwner]
  );

  const resolveSourceContinuityState = useCallback(
    (now = Date.now()) => {
      const audibleSource = resolveCurrentAudibleSource(now);
      const lastAudibleProgressAtMs = input.listenerMediaLifecycleRef.current.lastPlayoutProgressAt;
      const lastMediaStatsProgressAtMs =
        input.listenerMediaLifecycleRef.current.lastTransportProgressAt;
      const lastDataActivityAtMs = input.lastDataActivityAtRef.current;
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
        consecutiveNoProgressMs
      };
    },
    [
      input.lastDataActivityAtRef,
      input.listenerMediaLifecycleRef,
      resolveCurrentAudibleSource
    ]
  );

  const resolveSourceRecoverySuppressedReason = useCallback(
    (now = Date.now()) => {
      const playback = input.currentRoomRef.current?.room.playback;
      if (playback?.status !== "playing") {
        return null;
      }

      if (!input.isPageVisible) {
        return "page-hidden";
      }

      if (
        shouldSuppressSourceRecoveryDuringGenerationBootstrap({
          playbackStatus: playback.status,
          currentGeneration: input.listenerMediaLifecycleRef.current.currentGeneration,
          generationStartedAt: input.listenerMediaLifecycleRef.current.generationStartedAt,
          playingGeneration: input.listenerMediaLifecycleRef.current.playingGeneration,
          now
        })
      ) {
        return "generation-bootstrap-grace";
      }

      const continuity = resolveSourceContinuityState(now);
      if (
        continuity.audibleSource === "progressive-local" ||
        continuity.audibleSource === "full-local"
      ) {
        return "full-local-active";
      }

      if (
        input.lastSubscribeAckAtRef.current !== null &&
        now - input.lastSubscribeAckAtRef.current < recoveryBootstrapGraceMs
      ) {
        return "bootstrap-grace";
      }

      return null;
    },
    [
      input.currentRoomRef,
      input.isPageVisible,
      input.lastSubscribeAckAtRef,
      resolveSourceContinuityState
    ]
  );

  const ensureConnectionSupervisorState = useCallback(
    (remotePeerId: string) => {
      const roomId = input.currentRoomRef.current?.room.id ?? input.roomSnapshot?.room.id ?? null;
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
    },
    [input.currentRoomRef, input.roomSnapshot?.room.id]
  );

  const commitConnectionSupervisorState = useCallback(
    (
      peerId: string,
      channelKind: "data" | "media" | "system",
      nextState: PeerConnectionSupervisorState
    ) => {
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
        input.recordPeerDiagnostic({
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
    },
    [input.recordPeerDiagnostic]
  );

  const updateConnectionSupervisorSignalState = useCallback(
    (signalInput: {
      peerId: string;
      channelKind: "data" | "media";
      dataChannelState?: string | null;
      dataConnectionState?: string | null;
      mediaConnectionState?: string | null;
      dataIceState?: string | null;
      mediaIceState?: string | null;
      lastFailureReason?: string | null;
    }) => {
      const current = ensureConnectionSupervisorState(signalInput.peerId);
      if (!current) {
        return null;
      }

      const next = notePeerSignalState({
        state: current,
        dataChannelState: signalInput.dataChannelState,
        dataConnectionState: signalInput.dataConnectionState,
        mediaConnectionState: signalInput.mediaConnectionState,
        dataIceState: signalInput.dataIceState,
        mediaIceState: signalInput.mediaIceState,
        lastFailureReason: signalInput.lastFailureReason
      });
      return commitConnectionSupervisorState(signalInput.peerId, signalInput.channelKind, next);
    },
    [commitConnectionSupervisorState, ensureConnectionSupervisorState]
  );

  const updateConnectionSupervisorTransport = useCallback(
    (transportInput: {
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
    }) => {
      const current = ensureConnectionSupervisorState(transportInput.peerId);
      if (!current) {
        return null;
      }

      const next = observePeerTransport({
        state: current,
        sample: {
          ...transportInput.sample,
          packetsLost: transportInput.sample.packetsLost ?? null,
          packetLossRate: transportInput.sample.packetLossRate ?? null
        },
        diagnostics: {
          dataChannelState: current.dataChannelState,
          dataConnectionState: current.dataConnectionState,
          mediaConnectionState: current.mediaConnectionState,
          dataIceState: current.dataIceState,
          mediaIceState: current.mediaIceState
        }
      });
      return commitConnectionSupervisorState(
        transportInput.peerId,
        transportInput.channelKind,
        next
      );
    },
    [commitConnectionSupervisorState, ensureConnectionSupervisorState]
  );

  const updateConnectionSupervisorPlayout = useCallback(
    (peerId: string) => {
      const current = ensureConnectionSupervisorState(peerId);
      if (!current) {
        return null;
      }

      const next = recordPeerPlayoutProgress(current);
      return commitConnectionSupervisorState(peerId, "media", next);
    },
    [commitConnectionSupervisorState, ensureConnectionSupervisorState]
  );

  return {
    connectionSupervisorStatesRef,
    sourceRecoveryCoordinatorRef,
    beginSourceHardRecoveryAction,
    clearSourceHardRecoveryAction,
    resolveCurrentAudibleSource,
    resolveSourceContinuityState,
    resolveSourceRecoverySuppressedReason,
    ensureConnectionSupervisorState,
    commitConnectionSupervisorState,
    updateConnectionSupervisorSignalState,
    updateConnectionSupervisorTransport,
    updateConnectionSupervisorPlayout
  };
}

export function useRoomConnectionSupervisorRuntime(input: {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  connectionSupervisorStatesRef: MutableRefObject<Map<string, PeerConnectionSupervisorState>>;
  ensureConnectionSupervisorState: (remotePeerId: string) => PeerConnectionSupervisorState | null;
  commitConnectionSupervisorState: (
    peerId: string,
    channelKind: "data" | "media" | "system",
    nextState: PeerConnectionSupervisorState
  ) => PeerConnectionSupervisorState;
  resolveSourceContinuityState: (now?: number) => {
    audibleSource: PeerDiagnosticsSnapshot["audibleSource"];
    lastAudibleProgressAtMs: number | null;
    lastMediaStatsProgressAtMs: number | null;
    lastDataActivityAtMs: number | null;
    consecutiveNoProgressMs: number | null;
  };
  resolveSourceRecoverySuppressedReason: (now?: number) => string | null;
  beginSourceHardRecoveryAction: (
    sourcePeerId: string | null | undefined,
    mediaEpoch: number | null | undefined,
    action: SourceRecoveryCoordinatorState["action"]
  ) => boolean;
  clearSourceHardRecoveryAction: (
    sourcePeerId: string | null | undefined,
    mediaEpoch: number | null | undefined
  ) => void;
  listenerMediaLifecycleRef: MutableRefObject<{
    currentGeneration: string | null;
    generationStartedAt: number | null;
    playingGeneration: string | null;
    lastPlayoutProgressAt: number | null;
    lastTransportProgressAt: number | null;
  }>;
  recordPeerDiagnosticRef: MutableRefObject<(input: any) => void>;
  formatDiagnosticsTimestamp: (timestampMs: number | null) => string | null;
  resolvePeerConnectionNoProgressMs: (
    state: PeerConnectionSupervisorState,
    now?: number
  ) => number;
  resolveIceRestartNoProgressMs: (
    state: PeerConnectionSupervisorState | null | undefined
  ) => number;
  resolveHardRecreateNoProgressMs: (
    state: PeerConnectionSupervisorState | null | undefined
  ) => number;
  activePlaybackSource: ProgressivePlaybackSource;
  isPageVisible: boolean;
  isCurrentSourceOwner: boolean;
  resolveSoftRecoveryMediaState: (state: any) => any;
  mediaMeshRef: MutableRefObject<{
    restartListenerIce: (peerId: string) => Promise<unknown>;
    restartPublishingIce: (peerId: string, stream: MediaStream | null) => Promise<unknown>;
    resetListenerPeer: (peerId: string) => Promise<unknown>;
    restartPublishingPeer: (peerId: string, stream: MediaStream | null) => Promise<unknown>;
  } | null>;
  hostStreamRef: MutableRefObject<MediaStream | null>;
  meshRef: MutableRefObject<{
    restartIce: (peerId: string) => Promise<unknown>;
    restartPeer: (peerId: string) => Promise<unknown>;
  } | null>;
  reportRealtimeFailureRef: MutableRefObject<(input: any) => void>;
  setMediaConnectionState: Dispatch<SetStateAction<any>>;
  lastRealtimeRoomEventAtRef: MutableRefObject<number>;
  resubscribeRoomRef: MutableRefObject<(() => void) | null>;
  getCurrentPlaybackConnectionKey?: () => string | null;
  queuePlaybackRecoveryRecommendation?: (
    recommendation: PlaybackRecoveryRecommendation
  ) => void;
}) {
  const lastSourceSupervisorKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const currentRoom = input.currentRoomRef.current;
    const roomId = currentRoom?.room.id ?? input.roomSnapshot?.room.id ?? null;
    const playback = currentRoom?.room.playback ?? input.roomSnapshot?.room.playback ?? null;
    const sourcePeerId = playback?.sourcePeerId ?? null;
    const mediaEpoch = playback?.mediaEpoch ?? null;
    const sourceSupervisorKey =
      roomId &&
      sourcePeerId &&
      sourcePeerId !== input.peerId &&
      typeof mediaEpoch === "number"
        ? `${roomId}|${sourcePeerId}|${mediaEpoch}`
        : null;

    if (lastSourceSupervisorKeyRef.current === sourceSupervisorKey) {
      return;
    }

    lastSourceSupervisorKeyRef.current = sourceSupervisorKey;
    input.clearSourceHardRecoveryAction(null, null);

    if (!roomId || !sourcePeerId || sourcePeerId === input.peerId) {
      return;
    }

    const nextState = createPeerConnectionSupervisorState({
      roomId,
      peerId: sourcePeerId
    });
    input.connectionSupervisorStatesRef.current.set(sourcePeerId, nextState);
    input.recordPeerDiagnosticRef.current({
      peerId: sourcePeerId,
      channelKind: "media",
      direction: "local",
      event: "source-supervisor-reset",
      summary: "播放代次切换，重置源媒体连接监督状态",
      recordEvent: false,
      update: (snapshot: any) => withSupervisorDiagnosticPatch(snapshot, nextState)
    });
  }, [
    input.clearSourceHardRecoveryAction,
    input.connectionSupervisorStatesRef,
    input.currentRoomRef,
    input.peerId,
    input.recordPeerDiagnosticRef,
    input.roomSnapshot?.room.id,
    input.roomSnapshot?.room.playback.mediaEpoch,
    input.roomSnapshot?.room.playback.sourcePeerId
  ]);

  useEffect(() => {
    if (!input.roomSnapshot?.room.id || !input.peerId) {
      input.connectionSupervisorStatesRef.current.clear();
      lastSourceSupervisorKeyRef.current = null;
      return;
    }

    const tickIntervalMs = input.isPageVisible
      ? connectionSupervisorForegroundIntervalMs
      : connectionSupervisorBackgroundIntervalMs;
    const timerId = window.setInterval(() => {
      const currentRoom = input.currentRoomRef.current;
      if (!currentRoom?.room.id) {
        return;
      }

      const now = Date.now();
      const expectedPeerIds = currentRoom.room.members
        .map((member) => member.peerId)
        .filter(
          (memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== input.peerId
        );
      const expectedPeerSet = new Set(expectedPeerIds);
      for (const [remotePeerId, state] of input.connectionSupervisorStatesRef.current.entries()) {
        if (state.roomId !== currentRoom.room.id || !expectedPeerSet.has(remotePeerId)) {
          input.connectionSupervisorStatesRef.current.delete(remotePeerId);
        }
      }

      const playback = currentRoom.room.playback;
      const sourcePeerId = playback.sourcePeerId ?? null;
      const sourceGeneration = input.listenerMediaLifecycleRef.current.currentGeneration;
      const sourceLifecycle = input.listenerMediaLifecycleRef.current;

      for (const remotePeerId of expectedPeerIds) {
        const currentState = input.ensureConnectionSupervisorState(remotePeerId);
        if (!currentState) {
          continue;
        }

        let nextState: PeerConnectionSupervisorState = currentState;
        const isSourcePeer = remotePeerId === sourcePeerId;
        const iceRestartNoProgressMs = input.resolveIceRestartNoProgressMs(nextState);
        const hardRecreateNoProgressMs = input.resolveHardRecreateNoProgressMs(nextState);
        const sourceContinuity = isSourcePeer ? input.resolveSourceContinuityState(now) : null;
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
          : input.resolvePeerConnectionNoProgressMs(nextState, now);
        const sourceRecoverySuppressedReason = isSourcePeer
          ? input.resolveSourceRecoverySuppressedReason(now)
          : null;
        if (isSourcePeer) {
          input.recordPeerDiagnosticRef.current({
            peerId: remotePeerId,
            channelKind: "media",
            direction: "local",
            event: "source-progress",
            summary:
              typeof consecutiveNoProgressMs === "number"
                ? `源媒体 ${Math.round(consecutiveNoProgressMs)}ms 无连续进展`
                : "源媒体传输正常",
            recordEvent: false,
            update: (snapshot: any) => ({
              ...snapshot,
              zeroProgressMs:
                typeof consecutiveNoProgressMs === "number" && Number.isFinite(consecutiveNoProgressMs)
                  ? Math.max(0, Math.round(consecutiveNoProgressMs))
                  : null,
              consecutiveNoProgressMs:
                typeof consecutiveNoProgressMs === "number" && Number.isFinite(consecutiveNoProgressMs)
                  ? Math.max(0, Math.round(consecutiveNoProgressMs))
                  : null,
              lastAudibleProgressAt: input.formatDiagnosticsTimestamp(
                sourceContinuity?.lastAudibleProgressAtMs ?? null
              ),
              lastMediaStatsProgressAt: input.formatDiagnosticsTimestamp(
                sourceContinuity?.lastMediaStatsProgressAtMs ?? null
              ),
              lastDataActivityAt: input.formatDiagnosticsTimestamp(
                sourceContinuity?.lastDataActivityAtMs ?? null
              ),
              audibleSource: sourceContinuity?.audibleSource ?? null,
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
          input.commitConnectionSupervisorState(remotePeerId, recoveryChannel, nextState);

          if (input.queuePlaybackRecoveryRecommendation) {
            input.queuePlaybackRecoveryRecommendation({
              playbackConnectionKey: isSourcePeer
                ? input.getCurrentPlaybackConnectionKey?.() ?? null
                : null,
              peerId: remotePeerId,
              scope: recoveryChannel,
              level: "ice-restart",
              reason: nextState.lastFailureReason ?? "ice-restart-required",
              observedNoProgressMs:
                typeof consecutiveNoProgressMs === "number" ? consecutiveNoProgressMs : null
            });
            continue;
          }

          if (recoveryChannel === "media") {
            if (!input.beginSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch, "ice-restart")) {
              continue;
            }
            const restartPromise = isSourcePeer
              ? input.mediaMeshRef.current?.restartListenerIce(remotePeerId)
              : input.mediaMeshRef.current?.restartPublishingIce(
                  remotePeerId,
                  input.hostStreamRef.current
                );
            void restartPromise?.catch((error) => {
              input.clearSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch);
              input.reportRealtimeFailureRef.current({
                peerId: remotePeerId,
                channelKind: "media",
                event: "supervisor-ice-restart-failed",
                summary: "Failed to ICE restart media peer",
                error,
                mediaConnectionState: input.resolveSoftRecoveryMediaState("reconnecting")
              });
            });
          } else {
            void input.meshRef.current?.restartIce(remotePeerId).catch((error) => {
              input.reportRealtimeFailureRef.current({
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
          !sourceRecoverySuppressedReason;

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
          input.commitConnectionSupervisorState(remotePeerId, recoveryChannel, nextState);

          if (input.queuePlaybackRecoveryRecommendation) {
            input.queuePlaybackRecoveryRecommendation({
              playbackConnectionKey: isSourcePeer
                ? input.getCurrentPlaybackConnectionKey?.() ?? null
                : null,
              peerId: remotePeerId,
              scope: recoveryChannel,
              level: "hard-recreate",
              reason: nextState.lastFailureReason ?? "peer-stalled",
              observedNoProgressMs:
                typeof consecutiveNoProgressMs === "number" ? consecutiveNoProgressMs : null
            });
            continue;
          }

          if (recoveryChannel === "media") {
            if (
              !input.beginSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch, "hard-recreate")
            ) {
              continue;
            }
            if (isSourcePeer) {
              input.setMediaConnectionState(input.resolveSoftRecoveryMediaState("reconnecting"));
            }
            const recreatePromise = isSourcePeer
              ? input.mediaMeshRef.current?.resetListenerPeer(remotePeerId)
              : input.mediaMeshRef.current?.restartPublishingPeer(
                  remotePeerId,
                  input.hostStreamRef.current
                );
            void recreatePromise?.catch((error) => {
              input.clearSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch);
              input.reportRealtimeFailureRef.current({
                peerId: remotePeerId,
                channelKind: "media",
                event: "supervisor-hard-recreate-failed",
                summary: "Failed to hard recreate media peer",
                error,
                mediaConnectionState: input.resolveSoftRecoveryMediaState("reconnecting")
              });
            });
          } else {
            void input.meshRef.current?.restartPeer(remotePeerId).catch((error) => {
              input.reportRealtimeFailureRef.current({
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
          input.commitConnectionSupervisorState(
            remotePeerId,
            isSourcePeer ? "media" : "data",
            nextState
          );
          if (isSourcePeer) {
            input.clearSourceHardRecoveryAction(remotePeerId, playback.mediaEpoch);
          }
        }
      }

      const sourceState =
        sourcePeerId ? input.connectionSupervisorStatesRef.current.get(sourcePeerId) ?? null : null;
      const sourceContinuityForResubscribe = sourcePeerId
        ? input.resolveSourceContinuityState(now)
        : null;
      if (
        sourcePeerId &&
        sourceState &&
        !input.resolveSourceRecoverySuppressedReason(now) &&
        sourceContinuityForResubscribe !== null &&
        typeof sourceContinuityForResubscribe.consecutiveNoProgressMs === "number" &&
        sourceContinuityForResubscribe.consecutiveNoProgressMs >=
          connectionSupervisorHardRecreateNoProgressFloorMs &&
        now - input.lastRealtimeRoomEventAtRef.current >= 15_000 &&
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
        input.commitConnectionSupervisorState(sourcePeerId, "media", nextState);
        if (input.queuePlaybackRecoveryRecommendation) {
          input.queuePlaybackRecoveryRecommendation({
            playbackConnectionKey: input.getCurrentPlaybackConnectionKey?.() ?? null,
            peerId: sourcePeerId,
            scope: "room",
            level: "full-resubscribe",
            reason: "room-control-stale",
            observedNoProgressMs: sourceContinuityForResubscribe.consecutiveNoProgressMs
          });
          return;
        }
        if (
          input.beginSourceHardRecoveryAction(
            sourcePeerId,
            playback.mediaEpoch,
            "full-resubscribe"
          )
        ) {
          input.resubscribeRoomRef.current?.();
        }
      }
    }, tickIntervalMs);

    return () => {
      window.clearInterval(timerId);
    };
  }, [
    input.beginSourceHardRecoveryAction,
    input.clearSourceHardRecoveryAction,
    input.commitConnectionSupervisorState,
    input.connectionSupervisorStatesRef,
    input.currentRoomRef,
    input.ensureConnectionSupervisorState,
    input.formatDiagnosticsTimestamp,
    input.hostStreamRef,
    input.isCurrentSourceOwner,
    input.isPageVisible,
    input.lastRealtimeRoomEventAtRef,
    input.listenerMediaLifecycleRef,
    input.mediaMeshRef,
    input.meshRef,
    input.peerId,
    input.reportRealtimeFailureRef,
    input.resubscribeRoomRef,
    input.resolveHardRecreateNoProgressMs,
    input.resolveIceRestartNoProgressMs,
    input.resolvePeerConnectionNoProgressMs,
    input.resolveSoftRecoveryMediaState,
    input.resolveSourceContinuityState,
    input.resolveSourceRecoverySuppressedReason,
    input.roomSnapshot?.room.id,
    input.setMediaConnectionState
  ]);
}
