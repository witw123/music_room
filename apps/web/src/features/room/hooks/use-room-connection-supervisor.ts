"use client";

import { useCallback, useRef, type MutableRefObject } from "react";
import type { PeerDiagnosticsSnapshot } from "@music-room/shared";
import type { ProgressivePlaybackSource } from "@/features/playback/progressive-playback";
import {
  createPeerConnectionSupervisorState,
  notePeerSignalState,
  observePeerTransport,
  resolveTransportHealth,
  toSupervisorDiagnosticPatch,
  type PeerConnectionSupervisorState
} from "@/features/p2p";
import type { PlaybackRecoveryRecommendation } from "./room-runtime-types";

export type SourceRecoveryCoordinatorState = {
  actionKey: string | null;
  action: "soft" | "hard-recreate" | "full-resubscribe" | null;
  startedAtMs: number | null;
};

export function shouldRunMediaPeerRecovery() {
  return false;
}

export function shouldSuppressSourceRecoveryDuringGenerationBootstrap() {
  return false;
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
  return state ? { ...snapshot, ...toSupervisorDiagnosticPatch(state) } : snapshot;
}

export function useRoomConnectionSupervisor(input: {
  roomId?: string | null;
  lastSubscribeAckAtRef: MutableRefObject<number | null>;
}) {
  const connectionSupervisorStatesRef = useRef<Map<string, PeerConnectionSupervisorState>>(new Map());
  const sourceRecoveryCoordinatorRef = useRef<SourceRecoveryCoordinatorState>({
    actionKey: null,
    action: null,
    startedAtMs: null
  });

  const ensureConnectionSupervisorState = useCallback((peerId: string) => {
    const existing = connectionSupervisorStatesRef.current.get(peerId);
    if (existing) {
      return existing;
    }
    const next = createPeerConnectionSupervisorState({
      peerId,
      roomId: input.roomId ?? "room"
    });
    connectionSupervisorStatesRef.current.set(peerId, next);
    return next;
  }, [input.roomId]);

  const commitConnectionSupervisorState = useCallback(
    (state: PeerConnectionSupervisorState | null | undefined) => {
      if (state) {
        connectionSupervisorStatesRef.current.set(state.peerId, state);
      }
      return state ?? null;
    },
    []
  );

  const updateConnectionSupervisorSignalState = useCallback(
    (value: {
      peerId: string;
      channelKind: "data" | "media";
      dataConnectionState?: string;
      dataIceState?: string;
      dataChannelState?: string;
      lastFailureReason?: string;
    }) => {
      const state = ensureConnectionSupervisorState(value.peerId);
      const next = notePeerSignalState({
        state,
        dataConnectionState: value.dataConnectionState,
        dataIceState: value.dataIceState,
        dataChannelState: value.dataChannelState,
        lastFailureReason: value.lastFailureReason
      });
      return commitConnectionSupervisorState(next);
    },
    [commitConnectionSupervisorState, ensureConnectionSupervisorState]
  );

  const updateConnectionSupervisorTransport = useCallback(
    (value: {
      peerId: string;
      dataChannelState?: string | null;
      dataConnectionState?: string | null;
      dataIceState?: string | null;
      bytesReceived?: number | null;
      bytesSent?: number | null;
      bufferedAmountBytes?: number | null;
      now?: number;
    }) => {
      const state = ensureConnectionSupervisorState(value.peerId);
      const next = observePeerTransport({
        state,
        sample: {
          candidateType: null,
          protocol: null,
          currentRoundTripTimeMs: null,
          availableOutgoingBitrateKbps: null,
          packetLossRate: null,
          packetsLost: null,
          jitterMs: null,
          mediaReceiveBitrateKbps: null,
          mediaSendBitrateKbps: null
        },
        diagnostics: {
          dataChannelState: value.dataChannelState ?? null,
          dataConnectionState: value.dataConnectionState ?? null,
          dataIceState: value.dataIceState ?? null,
          mediaConnectionState: null,
          mediaIceState: null
        },
        now: value.now
      });
      return commitConnectionSupervisorState(next);
    },
    [commitConnectionSupervisorState, ensureConnectionSupervisorState]
  );

  const updateConnectionSupervisorPlayout = useCallback(() => null, []);

  const resolveCurrentAudibleSource = useCallback(
    (activePlaybackSource: ProgressivePlaybackSource = "progressive-local") => activePlaybackSource,
    []
  );
  const resolveSourceContinuityState = useCallback(
    (activePlaybackSource: ProgressivePlaybackSource = "progressive-local") => ({
      audibleSource: activePlaybackSource,
      bufferingWhileAudible: false,
      recentAudioProgress: true,
      recentTransportProgress: true,
      consecutiveNoProgressMs: null,
      consecutiveDataNoProgressMs: null
    }),
    []
  );
  const resolveSourceRecoverySuppressedReason = useCallback((now = Date.now()) => {
    const lastSubscribeAckAt = input.lastSubscribeAckAtRef.current;
    return typeof lastSubscribeAckAt === "number" && now - lastSubscribeAckAt < 2_000
      ? "recent-subscribe"
      : null;
  }, [input.lastSubscribeAckAtRef]);

  const beginSourceHardRecoveryAction = useCallback(() => false, []);
  const clearSourceHardRecoveryAction = useCallback(() => undefined, []);

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
  queuePlaybackRecoveryRecommendation?: (recommendation: PlaybackRecoveryRecommendation) => void;
}) {
  void input;
}
