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
};

type PieceMessageRouterCallbacks = {
  onPieceRequestReceived?: (payload: {
    peerId: string;
    trackId: string;
    chunkIndex: number;
    requestId?: string;
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
  private readonly takePendingRequest: (
    trackId: string,
    chunkIndex: number
  ) => PendingPieceRequest | null;
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
    takePendingRequest: (trackId: string, chunkIndex: number) => PendingPieceRequest | null;
    enqueueInboundPiece: (item: IncomingPieceBatchItem) => void;
  } & PieceMessageRouterCallbacks) {
    this.pieceServeBatchConcurrency = input.pieceServeBatchConcurrency;
    this.pieceFragments = new PieceFragmentTracker({
      ttlMs: input.incomingPieceFragmentTtlMs
    });
    this.servePieceRequest = input.servePieceRequest;
    this.takePendingRequest = input.takePendingRequest;
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
        chunkIndex: message.chunkIndex
      });
      return;
    }

    if (message.kind === "request-pieces") {
      const chunkIndexes = [...new Set(message.chunkIndexes)].sort((left, right) => left - right);
      for (let offset = 0; offset < chunkIndexes.length; offset += this.pieceServeBatchConcurrency) {
        const batch = chunkIndexes.slice(offset, offset + this.pieceServeBatchConcurrency);
        await Promise.all(
          batch.map((chunkIndex) =>
            this.serveSinglePieceRequest(input.peerId, input.entry, {
              trackId: message.trackId,
              chunkIndex,
              requestId: message.requestId
            })
          )
        );
      }
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
    this.callbacks.onPieceRequestReceived?.({
      peerId,
      trackId: request.trackId,
      chunkIndex: request.chunkIndex,
      requestId: request.requestId
    });
    await this.servePieceRequest({
      peerId,
      entry,
      request
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
