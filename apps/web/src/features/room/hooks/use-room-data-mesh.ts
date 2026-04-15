"use client";

import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PeerSignalMessage, RoomSnapshot } from "@music-room/shared";
import {
  ChunkScheduler,
  P2PMesh,
  resolvePreferredIceTransportPolicy,
  resolveTrackPieceManifest
} from "@/features/p2p";
import {
  cacheTrackPieces,
  getCachedLibraryTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey,
  queueTrackPieceManifestUpsert
} from "@/lib/indexeddb";
import { hashArrayBuffer } from "@/features/p2p";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { DataMeshBridge } from "./room-runtime-types";

export function useRoomDataMesh(input: {
  meshRef: MutableRefObject<P2PMesh | null>;
}): DataMeshBridge | null {
  return useMemo<DataMeshBridge>(
    () => ({
      async syncPeers(peerIds, options) {
        await input.meshRef.current?.syncPeers(peerIds, options);
      },
      restartPeer(peerId) {
        return input.meshRef.current?.restartPeer(peerId) ?? Promise.resolve(null);
      },
      requestPieces(peerId, trackId, chunkIndexes, totalChunks, timeoutMs) {
        return (
          input.meshRef.current?.requestPieces(
            peerId,
            trackId,
            chunkIndexes,
            totalChunks,
            timeoutMs
          ) ?? false
        );
      },
      getConnectedPeerIds() {
        return input.meshRef.current?.getConnectedPeerIds() ?? [];
      }
    }),
    [input.meshRef]
  );
}

export function createRoomDataMeshRuntime(input: {
  roomId: string;
  peerId: string;
  emitPeerSignal: (payload: PeerSignalMessage) => void;
  iceServers: RTCIceServer[];
  meshRef: MutableRefObject<P2PMesh | null>;
  chunkSchedulerRef: MutableRefObject<ChunkScheduler | null>;
  currentRoomRef: MutableRefObject<RoomSnapshot | null>;
  uploadedTracksRef: MutableRefObject<Record<string, UploadedTrack>>;
  uploadedTrackIdsRef: MutableRefObject<string[]>;
  manualCacheTrackIdsRef: MutableRefObject<string[]>;
  announceRoomTrackAvailabilityRef: MutableRefObject<(trackId: string) => Promise<void>>;
  handleManualCachePieceReceivedRef: MutableRefObject<
    (input: {
      trackId: string;
      chunkIndex: number;
      totalChunks: number;
      chunkSize: number;
      mimeType: string;
    }) => void
  >;
  clearManualCachePendingPiece: (trackId: string, chunkIndex: number) => void;
  flushPendingAvailabilityRef: MutableRefObject<() => void>;
  recordPeerDiagnosticRef: MutableRefObject<(input: any) => void>;
  recordPieceTransferRef: MutableRefObject<
    (input: { peerId: string; direction: "download" | "upload"; bytes: number }) => void
  >;
  recordPieceRequestSampleRef: MutableRefObject<
    (input: {
      peerId: string;
      outcome: "completed" | "timeout";
      durationMs: number;
    }) => void
  >;
  updatePeerBufferedAmountRef: MutableRefObject<
    (peerId: string, bufferedAmountBytes: number) => void
  >;
  updateDataTransportStatsRef: MutableRefObject<(input: any) => void>;
  connectionSupervisorStatesRef: MutableRefObject<Map<string, any>>;
  updateConnectionSupervisorSignalState: (input: {
    peerId: string;
    channelKind: "data" | "media";
    dataConnectionState?: string;
    dataIceState?: string;
    dataChannelState?: string;
    lastFailureReason?: string;
    mediaConnectionState?: string;
    mediaIceState?: string;
  }) => any;
  withResolvedTransportHealth: (snapshot: any) => any;
  withSupervisorDiagnosticPatch: (snapshot: any, state: any) => any;
  getPieceTransferRates: (
    transferWindows: Map<string, any>,
    peerId: string,
    now?: number
  ) => {
    downloadRateKbps: number | null;
    uploadRateKbps: number | null;
  };
  pieceTransferRatesRef: MutableRefObject<Map<string, any>>;
  getPeerMedianRttMs: (state: any) => number | null;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  bufferHealth: "healthy" | "low" | "critical";
  enableManualTrackCaching: boolean;
  reportMeshResyncFailure: (error: unknown) => void;
}) {
  const mesh = new P2PMesh(
    input.roomId,
    input.peerId,
    input.emitPeerSignal,
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
        input.recordPieceTransferRef.current({
          peerId: sourcePeerId,
          direction: "download",
          bytes: payloadBytes
        });
        if (typeof requestRttMs === "number" && Number.isFinite(requestRttMs)) {
          input.recordPieceRequestSampleRef.current({
            peerId: sourcePeerId,
            outcome: "completed",
            durationMs: requestRttMs
          });
        }
        const shouldProcessPieceForCache = input.manualCacheTrackIdsRef.current.includes(trackId);
        if (!shouldProcessPieceForCache) {
          return;
        }
        const currentTrack =
          input.currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
        if (currentTrack) {
          void (async () => {
            const cacheManifest =
              (await getTrackPieceManifestByFileHash(currentTrack.fileHash)) ??
              (await getTrackPieceManifest(trackId));
            await queueTrackPieceManifestUpsert({
              trackId,
              fileHash: currentTrack.fileHash,
              mimeType: currentTrack.mimeType || mimeType || "audio/mpeg",
              codec: currentTrack.codec ?? null,
              sizeBytes: currentTrack.sizeBytes ?? null,
              durationMs: currentTrack.durationMs,
              totalChunks,
              chunkSize,
              pieceHashes: cacheManifest?.pieceHashes
            });
          })();
        }
        input.chunkSchedulerRef.current?.markPieceReceived(trackId, chunkIndex, totalChunks);
        input.clearManualCachePendingPiece(trackId, chunkIndex);
        input.handleManualCachePieceReceivedRef.current({
          trackId,
          chunkIndex,
          totalChunks,
          chunkSize,
          mimeType
        });
      },
      onPieceSent: ({ peerId: targetPeerId, payloadBytes }) => {
        input.recordPieceTransferRef.current({
          peerId: targetPeerId,
          direction: "upload",
          bytes: payloadBytes
        });
      },
      onPieceRequestSent: ({ peerId: remotePeerId, trackId, chunkIndexes }) => {
        const chunkSummary =
          chunkIndexes.length === 1
            ? `${chunkIndexes[0]}`
            : `${chunkIndexes[0]}-${chunkIndexes[chunkIndexes.length - 1]}`;
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "sent",
          event: "piece-request",
          summary: `请求 ${remotePeerId} 的分片 ${trackId}#${chunkSummary}`
        });
      },
      onPieceRequestReceived: ({ peerId: remotePeerId, trackId, chunkIndex }) => {
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "received",
          event: "piece-request-received",
          summary: `收到 ${remotePeerId} 的分片请求 ${trackId}#${chunkIndex}`
        });
      },
      onPieceServed: ({ peerId: remotePeerId, trackId, chunkIndex, payloadBytes }) => {
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "sent",
          event: "piece-served",
          summary: `向 ${remotePeerId} 回传分片 ${trackId}#${chunkIndex} (${payloadBytes} bytes)`
        });
      },
      onPieceServeMiss: ({ peerId: remotePeerId, trackId, chunkIndex, reason }) => {
        const reasonLabel =
          reason === "piece-missing"
            ? "本地缺少分片"
            : reason === "manifest-missing"
              ? "分片清单缺失"
              : "DataChannel 未打开";
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "local",
          event: "piece-serve-miss",
          level: "warning",
          summary: `${trackId}#${chunkIndex} 未回片：${reasonLabel}`
        });
      },
      onPieceRequestTimeout: ({
        trackId,
        chunkIndex,
        peerId: timedOutPeerId,
        requestDurationMs
      }) => {
        input.recordPieceRequestSampleRef.current({
          peerId: timedOutPeerId,
          outcome: "timeout",
          durationMs: requestDurationMs
        });
        input.clearManualCachePendingPiece(trackId, chunkIndex);
        input.chunkSchedulerRef.current?.markRequestTimeout(trackId, chunkIndex, timedOutPeerId);
      },
      onPeerConnectionChange: ({ peerId: remotePeerId, state }) => {
        const supervisorState = input.updateConnectionSupervisorSignalState({
          peerId: remotePeerId,
          channelKind: "data",
          dataConnectionState: state,
          lastFailureReason: state === "failed" || state === "closed" ? "data-failed" : undefined
        });
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "local",
          event: "connection-state",
          summary: `Data 连接状态：${state}`,
          update: (snapshot: any) => ({
            ...input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              dataConnectionState: state
            })
          })
        });
        if (state === "closed" || state === "failed" || state === "disconnected") {
          input.setConnectedPeers((current) => current.filter((peer) => peer !== remotePeerId));
        }
      },
      onIceConnectionStateChange: ({ peerId: remotePeerId, state }) => {
        const supervisorState = input.updateConnectionSupervisorSignalState({
          peerId: remotePeerId,
          channelKind: "data",
          dataIceState: state,
          lastFailureReason: state === "failed" ? "ice-failed" : undefined
        });
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "local",
          event: "ice-state",
          summary: `Data ICE 状态：${state}`,
          update: (snapshot: any) => ({
            ...input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              dataIceState: state
            })
          })
        });
      },
      onDataChannelStateChange: ({ peerId: remotePeerId, state }) => {
        const supervisorState = input.updateConnectionSupervisorSignalState({
          peerId: remotePeerId,
          channelKind: "data",
          dataChannelState: state,
          lastFailureReason: state === "closed" ? "data-channel-closed" : undefined
        });
        input.recordPeerDiagnosticRef.current({
          peerId: remotePeerId,
          channelKind: "data",
          direction: "local",
          event: "data-channel",
          summary: `DataChannel 状态：${state}`,
          update: (snapshot: any) => ({
            ...input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              dataChannelState: state
            })
          })
        });
        input.setConnectedPeers((current) => {
          const next = new Set(current);
          if (state === "open") {
            next.add(remotePeerId);
          } else {
            next.delete(remotePeerId);
          }
          return [...next];
        });
        if (state === "open") {
          input.flushPendingAvailabilityRef.current();
          if (input.enableManualTrackCaching) {
            for (const trackId of input.currentRoomRef.current?.tracks.map((track) => track.id) ?? input.uploadedTrackIdsRef.current) {
              void input.announceRoomTrackAvailabilityRef.current(trackId);
            }
          }
        }
      },
      onDataBufferedAmountChange: ({ peerId: remotePeerId, bufferedAmountBytes }) => {
        input.updatePeerBufferedAmountRef.current(remotePeerId, bufferedAmountBytes);
      },
      onStatsSample: ({ peerId: remotePeerId, sample }) => {
        input.updateDataTransportStatsRef.current({
          peerId: remotePeerId,
          sample
        });
      },
      onPeerStalled: ({ peerId: remotePeerId, reason }) => {
        input.updateConnectionSupervisorSignalState({
          peerId: remotePeerId,
          channelKind: "data",
          lastFailureReason: reason
        });
      }
    },
    input.iceServers,
    {
      autoReconnect: false,
      resolveConnectionConfig: (remotePeerId) => ({
        iceTransportPolicy: resolvePreferredIceTransportPolicy(
          input.connectionSupervisorStatesRef.current.get(remotePeerId)
        )
      }),
      resolvePieceRequestFallback: async ({ trackId, chunkIndex }) => {
        const track = input.currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
        const uploadedTrack = input.uploadedTracksRef.current[trackId] ?? null;
        const cachedLibraryTrack = track ? await getCachedLibraryTrack(track.fileHash) : null;
        const fallbackFile = uploadedTrack?.file ?? cachedLibraryTrack?.file ?? null;
        if (!track || !fallbackFile) {
          return null;
        }

        const cachedManifest =
          (await getTrackPieceManifestByFileHash(track.fileHash)) ??
          (await getTrackPieceManifest(trackId));
        const manifest = resolveTrackPieceManifest({
          track,
          cacheManifest: cachedManifest,
          file: fallbackFile,
          mimeType: track.mimeType ?? fallbackFile.type ?? null,
          codec: track.codec ?? null,
          sizeBytes: track.sizeBytes ?? fallbackFile.size
        });
        if (!manifest || chunkIndex < 0 || chunkIndex >= manifest.totalChunks) {
          return null;
        }

        const chunkStart = chunkIndex * manifest.chunkSize;
        if (chunkStart >= fallbackFile.size) {
          return null;
        }

        const payload = await fallbackFile
          .slice(chunkStart, Math.min(fallbackFile.size, chunkStart + manifest.chunkSize))
          .arrayBuffer();
        const hash = await hashArrayBuffer(payload);

        await cacheTrackPieces([
          {
            pieceId: `${track.fileHash}:${manifest.chunkSize}:${localCacheOwnerKey}:${chunkIndex}`,
            trackId,
            fileHash: track.fileHash,
            peerId: input.peerId,
            ownerKey: localCacheOwnerKey,
            chunkIndex,
            chunkSize: payload.byteLength,
            hash,
            payload
          }
        ]);
        void queueTrackPieceManifestUpsert({
          trackId,
          fileHash: track.fileHash,
          mimeType: manifest.pieceMimeType,
          codec: track.codec ?? null,
          sizeBytes: track.sizeBytes ?? fallbackFile.size,
          durationMs: track.durationMs,
          totalChunks: manifest.totalChunks,
          chunkSize: manifest.chunkSize,
          pieceHashes: manifest.pieceHashes
        });

        return {
          payload,
          hash: manifest.pieceHashes?.[chunkIndex] ?? hash,
          totalChunks: manifest.totalChunks,
          chunkSize: manifest.chunkSize,
          mimeType: manifest.pieceMimeType
        };
      },
      resolveTrackCacheIdentity: (trackId) => {
        const track = input.currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
        return {
          fileHash: track?.fileHash ?? null,
          ownerKey: localCacheOwnerKey
        };
      }
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
  input.chunkSchedulerRef.current = new ChunkScheduler(input.peerId, {
    requestPieces: ({ peerId: remotePeerId, trackId, chunkIndexes, totalChunks, timeoutMs }) =>
      mesh.requestPieces(remotePeerId, trackId, chunkIndexes, totalChunks, timeoutMs),
    resolvePeerRequestWindow: (remotePeerId) => {
      const supervisorState =
        input.connectionSupervisorStatesRef.current.get(remotePeerId) ?? null;
      const pieceTransferRates = input.getPieceTransferRates(
        input.pieceTransferRatesRef.current,
        remotePeerId
      );
      return {
        currentRoundTripTimeMs: input.getPeerMedianRttMs(supervisorState),
        downloadRateKbps: pieceTransferRates.downloadRateKbps,
        candidateType: supervisorState?.lastObservedTransportKind ?? null,
        protocol: supervisorState?.samples[supervisorState.samples.length - 1]?.protocol ?? null,
        transportScore: supervisorState?.transportScore ?? null
      };
    }
  });

  const resyncRealtimePeers = (
    members: Array<{ peerId: string | null }> = input.currentRoomRef.current?.room.members ?? []
  ) => {
    const remotePeerIds = members
      .map((member) => member.peerId)
      .filter((memberPeerId): memberPeerId is string => !!memberPeerId && memberPeerId !== input.peerId);

    void mesh.syncPeers(remotePeerIds).catch((error) => {
      input.reportMeshResyncFailure(error);
    });
  };

  return {
    mesh,
    resyncRealtimePeers
  };
}
