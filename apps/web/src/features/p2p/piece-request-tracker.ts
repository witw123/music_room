export type PendingPieceRequest = {
  peerId: string;
  requestId?: string;
  expectedTotalChunks?: number;
  requestedAtMs: number;
  timeoutMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

export type PieceRequestAvailabilityOptions = {
  allowRedundant?: boolean;
  maxReplicas?: number;
  peerId?: string;
};

type PieceRequestTimeoutPayload = {
  trackId: string;
  chunkIndex: number;
  peerId: string;
  requestId?: string;
  requestDurationMs: number;
};

export class PieceRequestTracker {
  private readonly pendingPieceRequests = new Map<string, PendingPieceRequest[]>();

  getAvailableChunkIndexes(
    trackId: string,
    chunkIndexes: number[],
    options: PieceRequestAvailabilityOptions = {}
  ) {
    const maxReplicas = options.allowRedundant ? Math.max(1, options.maxReplicas ?? 2) : 1;
    return [...new Set(chunkIndexes)]
      .filter((chunkIndex) => {
        const pendingRequests =
          this.pendingPieceRequests.get(buildPieceRequestKey(trackId, chunkIndex)) ?? [];
        if (options.peerId && pendingRequests.some((request) => request.peerId === options.peerId)) {
          return false;
        }
        return pendingRequests.length < maxReplicas;
      })
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
    allowRedundant?: boolean;
    maxReplicas?: number;
  }) {
    const requestedAtMs = Date.now();
    const maxReplicas = input.allowRedundant ? Math.max(1, input.maxReplicas ?? 2) : 1;
    for (const chunkIndex of input.chunkIndexes) {
      const requestKey = buildPieceRequestKey(input.trackId, chunkIndex);
      const existingRequests = this.pendingPieceRequests.get(requestKey) ?? [];
      if (
        existingRequests.length >= maxReplicas ||
        existingRequests.some((request) => request.peerId === input.peerId)
      ) {
        continue;
      }

      const timeoutId = setTimeout(() => {
        const pendingRequests = this.pendingPieceRequests.get(requestKey) ?? [];
        const nextRequests = pendingRequests.filter(
          (request) => request.peerId !== input.peerId || request.requestId !== input.requestId
        );
        if (nextRequests.length === 0) {
          this.pendingPieceRequests.delete(requestKey);
        } else {
          this.pendingPieceRequests.set(requestKey, nextRequests);
        }
        input.onTimeout?.({
          trackId: input.trackId,
          chunkIndex,
          peerId: input.peerId,
          requestId: input.requestId,
          requestDurationMs: Date.now() - requestedAtMs
        });
      }, input.timeoutMs);
      this.pendingPieceRequests.set(requestKey, [
        ...existingRequests,
        {
          peerId: input.peerId,
          requestId: input.requestId,
          expectedTotalChunks: input.expectedTotalChunks,
          requestedAtMs,
          timeoutMs: input.timeoutMs,
          timeoutId
        }
      ]);
    }
  }

  get(trackId: string, chunkIndex: number) {
    return this.pendingPieceRequests.get(buildPieceRequestKey(trackId, chunkIndex))?.[0] ?? null;
  }

  take(trackId: string, chunkIndex: number) {
    const requestKey = buildPieceRequestKey(trackId, chunkIndex);
    const pendingRequests = this.pendingPieceRequests.get(requestKey) ?? [];
    if (pendingRequests.length === 0) {
      return null;
    }

    for (const pendingRequest of pendingRequests) {
      clearTimeout(pendingRequest.timeoutId);
    }
    this.pendingPieceRequests.delete(requestKey);
    return pendingRequests[0] ?? null;
  }

  clearPeer(peerId: string) {
    for (const [requestKey, pendingRequests] of this.pendingPieceRequests.entries()) {
      const nextRequests: PendingPieceRequest[] = [];
      for (const pendingRequest of pendingRequests) {
        if (pendingRequest.peerId === peerId) {
          clearTimeout(pendingRequest.timeoutId);
        } else {
          nextRequests.push(pendingRequest);
        }
      }

      if (nextRequests.length === 0) {
        this.pendingPieceRequests.delete(requestKey);
      } else {
        this.pendingPieceRequests.set(requestKey, nextRequests);
      }
    }
  }

  clearAll() {
    for (const pendingRequests of this.pendingPieceRequests.values()) {
      for (const pendingRequest of pendingRequests) {
        clearTimeout(pendingRequest.timeoutId);
      }
    }
    this.pendingPieceRequests.clear();
  }
}

export function buildPieceRequestKey(trackId: string, chunkIndex: number) {
  return `${trackId}:${chunkIndex}`;
}
