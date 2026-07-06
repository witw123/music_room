import {
  cacheTrackPieces,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import { validateTrackPiecePayloadBatch } from "./index";
import type { BinaryPieceMessage } from "./piece-frame-codec";
import type { CachedPieceManifestHeader } from "./piece-manifest-header";
import type { PendingPieceRequest } from "./piece-request-tracker";

export type IncomingPieceBatchItem = {
  peerId: string;
  message: BinaryPieceMessage;
  pendingRequest?: PendingPieceRequest;
};

export type ReceivedPieceCallbackPayload = {
  peerId: string;
  trackId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  payloadBytes: number;
  requestId?: string;
  requestRttMs?: number | null;
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
  onPieceRequestTimeout?: (payload: {
    trackId: string;
    chunkIndex: number;
    peerId: string;
    requestId?: string;
    requestDurationMs: number;
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
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private piecePersistChain: Promise<void> = Promise.resolve();

  constructor(input: {
    batchSize: number;
    localPeerId: string;
    flushDelayMs?: number;
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
    this.resolveManifestHeader = input.resolveManifestHeader;
    this.rememberManifestHeader = input.rememberManifestHeader;
    this.resolveTrackCacheIdentity = input.resolveTrackCacheIdentity;
    this.callbacks = input;
  }

  enqueue(item: IncomingPieceBatchItem) {
    this.pendingIncomingPieces.push(item);
    this.scheduleFlush();
  }

  pendingCount() {
    return this.pendingIncomingPieces.length;
  }

  awaitPersistence() {
    return this.piecePersistChain;
  }

  clear() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingIncomingPieces.length = 0;
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
    this.callbacks.onPieceRequestTimeout?.({
      trackId: item.message.trackId,
      chunkIndex: item.message.chunkIndex,
      peerId: item.peerId,
      requestId: item.pendingRequest?.requestId,
      requestDurationMs:
        item.pendingRequest ? Date.now() - item.pendingRequest.requestedAtMs : 0
    });
  }

  private buildCallbackPayload(item: IncomingPieceBatchItem): ReceivedPieceCallbackPayload {
    return {
      peerId: item.peerId,
      trackId: item.message.header.trackId,
      chunkIndex: item.message.header.chunkIndex,
      totalChunks: item.pendingRequest?.expectedTotalChunks ?? item.message.totalChunks,
      chunkSize: item.message.header.chunkSize,
      mimeType: item.message.header.mimeType,
      payloadBytes: item.message.payload.byteLength,
      requestId: item.message.header.requestId ?? item.pendingRequest?.requestId,
      requestRttMs:
        item.pendingRequest ? Date.now() - item.pendingRequest.requestedAtMs : null
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
        chunkSize: item.message.payload.byteLength,
        hash: expectedHash,
        payload: item.message.payload
      };
    });
    const persistedPayloads = persistablePieces.map((piece) => piece.callbackPayload);
    this.piecePersistChain = this.piecePersistChain
      .catch(() => undefined)
      .then(async () => {
        await cacheTrackPieces(piecesToPersist);
        for (const payload of persistedPayloads) {
          this.callbacks.onPiecePersisted?.(payload);
        }
      });
  }
}
