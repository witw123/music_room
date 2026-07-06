export type PendingPieceRequest = {
  peerId: string;
  requestId?: string;
  expectedTotalChunks?: number;
  requestedAtMs: number;
  timeoutMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PieceRequestTimeoutPayload = {
  trackId: string;
  chunkIndex: number;
  peerId: string;
  requestId?: string;
  requestDurationMs: number;
};

export class PieceRequestTracker {
  private readonly pendingPieceRequests = new Map<string, PendingPieceRequest>();

  getAvailableChunkIndexes(trackId: string, chunkIndexes: number[]) {
    return [...new Set(chunkIndexes)]
      .filter((chunkIndex) => !this.pendingPieceRequests.has(buildPieceRequestKey(trackId, chunkIndex)))
      .sort((left, right) => left - right);
  }

  registerRequests(input: {
    peerId: string;
    trackId: string;
    chunkIndexes: number[];
    expectedTotalChunks?: number;
    requestId?: string;
    timeoutMs: number;
    onTimeout?: (payload: PieceRequestTimeoutPayload) => void;
  }) {
    const requestedAtMs = Date.now();
    for (const chunkIndex of input.chunkIndexes) {
      const requestKey = buildPieceRequestKey(input.trackId, chunkIndex);
      const timeoutId = setTimeout(() => {
        this.pendingPieceRequests.delete(requestKey);
        input.onTimeout?.({
          trackId: input.trackId,
          chunkIndex,
          peerId: input.peerId,
          requestId: input.requestId,
          requestDurationMs: Date.now() - requestedAtMs
        });
      }, input.timeoutMs);
      this.pendingPieceRequests.set(requestKey, {
        peerId: input.peerId,
        requestId: input.requestId,
        expectedTotalChunks: input.expectedTotalChunks,
        requestedAtMs,
        timeoutMs: input.timeoutMs,
        timeoutId
      });
    }
  }

  get(trackId: string, chunkIndex: number) {
    return this.pendingPieceRequests.get(buildPieceRequestKey(trackId, chunkIndex)) ?? null;
  }

  take(trackId: string, chunkIndex: number) {
    const requestKey = buildPieceRequestKey(trackId, chunkIndex);
    const pendingRequest = this.pendingPieceRequests.get(requestKey) ?? null;
    if (!pendingRequest) {
      return null;
    }

    clearTimeout(pendingRequest.timeoutId);
    this.pendingPieceRequests.delete(requestKey);
    return pendingRequest;
  }

  clearPeer(peerId: string) {
    for (const [requestKey, pendingRequest] of this.pendingPieceRequests.entries()) {
      if (pendingRequest.peerId !== peerId) {
        continue;
      }

      clearTimeout(pendingRequest.timeoutId);
      this.pendingPieceRequests.delete(requestKey);
    }
  }

  clearAll() {
    for (const pendingRequest of this.pendingPieceRequests.values()) {
      clearTimeout(pendingRequest.timeoutId);
    }
    this.pendingPieceRequests.clear();
  }
}

export function buildPieceRequestKey(trackId: string, chunkIndex: number) {
  return `${trackId}:${chunkIndex}`;
}
