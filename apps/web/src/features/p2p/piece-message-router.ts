import type { CacheStreamMessage } from "@music-room/shared";
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

type PieceMessageRouterPeerEntry = {
  channel?: Pick<RTCDataChannel, "readyState"> | null;
};

type PieceMessageRouterCallbacks = {
  onCacheStreamMessage?: (payload: {
    peerId: string;
    message: CacheStreamMessage;
  }) => void | Promise<void>;
  onCacheStreamPiece?: (payload: {
    peerId: string;
    trackId: string;
    streamId: string;
    generation: number;
    chunkIndex: number;
    payloadBytes: number;
  }) => boolean;
};

export class PieceMessageRouter<
  TEntry extends PieceMessageRouterPeerEntry = PieceMessageRouterPeerEntry
> {
  private readonly acceptLegacyBinaryFrames: boolean;
  private readonly pieceFragments: PieceFragmentTracker;
  private readonly enqueueInboundPiece: (item: IncomingPieceBatchItem) => void;
  private readonly callbacks: PieceMessageRouterCallbacks;

  constructor(input: {
    incomingPieceFragmentTtlMs: number;
    acceptLegacyBinaryFrames?: boolean;
    enqueueInboundPiece: (item: IncomingPieceBatchItem) => void;
  } & PieceMessageRouterCallbacks) {
    this.acceptLegacyBinaryFrames = input.acceptLegacyBinaryFrames ?? false;
    this.pieceFragments = new PieceFragmentTracker({
      ttlMs: input.incomingPieceFragmentTtlMs
    });
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

    if (isCacheStreamMessage(message)) {
      await this.callbacks.onCacheStreamMessage?.({
        peerId: input.peerId,
        message
      });
      return;
    }

    if (
      message.kind === "send-piece" &&
      isBinaryPieceMessage(message) &&
      (this.acceptLegacyBinaryFrames || hasStreamIdentity(message))
    ) {
      this.enqueueReceivedPiece(input.peerId, message);
      return;
    }

    if (
      message.kind === "send-piece-fragment" &&
      isBinaryPieceFragmentMessage(message) &&
      (this.acceptLegacyBinaryFrames || hasStreamIdentity(message))
    ) {
      this.handleIncomingPieceFragment(input.peerId, message);
    }
  }

  clear() {
    this.pieceFragments.clearAll();
  }

  private enqueueReceivedPiece(peerId: string, message: BinaryPieceMessage) {
    const streamId = message.header.streamId;
    const generation = message.header.generation;
    if (!hasStreamIdentity(message) || !this.callbacks.onCacheStreamPiece) {
      return;
    }

    if (
      !this.callbacks.onCacheStreamPiece({
        peerId,
        trackId: message.trackId,
        streamId,
        generation,
        chunkIndex: message.chunkIndex,
        payloadBytes: message.payload.byteLength
      })
    ) {
      return;
    }

    this.enqueueInboundPiece({
      peerId,
      message
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

function isCacheStreamMessage(
  message: Awaited<ReturnType<typeof parseIncomingMeshMessage>>
): message is CacheStreamMessage {
  return (
    message !== null &&
    typeof message === "object" &&
    "kind" in message &&
    typeof message.kind === "string" &&
    message.kind.startsWith("cache-stream-")
  );
}

function hasStreamIdentity(
  message: BinaryPieceMessage | BinaryPieceFragmentMessage
): message is (BinaryPieceMessage | BinaryPieceFragmentMessage) & {
  streamId: string;
  generation: number;
} {
  return (
    typeof message.header.streamId === "string" &&
    message.header.streamId.length > 0 &&
    typeof message.header.generation === "number" &&
    Number.isInteger(message.header.generation) &&
    message.header.generation >= 0
  );
}
