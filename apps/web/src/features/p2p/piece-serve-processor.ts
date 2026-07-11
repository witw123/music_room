import {
  getCachedPiece,
  getCachedPiecesByIndexes,
  getCachedPieceIndexes,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey,
  type TrackPieceRecord
} from "@/lib/indexeddb";
import type { P2PDataMessage } from "@music-room/shared";
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
  priority?: "critical" | "bulk";
};

type CachedServedPiece = Pick<
  TrackPieceRecord,
  "chunkIndex" | "chunkSize" | "hash" | "payload"
>;

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
  private readonly resolveMaxDataChannelPayloadBytes?: (peerId: string) => number | null | undefined;
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
    resolveMaxDataChannelPayloadBytes?: (peerId: string) => number | null | undefined;
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
    this.resolveMaxDataChannelPayloadBytes = input.resolveMaxDataChannelPayloadBytes;
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
      const cacheIdentity = this.resolveTrackCacheIdentity?.(trackId) ?? null;
      const manifest =
        (cacheIdentity?.fileHash
          ? await getTrackPieceManifestByFileHash(cacheIdentity.fileHash)
          : null) ?? (await getTrackPieceManifest(trackId));
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
    await this.servePieceRequests({
      peerId: input.peerId,
      entry: input.entry,
      requests: [input.request]
    });
  }

  async servePieceRequests(input: {
    peerId: string;
    entry: TEntry;
    requests: PieceServeRequest[];
  }) {
    const { peerId, entry } = input;
    const requests = input.requests.filter(
      (request) => request.trackId && Number.isInteger(request.chunkIndex) && request.chunkIndex >= 0
    );
    if (requests.length === 0) {
      return;
    }

    if (entry.channel?.readyState !== "open") {
      for (const request of requests) {
        this.reportMiss(peerId, entry, request, "channel-not-open");
      }
      return;
    }

    const requestsByTrackId = new Map<string, PieceServeRequest[]>();
    for (const request of requests) {
      const trackRequests = requestsByTrackId.get(request.trackId) ?? [];
      trackRequests.push(request);
      requestsByTrackId.set(request.trackId, trackRequests);
    }

    for (const trackRequests of requestsByTrackId.values()) {
      await this.serveTrackPieceRequests({
        peerId,
        entry,
        requests: trackRequests
      });
    }
  }

  private async serveTrackPieceRequests(input: {
    peerId: string;
    entry: TEntry;
    requests: PieceServeRequest[];
  }) {
    const { peerId, entry, requests } = input;
    const trackId = requests[0]?.trackId;
    if (!trackId) {
      return;
    }

    const cacheIdentity = this.resolveTrackCacheIdentity?.(trackId) ?? null;
    const expectedChunkSize = cacheIdentity?.chunkSize ?? null;
    const chunkIndexes = [...new Set(requests.map((request) => request.chunkIndex))];
    const cachedPieces = requests.length === 1
      ? await this.getSingleCachedPiece(trackId, requests[0]!, cacheIdentity, expectedChunkSize)
      : await getCachedPiecesByIndexes(trackId, this.localPeerId, chunkIndexes, {
          fileHash: cacheIdentity?.fileHash,
          ownerKey: cacheIdentity?.ownerKey ?? localCacheOwnerKey,
          chunkSize: expectedChunkSize
        });
    const piecesByChunkIndex = new Map(
      cachedPieces.map((piece) => [piece.chunkIndex, piece])
    );
    let manifestHeader = cachedPieces.length > 0
      ? await this.resolveManifestHeader(trackId, expectedChunkSize ?? cachedPieces[0]!.chunkSize)
      : null;

    for (const request of requests) {
      if (entry.channel?.readyState !== "open") {
        this.reportMiss(peerId, entry, request, "channel-not-open");
        continue;
      }

      let piece: CachedServedPiece | null = piecesByChunkIndex.get(request.chunkIndex) ?? null;
      if (piece && !manifestHeader) {
        manifestHeader = await this.resolveManifestHeader(
          trackId,
          expectedChunkSize ?? piece.chunkSize
        );
      }

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
        this.reportMiss(peerId, entry, request, "piece-missing");
        continue;
      }

      if (!manifestHeader || entry.channel?.readyState !== "open") {
        this.reportMiss(
          peerId,
          entry,
          request,
          entry.channel?.readyState === "open" ? "manifest-missing" : "channel-not-open"
        );
        continue;
      }

      this.enqueuePieceFrames({
        peerId,
        entry,
        request,
        piece,
        manifestHeader
      });
    }
  }

  private async getSingleCachedPiece(
    trackId: string,
    request: PieceServeRequest,
    cacheIdentity: TrackCacheIdentity | null,
    expectedChunkSize: number | null
  ): Promise<CachedServedPiece[]> {
    const piece = await getCachedPiece(trackId, this.localPeerId, request.chunkIndex, {
      fileHash: cacheIdentity?.fileHash,
      ownerKey: cacheIdentity?.ownerKey ?? localCacheOwnerKey,
      chunkSize: expectedChunkSize
    });

    return piece ? [piece] : [];
  }

  private enqueuePieceFrames(input: {
    peerId: string;
    entry: TEntry;
    request: PieceServeRequest;
    piece: CachedServedPiece;
    manifestHeader: CachedPieceManifestHeader;
  }) {
    const { entry, manifestHeader, peerId, piece, request } = input;
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
      this.resolveMaxDataChannelPayloadBytes?.(peerId) ??
        this.maxDataChannelPayloadBytes
    );
    for (const frame of pieceFrames) {
      this.enqueueSendItem(peerId, entry, {
        data: frame.data,
        channel: "data",
        priority: request.priority === "critical" ? "critical" : "bulk",
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
    entry: TEntry,
    request: PieceServeRequest,
    reason: "channel-not-open" | "piece-missing" | "manifest-missing"
  ) {
    if (reason !== "channel-not-open" && entry.channel?.readyState === "open") {
      const payload: P2PDataMessage = {
        kind: "piece-unavailable",
        ...(request.requestId ? { requestId: request.requestId } : {}),
        trackId: request.trackId,
        chunkIndex: request.chunkIndex,
        reason
      };
      this.enqueueSendItem(peerId, entry, {
        data: JSON.stringify(payload),
        priority: "control"
      });
    }
    this.callbacks.onPieceServeMiss?.({
      peerId,
      trackId: request.trackId,
      chunkIndex: request.chunkIndex,
      reason
    });
  }
}
