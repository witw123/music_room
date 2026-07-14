import {
  availabilityRangesToChunkIndexes,
  chunkIndexesToAvailabilityRanges,
  type CacheStreamMessage,
  type PieceAvailabilityRange
} from "@music-room/shared";
import { isPeerTransportAllowed, resolvePeerLinkProfile } from "./peer-link-profile";

const MIN_INITIAL_CREDIT_BYTES = 8 * 1024 * 1024;
const MAX_INITIAL_CREDIT_BYTES = 32 * 1024 * 1024;
const MAX_ACTIVE_STREAMS_PER_TRACK = 6;
const MAX_ACTIVE_STREAMS_PER_PEER = 4;

export type CacheStreamResetReason = Extract<
  CacheStreamMessage,
  { kind: "cache-stream-reset" }
>["reason"];

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
  candidateType?: string | null;
  protocol?: string | null;
  relayProtocol?: string | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
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
  timeoutMs?: number;
};

export type CacheStreamRequestOptions = Pick<
  CacheStreamSchedulerRequest,
  "allowRedundant" | "maxReplicas" | "priority" | "timeoutMs"
>;

type SchedulerStream = {
  peerId: string;
  streamId: string;
  trackId: string;
  generation: number;
  priority: "critical" | "bulk";
  chunkIndexes: Set<number>;
  received: Set<number>;
  acknowledged: Set<number>;
  credited: Set<number>;
  unconfirmed: Set<number>;
  totalChunks: number;
  chunkSize: number;
  openedAtMs: number;
  lastProgressAtMs: number;
  lastValidatedAtMs: number;
  lastPersistedAtMs: number;
  stallTimeoutMs: number;
  bytesAcked: number;
  nackCount: number;
  creditBytes: number;
  watchdogTimerId: ReturnType<typeof setTimeout> | null;
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
  private readonly resolvePeerTransport?: (peerId: string) => {
    candidateType?: string | null;
    protocol?: string | null;
    relayProtocol?: string | null;
    transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  } | null | undefined;
  private readonly resolveInitialCreditBytes?: (input: {
    peerId: string;
    chunkSize: number;
    priority: "critical" | "bulk";
  }) => number | null | undefined;
  private readonly providers = new Map<string, CacheStreamProvider>();
  private readonly streams = new Map<string, SchedulerStream>();
  private readonly generationByTrack = new Map<string, number>();
  private readonly assignedByTrack = new Map<string, Map<number, Set<string>>>();
  private readonly onStreamReset?: (input: {
    peerId: string;
    trackId: string;
    streamId: string;
    generation: number;
    chunkIndexes: number[];
    reason: CacheStreamResetReason;
  }) => void;
  private streamSequence = 0;

  constructor(input: {
    sendControl: (peerId: string, message: CacheStreamMessage) => void;
    resolvePeerTransport?: CacheStreamScheduler["resolvePeerTransport"];
    resolveInitialCreditBytes?: CacheStreamScheduler["resolveInitialCreditBytes"];
    onStreamReset?: CacheStreamScheduler["onStreamReset"];
  }) {
    this.sendControl = input.sendControl;
    this.resolvePeerTransport = input.resolvePeerTransport;
    this.resolveInitialCreditBytes = input.resolveInitialCreditBytes;
    this.onStreamReset = input.onStreamReset;
  }

  setProvider(provider: CacheStreamProvider) {
    const key = this.providerKey(provider.trackId, provider.peerId);
    const previous = this.providers.get(key);
    this.providers.set(key, {
      ...previous,
      ...provider,
      connected: provider.connected ?? previous?.connected ?? true
    });
  }

  removeProvider(trackId: string, peerId: string) {
    this.providers.delete(this.providerKey(trackId, peerId));
    for (const stream of [...this.streams.values()]) {
      if (stream.trackId !== trackId || stream.peerId !== peerId) {
        continue;
      }
      this.reassignStream(stream, "peer-closed", [peerId]);
    }
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
    this.reassignStalledStreams(input.trackId);

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

    const activeStreams = this.getTrackStreams(input.trackId);
    const availableStreamSlots = Math.max(
      0,
      MAX_ACTIVE_STREAMS_PER_TRACK - activeStreams.length
    );
    if (availableStreamSlots === 0) {
      return false;
    }

    const assignment = new Map<string, number[]>();
    for (const chunkIndex of wanted) {
      const assignedPeers = this.assignedByTrack.get(input.trackId)?.get(chunkIndex) ?? new Set();
      const hasAnnouncedProvider = candidates.some((provider) =>
        this.providerHasChunk(provider, chunkIndex)
      );
      const chunkCandidates = candidates.filter((provider) => {
        if (this.getPeerStreams(provider.peerId).length >= MAX_ACTIVE_STREAMS_PER_PEER) {
          return false;
        }
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
        return (
          this.providerHasChunk(provider, chunkIndex) ||
          (!hasAnnouncedProvider && provider.peerId === input.preferredPeerId)
        );
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

    let opened = false;
    const assignmentEntries = [...assignment.entries()];
    for (const [peerId, chunkIndexes] of assignmentEntries.slice(availableStreamSlots)) {
      for (const chunkIndex of chunkIndexes) {
        this.releaseAssignment(input.trackId, chunkIndex, peerId);
      }
    }

    for (const [peerId, chunkIndexes] of assignmentEntries.slice(0, availableStreamSlots)) {
      if (chunkIndexes.length === 0) {
        continue;
      }
      if (activeStreams.length >= MAX_ACTIVE_STREAMS_PER_TRACK) {
        break;
      }
      const provider = candidates.find((candidate) => candidate.peerId === peerId);
      const transport = this.resolvePeerTransport?.(peerId) ?? provider ?? null;
      const streamId = this.createStreamId(input.trackId, generation);
      const message: CacheStreamMessage = {
        kind: "cache-stream-open",
        protocolVersion: 3,
        streamId,
        trackId: input.trackId,
        generation,
        priority: input.priority,
        ranges: chunkIndexesToAvailabilityRanges(chunkIndexes, input.totalChunks),
        initialCreditBytes: calculateInitialCreditBytes({
          chunkSize: input.chunkSize,
          throughputKbps: provider?.throughputKbps,
          rttMs: provider?.p95RttMs ?? provider?.rttMs,
          profile: transport ? resolvePeerLinkProfile(transport) : undefined,
          preferredCreditBytes: this.resolveInitialCreditBytes?.({
            peerId,
            chunkSize: input.chunkSize,
            priority: input.priority
          })
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
        credited: new Set(),
        unconfirmed: new Set(chunkIndexes),
        totalChunks: input.totalChunks,
        chunkSize: input.chunkSize,
        openedAtMs: Date.now(),
        lastProgressAtMs: Date.now(),
        lastValidatedAtMs: Date.now(),
        lastPersistedAtMs: Date.now(),
        stallTimeoutMs: resolveStreamTimeoutMs({
          inputTimeoutMs: input.timeoutMs,
          profile: transport ? resolvePeerLinkProfile(transport) : undefined,
          priority: input.priority
        }),
        bytesAcked: 0,
        nackCount: 0,
        creditBytes: message.initialCreditBytes,
        watchdogTimerId: null
      };
      this.streams.set(streamId, stream);
      this.scheduleWatchdog(stream);
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
    payloadBytes?: number;
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
    stream.creditBytes = Math.max(
      0,
      stream.creditBytes - Math.max(0, input.payloadBytes ?? stream.chunkSize)
    );
    stream.lastProgressAtMs = Date.now();
    return "accepted";
  }

  ackDuplicate(input: {
    peerId: string;
    streamId: string;
    generation: number;
    chunkIndex: number;
    storedBytes: number;
  }) {
    const stream = this.streams.get(input.streamId);
    if (
      !stream ||
      stream.peerId !== input.peerId ||
      stream.generation !== input.generation ||
      !stream.acknowledged.has(input.chunkIndex)
    ) {
      return;
    }
    this.sendControl(input.peerId, {
      kind: "cache-stream-ack",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      storedBytes: input.storedBytes
    });
  }

  markPeerTransportUnavailable(peerId: string) {
    for (const provider of this.providers.values()) {
      if (provider.peerId === peerId) {
        provider.connected = false;
      }
    }
    this.reassignPeerStreams(peerId, "peer-closed");
  }

  markPeerTransportAvailable(peerId: string) {
    for (const provider of this.providers.values()) {
      if (provider.peerId === peerId) {
        provider.connected = true;
      }
    }
  }

  handleValidated(input: {
    peerId: string;
    streamId: string;
    generation: number;
    chunkIndex: number;
    storedBytes: number;
  }) {
    const stream = this.streams.get(input.streamId);
    if (
      !stream ||
      stream.peerId !== input.peerId ||
      stream.generation !== input.generation ||
      !stream.unconfirmed.has(input.chunkIndex) ||
      !stream.received.has(input.chunkIndex) ||
      stream.credited.has(input.chunkIndex)
    ) {
      return false;
    }
    stream.credited.add(input.chunkIndex);
    stream.lastValidatedAtMs = Date.now();
    stream.lastProgressAtMs = stream.lastValidatedAtMs;
    stream.creditBytes += input.storedBytes;
    this.sendControl(input.peerId, {
      kind: "cache-stream-credit",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      creditBytes: input.storedBytes
    });
    return true;
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
    if (
      !stream ||
      stream.peerId !== input.peerId ||
      stream.generation !== input.generation ||
      !stream.credited.has(input.chunkIndex) ||
      stream.acknowledged.has(input.chunkIndex)
    ) {
      return false;
    }
    stream.acknowledged.add(input.chunkIndex);
    stream.unconfirmed.delete(input.chunkIndex);
    stream.bytesAcked += input.storedBytes;
    stream.lastPersistedAtMs = Date.now();
    stream.lastProgressAtMs = Date.now();
    this.sendControl(input.peerId, {
      kind: "cache-stream-ack",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      storedBytes: input.storedBytes
    });
    if (stream.unconfirmed.size === 0) {
      this.removeStream(stream);
    }
    return true;
  }

  handleNack(input: {
    peerId: string;
    streamId: string;
    generation: number;
    trackId: string;
    chunkIndex: number;
    reason: Extract<CacheStreamMessage, { kind: "cache-stream-nack" }>["reason"];
    refundCreditBytes: number;
  }) {
    const stream = this.streams.get(input.streamId);
    if (!stream || stream.peerId !== input.peerId || stream.generation !== input.generation) {
      return;
    }
    stream.nackCount += 1;
    stream.received.delete(input.chunkIndex);
    stream.lastProgressAtMs = Date.now();
    this.sendControl(input.peerId, {
      kind: "cache-stream-nack",
      streamId: input.streamId,
      generation: input.generation,
      chunkIndex: input.chunkIndex,
      reason: input.reason,
      refundCreditBytes: input.refundCreditBytes
    });
  }

  handleReset(input: {
    peerId: string;
    streamId: string;
    generation: number;
    reason?: CacheStreamResetReason;
  }) {
    const stream = this.streams.get(input.streamId);
    if (
      !stream ||
      stream.peerId !== input.peerId ||
      stream.generation !== input.generation
    ) {
      return false;
    }

    const remaining = [...stream.unconfirmed];
    const resetReason = input.reason ?? "peer-closed";
    this.onStreamReset?.({
      peerId: stream.peerId,
      trackId: stream.trackId,
      streamId: stream.streamId,
      generation: stream.generation,
      chunkIndexes: remaining,
      reason: resetReason
    });
    this.removeStream(stream);
    if (remaining.length > 0) {
      this.request({
        trackId: stream.trackId,
        chunkIndexes: remaining,
        totalChunks: stream.totalChunks,
        chunkSize: stream.chunkSize,
        priority: stream.priority,
        generation: stream.generation,
        excludedPeerIds: [input.peerId],
        timeoutMs: stream.stallTimeoutMs
      });
    }
    return true;
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
      this.onStreamReset?.({
        peerId: stream.peerId,
        trackId: stream.trackId,
        streamId: stream.streamId,
        generation: stream.generation,
        chunkIndexes: [...stream.unconfirmed],
        reason: "superseded"
      });
      this.removeStream(stream);
    }
    this.assignedByTrack.delete(trackId);
  }

  clear() {
    for (const stream of [...this.streams.values()]) {
      this.sendControl(stream.peerId, {
        kind: "cache-stream-reset",
        streamId: stream.streamId,
        generation: stream.generation,
        reason: "superseded"
      });
      this.onStreamReset?.({
        peerId: stream.peerId,
        trackId: stream.trackId,
        streamId: stream.streamId,
        generation: stream.generation,
        chunkIndexes: [...stream.unconfirmed],
        reason: "superseded"
      });
      this.removeStream(stream);
    }
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
        this.isProviderTransportAllowed(provider, input.priority) &&
        (provider.peerId === input.preferredPeerId || provider.peerId !== "")
    );
    if (
      input.preferredPeerId &&
      !providers.some((provider) => provider.peerId === input.preferredPeerId) &&
      this.isProviderTransportAllowed(
        { peerId: input.preferredPeerId, trackId: input.trackId },
        input.priority
      )
    ) {
      providers.push({
        peerId: input.preferredPeerId,
        trackId: input.trackId,
        connected: true
      });
    }
    return providers.sort((left, right) => this.scoreProvider(left) - this.scoreProvider(right));
  }

  private isProviderTransportAllowed(
    provider: CacheStreamProvider,
    priority: CacheStreamSchedulerRequest["priority"]
  ) {
    const transport = this.resolvePeerTransport?.(provider.peerId) ?? provider;
    if (
      transport.transportScore === "failed" ||
      ((transport.transportScore === "degraded" || transport.transportScore === "unstable") &&
        priority !== "critical")
    ) {
      return false;
    }
    return isPeerTransportAllowed(transport);
  }

  private providerHasChunk(provider: CacheStreamProvider, chunkIndex: number) {
    if (provider.availableRanges) {
      return provider.availableRanges.some(
        (range) => chunkIndex >= range.start && chunkIndex <= range.end
      );
    }
    if (provider.availableChunks) {
      return provider.availableChunks.includes(chunkIndex);
    }
    return true;
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

  private reassignPeerStreams(peerId: string, reason: CacheStreamResetReason = "peer-closed") {
    for (const stream of [...this.streams.values()]) {
      if (stream.peerId !== peerId || stream.unconfirmed.size === 0) {
        continue;
      }
      this.reassignStream(stream, reason);
    }
  }

  private reassignStalledStreams(trackId?: string) {
    const now = Date.now();
    for (const stream of [...this.streams.values()]) {
      if (
        (trackId && stream.trackId !== trackId) ||
        stream.unconfirmed.size === 0 ||
        now - stream.lastValidatedAtMs < stream.stallTimeoutMs
      ) {
        continue;
      }

      this.reassignStream(stream, "timeout", [stream.peerId]);
    }
  }

  private getTrackStreams(trackId: string) {
    return [...this.streams.values()].filter(
      (stream) => stream.trackId === trackId && stream.unconfirmed.size > 0
    );
  }

  private getPeerStreams(peerId: string) {
    return [...this.streams.values()].filter(
      (stream) => stream.peerId === peerId && stream.unconfirmed.size > 0
    );
  }

  private removeStream(stream: SchedulerStream) {
    if (stream.watchdogTimerId) {
      clearTimeout(stream.watchdogTimerId);
      stream.watchdogTimerId = null;
    }
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

  private reassignStream(
    stream: SchedulerStream,
    reason: CacheStreamResetReason,
    excludedPeerIds: string[] = []
  ) {
    const remaining = [...stream.unconfirmed];
    this.sendControl(stream.peerId, {
      kind: "cache-stream-reset",
      streamId: stream.streamId,
      generation: stream.generation,
      reason
    });
    this.onStreamReset?.({
      peerId: stream.peerId,
      trackId: stream.trackId,
      streamId: stream.streamId,
      generation: stream.generation,
      chunkIndexes: remaining,
      reason
    });
    this.removeStream(stream);
    if (remaining.length > 0) {
      const request = {
        trackId: stream.trackId,
        chunkIndexes: remaining,
        totalChunks: stream.totalChunks,
        chunkSize: stream.chunkSize,
        priority: stream.priority,
        generation: stream.generation,
        excludedPeerIds,
        timeoutMs: stream.stallTimeoutMs
      } satisfies CacheStreamSchedulerRequest;
      const reassigned = this.request(request);
      if (!reassigned && reason === "timeout" && excludedPeerIds.length > 0) {
        this.request({
          ...request,
          excludedPeerIds: []
        });
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

  private scheduleWatchdog(stream: SchedulerStream) {
    if (stream.watchdogTimerId || stream.unconfirmed.size === 0) {
      return;
    }

    stream.watchdogTimerId = setTimeout(() => {
      stream.watchdogTimerId = null;
      const current = this.streams.get(stream.streamId);
      if (!current || current.unconfirmed.size === 0) {
        return;
      }

      if (Date.now() - current.lastValidatedAtMs < current.stallTimeoutMs) {
        this.scheduleWatchdog(current);
        return;
      }

      this.reassignStream(current, "timeout", [current.peerId]);
    }, Math.max(1_000, stream.stallTimeoutMs));
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
  profile?: ReturnType<typeof resolvePeerLinkProfile>;
  preferredCreditBytes?: number | null;
}) {
  const throughputBytesPerSecond = Math.max(64 * 1024, (input.throughputKbps ?? 2_048) * 125);
  const rttSeconds = Math.max(0.02, (input.rttMs ?? 120) / 1_000);
  const bdpBytes = throughputBytesPerSecond * rttSeconds;
  const profileFloor =
    input.profile === "fast-direct" || input.profile === "standard-direct"
      ? 16 * 1024 * 1024
      : input.profile === "relay-udp"
        ? 8 * 1024 * 1024
        : MIN_INITIAL_CREDIT_BYTES;
  const chunkFloor = Math.max(2 * input.chunkSize, profileFloor);
  return clampPowerOfTwo(
    Math.max(chunkFloor, bdpBytes * 4, input.preferredCreditBytes ?? 0),
    MIN_INITIAL_CREDIT_BYTES,
    MAX_INITIAL_CREDIT_BYTES
  );
}

function resolveStreamTimeoutMs(input: {
  inputTimeoutMs?: number;
  profile?: ReturnType<typeof resolvePeerLinkProfile>;
  priority: CacheStreamSchedulerRequest["priority"];
}) {
  if (input.priority === "critical") {
    // This is a no-progress watchdog, not a whole-request deadline. Reliable
    // SCTP may be slow over TURN, but eight seconds without one validated
    // piece means startup should rebuild the stream instead of staying silent.
    return 8_000;
  }
  const minimum = input.profile === "relay-udp" ? 25_000 : 15_000;
  return Math.max(minimum, input.inputTimeoutMs ?? minimum);
}

function clampPowerOfTwo(value: number, min: number, max: number) {
  const clamped = Math.min(max, Math.max(min, Math.ceil(value)));
  return 2 ** Math.ceil(Math.log2(clamped));
}
