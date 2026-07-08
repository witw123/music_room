import type { P2PDataMessage } from "@music-room/shared";
import type { DataChannelQueuedSendItem } from "./data-channel-manager";
import {
  PieceRequestTracker,
  type PendingPieceRequest
} from "./piece-request-tracker";

type PieceRequestPeerEntry = {
  channel?: Pick<RTCDataChannel, "readyState"> | null;
};

type PieceRequestTimeoutPayload = {
  trackId: string;
  chunkIndex: number;
  peerId: string;
  requestId?: string;
  requestDurationMs: number;
};

type PieceRequestClientCallbacks = {
  onPieceRequestSent?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndexes: number[];
    requestId?: string;
  }) => void;
  onPieceRequestTimeout?: (payload: PieceRequestTimeoutPayload) => void;
};

export type PieceRequestOptions = {
  allowRedundant?: boolean;
  maxReplicas?: number;
};

export class PieceRequestClient<TEntry extends PieceRequestPeerEntry = PieceRequestPeerEntry> {
  private readonly pieceRequests = new PieceRequestTracker();
  private readonly getPeerEntry: (peerId: string) => TEntry | null | undefined;
  private readonly enqueueSendItem: (
    peerId: string,
    entry: TEntry,
    item: DataChannelQueuedSendItem
  ) => void;
  private readonly createRequestId: (trackId: string, chunkIndexes: number[]) => string;
  private readonly callbacks: PieceRequestClientCallbacks;

  constructor(input: {
    getPeerEntry: (peerId: string) => TEntry | null | undefined;
    enqueueSendItem: (
      peerId: string,
      entry: TEntry,
      item: DataChannelQueuedSendItem
    ) => void;
    createRequestId?: (trackId: string, chunkIndexes: number[]) => string;
  } & PieceRequestClientCallbacks) {
    this.getPeerEntry = input.getPeerEntry;
    this.enqueueSendItem = input.enqueueSendItem;
    this.createRequestId = input.createRequestId ?? createDefaultPieceRequestId;
    this.callbacks = input;
  }

  requestPiece(
    peerId: string,
    trackId: string,
    chunkIndex: number,
    expectedTotalChunks?: number,
    timeoutMs = 10000
  ) {
    return this.requestPieces(
      peerId,
      trackId,
      [chunkIndex],
      expectedTotalChunks,
      timeoutMs
    );
  }

  requestPieces(
    peerId: string,
    trackId: string,
    chunkIndexes: number[],
    expectedTotalChunks?: number,
    timeoutMs = 10000,
    options: PieceRequestOptions = {}
  ) {
    const entry = this.getPeerEntry(peerId);
    if (!entry?.channel || entry.channel.readyState !== "open") {
      return false;
    }

    const normalizedChunkIndexes = this.pieceRequests.getAvailableChunkIndexes(trackId, chunkIndexes, {
      allowRedundant: options.allowRedundant,
      maxReplicas: options.maxReplicas,
      peerId
    });
    if (normalizedChunkIndexes.length === 0) {
      return false;
    }

    const requestId =
      normalizedChunkIndexes.length > 1
        ? this.createRequestId(trackId, normalizedChunkIndexes)
        : undefined;
    this.pieceRequests.registerRequests({
      peerId,
      trackId,
      chunkIndexes: normalizedChunkIndexes,
      expectedTotalChunks,
      requestId,
      timeoutMs,
      onTimeout: this.callbacks.onPieceRequestTimeout,
      allowRedundant: options.allowRedundant,
      maxReplicas: options.maxReplicas
    });

    const payload: P2PDataMessage =
      normalizedChunkIndexes.length === 1
        ? {
            kind: "request-piece",
            trackId,
            chunkIndex: normalizedChunkIndexes[0]!
          }
        : {
            kind: "request-pieces",
            requestId: requestId!,
            trackId,
            chunkIndexes: normalizedChunkIndexes
          };
    this.enqueueSendItem(peerId, entry, {
      data: JSON.stringify(payload)
    });
    this.callbacks.onPieceRequestSent?.({
      peerId,
      trackId,
      chunkIndexes: normalizedChunkIndexes,
      requestId
    });
    return true;
  }

  takePendingRequest(trackId: string, chunkIndex: number): PendingPieceRequest | null {
    return this.pieceRequests.take(trackId, chunkIndex);
  }

  clearPeer(peerId: string) {
    this.pieceRequests.clearPeer(peerId);
  }

  clearAll() {
    this.pieceRequests.clearAll();
  }
}

function createDefaultPieceRequestId(trackId: string, chunkIndexes: number[]) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${trackId}:${crypto.randomUUID()}`;
  }

  return `${trackId}:${chunkIndexes[0] ?? 0}:${Date.now().toString(36)}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
