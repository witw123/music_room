import {
  assembleIncomingPieceFragments,
  type BinaryPieceFragmentMessage,
  type BinaryPieceMessage,
  type PendingIncomingPieceFragments
} from "./piece-frame-codec";

export class PieceFragmentTracker {
  private readonly ttlMs: number;
  private readonly pendingFragments = new Map<string, PendingIncomingPieceFragments>();

  constructor(input: { ttlMs: number }) {
    this.ttlMs = input.ttlMs;
  }

  addFragment(
    peerId: string,
    message: BinaryPieceFragmentMessage,
    nowMs = Date.now()
  ): BinaryPieceMessage | null {
    this.purgeStale(nowMs);
    const fragmentKey = buildIncomingPieceFragmentKey(
      peerId,
      message.trackId,
      message.chunkIndex,
      message.requestId
    );
    const existing = this.pendingFragments.get(fragmentKey);
    const fragmentState: PendingIncomingPieceFragments =
      existing &&
      existing.fragmentCount === message.fragmentCount &&
      existing.pieceHash === message.pieceHash
        ? existing
        : {
            peerId,
            requestId: message.requestId,
            trackId: message.trackId,
            chunkIndex: message.chunkIndex,
            totalChunks: message.totalChunks,
            chunkSize: message.chunkSize,
            mimeType: message.mimeType,
            pieceHash: message.pieceHash,
            fragmentCount: message.fragmentCount,
            receivedAtMs: nowMs,
            fragments: new Map<number, ArrayBuffer>()
          };

    fragmentState.receivedAtMs = nowMs;
    fragmentState.fragments.set(message.fragmentIndex, message.payload);
    this.pendingFragments.set(fragmentKey, fragmentState);

    if (fragmentState.fragments.size < fragmentState.fragmentCount) {
      return null;
    }

    const assembledPayload = assembleIncomingPieceFragments(fragmentState);
    this.pendingFragments.delete(fragmentKey);
    if (!assembledPayload) {
      return null;
    }

    return {
      kind: "send-piece",
      requestId: message.requestId,
      trackId: message.trackId,
      chunkIndex: message.chunkIndex,
      totalChunks: message.totalChunks,
      chunkSize: message.chunkSize,
      mimeType: message.mimeType,
      pieceHash: message.pieceHash,
      header: {
        kind: "send-piece",
        requestId: message.requestId,
        trackId: message.trackId,
        chunkIndex: message.chunkIndex,
        totalChunks: message.totalChunks,
        chunkSize: message.chunkSize,
        mimeType: message.mimeType,
        pieceHash: message.pieceHash
      },
      payload: assembledPayload
    };
  }

  clearAll() {
    this.pendingFragments.clear();
  }

  private purgeStale(nowMs: number) {
    for (const [fragmentKey, fragmentState] of this.pendingFragments.entries()) {
      if (nowMs - fragmentState.receivedAtMs >= this.ttlMs) {
        this.pendingFragments.delete(fragmentKey);
      }
    }
  }
}

function buildIncomingPieceFragmentKey(
  peerId: string,
  trackId: string,
  chunkIndex: number,
  requestId?: string
) {
  return `${peerId}:${trackId}:${chunkIndex}:${requestId ?? "none"}`;
}
