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
  onPieceValidated?: (payload: ReceivedPieceCallbackPayload) => void;
  onPiecePersisted?: (payload: ReceivedPieceCallbackPayload) => void;
  onPieceNack?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    streamId: string;
    generation: number;
    reason: "hash-mismatch" | "decode-failure" | "storage-failure" | "receiver-overloaded";
    refundCreditBytes: number;
  }) => void;
};

const maxValidationQueueBytes = 8 * 1024 * 1024;
const defaultMaxPersistenceBacklogBytes = 32 * 1024 * 1024;
const maxPersistenceBacklogPerTrackBytes = 16 * 1024 * 1024;
const persistenceWorkerCount = 2;
const maxPersistenceBatchPieces = 16;
const maxPersistenceBatchBytes = 4 * 1024 * 1024;
const persistenceRetryDelaysMs = [250, 1_000, 4_000] as const;

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
  private readonly pendingPersistencePieces: PersistableIncomingPiece[] = [];
  private readonly invalidatedTracks = new Set<string>();
  private readonly persistenceBacklogByTrack = new Map<string, number>();
  private readonly persistenceWaiters = new Set<() => void>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private persistenceWorkerCount = 0;
  private pendingValidationBytes = 0;
  private persistenceBacklogBytes = 0;
  private readonly maxPersistenceBacklogBytes: number;
  private disposed = false;

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
    this.batchSize = Math.max(1, Math.min(input.batchSize, maxPersistenceBatchPieces));
    this.localPeerId = input.localPeerId;
    this.flushDelayMs = input.flushDelayMs ?? 18;
    this.maxPersistenceBacklogBytes =
      input.maxPersistenceBacklogBytes ?? defaultMaxPersistenceBacklogBytes;
    this.resolveManifestHeader = input.resolveManifestHeader;
    this.rememberManifestHeader = input.rememberManifestHeader;
    this.resolveTrackCacheIdentity = input.resolveTrackCacheIdentity;
    this.callbacks = input;
  }

  enqueue(item: IncomingPieceBatchItem) {
    if (this.disposed || this.invalidatedTracks.has(item.message.trackId)) {
      return;
    }

    const payloadBytes = item.message.payload.byteLength;
    if (this.pendingValidationBytes + payloadBytes > maxValidationQueueBytes) {
      this.reportNack(item, "receiver-overloaded", payloadBytes);
      return;
    }

    this.pendingIncomingPieces.push(item);
    this.pendingValidationBytes += payloadBytes;
    this.scheduleFlush();
  }

  resumeTrack(trackId: string) {
    this.invalidatedTracks.delete(trackId);
  }

  pendingCount() {
    return this.pendingIncomingPieces.length;
  }

  awaitPersistence() {
    if (
      this.pendingIncomingPieces.length === 0 &&
      !this.flushInFlight &&
      this.pendingPersistencePieces.length === 0 &&
      this.persistenceWorkerCount === 0
    ) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.persistenceWaiters.add(resolve);
    });
  }

  getBacklogSnapshot() {
    return {
      validationQueueItems: this.pendingIncomingPieces.length,
      validationQueueBytes: this.pendingValidationBytes,
      maxValidationQueueBytes,
      persistenceBacklogBytes: this.persistenceBacklogBytes,
      maxPersistenceBacklogBytes: this.maxPersistenceBacklogBytes,
      persistenceWorkerCount: this.persistenceWorkerCount,
      persistenceQueueItems: this.pendingPersistencePieces.length
    };
  }

  clear() {
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingIncomingPieces.length = 0;
    this.pendingPersistencePieces.length = 0;
    this.pendingValidationBytes = 0;
    this.persistenceBacklogBytes = 0;
    this.persistenceBacklogByTrack.clear();
    this.invalidatedTracks.clear();
    this.resolvePersistenceWaitersIfIdle();
  }

  async clearTrack(trackId: string) {
    this.invalidatedTracks.add(trackId);
    for (let index = this.pendingIncomingPieces.length - 1; index >= 0; index -= 1) {
      const item = this.pendingIncomingPieces[index];
      if (item?.message.trackId === trackId) {
        this.pendingValidationBytes = Math.max(
          0,
          this.pendingValidationBytes - item.message.payload.byteLength
        );
        this.pendingIncomingPieces.splice(index, 1);
      }
    }
    for (let index = this.pendingPersistencePieces.length - 1; index >= 0; index -= 1) {
      const piece = this.pendingPersistencePieces[index];
      if (piece?.item.message.trackId === trackId) {
        this.releasePersistenceBacklog(piece);
        this.pendingPersistencePieces.splice(index, 1);
      }
    }
    await this.awaitPersistence();
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
      this.resolvePersistenceWaitersIfIdle();
      return;
    }

    this.flushInFlight = true;
    const batch: IncomingPieceBatchItem[] = [];
    let batchBytes = 0;
    while (
      this.pendingIncomingPieces.length > 0 &&
      batch.length < this.batchSize &&
      (batch.length === 0 || batchBytes + (this.pendingIncomingPieces[0]?.message.payload.byteLength ?? 0) <= maxPersistenceBatchBytes)
    ) {
      const item = this.pendingIncomingPieces.shift();
      if (!item) {
        break;
      }
      batch.push(item);
      batchBytes += item.message.payload.byteLength;
      this.pendingValidationBytes = Math.max(
        0,
        this.pendingValidationBytes - item.message.payload.byteLength
      );
    }

    try {
      const manifestHeaders = await this.resolveManifestHeaders(batch);
      const expectedHashes = batch.map(
        (item, index) =>
          manifestHeaders[index]?.pieceHashes?.[item.message.chunkIndex] ?? item.message.pieceHash
      );
      let validationResults: boolean[];
      let validationFailureReason: "hash-mismatch" | "decode-failure" = "hash-mismatch";
      try {
        validationResults = await validateTrackPiecePayloadBatch(
          batch.map((item, index) => ({
            payload: item.message.payload,
            expectedHash: expectedHashes[index] ?? item.message.pieceHash
          }))
        );
      } catch {
        validationFailureReason = "decode-failure";
        validationResults = batch.map(() => false);
      }

      this.collectValidatedPieces({
        batch,
        expectedHashes,
        manifestHeaders,
        validationResults,
        validationFailureReason
      });
    } finally {
      this.flushInFlight = false;
      if (this.pendingIncomingPieces.length > 0) {
        this.scheduleFlush();
      }
      this.resolvePersistenceWaitersIfIdle();
    }
  }

  private async resolveManifestHeaders(batch: IncomingPieceBatchItem[]) {
    return Promise.all(
      batch.map((item) =>
        this.resolveManifestHeader(item.message.trackId, item.message.header.chunkSize)
      )
    );
  }

  private collectValidatedPieces(input: {
    batch: IncomingPieceBatchItem[];
    expectedHashes: string[];
    manifestHeaders: Array<CachedPieceManifestHeader | null>;
    validationResults: boolean[];
    validationFailureReason: "hash-mismatch" | "decode-failure";
  }) {
    const {
      batch,
      expectedHashes,
      manifestHeaders,
      validationResults,
      validationFailureReason
    } = input;

    for (const [index, item] of batch.entries()) {
      if (this.disposed || this.invalidatedTracks.has(item.message.trackId)) {
        continue;
      }
      const payloadBytes = item.message.payload.byteLength;
      if (!(validationResults[index] ?? false)) {
        this.reportNack(item, validationFailureReason, payloadBytes);
        continue;
      }

      if (!this.canAdmitPersistence(item.message.trackId, payloadBytes)) {
        this.reportNack(item, "receiver-overloaded", payloadBytes);
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

      if (shouldPersistPiece === false) {
        continue;
      }

      const persistablePiece = {
        item,
        expectedHash,
        callbackPayload
      } satisfies PersistableIncomingPiece;
      this.pendingPersistencePieces.push(persistablePiece);
      this.addPersistenceBacklog(persistablePiece);
      this.callbacks.onPieceValidated?.(callbackPayload);
    }

    this.startPersistenceWorkers();
    this.resolvePersistenceWaitersIfIdle();
  }

  private canAdmitPersistence(trackId: string, payloadBytes: number) {
    const trackBacklog = this.persistenceBacklogByTrack.get(trackId) ?? 0;
    return (
      this.persistenceBacklogBytes + payloadBytes <= this.maxPersistenceBacklogBytes &&
      trackBacklog + payloadBytes <= maxPersistenceBacklogPerTrackBytes
    );
  }

  private startPersistenceWorkers() {
    while (
      this.persistenceWorkerCount < persistenceWorkerCount &&
      this.pendingPersistencePieces.length > 0
    ) {
      this.persistenceWorkerCount += 1;
      void this.runPersistenceWorker().finally(() => {
        this.persistenceWorkerCount = Math.max(0, this.persistenceWorkerCount - 1);
        this.startPersistenceWorkers();
        this.resolvePersistenceWaitersIfIdle();
      });
    }
  }

  private async runPersistenceWorker() {
    while (this.pendingPersistencePieces.length > 0) {
      const batch: PersistableIncomingPiece[] = [];
      let batchBytes = 0;
      while (
        this.pendingPersistencePieces.length > 0 &&
        batch.length < maxPersistenceBatchPieces &&
        (batch.length === 0 ||
          batchBytes + (this.pendingPersistencePieces[0]?.item.message.payload.byteLength ?? 0) <=
            maxPersistenceBatchBytes)
      ) {
        const piece = this.pendingPersistencePieces.shift();
        if (!piece) {
          break;
        }
        batch.push(piece);
        batchBytes += piece.item.message.payload.byteLength;
      }
      if (batch.length === 0) {
        continue;
      }
      await this.persistBatchWithRetry(batch);
    }
  }

  private async persistBatchWithRetry(batch: PersistableIncomingPiece[]) {
    const piecesToPersist = batch.map(({ item, expectedHash }) => {
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

    for (let attempt = 0; attempt <= persistenceRetryDelaysMs.length; attempt += 1) {
      const activeBatch = batch.filter(
        ({ item }) => !this.disposed && !this.invalidatedTracks.has(item.message.trackId)
      );
      if (activeBatch.length === 0) {
        this.releasePersistenceBacklogForBatch(batch);
        return;
      }

      try {
        await cacheTrackPieces(
          piecesToPersist.filter((piece) =>
            activeBatch.some(
              ({ item }) =>
                item.message.trackId === piece.trackId &&
                item.message.chunkIndex === piece.chunkIndex
            )
          )
        );
        for (const piece of activeBatch) {
          if (!this.disposed && !this.invalidatedTracks.has(piece.callbackPayload.trackId)) {
            this.callbacks.onPiecePersisted?.(piece.callbackPayload);
          }
        }
        this.releasePersistenceBacklogForBatch(batch);
        return;
      } catch {
        if (attempt >= persistenceRetryDelaysMs.length) {
          for (const piece of activeBatch) {
            this.reportNack(piece.item, "storage-failure", 0);
          }
          this.releasePersistenceBacklogForBatch(batch);
          return;
        }
        await delay(persistenceRetryDelaysMs[attempt]);
      }
    }
  }

  private addPersistenceBacklog(piece: PersistableIncomingPiece) {
    const bytes = piece.callbackPayload.payloadBytes;
    this.persistenceBacklogBytes += bytes;
    this.persistenceBacklogByTrack.set(
      piece.callbackPayload.trackId,
      (this.persistenceBacklogByTrack.get(piece.callbackPayload.trackId) ?? 0) + bytes
    );
  }

  private releasePersistenceBacklog(piece: PersistableIncomingPiece) {
    const bytes = piece.callbackPayload.payloadBytes;
    this.persistenceBacklogBytes = Math.max(0, this.persistenceBacklogBytes - bytes);
    const nextTrackBytes = Math.max(
      0,
      (this.persistenceBacklogByTrack.get(piece.callbackPayload.trackId) ?? 0) - bytes
    );
    if (nextTrackBytes === 0) {
      this.persistenceBacklogByTrack.delete(piece.callbackPayload.trackId);
    } else {
      this.persistenceBacklogByTrack.set(piece.callbackPayload.trackId, nextTrackBytes);
    }
  }

  private releasePersistenceBacklogForBatch(batch: PersistableIncomingPiece[]) {
    for (const piece of batch) {
      this.releasePersistenceBacklog(piece);
    }
  }

  private reportNack(
    item: IncomingPieceBatchItem,
    reason: "hash-mismatch" | "decode-failure" | "storage-failure" | "receiver-overloaded",
    refundCreditBytes: number
  ) {
    const streamId = item.message.header.streamId;
    const generation = item.message.header.generation;
    if (streamId && typeof generation === "number") {
      this.callbacks.onPieceNack?.({
        peerId: item.peerId,
        trackId: item.message.trackId,
        chunkIndex: item.message.chunkIndex,
        streamId,
        generation,
        reason,
        refundCreditBytes
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

  private resolvePersistenceWaitersIfIdle() {
    if (
      this.pendingIncomingPieces.length > 0 ||
      this.flushInFlight ||
      this.pendingPersistencePieces.length > 0 ||
      this.persistenceWorkerCount > 0
    ) {
      return;
    }
    for (const resolve of this.persistenceWaiters) {
      resolve();
    }
    this.persistenceWaiters.clear();
  }
}

function delay(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
