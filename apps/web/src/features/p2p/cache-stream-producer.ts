import {
  availabilityRangesToChunkIndexes,
  type CacheStreamMessage,
  type PieceAvailabilityRange
} from "@music-room/shared";
import {
  getCachedPiecesByIndexes,
  getTrackPieceManifest,
  getTrackPieceManifestByFileHash,
  localCacheOwnerKey,
  type TrackPieceRecord
} from "@/lib/indexeddb";
import { buildPieceFrames } from "./piece-frame-codec";
import type { DataChannelQueuedSendItem } from "./data-channel-manager";

type ProducerPeerEntry = {
  channel?: Pick<RTCDataChannel, "readyState" | "bufferedAmount"> | null;
  dataChannel?: Pick<RTCDataChannel, "readyState" | "bufferedAmount"> | null;
};

type TrackCacheIdentity = {
  fileHash: string | null;
  ownerKey?: string | null;
  chunkSize?: number | null;
};

type ProducerFallbackPiece = {
  payload: ArrayBuffer;
  hash: string;
  totalChunks: number;
  chunkSize: number;
  mimeType: string;
};

type ProducerInFlight = {
  bytes: number;
  sentAtMs: number;
};

type ProducerState<TEntry extends ProducerPeerEntry = ProducerPeerEntry> = {
  peerId: string;
  entry: TEntry;
  streamId: string;
  trackId: string;
  generation: number;
  priority: "critical" | "bulk";
  ranges: PieceAvailabilityRange[];
  pendingIndexes: number[];
  cursor: number;
  creditBytes: number;
  inFlightBytes: number;
  sent: Set<number>;
  inFlight: Map<number, ProducerInFlight>;
  acked: Set<number>;
  retryIndexes: number[];
  pumping: boolean;
  closed: boolean;
  startedAtMs: number;
  bytesSent: number;
  nackCount: number;
};

const producerReadBatchSize = 32;

export type CacheStreamProducerMetrics = {
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
};

export class CacheStreamProducer<TEntry extends ProducerPeerEntry = ProducerPeerEntry> {
  private readonly localPeerId: string;
  private readonly enqueueSendItem: (
    peerId: string,
    entry: TEntry,
    item: DataChannelQueuedSendItem
  ) => void;
  private readonly sendControl: (
    peerId: string,
    entry: TEntry,
    message: CacheStreamMessage
  ) => void;
  private readonly resolveTrackCacheIdentity?: (
    trackId: string
  ) => TrackCacheIdentity | null | undefined;
  private readonly resolveMaxDataChannelPayloadBytes: (peerId: string) => number;
  private readonly resolveDataChannelBufferedAmountBytes: (peerId: string, entry: TEntry) => number;
  private readonly resolveMaxInFlightBytes: (peerId: string) => number;
  private readonly resolvePieceFallback?: (
    input: { trackId: string; chunkIndex: number }
  ) => Promise<ProducerFallbackPiece | null>;
  private readonly onMetrics?: (metrics: CacheStreamProducerMetrics) => void;
  private readonly streams = new Map<string, ProducerState<TEntry>>();
  private readonly manifestHeaders = new Map<string, {
    totalChunks: number;
    chunkSize: number;
    mimeType: string;
  }>();

  constructor(input: {
    localPeerId: string;
    enqueueSendItem: (
      peerId: string,
      entry: TEntry,
      item: DataChannelQueuedSendItem
    ) => void;
    sendControl: (peerId: string, entry: TEntry, message: CacheStreamMessage) => void;
    resolveTrackCacheIdentity?: (
      trackId: string
    ) => TrackCacheIdentity | null | undefined;
    resolveMaxDataChannelPayloadBytes?: (peerId: string) => number;
    resolveDataChannelBufferedAmountBytes?: (peerId: string, entry: TEntry) => number;
    resolveMaxInFlightBytes?: (peerId: string) => number;
    resolvePieceFallback?: (
      input: { trackId: string; chunkIndex: number }
    ) => Promise<ProducerFallbackPiece | null>;
    onMetrics?: (metrics: CacheStreamProducerMetrics) => void;
  }) {
    this.localPeerId = input.localPeerId;
    this.enqueueSendItem = input.enqueueSendItem;
    this.sendControl = input.sendControl;
    this.resolveTrackCacheIdentity = input.resolveTrackCacheIdentity;
    this.resolveMaxDataChannelPayloadBytes =
      input.resolveMaxDataChannelPayloadBytes ?? (() => 240 * 1024);
    this.resolveDataChannelBufferedAmountBytes =
      input.resolveDataChannelBufferedAmountBytes ??
      ((_, entry) => entry.dataChannel?.bufferedAmount ?? 0);
    this.resolveMaxInFlightBytes =
      input.resolveMaxInFlightBytes ?? (() => 64 * 1024 * 1024);
    this.resolvePieceFallback = input.resolvePieceFallback;
    this.onMetrics = input.onMetrics;
  }

  async handleMessage(peerId: string, entry: TEntry, message: CacheStreamMessage) {
    if (message.kind === "cache-stream-open") {
      await this.open(peerId, entry, message);
      return;
    }

    const state = this.streams.get(message.streamId);
    if (!state || state.peerId !== peerId || state.generation !== message.generation) {
      return;
    }

    if (message.kind === "cache-stream-credit") {
      state.creditBytes = Math.min(
        this.resolveMaxInFlightBytes(peerId),
        state.creditBytes + message.creditBytes
      );
      void this.pump(state);
      return;
    }

    if (message.kind === "cache-stream-ack") {
      const inFlight = state.inFlight.get(message.chunkIndex);
      if (inFlight) {
        state.inFlight.delete(message.chunkIndex);
        state.inFlightBytes = Math.max(0, state.inFlightBytes - inFlight.bytes);
        state.acked.add(message.chunkIndex);
        this.emitMetrics(state, Date.now() - inFlight.sentAtMs);
      }
      if (
        state.cursor >= state.pendingIndexes.length &&
        state.retryIndexes.length === 0 &&
        state.inFlight.size === 0
      ) {
        this.closeStream(state.streamId);
        return;
      }
      void this.pump(state);
      return;
    }

    if (message.kind === "cache-stream-nack") {
      const inFlight = state.inFlight.get(message.chunkIndex);
      if (inFlight) {
        state.inFlight.delete(message.chunkIndex);
        state.inFlightBytes = Math.max(0, state.inFlightBytes - inFlight.bytes);
        state.creditBytes = Math.min(
          this.resolveMaxInFlightBytes(peerId),
          state.creditBytes + inFlight.bytes
        );
      }
      state.nackCount += 1;
      if (message.reason !== "hash-mismatch") {
        state.retryIndexes.unshift(message.chunkIndex);
      }
      this.emitMetrics(state, null);
      void this.pump(state);
      return;
    }

    this.closeStream(message.streamId);
  }

  clearPeer(peerId: string, reason: Extract<CacheStreamMessage, { kind: "cache-stream-reset" }>["reason"] = "peer-closed") {
    for (const state of [...this.streams.values()]) {
      if (state.peerId !== peerId) {
        continue;
      }
      this.sendControl(state.peerId, state.entry, {
        kind: "cache-stream-reset",
        streamId: state.streamId,
        generation: state.generation,
        reason
      });
      this.closeStream(state.streamId);
    }
  }

  clearTrack(trackId: string) {
    for (const state of [...this.streams.values()]) {
      if (state.trackId === trackId) {
        this.closeStream(state.streamId);
      }
    }
  }

  resumePeer(peerId: string) {
    for (const state of this.streams.values()) {
      if (state.peerId === peerId) {
        void this.pump(state);
      }
    }
  }

  clear() {
    this.streams.clear();
    this.manifestHeaders.clear();
  }

  getMetrics() {
    return [...this.streams.values()].map((state) => this.buildMetrics(state, null));
  }

  private async open(
    peerId: string,
    entry: TEntry,
    message: Extract<CacheStreamMessage, { kind: "cache-stream-open" }>
  ) {
    this.closeStream(message.streamId);
    const pendingIndexes = availabilityRangesToChunkIndexes(message.ranges);
    const state: ProducerState<TEntry> = {
      peerId,
      entry,
      streamId: message.streamId,
      trackId: message.trackId,
      generation: message.generation,
      priority: message.priority,
      ranges: message.ranges,
      pendingIndexes,
      cursor: 0,
      creditBytes: Math.min(
        this.resolveMaxInFlightBytes(peerId),
        Math.max(0, message.initialCreditBytes)
      ),
      inFlightBytes: 0,
      sent: new Set(),
      inFlight: new Map(),
      acked: new Set(),
      retryIndexes: [],
      pumping: false,
      closed: false,
      startedAtMs: Date.now(),
      bytesSent: 0,
      nackCount: 0
    };
    this.streams.set(message.streamId, state);
    await this.pump(state);
  }

  private async pump(state: ProducerState<TEntry>) {
    if (state.closed || state.pumping) {
      return;
    }

    state.pumping = true;
    try {
      while (!state.closed && state.creditBytes > 0) {
        const bufferedAmountBytes = this.resolveDataChannelBufferedAmountBytes(
          state.peerId,
          state.entry
        );
        const maxInFlightBytes = this.resolveMaxInFlightBytes(state.peerId);
        if (
          bufferedAmountBytes >= Math.min(16 * 1024 * 1024, maxInFlightBytes) ||
          state.inFlightBytes >= maxInFlightBytes
        ) {
          break;
        }

        const nextIndexes = this.takeNextIndexes(state, producerReadBatchSize);
        if (nextIndexes.length === 0) {
          break;
        }

        const identity = this.resolveTrackCacheIdentity?.(state.trackId) ?? null;
        const pieces = await getCachedPiecesByIndexes(
          state.trackId,
          this.localPeerId,
          nextIndexes,
          {
            fileHash: identity?.fileHash,
            ownerKey: identity?.ownerKey ?? localCacheOwnerKey,
            chunkSize: identity?.chunkSize
          }
        );
        const piecesByIndex = new Map(pieces.map((piece) => [piece.chunkIndex, piece]));
        const missingIndexes = nextIndexes.filter((chunkIndex) => !piecesByIndex.has(chunkIndex));
        if (missingIndexes.length > 0 && this.resolvePieceFallback) {
          const fallbackPieces = await Promise.all(
            missingIndexes.map(async (chunkIndex) => ({
              chunkIndex,
              piece: await this.resolvePieceFallback?.({
                trackId: state.trackId,
                chunkIndex
              })
            }))
          );
          for (const { chunkIndex, piece } of fallbackPieces) {
            if (!piece) {
              continue;
            }
            piecesByIndex.set(chunkIndex, {
              chunkIndex,
              chunkSize: piece.chunkSize,
              hash: piece.hash,
              payload: piece.payload
            } as TrackPieceRecord);
          }
        }
        if (piecesByIndex.size !== nextIndexes.length) {
          this.sendControl(state.peerId, state.entry, {
            kind: "cache-stream-reset",
            streamId: state.streamId,
            generation: state.generation,
            reason: "protocol-error"
          });
          this.closeStream(state.streamId);
          break;
        }
        let sentAny = false;

        for (const chunkIndex of nextIndexes) {
          const piece = piecesByIndex.get(chunkIndex);
          if (!piece || state.acked.has(chunkIndex) || state.inFlight.has(chunkIndex)) {
            continue;
          }
          if (piece.payload.byteLength > state.creditBytes) {
            state.retryIndexes.unshift(chunkIndex);
            break;
          }

          await this.enqueuePiece(state, piece);
          sentAny = true;
        }

        if (!sentAny) {
          break;
        }
      }
      this.emitMetrics(state, null);
    } catch {
      if (!state.closed) {
        this.sendControl(state.peerId, state.entry, {
          kind: "cache-stream-reset",
          streamId: state.streamId,
          generation: state.generation,
          reason: "protocol-error"
        });
        this.closeStream(state.streamId);
      }
    } finally {
      state.pumping = false;
    }
  }

  private takeNextIndexes(state: ProducerState<TEntry>, limit: number) {
    const indexes: number[] = [];
    while (state.retryIndexes.length > 0 && indexes.length < limit) {
      const chunkIndex = state.retryIndexes.shift();
      if (typeof chunkIndex === "number" && !state.acked.has(chunkIndex) && !state.inFlight.has(chunkIndex)) {
        indexes.push(chunkIndex);
      }
    }
    while (state.cursor < state.pendingIndexes.length && indexes.length < limit) {
      const chunkIndex = state.pendingIndexes[state.cursor++];
      if (!state.acked.has(chunkIndex) && !state.inFlight.has(chunkIndex) && !state.sent.has(chunkIndex)) {
        indexes.push(chunkIndex);
      }
    }
    return indexes;
  }

  private async enqueuePiece(state: ProducerState<TEntry>, piece: Pick<TrackPieceRecord, "chunkIndex" | "chunkSize" | "hash" | "payload">) {
    const manifest = await this.resolveManifestHeader(state.trackId, piece.chunkSize, state.pendingIndexes.length);
    const frames = buildPieceFrames(
      {
        streamId: state.streamId,
        generation: state.generation,
        trackId: state.trackId,
        chunkIndex: piece.chunkIndex,
        totalChunks: manifest.totalChunks,
        chunkSize: manifest.chunkSize,
        mimeType: manifest.mimeType,
        pieceHash: piece.hash
      },
      piece.payload,
      this.resolveMaxDataChannelPayloadBytes(state.peerId)
    );
    const bytes = piece.payload.byteLength;
    state.creditBytes = Math.max(0, state.creditBytes - bytes);
    state.inFlightBytes += bytes;
    state.sent.add(piece.chunkIndex);
    state.inFlight.set(piece.chunkIndex, { bytes, sentAtMs: Date.now() });
    state.bytesSent += bytes;
    for (const frame of frames) {
      this.enqueueSendItem(state.peerId, state.entry, {
        data: frame.data,
        channel: "data",
        priority: state.priority === "critical" ? "critical" : "bulk",
        trackId: state.trackId,
        chunkIndex: piece.chunkIndex,
        payloadBytes: frame.payloadBytes
      });
    }
  }

  private async resolveManifestHeader(trackId: string, fallbackChunkSize: number, fallbackTotalChunks: number) {
    const cached = this.manifestHeaders.get(trackId);
    if (cached) {
      return cached;
    }
    const identity = this.resolveTrackCacheIdentity?.(trackId) ?? null;
    const manifest = identity?.fileHash
      ? getTrackPieceManifestByFileHash(identity.fileHash)
      : getTrackPieceManifest(trackId);
    const resolvedManifest = await manifest.catch(() => null);
    const header = {
      totalChunks: resolvedManifest?.totalChunks ?? Math.max(1, fallbackTotalChunks),
      chunkSize: resolvedManifest?.chunkSize ?? fallbackChunkSize,
      mimeType: resolvedManifest?.mimeType || "audio/mpeg"
    };
    this.manifestHeaders.set(trackId, header);
    return header;
  }

  private closeStream(streamId: string) {
    const state = this.streams.get(streamId);
    if (!state) {
      return;
    }
    state.closed = true;
    this.streams.delete(streamId);
  }

  private emitMetrics(state: ProducerState<TEntry>, ackRttMs: number | null) {
    this.onMetrics?.(this.buildMetrics(state, ackRttMs));
  }

  private buildMetrics(state: ProducerState<TEntry>, ackRttMs: number | null): CacheStreamProducerMetrics {
    const elapsedMs = Math.max(1, Date.now() - state.startedAtMs);
    return {
      peerId: state.peerId,
      streamId: state.streamId,
      trackId: state.trackId,
      generation: state.generation,
      streamThroughputKbps: (state.bytesSent * 8) / elapsedMs,
      streamInFlightBytes: state.inFlightBytes,
      streamCreditBytes: state.creditBytes,
      streamAckRttMs: ackRttMs,
      streamNackCount: state.nackCount,
      streamRetryCount: state.retryIndexes.length,
      providerContributionBytes: state.bytesSent,
      dataChannelBufferedAmountBytes: this.resolveDataChannelBufferedAmountBytes(
        state.peerId,
        state.entry
      )
    };
  }
}
