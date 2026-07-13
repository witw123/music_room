import { describe, expect, it, vi } from "vitest";
import {
  createBoundedCachedLibraryTrackCache,
  createInFlightCachedLibraryTrackRecordLoader,
  createDataMeshBridge,
  createRoomDataMeshRuntime,
  resolvePieceRequestFallbackPayload,
  resolveDataPeerRecoveryRecommendation
} from "./use-room-data-mesh";

describe("createBoundedCachedLibraryTrackCache", () => {
  it("reuses recent cached-library records and evicts older full-file entries", () => {
    const cache = createBoundedCachedLibraryTrackCache<{ fileHash: string; title: string }>(2);
    const first = { fileHash: "hash_1", title: "First" };
    const second = { fileHash: "hash_2", title: "Second" };
    const third = { fileHash: "hash_3", title: "Third" };

    cache.set(first);
    cache.set(second);
    expect(cache.get("hash_1")).toBe(first);

    cache.set(third);

    expect(cache.get("hash_1")).toBe(first);
    expect(cache.get("hash_2")).toBeNull();
    expect(cache.get("hash_3")).toBe(third);
  });
});

describe("createInFlightCachedLibraryTrackRecordLoader", () => {
  it("coalesces concurrent cached-library record loads for piece fallback", async () => {
    type CachedRecord = { fileHash: string; file: File };
    const loads: Array<{
      fileHash: string;
      resolve: (value: CachedRecord | null) => void;
    }> = [];
    const loader = createInFlightCachedLibraryTrackRecordLoader<CachedRecord>((fileHash) =>
      new Promise<CachedRecord | null>((resolve) => {
        loads.push({ fileHash, resolve });
      })
    );
    const cachedRecord = {
      fileHash: "hash_1",
      file: new File(["cached"], "cached.flac", { type: "audio/flac" })
    };

    const first = loader("hash_1");
    const second = loader("hash_1");

    expect(loads).toHaveLength(1);
    loads[0]?.resolve(cachedRecord);
    await expect(Promise.all([first, second])).resolves.toEqual([
      cachedRecord,
      cachedRecord
    ]);

    const third = loader("hash_1");
    expect(loads).toHaveLength(2);
    loads[1]?.resolve(null);
    await expect(third).resolves.toBeNull();
  });
});

describe("createDataMeshBridge", () => {
  it("reports syncPeers as not started before the mesh runtime exists", async () => {
    const bridge = createDataMeshBridge({ current: null });

    await expect(bridge.syncPeers(["peer_source"])).resolves.toBe(false);
    expect(bridge.isReady()).toBe(false);
  });

  it("returns true when syncPeers reaches the mesh runtime", async () => {
    const syncPeers = vi.fn().mockResolvedValue(undefined);
    const bridge = createDataMeshBridge({
      current: {
        syncPeers,
        restartPeer: vi.fn(),
        requestPieces: vi.fn(),
        getConnectedPeerIds: vi.fn(() => [])
      }
    });

    await expect(bridge.syncPeers(["peer_source"])).resolves.toBe(true);
    expect(syncPeers).toHaveBeenCalledWith(["peer_source"], undefined);
    expect(bridge.isReady()).toBe(true);
  });
});

describe("createRoomDataMeshRuntime piece persistence", () => {
  it("persists every validated playback piece and marks it owned only after persistence", () => {
    const markPieceReceived = vi.fn();
    const markRequestTimeout = vi.fn();
    const clearManualCachePendingPiece = vi.fn();
    const handleManualCachePieceReceived = vi.fn();
    const meshRef = { current: null };
    const chunkSchedulerRef = { current: null };
    const runtime = createRoomDataMeshRuntime({
      roomId: "room_1",
      peerId: "peer_local",
      emitPeerSignal: vi.fn(),
      iceServers: [],
      meshRef,
      chunkSchedulerRef,
      currentRoomRef: { current: null },
      uploadedTracksRef: { current: {} },
      uploadedTrackIdsRef: { current: [] },
      manualCacheTrackIdsRef: { current: [] },
      announceRoomTrackAvailabilityRef: { current: vi.fn() },
      handleManualCachePieceReceivedRef: {
        current: handleManualCachePieceReceived
      },
      clearManualCachePendingPiece,
      deferManualCachePendingPiece: vi.fn(),
      flushPendingAvailabilityRef: { current: vi.fn() },
      setConnectedPeers: vi.fn(),
      isPageVisible: true,
      playbackStatus: "playing",
      currentTrackId: "track_1",
      bufferHealth: "healthy",
      enableManualTrackCaching: false,
      reportMeshResyncFailure: vi.fn(),
      recordPeerDiagnosticRef: { current: vi.fn() },
      recordPieceTransferRef: { current: vi.fn() },
      recordPieceRequestSampleRef: { current: vi.fn() },
      updatePeerBufferedAmountRef: { current: vi.fn() },
      updateDataTransportStatsRef: { current: vi.fn() },
      connectionSupervisorStatesRef: { current: new Map() },
      updateConnectionSupervisorSignalState: vi.fn(() => null),
      updateConnectionSupervisorTransportStats: vi.fn(() => null),
      withResolvedTransportHealth: vi.fn((snapshot) => snapshot),
      withSupervisorDiagnosticPatch: vi.fn((snapshot) => snapshot),
      getPieceTransferRates: vi.fn(() => ({
        downloadRateKbps: null,
        uploadRateKbps: null
      })),
      pieceTransferRatesRef: { current: new Map() },
      getPeerMedianRttMs: vi.fn(() => null)
    });
    chunkSchedulerRef.current = {
      markPieceReceived,
      markRequestTimeout
    } as never;
    const callbacks = (
      runtime.mesh as unknown as {
        callbacks: {
          onPieceReceived: (payload: {
            peerId: string;
            trackId: string;
            chunkIndex: number;
            totalChunks: number;
            chunkSize: number;
            mimeType: string;
            payloadBytes: number;
            payload: ArrayBuffer;
            requestRttMs: number | null;
          }) => boolean | void;
          onPiecePersisted: (payload: {
            peerId: string;
            trackId: string;
            chunkIndex: number;
            totalChunks: number;
            chunkSize: number;
            mimeType: string;
          }) => void;
          onCacheStreamReset: (payload: {
            peerId: string;
            trackId: string;
            streamId: string;
            generation: number;
            chunkIndexes: number[];
            reason: "timeout";
          }) => void;
        };
      }
    ).callbacks;
    const piece = {
      peerId: "peer_source",
      trackId: "track_1",
      chunkIndex: 4,
      totalChunks: 12,
      chunkSize: 4,
      mimeType: "audio/flac"
    };

    expect(
      callbacks.onPieceReceived({
        ...piece,
        payloadBytes: 4,
        payload: new Uint8Array([1, 2, 3, 4]).buffer,
        requestRttMs: null
      })
    ).toBe(true);
    expect(markPieceReceived).not.toHaveBeenCalled();

    callbacks.onPiecePersisted(piece);

    expect(markPieceReceived).toHaveBeenCalledWith(
      "track_1",
      4,
      12,
      "peer_source"
    );
    expect(clearManualCachePendingPiece).toHaveBeenCalledWith("track_1", 4);
    expect(handleManualCachePieceReceived).toHaveBeenCalledWith({
      trackId: "track_1",
      chunkIndex: 4,
      totalChunks: 12,
      chunkSize: 4,
      mimeType: "audio/flac"
    });

    clearManualCachePendingPiece.mockClear();
    callbacks.onCacheStreamReset({
      peerId: "peer_source",
      trackId: "track_1",
      streamId: "stream_1",
      generation: 1,
      chunkIndexes: [0, 1, 2],
      reason: "timeout"
    });
    expect(clearManualCachePendingPiece.mock.calls).toEqual([
      ["track_1", 0],
      ["track_1", 1],
      ["track_1", 2]
    ]);

    runtime.mesh.destroy();
  });
});

describe("resolvePieceRequestFallbackPayload", () => {
  it("reuses manifest piece hashes without hashing the fallback file chunk again", async () => {
    const hashArrayBuffer = vi.fn(async () => "computed-hash");
    const fallbackFile = new File(["abcdefgh"], "track.flac", { type: "audio/flac" });

    const result = await resolvePieceRequestFallbackPayload({
      track: {
        id: "track_1",
        title: "Track",
        artist: "Artist",
        album: null,
        durationMs: 1000,
        bitrate: null,
        sizeBytes: fallbackFile.size,
        codec: "flac",
        mimeType: "audio/flac",
        fileHash: "file-hash",
        artworkUrl: null,
        ownerSessionId: "owner_1",
        ownerNickname: "owner",
        sourceType: "local_upload",
        pieceManifest: null,
        relayManifest: null
      },
      fallbackFile,
      cachedManifest: {
        trackId: "track_1",
        fileHash: "file-hash",
        mimeType: "audio/flac",
        codec: "flac",
        sizeBytes: fallbackFile.size,
        durationMs: 1000,
        totalChunks: 2,
        chunkSize: 4,
        pieceHashes: ["manifest-hash-0", "manifest-hash-1"],
        updatedAt: "2026-07-08T00:00:00.000Z"
      },
      chunkIndex: 1,
      hashArrayBuffer
    });

    expect(hashArrayBuffer).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      hash: "manifest-hash-1",
      totalChunks: 2,
      chunkSize: 4,
      mimeType: "audio/flac"
    });
    expect(new TextDecoder().decode(result?.payload)).toBe("efgh");
  });
});

describe("resolveDataPeerRecoveryRecommendation", () => {
  it("requests a targeted data peer restart for closed or failed transport states", () => {
    expect(
      resolveDataPeerRecoveryRecommendation({
        peerId: "peer_2",
        dataChannelState: "closed",
        dataConnectionState: "connected",
        reason: "data-channel-closed"
      })
    ).toMatchObject({
      peerId: "peer_2",
      scope: "data",
      level: "hard-recreate",
      reason: "data-channel-closed"
    });

    expect(
      resolveDataPeerRecoveryRecommendation({
        peerId: "peer_2",
        dataChannelState: "open",
        dataConnectionState: "connected",
        reason: "data-channel-open"
      })
    ).toBeNull();
  });
});
