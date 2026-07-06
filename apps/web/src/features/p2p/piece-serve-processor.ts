import {
  getCachedPiece,
  getCachedPieceIndexes,
  getTrackPieceManifest,
  localCacheOwnerKey
} from "@/lib/indexeddb";
import { buildPieceFrames } from "./piece-frame-codec";
import type { DataChannelQueuedSendItem } from "./data-channel-manager";
import type { CachedPieceManifestHeader } from "./piece-manifest-header";

type TrackCacheIdentity = {
  fileHash: string | null;
  ownerKey?: string | null;
  chunkSize?: number | null;
};

type PieceRequestFallback = (input: {
  trackId: string;
  chunkIndex: number;
}) => Promise<{
  payload: ArrayBuffer;
  hash: string;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
  requestId?: string;
} | null>;

type PieceServePeerEntry = {
  channel?: RTCDataChannel | null;
};

type PieceServeRequest = {
  trackId: string;
  chunkIndex: number;
  requestId?: string;
};

type PieceServeProcessorCallbacks = {
  onPieceServed?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    payloadBytes: number;
    requestId?: string;
  }) => void;
  onPieceServeMiss?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    reason: "channel-not-open" | "piece-missing" | "manifest-missing";
  }) => void;
};

export class PieceServeProcessor<TEntry extends PieceServePeerEntry = PieceServePeerEntry> {
  private readonly localPeerId: string;
  private readonly maxDataChannelPayloadBytes: number;
  private readonly resolvePieceRequestFallback?: PieceRequestFallback;
  private readonly resolveTrackCacheIdentity?: (
    trackId: string
  ) => TrackCacheIdentity | null | undefined;
  private readonly enqueueSendItem: (
    peerId: string,
    entry: TEntry,
    item: DataChannelQueuedSendItem
  ) => void;
  private readonly callbacks: PieceServeProcessorCallbacks;
  private readonly pieceManifestHeaders = new Map<string, CachedPieceManifestHeader>();

  constructor(input: {
    localPeerId: string;
    maxDataChannelPayloadBytes: number;
    resolvePieceRequestFallback?: PieceRequestFallback;
    resolveTrackCacheIdentity?: (trackId: string) => TrackCacheIdentity | null | undefined;
    enqueueSendItem: (
      peerId: string,
      entry: TEntry,
      item: DataChannelQueuedSendItem
    ) => void;
  } & PieceServeProcessorCallbacks) {
    this.localPeerId = input.localPeerId;
    this.maxDataChannelPayloadBytes = input.maxDataChannelPayloadBytes;
    this.resolvePieceRequestFallback = input.resolvePieceRequestFallback;
    this.resolveTrackCacheIdentity = input.resolveTrackCacheIdentity;
    this.enqueueSendItem = input.enqueueSendItem;
    this.callbacks = input;
  }

  rememberManifestHeader(trackId: string, header: CachedPieceManifestHeader) {
    this.pieceManifestHeaders.set(trackId, header);
  }

  async resolveManifestHeader(trackId: string, fallbackChunkSize: number) {
    let manifestHeader = this.pieceManifestHeaders.get(trackId) ?? null;
    if (!manifestHeader) {
      const manifest = await getTrackPieceManifest(trackId);
      if (manifest) {
        manifestHeader = {
          totalChunks: manifest.totalChunks,
          chunkSize: manifest.chunkSize,
          mimeType: manifest.mimeType || "audio/mpeg",
          pieceHashes: manifest.pieceHashes
        };
        this.rememberManifestHeader(trackId, manifestHeader);
      }
    }

    let totalChunks = manifestHeader?.totalChunks ?? 0;
    if (totalChunks <= 0) {
      const cacheIdentity = this.resolveTrackCacheIdentity?.(trackId) ?? null;
      const chunkIndexes = await getCachedPieceIndexes(trackId, this.localPeerId, {
        fileHash: cacheIdentity?.fileHash,
        ownerKey: cacheIdentity?.ownerKey ?? localCacheOwnerKey,
        chunkSize: cacheIdentity?.chunkSize
      });
      totalChunks = chunkIndexes.length;
      manifestHeader = {
        totalChunks,
        chunkSize: manifestHeader?.chunkSize ?? fallbackChunkSize,
        mimeType: manifestHeader?.mimeType || "audio/mpeg"
      };
      this.rememberManifestHeader(trackId, manifestHeader);
    }

    return manifestHeader;
  }

  async servePieceRequest(input: {
    peerId: string;
    entry: TEntry;
    request: PieceServeRequest;
  }) {
    const { peerId, entry, request } = input;
    if (entry.channel?.readyState !== "open") {
      this.reportMiss(peerId, request, "channel-not-open");
      return;
    }

    const cacheIdentity = this.resolveTrackCacheIdentity?.(request.trackId) ?? null;
    const expectedChunkSize = cacheIdentity?.chunkSize ?? null;
    let piece: {
      chunkIndex: number;
      chunkSize: number;
      hash: string;
      payload: ArrayBuffer;
    } | null = await getCachedPiece(request.trackId, this.localPeerId, request.chunkIndex, {
      fileHash: cacheIdentity?.fileHash,
      ownerKey: cacheIdentity?.ownerKey ?? localCacheOwnerKey,
      chunkSize: expectedChunkSize
    });
    let manifestHeader = piece
      ? await this.resolveManifestHeader(request.trackId, expectedChunkSize ?? piece.chunkSize)
      : null;

    if (!piece || !manifestHeader) {
      const fallbackPiece = await this.resolvePieceRequestFallback?.({
        trackId: request.trackId,
        chunkIndex: request.chunkIndex
      });
      if (fallbackPiece) {
        piece = {
          chunkIndex: request.chunkIndex,
          chunkSize: fallbackPiece.payload.byteLength,
          hash: fallbackPiece.hash,
          payload: fallbackPiece.payload
        };
        manifestHeader = {
          totalChunks: fallbackPiece.totalChunks,
          chunkSize: fallbackPiece.chunkSize,
          mimeType: fallbackPiece.mimeType
        };
        this.rememberManifestHeader(request.trackId, manifestHeader);
      }
    }

    if (!piece) {
      this.reportMiss(peerId, request, "piece-missing");
      return;
    }

    if (!manifestHeader || entry.channel?.readyState !== "open") {
      this.reportMiss(peerId, request, "manifest-missing");
      return;
    }

    const pieceFrames = buildPieceFrames(
      {
        requestId: request.requestId,
        trackId: request.trackId,
        chunkIndex: piece.chunkIndex,
        totalChunks: manifestHeader.totalChunks,
        chunkSize: manifestHeader.chunkSize,
        mimeType: manifestHeader.mimeType,
        pieceHash: piece.hash
      },
      piece.payload,
      this.maxDataChannelPayloadBytes
    );
    for (const frame of pieceFrames) {
      this.enqueueSendItem(peerId, entry, {
        data: frame.data,
        trackId: request.trackId,
        chunkIndex: piece.chunkIndex,
        payloadBytes: frame.payloadBytes
      });
    }
    this.callbacks.onPieceServed?.({
      peerId,
      trackId: request.trackId,
      chunkIndex: piece.chunkIndex,
      payloadBytes: piece.payload.byteLength,
      requestId: request.requestId
    });
  }

  private reportMiss(
    peerId: string,
    request: PieceServeRequest,
    reason: "channel-not-open" | "piece-missing" | "manifest-missing"
  ) {
    this.callbacks.onPieceServeMiss?.({
      peerId,
      trackId: request.trackId,
      chunkIndex: request.chunkIndex,
      reason
    });
  }
}
