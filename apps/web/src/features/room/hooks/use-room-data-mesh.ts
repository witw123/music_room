"use client";

import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PeerDiagnosticsSnapshot, PeerSignalMessage, RoomSnapshot } from "@music-room/shared";
import { P2PMesh, resolvePreferredIceTransportPolicy } from "@/features/p2p";
import type {
  DataMeshBridge,
  PlaybackRecoveryRecommendation,
  RoomDataMeshDiagnosticsRefs
} from "./room-runtime-types";

type DataMeshRuntime = Pick<
  P2PMesh,
  "syncPeers" | "restartPeer" | "getConnectedPeerIds"
> & Pick<P2PMesh, "restartMediaPeer">;

export function useRoomDataMesh(input: {
  meshRef: MutableRefObject<P2PMesh | null>;
}): DataMeshBridge | null {
  return useMemo<DataMeshBridge>(
    () => createDataMeshBridge(input.meshRef),
    [input.meshRef]
  );
}

export function createDataMeshBridge(
  meshRef: MutableRefObject<DataMeshRuntime | null>
): DataMeshBridge {
  return {
    async syncPeers(peerIds, options) {
      const mesh = meshRef.current;
      if (!mesh) {
        return false;
      }
      await mesh.syncPeers(peerIds, options);
      return true;
    },
    restartPeer(peerId) {
      return meshRef.current?.restartPeer(peerId) ?? Promise.resolve(null);
    },
    restartMediaPeer(peerId) {
      return meshRef.current?.restartMediaPeer?.(peerId) ?? Promise.resolve(null);
    },
    getConnectedPeerIds() {
      return meshRef.current?.getConnectedPeerIds() ?? [];
    },
    isReady() {
      return !!meshRef.current;
    }
  };
}

export function resolveDataPeerRecoveryRecommendation(input: {
  peerId: string;
  dataChannelState?: string | null;
  dataConnectionState?: string | null;
  reason: string;
}): PlaybackRecoveryRecommendation | null {
  const failedDataChannel = input.dataChannelState === "closed";
  const failedDataConnection =
    input.dataConnectionState === "closed" ||
    input.dataConnectionState === "failed" ||
    input.dataConnectionState === "disconnected";
  const stalledReason =
    input.reason === "watchdog-timeout" ||
    input.reason === "connection-failed" ||
    input.reason === "data-channel-closed";

  if (!failedDataChannel && !failedDataConnection && !stalledReason) {
    return null;
  }

  return {
    playbackConnectionKey: null,
    peerId: input.peerId,
    scope: "data",
    level: "hard-recreate",
    reason: input.reason,
    observedNoProgressMs: null
  };
}

export function createRoomDataMeshRuntime(input: {
  roomId: string;
  peerId: string;
  emitPeerSignal: (payload: PeerSignalMessage) => void;
  iceServers: RTCIceServer[];
  meshRef: MutableRefObject<P2PMesh | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  setMediaConnectedPeers: Dispatch<SetStateAction<string[]>>;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  bufferHealth: "healthy" | "low" | "critical";
  queuePlaybackRecoveryRecommendation?: (recommendation: PlaybackRecoveryRecommendation) => void;
  reportMeshResyncFailure: (error: unknown) => void;
} & RoomDataMeshDiagnosticsRefs) {
  const peerBufferedAmountBytes = new Map<string, number>();
  const queueDataPeerRecovery = (peerId: string, reason: string, dataChannelState?: string) => {
    const recommendation = resolveDataPeerRecoveryRecommendation({
      peerId,
      reason,
      dataChannelState
    });
    if (recommendation) {
      input.queuePlaybackRecoveryRecommendation?.(recommendation);
    }
  };

  const mesh = new P2PMesh(
    input.roomId,
    input.peerId,
    input.emitPeerSignal,
    {
      onPeerConnectionChange: ({ peerId, state, linkKind = "data" }) => {
        const supervisorState = input.updateConnectionSupervisorSignalState({
          peerId,
          channelKind: linkKind,
          ...(linkKind === "media"
            ? { mediaConnectionState: state }
            : { dataConnectionState: state })
        });
        input.recordPeerDiagnosticRef.current({
          peerId,
          channelKind: linkKind,
          direction: "local",
          event: linkKind === "media" ? "media-connection-state" : "connection-state",
          summary: `${linkKind === "media" ? "Media" : "Data"} 连接状态：${state}`,
          update: (snapshot: PeerDiagnosticsSnapshot) =>
            input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              ...(linkKind === "media"
                ? { mediaConnectionState: state }
                : { dataConnectionState: state })
            })
        });
        if (linkKind === "media") {
          input.setMediaConnectedPeers((current) => {
            const next = new Set(current);
            if (state === "connected") next.add(peerId);
            else next.delete(peerId);
            return [...next];
          });
          return;
        }
        input.setConnectedPeers((current) => {
          const next = new Set(current);
          if (state === "connected") next.add(peerId);
          else next.delete(peerId);
          return [...next];
        });
        if (["closed", "failed", "disconnected"].includes(state)) {
          peerBufferedAmountBytes.delete(peerId);
          queueDataPeerRecovery(peerId, state === "disconnected" ? "data-disconnected" : "data-failed", state);
        }
      },
      onIceConnectionStateChange: ({ peerId, state, linkKind = "data" }) => {
        const supervisorState = input.updateConnectionSupervisorSignalState({
          peerId,
          channelKind: linkKind,
          ...(linkKind === "media" ? { mediaIceState: state } : { dataIceState: state })
        });
        input.recordPeerDiagnosticRef.current({
          peerId,
          channelKind: linkKind,
          direction: "local",
          event: linkKind === "media" ? "media-ice-state" : "ice-state",
          summary: `${linkKind === "media" ? "Media" : "Data"} ICE 状态：${state}`,
          update: (snapshot: PeerDiagnosticsSnapshot) =>
            input.withResolvedTransportHealth(
              input.withSupervisorDiagnosticPatch(snapshot, supervisorState)
            )
        });
      },
      onDataChannelStateChange: ({ peerId, state }) => {
        input.setConnectedPeers((current) => {
          const next = new Set(current);
          if (state === "open") next.add(peerId);
          else next.delete(peerId);
          return [...next];
        });
        if (state === "closed") {
          queueDataPeerRecovery(peerId, "data-channel-closed", state);
        }
      },
      onDataBufferedAmountChange: ({ peerId, bufferedAmountBytes }) => {
        peerBufferedAmountBytes.set(peerId, bufferedAmountBytes);
        input.updatePeerBufferedAmountRef.current(peerId, bufferedAmountBytes);
      },
      onStatsSample: ({ peerId, sample }) => {
        input.updateConnectionSupervisorTransportStats({ peerId, sample });
        const isMediaSample =
          sample.dataChannelState === null &&
          (typeof sample.senderTrackId === "string" ||
            typeof sample.receiverTrackId === "string" ||
            sample.mediaReceiveBitrateKbps !== null ||
            sample.mediaSendBitrateKbps !== null);
        (isMediaSample
          ? input.updateMediaTransportStatsRef ?? input.updateDataTransportStatsRef
          : input.updateDataTransportStatsRef).current({ peerId, sample });
      },
      onRemoteAudioTrack: ({ peerId, track }) => {
        input.recordPeerDiagnosticRef.current({
          peerId,
          channelKind: "media",
          direction: "received",
          event: "media-track-received",
          summary: `收到媒体音频轨道 ${track.id}`,
          update: (snapshot: PeerDiagnosticsSnapshot) => snapshot
        });
      },
      onMediaTrackMuted: ({ peerId, trackId }) => {
        input.recordPeerDiagnosticRef.current({
          peerId,
          channelKind: "media",
          direction: "received",
          event: "media-track-muted",
          summary: `媒体轨道短暂静音：${trackId}`,
          level: "warning"
        });
      },
      onMediaStateChange: ({ peerId, direction, state }) => {
        input.recordPeerDiagnosticRef.current({
          peerId,
          channelKind: "media",
          direction: "local",
          event: `media-track-${state}`,
          summary: `${direction === "sender" ? "发送" : "接收"}媒体轨道：${state}`,
          recordEvent: false,
          update: (snapshot: PeerDiagnosticsSnapshot) => ({
            ...snapshot,
            mediaConnectionState:
              state === "live"
                ? "connected"
                : state === "failed"
                  ? "failed"
                  : snapshot.mediaConnectionState,
          })
        });
      },
      onMediaRecovery: ({ peerId, reason, restartCount }) => {
        input.recordPeerDiagnosticRef.current({
          peerId,
          channelKind: "media",
          direction: "local",
          event: reason === "connection-failed" ? "media-recovery-failed" : "media-ice-restart",
          summary:
            reason === "connection-failed"
              ? "媒体连接连续恢复失败，检查 TURN/网络容量"
              : `媒体链路已执行 ICE restart（${reason}，第 ${restartCount} 次）`,
          level: reason === "connection-failed" ? "error" : "warning"
        });
      },
      onPeerStalled: ({ peerId, reason }) => {
        input.updateConnectionSupervisorSignalState({
          peerId,
          channelKind: "data",
          lastFailureReason: reason
        });
        queueDataPeerRecovery(peerId, reason);
      }
    },
    input.iceServers,
    {
      autoReconnect: true,
      resolveConnectionConfig: (peerId) => ({
        iceTransportPolicy: resolvePreferredIceTransportPolicy(
          input.connectionSupervisorStatesRef.current.get(peerId)
        )
      })
    }
  );

  input.meshRef.current = mesh;
  mesh.setStatsSamplingMode(
    !input.currentTrackId || (!input.isPageVisible && input.playbackStatus !== "playing")
      ? "off"
      : input.bufferHealth !== "healthy"
        ? "active"
        : "steady"
  );

  const resyncRealtimePeers = (
    members: Array<{ peerId: string | null }> = input.currentRoomRef.current?.room.members ?? []
  ) => {
    const remotePeerIds = members
      .map((member) => member.peerId)
      .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== input.peerId);
    void mesh.syncPeers(remotePeerIds).catch(input.reportMeshResyncFailure);
  };

  return { mesh, resyncRealtimePeers };
}
