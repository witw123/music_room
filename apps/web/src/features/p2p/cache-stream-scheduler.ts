import {
  availabilityRangesToChunkIndexes,
  chunkIndexesToAvailabilityRanges,
  type CacheStreamMessage,
  type PieceAvailabilityRange
} from "@music-room/shared";

const MIN_INITIAL_CREDIT_BYTES = 2 * 1024 * 1024;
const MAX_INITIAL_CREDIT_BYTES = 64 * 1024 * 1024;
const MAX_ACTIVE_STREAMS_PER_TRACK = 6;

export type CacheStreamProvider = {
  peerId: string;
  trackId: string;
  connected?: boolean;
  availableRanges?: PieceAvailabilityRange[];
  availableChunks?: number[];
  throughputKbps?: number;
  rttMs?: number;
  p95RttMs?: number;
  bufferedAmountBytes?: number;
  failureRate?: number;
  nackRate?: number;
};

export type CacheStreamSchedulerRequest = {
  trackId: string;
  chunkIndexes: number[];
  totalChunks: number;
  chunkSize: number;
  priority: "critical" | "bulk";
  preferredPeerId?: string | null;
  allowRedundant?: boolean;
  maxReplicas?: number;
  generation?: number;
  excludedPeerIds?: string[];
};

type SchedulerStream = {
  peerId: string;
  streamId: string;
  trackId: string;
  generation: number;
  priority: "critical" | "bulk";
  chunkIndexes: Set<number>;
  received: Set<number>;
  acknowledged: Set<number>;
  unconfirmed: Set<number>;
  chunkSize: number;
  openedAtMs: number;
  bytesAcked: number;
  nackCount: number;
  creditBytes: number;
};

export type CacheStreamSchedulerMetrics = {
  peerId: string;
  streamId: string;
  trackId: string;
  generation: number;
  streamThroughputKbps: number;
  streamInFlightBytes: number;
  streamCreditBytes: number;
  streamAckRttMs: number | null;
  streamNackCount: number;
  streamRetryCount: number;
  providerContributionBytes: number;
  dataChannelBufferedAmountBytes: number;
  availabilityCoveragePercent: number;
};

export class CacheStreamScheduler {
  private readonly sendControl: (peerId: string, message: CacheStreamMessage) => void;
  private readonly providers = new Map<string, CacheStreamProvider>();
  private readonly streams = new Map<string, SchedulerStream>();
  private readonly generationByTrack = new Map<string, number>();
  private readonly assignedByTrack = new Map<string, Map<number, Set<string>>>();
  private streamSequence = 0;

  constructor(input: {
    sendControl: (peerId: string, message: CacheStreamMessage) => void;
  }) {
    this.sendControl = input.sendControl;
  }

  setProvider(provider: CacheStreamProvider) {
    this.providers.set(this.providerKey(provider.trackId, provider.peerId), {
      ...provider,
      connected: provider.connected ?? true
    });
  }

  updateProviderMetrics(input: {
    trackId: string;
    peerId: string;
    throughputKbps?: number;
    rttMs?: number;
    p95RttMs?: number;
    bufferedAmountBytes?: number;
    failureRate?: number;
    nackRate?: number;
  }) {
    const key = this.providerKey(input.trackId, input.peerId);
    const provider = this.providers.get(key) ?? {
      trackId: input.trackId,
      peerId: input.peerId,
      connected: true
    };
    this.providers.set(key, { ...provider, ...input });
  }

  markPeerConnected(peerId: string, connected: boolean) {
    for (const provider of this.providers.values()) {
      if (provider.peerId === peerId) {
        provider.connected = connected;
      }
    }
    if (!connected) {
      this.reassignPeerStreams(peerId);
    }
  }

  request(input: CacheStreamSchedulerRequest) {
    const wanted = [...new Set(input.chunkIndexes)]
      .filter((chunkIndex) => chunkIndex >= 0 && chunkIndex < input.totalChunks)
      .sort((left, right) => left - right);
    if (wanted.length === 0) {
      return false;
    }

    const generation = input.generation ?? this.generationByTrack.get(input.trackId) ?? 0;
    this.generationByTrack.set(input.trackId, generation);
    const candidates = this.resolveCandidates(input);
    if (candidates.length === 0) {
      return false;
    }

    const assignment = new Map<string, number[]>();
    for (const chunkIndex of wanted) {
      const assignedPeers = this.assignedByTrack.get(input.trackId)?.get(chunkIndex) ?? new Set();
      const chunkCandidates = candidates.filter((provider) => {
        if (
          assignedPeers.size > 0 &&
          !(input.priority === "critical" && input.allowRedundant)
        ) {
          return false;
        }
        if (input.priority === "critical" && input.allowRedundant && assignedPeers.size >= Math.max(1, input.maxReplicas ?? 2)) {
          return false;
        }
        if (assignedPeers.has(provider.peerId)) {
          return false;
        }
        return this.providerHasChunk(provider, chunkIndex) || provider.peerId === input.preferredPeerId;
      });
      const orderedChunkCandidates = [...chunkCandidates].sort((left, right) => {
        const leftLoad = assignment.get(left.peerId)?.length ?? 0;
        const rightLoad = assignment.get(right.peerId)?.length ?? 0;
        return leftLoad - rightLoad || this.scoreProvider(left) - this.scoreProvider(right);
      });
      const selected = orderedChunkCandidates[0];
      if (!selected) {
        continue;
      }
      const indexes = assignment.get(selected.peerId) ?? [];
      indexes.push(chunkIndex);
      assignment.set(selected.peerId, indexes);
      const trackAssignments = this.assignedByTrack.get(input.trackId) ?? new Map();
      const nextPeers = trackAssignments.get(chunkIndex) ?? new Set<string>();
      nextPeers.add(selected.peerId);
      trackAssignments.set(chunkIndex, nextPeers);
      this.assignedByTrack.set(input.trackId, trackAssignments);
    }

    const activeStreams = this.getTrackStreams(input.trackId);
    let opened = false;
    for (const [peerId, chunkIndexes] of assignment.entries()) {
      if (chunkIndexes.length === 0) {
        continue;
      }
      if (activeStreams.length >= MAX_ACTIVE_STREAMS_PER_TRACK) {
        break;
      }
      const provider = candidates.find((candidate) => candidate.peerId === peerId);
      const streamId = this.createStreamId(input.trackId, generation);
      const message: CacheStreamMessage = {
        kind: "cache-stream-open",
        protocolVersion: 2,
        streamId,
        trackId: input.trackId,
        generation,
        priority: input.priority,
        ranges: chunkIndexesToAvailabilityRanges(chunkIndexes, input.totalChunks),
        initialCreditBytes: calculateInitialCreditBytes({
          chunkSize: input.chunkSize,
          throughputKbps: provider?.throughputKbps,
          rttMs: provider?.p95RttMs ?? provider?.rttMs
        })
      };
      const stream: SchedulerStream = {
        peerId,
        streamId,
        trackId: input.trackId,
        generation,
        priority: input.priority,
        chunkIndexes: new Set(chunkIndexes),
        received: new Set(),
        acknowledged: new Set(),
        unconfirmed: new Set(chunkIndexes),
        chunkSize: input.chunkSize,
        openedAtMs: Date.now(),
        bytesAcked: 0,
        nackCount: 0,
        creditBytes: message.initialCreditBytes
      };
      this.streams.set(streamId, stream);
      this.sendControl(peerId, message);
      opened = true;
      activeStreams.push(stream);
    }
    return opened;
  }

  acceptIncomingPiece(input: {
    peerId: string;
    streamId: string;
    generation: number;
    trackId: string;
    chunkIndex: number;
  }) {
    return this.inspectIncomingPiece(input) === "accepted";
  }

  inspectIncomingPiece(input: {
    peerId: string;
    streamId: string;
    generation: number;
    trackId: string;
    chunkIndex: number;
  }): "accepted" | "duplicate" | "rejected" {
    const stream = this.streams.get(input.streamId);
    if (
      !stream ||
      stream.peerId !== input.peerId ||
      stream.trackId !== input.trackId ||
      stream.generation !== input.generation ||
      !stream.chunkIndexes.has(input.chunkIndex)
    ) {
      return "rejected";
    }
    if (stream.received.has(input.chunkIndex) || stream.acknowledged.has(input.chunkIndex)) {
      return "duplicate";
    }
    stream.received.add(input.chunkIndex);
    return "accepted";
  }

  ackDuplicate(input: {
    peerId: string;
    streamId: string;
    generation: number;
    chunkIndex: number;
    storedBytes: number;
  }) {
    this.sendControl(input.peerId, {
      kind: "cache-stream-ack",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      storedBytes: input.storedBytes
    });
    this.sendControl(input.peerId, {
      kind: "cache-stream-credit",
      streamId: input.streamId,
      generation: input.generation,
      creditBytes: input.storedBytes
    });
  }

  handlePersisted(input: {
    peerId: string;
    streamId?: string;
    generation?: number;
    trackId: string;
    chunkIndex: number;
    storedBytes: number;
  }) {
    if (!input.streamId || typeof input.generation !== "number") {
      return false;
    }
    const stream = this.streams.get(input.streamId);
    if (!stream || stream.peerId !== input.peerId || stream.generation !== input.generation) {
      return false;
    }
    stream.acknowledged.add(input.chunkIndex);
    stream.unconfirmed.delete(input.chunkIndex);
    stream.bytesAcked += input.storedBytes;
    stream.creditBytes += input.storedBytes;
    this.sendControl(input.peerId, {
      kind: "cache-stream-ack",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      storedBytes: input.storedBytes
    });
    this.sendControl(input.peerId, {
      kind: "cache-stream-credit",
      streamId: input.streamId,
      generation: input.generation,
      creditBytes: input.storedBytes
    });
    return true;
  }

  handleNack(input: {
    peerId: string;
    streamId: string;
    generation: number;
    trackId: string;
    chunkIndex: number;
    reason: Extract<CacheStreamMessage, { kind: "cache-stream-nack" }>["reason"];
  }) {
    const stream = this.streams.get(input.streamId);
    if (!stream || stream.peerId !== input.peerId || stream.generation !== input.generation) {
      return;
    }
    stream.nackCount += 1;
    stream.received.delete(input.chunkIndex);
    stream.unconfirmed.add(input.chunkIndex);
    this.releaseAssignment(stream.trackId, input.chunkIndex, stream.peerId);
    this.sendControl(input.peerId, {
      kind: "cache-stream-nack",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      reason: input.reason
    });
    this.request({
      trackId: stream.trackId,
      chunkIndexes: [input.chunkIndex],
      totalChunks: Math.max(input.chunkIndex + 1, ...stream.chunkIndexes),
      chunkSize: stream.chunkSize,
      priority: stream.priority,
      generation: stream.generation,
      excludedPeerIds: input.reason === "hash-mismatch" ? [input.peerId] : []
    });
  }

  clearTrack(trackId: string) {
    const generation = (this.generationByTrack.get(trackId) ?? 0) + 1;
    this.generationByTrack.set(trackId, generation);
    for (const stream of [...this.streams.values()]) {
      if (stream.trackId !== trackId) {
        continue;
      }
      this.sendControl(stream.peerId, {
        kind: "cache-stream-reset",
        streamId: stream.streamId,
        generation: stream.generation,
        reason: "superseded"
      });
      this.removeStream(stream);
    }
    this.assignedByTrack.delete(trackId);
  }

  clear() {
    for (const stream of this.streams.values()) {
      this.sendControl(stream.peerId, {
        kind: "cache-stream-reset",
        streamId: stream.streamId,
        generation: stream.generation,
        reason: "superseded"
      });
    }
    this.streams.clear();
    this.assignedByTrack.clear();
  }

  getMetrics() {
    return [...this.streams.values()].map((stream) => this.buildMetrics(stream));
  }

  private resolveCandidates(input: CacheStreamSchedulerRequest) {
    const providers = [...this.providers.values()].filter(
      (provider) =>
        provider.trackId === input.trackId &&
        provider.connected !== false &&
        !input.excludedPeerIds?.includes(provider.peerId) &&
        (provider.peerId === input.preferredPeerId || provider.peerId !== "")
    );
    if (input.preferredPeerId && !providers.some((provider) => provider.peerId === input.preferredPeerId)) {
      providers.push({
        peerId: input.preferredPeerId,
        trackId: input.trackId,
        connected: true
      });
    }
    return providers.sort((left, right) => this.scoreProvider(left) - this.scoreProvider(right));
  }

  private providerHasChunk(provider: CacheStreamProvider, chunkIndex: number) {
    if (provider.availableRanges?.length) {
      return provider.availableRanges.some(
        (range) => chunkIndex >= range.start && chunkIndex <= range.end
      );
    }
    return provider.availableChunks?.includes(chunkIndex) ?? true;
  }

  private scoreProvider(provider: CacheStreamProvider) {
    const throughputPenalty = 2_000 / Math.max(64, provider.throughputKbps ?? 128);
    const rttPenalty = Math.min(1_000, provider.p95RttMs ?? provider.rttMs ?? 180);
    const bufferedPenalty = Math.min(1_000, (provider.bufferedAmountBytes ?? 0) / 16_384);
    const failurePenalty = (provider.failureRate ?? 0) * 3_000;
    const nackPenalty = (provider.nackRate ?? 0) * 2_000;
    const coverageBonus = Math.min(
      2_000,
      (provider.availableRanges?.reduce((total, range) => total + range.end - range.start + 1, 0) ??
        provider.availableChunks?.length ??
        0) * 2
    );
    return throughputPenalty + rttPenalty + bufferedPenalty + failurePenalty + nackPenalty - coverageBonus;
  }

  private reassignPeerStreams(peerId: string) {
    for (const stream of [...this.streams.values()]) {
      if (stream.peerId !== peerId || stream.unconfirmed.size === 0) {
        continue;
      }
      this.sendControl(peerId, {
        kind: "cache-stream-reset",
        streamId: stream.streamId,
        generation: stream.generation,
        reason: "peer-closed"
      });
      const remaining = [...stream.unconfirmed];
      this.removeStream(stream);
      this.request({
        trackId: stream.trackId,
        chunkIndexes: remaining,
        totalChunks: Math.max(...remaining, 0) + 1,
        chunkSize: stream.chunkSize,
        priority: stream.priority,
        generation: stream.generation
      });
    }
  }

  private getTrackStreams(trackId: string) {
    return [...this.streams.values()].filter(
      (stream) => stream.trackId === trackId && stream.unconfirmed.size > 0
    );
  }

  private removeStream(stream: SchedulerStream) {
    this.streams.delete(stream.streamId);
    const assignments = this.assignedByTrack.get(stream.trackId);
    for (const chunkIndex of stream.chunkIndexes) {
      const peers = assignments?.get(chunkIndex);
      peers?.delete(stream.peerId);
      if (peers?.size === 0) {
        assignments?.delete(chunkIndex);
      }
    }
  }

  private releaseAssignment(trackId: string, chunkIndex: number, peerId: string) {
    const assignments = this.assignedByTrack.get(trackId);
    const peers = assignments?.get(chunkIndex);
    peers?.delete(peerId);
    if (peers?.size === 0) {
      assignments?.delete(chunkIndex);
    }
  }

  private createStreamId(trackId: string, generation: number) {
    this.streamSequence += 1;
    return `cs-${trackId}-${generation}-${this.streamSequence}`;
  }

  private providerKey(trackId: string, peerId: string) {
    return `${trackId}:${peerId}`;
  }

  private buildMetrics(stream: SchedulerStream): CacheStreamSchedulerMetrics {
    const provider = this.providers.get(this.providerKey(stream.trackId, stream.peerId));
    const elapsedMs = Math.max(1, Date.now() - stream.openedAtMs);
    const coverage = provider
      ? availabilityRangesToChunkIndexes(
          provider.availableRanges ?? chunkIndexesToAvailabilityRanges(provider.availableChunks ?? []),
          Math.max(...stream.chunkIndexes, 0) + 1
        ).filter((chunkIndex) => stream.chunkIndexes.has(chunkIndex)).length /
        Math.max(1, stream.chunkIndexes.size)
      : 0;
    return {
      peerId: stream.peerId,
      streamId: stream.streamId,
      trackId: stream.trackId,
      generation: stream.generation,
      streamThroughputKbps: (stream.bytesAcked * 8) / elapsedMs,
      streamInFlightBytes: [...stream.unconfirmed].length * stream.chunkSize,
      streamCreditBytes: stream.creditBytes,
      streamAckRttMs: null,
      streamNackCount: stream.nackCount,
      streamRetryCount: stream.nackCount,
      providerContributionBytes: stream.bytesAcked,
      dataChannelBufferedAmountBytes: provider?.bufferedAmountBytes ?? 0,
      availabilityCoveragePercent: Math.round(coverage * 100)
    };
  }
}

export function calculateInitialCreditBytes(input: {
  chunkSize: number;
  throughputKbps?: number;
  rttMs?: number;
}) {
  const throughputBytesPerSecond = Math.max(64 * 1024, (input.throughputKbps ?? 512) * 125);
  const rttSeconds = Math.max(0.02, (input.rttMs ?? 120) / 1_000);
  const bdpBytes = throughputBytesPerSecond * rttSeconds * 2;
  const chunkFloor = Math.max(2 * input.chunkSize, MIN_INITIAL_CREDIT_BYTES);
  return clampPowerOfTwo(Math.max(chunkFloor, bdpBytes), MIN_INITIAL_CREDIT_BYTES, MAX_INITIAL_CREDIT_BYTES);
}

function clampPowerOfTwo(value: number, min: number, max: number) {
  const clamped = Math.min(max, Math.max(min, Math.ceil(value)));
  return 2 ** Math.ceil(Math.log2(clamped));
}
