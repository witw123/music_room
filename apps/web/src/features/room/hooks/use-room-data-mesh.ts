"use client";

import { useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PeerDiagnosticsSnapshot, PeerSignalMessage, RoomSnapshot, TrackMeta } from "@music-room/shared";
import {
  ChunkScheduler,
  P2PMesh,
  resolvePreferredIceTransportPolicy,
  resolvePeerSendBudget,
  resolveTrackPieceManifest,
  pieceMemoryBuffer
} from "@/features/p2p";
import {
  getCachedLibraryTrack,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey,
  queueTrackPieceManifestUpsert,
  type TrackPieceManifestRecord
} from "@/lib/indexeddb";
import type { CachedLibraryTrackRecord } from "@/lib/indexeddb";
import { hashArrayBuffer } from "@/features/p2p";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { isCachedLibraryTrackUsableForRoomTrack } from "@/features/upload/cached-library-track-policy";
import type {
  DataMeshBridge,
  ManualCachePieceReceivedInput,
  PlaybackRecoveryRecommendation,
  RoomDataMeshDiagnosticsRefs
} from "./room-runtime-types";

type DataMeshRuntime = Pick<
  P2PMesh,
  "syncPeers" | "restartPeer" | "requestPieces" | "getConnectedPeerIds"
>;

const pieceUnavailableRetryDelayMs = 1_500;

export function useRoomDataMesh(input: {
  meshRef: MutableRefObject<P2PMesh | null>;
}): DataMeshBridge | null {
  return useMemo<DataMeshBridge>(
    () => createDataMeshBridge(input.meshRef),
    [input.meshRef]
  );
}

export function createDataMeshBridge(meshRef: MutableRefObject<DataMeshRuntime | null>): DataMeshBridge {
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
    requestPieces(peerId, trackId, chunkIndexes, totalChunks, timeoutMs, options) {
      return (
        meshRef.current?.requestPieces(
          peerId,
          trackId,
          chunkIndexes,
          totalChunks,
          timeoutMs,
          options
        ) ?? false
      );
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

export function createBoundedCachedLibraryTrackCache<T extends { fileHash: string }>(
  maxEntries = 2,
  ttlMs = 30_000
) {
  const entries = new Map<string, { value: T; lastUsedAt: number }>();

  return {
    get(fileHash: string, now = Date.now()) {
      const entry = entries.get(fileHash);
      if (!entry) {
        return null;
      }
      if (now - entry.lastUsedAt > ttlMs) {
        entries.delete(fileHash);
        return null;
      }
      entries.delete(fileHash);
      entries.set(fileHash, {
        value: entry.value,
        lastUsedAt: now
      });
      return entry.value;
    },
    set(value: T, now = Date.now()) {
      entries.delete(value.fileHash);
      entries.set(value.fileHash, {
        value,
        lastUsedAt: now
      });
      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (!oldestKey) {
          break;
        }
        entries.delete(oldestKey);
      }
    },
    clear() {
      entries.clear();
    }
  };
}

export function createInFlightCachedLibraryTrackRecordLoader<T>(
  loadCachedLibraryTrackRecord: (fileHash: string) => Promise<T | null>
) {
  const inFlightLoads = new Map<string, Promise<T | null>>();

  return (fileHash: string) => {
    const existingLoad = inFlightLoads.get(fileHash);
    if (existingLoad) {
      return existingLoad;
    }

    const nextLoad = loadCachedLibraryTrackRecord(fileHash).finally(() => {
      if (inFlightLoads.get(fileHash) === nextLoad) {
        inFlightLoads.delete(fileHash);
      }
    });
    inFlightLoads.set(fileHash, nextLoad);
    return nextLoad;
  };
}

export async function resolvePieceRequestFallbackPayload(input: {
  track: TrackMeta;
  fallbackFile: Blob;
  cachedManifest: TrackPieceManifestRecord | null;
  chunkIndex: number;
  hashArrayBuffer: (payload: ArrayBuffer) => Promise<string>;
}) {
  const manifest = resolveTrackPieceManifest({
    track: input.track,
    cacheManifest: input.cachedManifest,
    file: input.fallbackFile,
    mimeType: input.track.mimeType ?? input.fallbackFile.type ?? null,
    codec: input.track.codec ?? null,
    sizeBytes: input.track.sizeBytes ?? input.fallbackFile.size
  });
  if (!manifest || input.chunkIndex < 0 || input.chunkIndex >= manifest.totalChunks) {
    return null;
  }

  const chunkStart = input.chunkIndex * manifest.chunkSize;
  if (chunkStart >= input.fallbackFile.size) {
    return null;
  }

  const payload = await input.fallbackFile
    .slice(chunkStart, Math.min(input.fallbackFile.size, chunkStart + manifest.chunkSize))
    .arrayBuffer();
  const hash = manifest.pieceHashes?.[input.chunkIndex] ?? await input.hashArrayBuffer(payload);

  return {
    payload,
    hash,
    totalChunks: manifest.totalChunks,
    chunkSize: manifest.chunkSize,
    mimeType: manifest.pieceMimeType
  };
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
  announceRoomTrackAvailabilityRef: MutableRefObject<(
    trackId: string,
    options?: { force?: boolean }
  ) => Promise<boolean>>;
  handleManualCachePieceReceivedRef: MutableRefObject<(input: ManualCachePieceReceivedInput) => void>;
  clearManualCachePendingPiece: (trackId: string, chunkIndex: number) => void;
  deferManualCachePendingPiece: (
    trackId: string,
    chunkIndex: number,
    options: { delayMs: number }
  ) => void;
  flushPendingAvailabilityRef: MutableRefObject<() => void>;
  setConnectedPeers: Dispatch<SetStateAction<string[]>>;
  isPageVisible: boolean;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null | undefined;
  currentTrackId: string | null | undefined;
  bufferHealth: "healthy" | "low" | "critical";
  enableManualTrackCaching: boolean;
  queuePlaybackRecoveryRecommendation?: (recommendation: PlaybackRecoveryRecommendation) => void;
  reportMeshResyncFailure: (error: unknown) => void;
} & RoomDataMeshDiagnosticsRefs) {
  const peerBufferedAmountBytes = new Map<string, number>();
  const cachedLibraryTrackCache =
    createBoundedCachedLibraryTrackCache<CachedLibraryTrackRecord>(1, 5_000);
  const loadCachedLibraryTrackRecord = createInFlightCachedLibraryTrackRecordLoader(
    getCachedLibraryTrack
  );
const resolvePeerLinkWindow = (remotePeerId: string) => {
    const supervisorState =
      input.connectionSupervisorStatesRef.current.get(remotePeerId) ?? null;
    const latestTransportSample =
      supervisorState?.samples[supervisorState.samples.length - 1] ?? null;
    const pieceTransferRates = input.getPieceTransferRates(
      input.pieceTransferRatesRef.current,
      remotePeerId
    );

    return {
      currentRoundTripTimeMs: input.getPeerMedianRttMs(supervisorState),
      downloadRateKbps: pieceTransferRates.downloadRateKbps,
      uploadRateKbps: pieceTransferRates.uploadRateKbps,
      candidateType:
        latestTransportSample?.candidateType ?? supervisorState?.lastObservedTransportKind ?? null,
      protocol:
        latestTransportSample?.relayProtocol ?? latestTransportSample?.protocol ?? null,
      relayProtocol: latestTransportSample?.relayProtocol ?? null,
      transportScore: supervisorState?.transportScore ?? null,
      bufferedAmountBytes: peerBufferedAmountBytes.get(remotePeerId) ?? null
    };
  };
  const queueDataPeerRecovery = (inputValue: {
    peerId: string;
    dataChannelState?: string | null;
    dataConnectionState?: string | null;
    reason: string;
  }) => {
    const recommendation = resolveDataPeerRecoveryRecommendation(inputValue);
    if (recommendation) {
      input.queuePlaybackRecoveryRecommendation?.(recommendation);
    }
  };
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
        payload,
        requestRttMs
      }) => {
        // Store validated piece in the in-memory buffer so the PCM engine can
        // read it instantly without an IndexedDB round-trip. This eliminates
        // the primary latency bottleneck for first-time playback.
        pieceMemoryBuffer.put(trackId, chunkIndex, payload);

        input.recordPieceTransferRef.current({
          peerId: sourcePeerId,
          direction: "download",
          bytes: payloadBytes,
          durationMs: requestRttMs
        });
        if (typeof requestRttMs === "number" && Number.isFinite(requestRttMs)) {
          input.recordPieceRequestSampleRef.current({
            peerId: sourcePeerId,
            outcome: "completed",
            durationMs: requestRttMs
          });
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
        // PCM may evict this piece from its memory window at any time, so every
        // validated playback piece must also survive in the durable cache.
        return true;
      },
      onPiecePersisted: ({
        peerId: sourcePeerId,
        trackId,
        chunkIndex,
        totalChunks,
        chunkSize,
        mimeType
      }) => {
        input.chunkSchedulerRef.current?.markPieceReceived(
          trackId,
          chunkIndex,
          totalChunks,
          sourcePeerId
        );
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
      onPieceUnavailable: ({
        trackId,
        chunkIndex,
        peerId: unavailablePeerId,
        reason,
        requestDurationMs
      }) => {
        input.recordPieceRequestSampleRef.current({
          peerId: unavailablePeerId,
          outcome: "timeout",
          durationMs: requestDurationMs
        });
        input.deferManualCachePendingPiece(
          trackId,
          chunkIndex,
          { delayMs: pieceUnavailableRetryDelayMs }
        );
        input.chunkSchedulerRef.current?.markRequestTimeout(trackId, chunkIndex, unavailablePeerId);
        input.recordPeerDiagnosticRef.current({
          peerId: unavailablePeerId,
          channelKind: "data",
          direction: "received",
          event: "piece-unavailable",
          level: "warning",
          summary: `${trackId}#${chunkIndex} 暂不可用：${reason}`
        });
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
          update: (snapshot: PeerDiagnosticsSnapshot) => ({
            ...input.withResolvedTransportHealth({
              ...input.withSupervisorDiagnosticPatch(snapshot, supervisorState),
              dataConnectionState: state
            })
          })
        });
        if (state === "closed" || state === "failed" || state === "disconnected") {
          peerBufferedAmountBytes.delete(remotePeerId);
          input.chunkSchedulerRef.current?.markPeerUnavailable(remotePeerId);
          input.setConnectedPeers((current) => current.filter((peer) => peer !== remotePeerId));
          queueDataPeerRecovery({
            peerId: remotePeerId,
            dataConnectionState: state,
            reason: state === "disconnected" ? "data-disconnected" : "data-failed"
          });
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
          update: (snapshot: PeerDiagnosticsSnapshot) => ({
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
          update: (snapshot: PeerDiagnosticsSnapshot) => ({
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
        if (state === "closed" || state === "closing") {
          peerBufferedAmountBytes.delete(remotePeerId);
          input.chunkSchedulerRef.current?.markPeerUnavailable(remotePeerId);
        }
        if (state === "closed") {
          queueDataPeerRecovery({
            peerId: remotePeerId,
            dataChannelState: state,
            reason: "data-channel-closed"
          });
        }
      },
      onDataBufferedAmountChange: ({ peerId: remotePeerId, bufferedAmountBytes }) => {
        peerBufferedAmountBytes.set(remotePeerId, bufferedAmountBytes);
        input.updatePeerBufferedAmountRef.current(remotePeerId, bufferedAmountBytes);
      },
      onStatsSample: ({ peerId: remotePeerId, sample }) => {
        input.updateConnectionSupervisorTransportStats({
          peerId: remotePeerId,
          sample
        });
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
        input.chunkSchedulerRef.current?.markPeerUnavailable(remotePeerId);
        queueDataPeerRecovery({
          peerId: remotePeerId,
          reason
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
      resolvePeerSendBudget: (remotePeerId) =>
        resolvePeerSendBudget(resolvePeerLinkWindow(remotePeerId)),
      resolvePieceRequestFallback: async ({ trackId, chunkIndex }) => {
        const track = input.currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
        const uploadedTrack = input.uploadedTracksRef.current[trackId] ?? null;
        let cachedLibraryTrack = track
          ? cachedLibraryTrackCache.get(track.fileHash)
          : null;
        if (!cachedLibraryTrack && track) {
          cachedLibraryTrack = (await loadCachedLibraryTrackRecord(track.fileHash)) ?? null;
          if (cachedLibraryTrack) {
            cachedLibraryTrackCache.set(cachedLibraryTrack);
          }
        }
        const fallbackFile =
          uploadedTrack?.file ??
          (isCachedLibraryTrackUsableForRoomTrack({
            cachedTrack: cachedLibraryTrack,
            roomTrack: track
          })
            ? cachedLibraryTrack?.file ?? null
            : null);
        if (!track || !fallbackFile) {
          return null;
        }

        const cachedManifest =
          (await getTrackPieceManifestByFileHash(track.fileHash)) ??
          (await getTrackPieceManifest(trackId)) ??
          null;
        return resolvePieceRequestFallbackPayload({
          track,
          cachedManifest,
          fallbackFile,
          chunkIndex,
          hashArrayBuffer
        });
      },
      resolveTrackCacheIdentity: (trackId) => {
        const track = input.currentRoomRef.current?.tracks.find((entry) => entry.id === trackId) ?? null;
        return {
          fileHash: track?.fileHash ?? null,
          ownerKey: localCacheOwnerKey,
          chunkSize: track?.relayManifest?.chunkSize ?? track?.pieceManifest?.chunkSize ?? null
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
    requestPieces: ({
      peerId: remotePeerId,
      trackId,
      chunkIndexes,
      totalChunks,
      timeoutMs,
      priority
    }) =>
      mesh.requestPieces(remotePeerId, trackId, chunkIndexes, totalChunks, timeoutMs, {
        priority: priority === "background" ? "bulk" : "critical"
      }),
    resolvePeerRequestWindow: (remotePeerId) => resolvePeerLinkWindow(remotePeerId)
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
