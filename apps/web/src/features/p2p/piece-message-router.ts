import type {
  BinaryPieceFragmentMessage,
  BinaryPieceMessage
} from "./piece-frame-codec";
import {
  isBinaryPieceFragmentMessage,
  isBinaryPieceMessage,
  parseIncomingMeshMessage
} from "./mesh-message-codec";
import { PieceFragmentTracker } from "./piece-fragment-tracker";
import type { IncomingPieceBatchItem } from "./piece-inbound-processor";
import type { PendingPieceRequest } from "./piece-request-tracker";

type PieceMessageRouterPeerEntry = {
  channel?: Pick<RTCDataChannel, "readyState"> | null;
};

type PieceServeRequest = {
  trackId: string;
  chunkIndex: number;
  requestId?: string;
  priority?: "critical" | "bulk";
};

type PieceMessageRouterCallbacks = {
  onPieceRequestReceived?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    requestId?: string;
  }) => void;
  onPieceUnavailable?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    requestId?: string;
    reason: "piece-missing" | "manifest-missing" | "channel-not-open";
    requestDurationMs: number;
    pendingRequest?: PendingPieceRequest;
  }) => void;
};

export class PieceMessageRouter<TEntry extends PieceMessageRouterPeerEntry = PieceMessageRouterPeerEntry> {
  private readonly pieceServeBatchConcurrency: number;
  private readonly pieceFragments: PieceFragmentTracker;
  private readonly servePieceRequest: (input: {
    peerId: string;
    entry: TEntry;
    request: PieceServeRequest;
  }) => Promise<void>;
  private readonly servePieceRequests?: (input: {
    peerId: string;
    entry: TEntry;
    requests: PieceServeRequest[];
  }) => Promise<void>;
  private readonly takePendingRequest: (
    trackId: string,
    chunkIndex: number
  ) => PendingPieceRequest | null;
  private readonly failPendingRequest: (input: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    requestId?: string;
  }) => PendingPieceRequest | null;
  private readonly enqueueInboundPiece: (item: IncomingPieceBatchItem) => void;
  private readonly callbacks: PieceMessageRouterCallbacks;

  constructor(input: {
    pieceServeBatchConcurrency: number;
    incomingPieceFragmentTtlMs: number;
    servePieceRequest: (input: {
      peerId: string;
      entry: TEntry;
      request: PieceServeRequest;
    }) => Promise<void>;
    servePieceRequests?: (input: {
      peerId: string;
      entry: TEntry;
      requests: PieceServeRequest[];
    }) => Promise<void>;
    takePendingRequest: (trackId: string, chunkIndex: number) => PendingPieceRequest | null;
    failPendingRequest?: (input: {
      peerId: string;
      trackId: string;
      chunkIndex: number;
      requestId?: string;
    }) => PendingPieceRequest | null;
    enqueueInboundPiece: (item: IncomingPieceBatchItem) => void;
  } & PieceMessageRouterCallbacks) {
    this.pieceServeBatchConcurrency = input.pieceServeBatchConcurrency;
    this.pieceFragments = new PieceFragmentTracker({
      ttlMs: input.incomingPieceFragmentTtlMs
    });
    this.servePieceRequest = input.servePieceRequest;
    this.servePieceRequests = input.servePieceRequests;
    this.takePendingRequest = input.takePendingRequest;
    this.failPendingRequest = input.failPendingRequest ?? (() => null);
    this.enqueueInboundPiece = input.enqueueInboundPiece;
    this.callbacks = input;
  }

  async handleChannelMessage(input: {
    peerId: string;
    entry: TEntry;
    data: unknown;
  }) {
    const message = await parseIncomingMeshMessage(input.data);
    if (!message) {
      return;
    }

    if (message.kind === "request-piece") {
      await this.serveSinglePieceRequest(input.peerId, input.entry, {
        trackId: message.trackId,
        chunkIndex: message.chunkIndex,
        priority: message.priority
      });
      return;
    }

    if (message.kind === "request-pieces") {
      const chunkIndexes = [...new Set(message.chunkIndexes)].sort((left, right) => left - right);
      const requests = chunkIndexes.map((chunkIndex) => ({
        trackId: message.trackId,
        chunkIndex,
        requestId: message.requestId,
        priority: message.priority
      }));
      for (const request of requests) {
        this.reportPieceRequest(input.peerId, request);
      }
      if (this.servePieceRequests) {
        await this.servePieceRequests({
          peerId: input.peerId,
          entry: input.entry,
          requests
        });
        return;
      }

      for (let offset = 0; offset < requests.length; offset += this.pieceServeBatchConcurrency) {
        const batch = requests.slice(offset, offset + this.pieceServeBatchConcurrency);
        await Promise.all(
          batch.map((request) =>
            this.servePieceRequest({
              peerId: input.peerId,
              entry: input.entry,
              request
            })
          )
        );
      }
      return;
    }

    if (message.kind === "piece-unavailable") {
      const pendingRequest = this.failPendingRequest({
        peerId: input.peerId,
        trackId: message.trackId,
        chunkIndex: message.chunkIndex,
        requestId: message.requestId
      });
      this.callbacks.onPieceUnavailable?.({
        peerId: input.peerId,
        trackId: message.trackId,
        chunkIndex: message.chunkIndex,
        requestId: message.requestId,
        reason: message.reason ?? "piece-missing",
        requestDurationMs:
          pendingRequest ? Date.now() - pendingRequest.requestedAtMs : 0,
        pendingRequest: pendingRequest ?? undefined
      });
      return;
    }

    if (message.kind === "send-piece" && isBinaryPieceMessage(message)) {
      this.enqueueReceivedPiece(input.peerId, message);
      return;
    }

    if (message.kind === "send-piece-fragment" && isBinaryPieceFragmentMessage(message)) {
      this.handleIncomingPieceFragment(input.peerId, message);
    }
  }

  clear() {
    this.pieceFragments.clearAll();
  }

  private async serveSinglePieceRequest(
    peerId: string,
    entry: TEntry,
    request: PieceServeRequest
  ) {
    this.reportPieceRequest(peerId, request);
    await this.servePieceRequest({
      peerId,
      entry,
      request
    });
  }

  private reportPieceRequest(peerId: string, request: PieceServeRequest) {
    this.callbacks.onPieceRequestReceived?.({
      peerId,
      trackId: request.trackId,
      chunkIndex: request.chunkIndex,
      requestId: request.requestId
    });
  }

  private enqueueReceivedPiece(peerId: string, message: BinaryPieceMessage) {
    const pendingRequest = this.takePendingRequest(message.trackId, message.chunkIndex);

    this.enqueueInboundPiece({
      peerId,
      message,
      pendingRequest: pendingRequest ?? undefined
    });
  }

  private handleIncomingPieceFragment(peerId: string, message: BinaryPieceFragmentMessage) {
    const assembledMessage = this.pieceFragments.addFragment(peerId, message);
    if (!assembledMessage) {
      return;
    }

    this.enqueueReceivedPiece(peerId, assembledMessage);
  }
}
