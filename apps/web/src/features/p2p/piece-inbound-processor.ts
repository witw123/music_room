import {
  cacheTrackPieces,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import { validateTrackPiecePayloadBatch } from "./index";
import type { BinaryPieceMessage } from "./piece-frame-codec";
import type { CachedPieceManifestHeader } from "./piece-manifest-header";

export type IncomingPieceBatchItem = {
  peerId: string;
  message: BinaryPieceMessage;
};

export type ReceivedPieceCallbackPayload = {
  peerId: string;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  payloadBytes: number;
  /** Raw piece payload bytes — available for in-memory buffering.
   *  This is the validated chunk data before IndexedDB persistence. */
  payload: ArrayBuffer;
  streamId: string;
  generation: number;
};

type PersistableIncomingPiece = {
  item: IncomingPieceBatchItem;
  expectedHash: string;
  callbackPayload: ReceivedPieceCallbackPayload;
};

type TrackCacheIdentity = {
  fileHash: string | null;
  ownerKey?: string | null;
  chunkSize?: number | null;
};

type PieceInboundProcessorCallbacks = {
  onPieceReceived: (payload: ReceivedPieceCallbackPayload) => boolean | void;
  onPiecePersisted?: (payload: ReceivedPieceCallbackPayload) => void;
  onPieceNack?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    streamId: string;
    generation: number;
    reason: "hash-mismatch" | "decode-failure" | "storage-failure";
  }) => void;
};

export class PieceInboundProcessor {
  private readonly batchSize: number;
  private readonly localPeerId: string;
  private readonly flushDelayMs: number;
  private readonly resolveManifestHeader: (
    trackId: string,
    fallbackChunkSize: number
  ) => Promise<CachedPieceManifestHeader | null>;
  private readonly rememberManifestHeader: (
    trackId: string,
    header: CachedPieceManifestHeader
  ) => void;
  private readonly resolveTrackCacheIdentity?: (
    trackId: string
  ) => TrackCacheIdentity | null | undefined;
  private readonly callbacks: PieceInboundProcessorCallbacks;
  private readonly pendingIncomingPieces: IncomingPieceBatchItem[] = [];
  private readonly invalidatedTracks = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private piecePersistChain: Promise<void> = Promise.resolve();
  private persistenceBacklogBytes = 0;
  private readonly maxPersistenceBacklogBytes: number;

  constructor(input: {
    batchSize: number;
    localPeerId: string;
    flushDelayMs?: number;
    maxPersistenceBacklogBytes?: number;
    resolveManifestHeader: (
      trackId: string,
      fallbackChunkSize: number
    ) => Promise<CachedPieceManifestHeader | null>;
    rememberManifestHeader: (trackId: string, header: CachedPieceManifestHeader) => void;
    resolveTrackCacheIdentity?: (trackId: string) => TrackCacheIdentity | null | undefined;
  } & PieceInboundProcessorCallbacks) {
    this.batchSize = input.batchSize;
    this.localPeerId = input.localPeerId;
    this.flushDelayMs = input.flushDelayMs ?? 18;
    this.maxPersistenceBacklogBytes = input.maxPersistenceBacklogBytes ?? 32 * 1024 * 1024;
    this.resolveManifestHeader = input.resolveManifestHeader;
    this.rememberManifestHeader = input.rememberManifestHeader;
    this.resolveTrackCacheIdentity = input.resolveTrackCacheIdentity;
    this.callbacks = input;
  }

  enqueue(item: IncomingPieceBatchItem) {
    if (this.invalidatedTracks.has(item.message.trackId)) {
      return;
    }
    this.pendingIncomingPieces.push(item);
    this.scheduleFlush();
  }

  resumeTrack(trackId: string) {
    this.invalidatedTracks.delete(trackId);
  }

  pendingCount() {
    return this.pendingIncomingPieces.length;
  }

  awaitPersistence() {
    return this.piecePersistChain;
  }

  getBacklogSnapshot() {
    return {
      validationQueueItems: this.pendingIncomingPieces.length,
      persistenceBacklogBytes: this.persistenceBacklogBytes,
      maxPersistenceBacklogBytes: this.maxPersistenceBacklogBytes
    };
  }

  clear() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingIncomingPieces.length = 0;
    this.invalidatedTracks.clear();
  }

  async clearTrack(trackId: string) {
    this.invalidatedTracks.add(trackId);
    for (let index = this.pendingIncomingPieces.length - 1; index >= 0; index -= 1) {
      if (this.pendingIncomingPieces[index]?.message.trackId === trackId) {
        this.pendingIncomingPieces.splice(index, 1);
      }
    }
    await this.piecePersistChain.catch(() => undefined);
  }

  scheduleFlush() {
    if (this.flushTimer || this.flushInFlight) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.flushInFlight || this.pendingIncomingPieces.length === 0) {
      return;
    }

    this.flushInFlight = true;
    const batch = this.pendingIncomingPieces.splice(0, this.batchSize);

    try {
      if (this.persistenceBacklogBytes >= this.maxPersistenceBacklogBytes) {
        await this.piecePersistChain.catch(() => undefined);
      }
      const manifestHeaders = await this.resolveManifestHeaders(batch);
      const expectedHashes = batch.map(
        (item, index) =>
          manifestHeaders[index]?.pieceHashes?.[item.message.chunkIndex] ?? item.message.pieceHash
      );
      const validationResults = await validateTrackPiecePayloadBatch(
        batch.map((item, index) => ({
          payload: item.message.payload,
          expectedHash: expectedHashes[index] ?? item.message.pieceHash
        }))
      );

      const persistablePieces = this.collectPersistablePieces({
        batch,
        expectedHashes,
        manifestHeaders,
        validationResults
      });
      this.persistAcceptedPieces(persistablePieces);
    } finally {
      this.flushInFlight = false;
      if (this.pendingIncomingPieces.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  private async resolveManifestHeaders(batch: IncomingPieceBatchItem[]) {
    return Promise.all(
      batch.map(async (item) => {
        return this.resolveManifestHeader(
          item.message.trackId,
          item.message.header.chunkSize
        );
      })
    );
  }

  private collectPersistablePieces(input: {
    batch: IncomingPieceBatchItem[];
    expectedHashes: string[];
    manifestHeaders: Array<CachedPieceManifestHeader | null>;
    validationResults: boolean[];
  }) {
    const persistablePieces: PersistableIncomingPiece[] = [];
    const { batch, expectedHashes, manifestHeaders, validationResults } = input;

    for (const [index, item] of batch.entries()) {
      if (this.invalidatedTracks.has(item.message.trackId)) {
        continue;
      }
      if (!(validationResults[index] ?? false)) {
        this.reportValidationFailure(item);
        continue;
      }

      const expectedHash = expectedHashes[index] ?? item.message.pieceHash;
      const callbackPayload = this.buildCallbackPayload(item);
      const shouldPersistPiece = this.callbacks.onPieceReceived(callbackPayload);
      this.rememberManifestHeader(item.message.trackId, {
        totalChunks: callbackPayload.totalChunks,
        chunkSize: item.message.header.chunkSize,
        mimeType: item.message.header.mimeType,
        pieceHashes: manifestHeaders[index]?.pieceHashes
      });

      if (shouldPersistPiece === true) {
        persistablePieces.push({
          item,
          expectedHash,
          callbackPayload
        });
      }
    }

    return persistablePieces;
  }

  private reportValidationFailure(item: IncomingPieceBatchItem) {
    const streamId = item.message.header.streamId;
    const generation = item.message.header.generation;
    if (streamId && typeof generation === "number") {
      this.callbacks.onPieceNack?.({
        peerId: item.peerId,
        trackId: item.message.trackId,
        chunkIndex: item.message.chunkIndex,
        streamId,
        generation,
        reason: "hash-mismatch"
      });
    }
  }

  private buildCallbackPayload(item: IncomingPieceBatchItem): ReceivedPieceCallbackPayload {
    return {
      peerId: item.peerId,
      trackId: item.message.header.trackId,
      chunkIndex: item.message.header.chunkIndex,
      totalChunks: item.message.totalChunks,
      chunkSize: item.message.header.chunkSize,
      mimeType: item.message.header.mimeType,
      payloadBytes: item.message.payload.byteLength,
      payload: item.message.payload,
      streamId: item.message.header.streamId,
      generation: item.message.header.generation
    };
  }

  private persistAcceptedPieces(persistablePieces: PersistableIncomingPiece[]) {
    if (persistablePieces.length === 0) {
      return;
    }

    const piecesToPersist = persistablePieces.map(({ item, expectedHash }) => {
      const cacheIdentity = this.resolveTrackCacheIdentity?.(item.message.trackId) ?? null;
      const fileHash = cacheIdentity?.fileHash ?? item.message.trackId;
      return {
        pieceId: `${fileHash}:${item.message.header.chunkSize}:${localCacheOwnerKey}:${item.message.chunkIndex}`,
        trackId: item.message.trackId,
        fileHash: cacheIdentity?.fileHash ?? undefined,
        peerId: this.localPeerId,
        ownerKey: localCacheOwnerKey,
        chunkIndex: item.message.chunkIndex,
        chunkSize: item.message.header.chunkSize,
        hash: expectedHash,
        payload: item.message.payload
      };
    });
    const persistedPayloads = persistablePieces.map((piece) => piece.callbackPayload);
    const persistedBytes = persistablePieces.reduce(
      (total, piece) => total + piece.item.message.payload.byteLength,
      0
    );
    this.persistenceBacklogBytes += persistedBytes;
    this.piecePersistChain = this.piecePersistChain
      .catch(() => undefined)
      .then(async () => {
        try {
          if (persistablePieces.some(({ item }) => this.invalidatedTracks.has(item.message.trackId))) {
            return;
          }
          await cacheTrackPieces(piecesToPersist);
          for (const payload of persistedPayloads) {
            if (!this.invalidatedTracks.has(payload.trackId)) {
              this.callbacks.onPiecePersisted?.(payload);
            }
          }
        } catch {
          for (const payload of persistedPayloads) {
            if (payload.streamId && typeof payload.generation === "number") {
              this.callbacks.onPieceNack?.({
                peerId: payload.peerId,
                trackId: payload.trackId,
                chunkIndex: payload.chunkIndex,
                streamId: payload.streamId,
                generation: payload.generation,
                reason: "storage-failure"
              });
            }
          }
        } finally {
          this.persistenceBacklogBytes = Math.max(
            0,
            this.persistenceBacklogBytes - persistedBytes
          );
        }
      });
  }
}
