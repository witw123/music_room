import {
  assetStreamMessageSchema,
  rangesToUnitIndexes,
  unitIndexesToRanges,
  type AssetAvailabilityAnnouncement,
  type AssetKind,
  type AssetStreamMessage,
  type AssetUnitDescriptor
} from "@music-room/shared";
import { AssetFragmentTracker } from "./asset-fragment-tracker";
import {
  decodeAssetUnitFrame,
  encodeAssetUnitFrames,
  isAssetUnitFrame
} from "./asset-frame-codec";

type LocalAssetUnit = { descriptor: AssetUnitDescriptor; payload: ArrayBuffer };

type ProducerStream = {
  peerId: string;
  streamId: string;
  generation: number;
  assetId: string;
  assetKind: AssetKind;
  unitIndexes: number[];
  creditBytes: number;
  pumping: boolean;
};

type ReceiverStream = {
  peerId: string;
  assetId: string;
  assetKind: AssetKind;
  generation: number;
  totalUnits: number;
  priority: "critical" | "playback-fill" | "bulk";
  maxReplicas: number;
  wanted: Set<number>;
  lastProgressAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

export class AssetTransferManager {
  private readonly providers = new Map<string, Map<string, AssetAvailabilityAnnouncement>>();
  private readonly producers = new Map<string, ProducerStream>();
  private readonly receivers = new Map<string, ReceiverStream>();
  private readonly fragments = new AssetFragmentTracker();
  private readonly integrityFailures = new Map<string, number>();
  private sequence = 0;

  constructor(private readonly callbacks: {
    sendControl: (peerId: string, message: AssetStreamMessage) => void;
    sendBinary: (peerId: string, kind: AssetKind, payload: ArrayBuffer) => void;
    resolveLocalUnit: (assetId: string, unitIndex: number) => Promise<LocalAssetUnit | null>;
    persistInboundUnit: (
      peerId: string,
      descriptor: AssetUnitDescriptor,
      payload: ArrayBuffer
    ) => Promise<void>;
    onUnitPersisted?: (input: { peerId: string; descriptor: AssetUnitDescriptor; payloadBytes: number }) => void;
    onStreamReset?: (input: { peerId: string; assetId: string; unitIndexes: number[]; reason: string }) => void;
  }) {}

  setProvider(announcement: AssetAvailabilityAnnouncement) {
    const assetProviders = this.providers.get(announcement.assetId) ?? new Map();
    assetProviders.set(announcement.ownerPeerId, announcement);
    this.providers.set(announcement.assetId, assetProviders);
  }

  removeProvider(assetId: string, peerId: string) {
    const providers = this.providers.get(assetId);
    providers?.delete(peerId);
    if (providers?.size === 0) {
      this.providers.delete(assetId);
    }
    for (const [streamId, stream] of this.receivers.entries()) {
      if (stream.assetId === assetId && stream.peerId === peerId) {
        this.resetReceiver(streamId, "peer-closed");
      }
    }
  }

  removePeer(peerId: string) {
    for (const assetId of [...this.providers.keys()]) {
      this.removeProvider(assetId, peerId);
    }
  }

  cancel(assetId: string) {
    for (const [streamId, receiver] of [...this.receivers.entries()]) {
      if (receiver.assetId === assetId) {
        this.resetReceiver(streamId, "superseded");
      }
    }
  }

  request(input: {
    assetId: string;
    assetKind: AssetKind;
    unitIndexes: number[];
    totalUnits: number;
    priority: "critical" | "playback-fill" | "bulk";
    preferredPeerId?: string | null;
    maxReplicas?: number;
  }) {
    const wanted = [...new Set(input.unitIndexes)]
      .filter((index) => index >= 0 && index < input.totalUnits)
      .sort((left, right) => left - right);
    if (wanted.length === 0) {
      return false;
    }
    const candidates = [...(this.providers.get(input.assetId)?.values() ?? [])]
      .filter((provider) => provider.assetKind === input.assetKind)
      .sort((left, right) => {
        const leftPreferred = left.ownerPeerId === input.preferredPeerId ? 0 : 1;
        const rightPreferred = right.ownerPeerId === input.preferredPeerId ? 0 : 1;
        return leftPreferred - rightPreferred || left.ownerPeerId.localeCompare(right.ownerPeerId);
      });
    const assignments = new Map<string, number[]>();
    const replicas = input.priority === "critical" ? Math.max(1, input.maxReplicas ?? 2) : 1;
    for (const unitIndex of wanted) {
      const activePeers = this.activeReceiverPeers(input.assetId, unitIndex);
      if (activePeers.size >= replicas) {
        continue;
      }
      const providers = candidates
        .filter((candidate) =>
          candidate.availableRanges.some(
            (range) => range.start <= unitIndex && range.end >= unitIndex
          )
        )
        .filter((candidate) => !activePeers.has(candidate.ownerPeerId))
        .slice(0, replicas - activePeers.size);
      for (const provider of providers) {
        const indexes = assignments.get(provider.ownerPeerId) ?? [];
        indexes.push(unitIndex);
        assignments.set(provider.ownerPeerId, indexes);
      }
    }
    for (const [peerId, unitIndexes] of assignments.entries()) {
      this.openReceiverStream({ ...input, peerId, unitIndexes });
    }
    return assignments.size > 0;
  }

  async handleChannelMessage(peerId: string, data: unknown) {
    try {
      if (typeof data === "string") {
        let raw: unknown;
        try {
          raw = JSON.parse(data);
        } catch {
          return false;
        }
        const parsed = assetStreamMessageSchema.safeParse(raw);
        if (!parsed.success) {
          return false;
        }
        await this.handleControl(peerId, parsed.data);
        return true;
      }
      if (!(data instanceof ArrayBuffer) || !isAssetUnitFrame(data)) {
        return false;
      }
      await this.handleFrame(peerId, data);
      return true;
    } catch {
      // DataChannels are peer-controlled input. A malformed frame must not
      // become an unhandled promise rejection or interrupt the receive loop.
      return false;
    }
  }

  clear() {
    for (const receiver of this.receivers.values()) {
      clearTimeout(receiver.timeoutId);
    }
    this.receivers.clear();
    this.producers.clear();
    this.providers.clear();
    this.integrityFailures.clear();
    this.fragments.clear();
  }

  private openReceiverStream(input: {
    peerId: string;
    assetId: string;
    assetKind: AssetKind;
    unitIndexes: number[];
    totalUnits: number;
    priority: "critical" | "playback-fill" | "bulk";
    maxReplicas?: number;
  }) {
    const generation = 0;
    const streamId = `asset:${input.assetId.slice(0, 12)}:${++this.sequence}`;
    const timeoutId = setTimeout(() => this.resetReceiver(streamId, "timeout"), 5_000);
    this.receivers.set(streamId, {
      peerId: input.peerId,
      assetId: input.assetId,
      assetKind: input.assetKind,
      generation,
      totalUnits: input.totalUnits,
      priority: input.priority,
      maxReplicas: input.priority === "critical" ? Math.max(1, input.maxReplicas ?? 2) : 1,
      wanted: new Set(input.unitIndexes),
      lastProgressAt: Date.now(),
      timeoutId
    });
    this.callbacks.sendControl(input.peerId, {
      kind: "asset-stream-open",
      protocolVersion: 4,
      streamId,
      assetId: input.assetId,
      assetKind: input.assetKind,
      generation,
      priority: input.priority,
      ranges: unitIndexesToRanges(input.unitIndexes, input.totalUnits),
      initialCreditBytes:
        input.priority === "critical" ? 512 * 1024 : input.priority === "playback-fill" ? 1024 * 1024 : 4 * 1024 * 1024
    });
  }

  private async handleControl(peerId: string, message: AssetStreamMessage) {
    if (message.kind === "asset-stream-open") {
      this.producers.set(message.streamId, {
        peerId,
        streamId: message.streamId,
        generation: message.generation,
        assetId: message.assetId,
        assetKind: message.assetKind,
        unitIndexes: rangesToUnitIndexes(message.ranges),
        creditBytes: message.initialCreditBytes,
        pumping: false
      });
      await this.pumpProducer(message.streamId);
      return;
    }
    const producer = this.producers.get(message.streamId);
    const matchesProducer =
      producer?.peerId === peerId && producer.generation === message.generation;
    if (message.kind === "asset-stream-credit" && producer && matchesProducer) {
      producer.creditBytes += message.creditBytes;
      await this.pumpProducer(message.streamId);
      return;
    }
    if (message.kind === "asset-stream-nack" && producer && matchesProducer) {
      if (!producer.unitIndexes.includes(message.unitIndex)) {
        producer.unitIndexes.unshift(message.unitIndex);
      }
      producer.creditBytes += message.refundCreditBytes;
      await this.pumpProducer(message.streamId);
      return;
    }
    if (message.kind === "asset-stream-reset") {
      if (producer && matchesProducer) {
        this.producers.delete(message.streamId);
      }
      const receiver = this.receivers.get(message.streamId);
      if (
        receiver &&
        receiver.peerId === peerId &&
        receiver.generation === message.generation
      ) {
        this.resetReceiver(message.streamId, message.reason, false);
      }
    }
  }

  private async pumpProducer(streamId: string) {
    const stream = this.producers.get(streamId);
    if (!stream || stream.pumping) {
      return;
    }
    stream.pumping = true;
    try {
      while (stream.unitIndexes.length > 0) {
        const unitIndex = stream.unitIndexes[0]!;
        const unit = await this.callbacks.resolveLocalUnit(stream.assetId, unitIndex);
        if (!unit) {
          stream.unitIndexes.shift();
          continue;
        }
        if (unit.payload.byteLength > stream.creditBytes) {
          break;
        }
        stream.unitIndexes.shift();
        stream.creditBytes -= unit.payload.byteLength;
        for (const frame of encodeAssetUnitFrames({
          streamId: stream.streamId,
          generation: stream.generation,
          descriptor: unit.descriptor,
          payload: unit.payload
        })) {
          this.callbacks.sendBinary(stream.peerId, stream.assetKind, frame);
        }
      }
      if (stream.unitIndexes.length === 0) {
        this.producers.delete(streamId);
      }
    } finally {
      stream.pumping = false;
    }
  }

  private async handleFrame(peerId: string, data: ArrayBuffer) {
    const frame = decodeAssetUnitFrame(data);
    const receiver = this.receivers.get(frame.header.streamId);
    if (
      !receiver ||
      receiver.peerId !== peerId ||
      receiver.assetId !== frame.header.assetId ||
      receiver.assetKind !== frame.header.assetKind ||
      receiver.generation !== frame.header.generation ||
      !receiver.wanted.has(frame.header.unitIndex)
    ) {
      return;
    }
    receiver.lastProgressAt = Date.now();
    clearTimeout(receiver.timeoutId);
    receiver.timeoutId = setTimeout(
      () => this.resetReceiver(frame.header.streamId, "timeout"),
      5_000
    );
    const complete = this.fragments.add(peerId, frame);
    if (!complete) {
      return;
    }
    try {
      await this.callbacks.persistInboundUnit(peerId, complete.descriptor, complete.payload);
      this.integrityFailures.delete(`${complete.descriptor.assetId}:${peerId}`);
      receiver.wanted.delete(complete.descriptor.unitIndex);
      this.completeRedundantReceivers(
        frame.header.streamId,
        complete.descriptor.assetId,
        complete.descriptor.unitIndex
      );
      this.callbacks.sendControl(peerId, {
        kind: "asset-stream-ack",
        protocolVersion: 4,
        streamId: frame.header.streamId,
        generation: receiver.generation,
        unitIndex: complete.descriptor.unitIndex,
        storedBytes: complete.payload.byteLength
      });
      this.callbacks.sendControl(peerId, {
        kind: "asset-stream-credit",
        protocolVersion: 4,
        streamId: frame.header.streamId,
        generation: receiver.generation,
        unitIndex: complete.descriptor.unitIndex,
        creditBytes: complete.payload.byteLength
      });
      this.callbacks.onUnitPersisted?.({
        peerId,
        descriptor: complete.descriptor,
        payloadBytes: complete.payload.byteLength
      });
      if (receiver.wanted.size === 0) {
        clearTimeout(receiver.timeoutId);
        this.receivers.delete(frame.header.streamId);
      }
    } catch (error) {
      const integrityFailure = error instanceof Error && error.message.includes("Merkle");
      this.callbacks.sendControl(peerId, {
        kind: "asset-stream-nack",
        protocolVersion: 4,
        streamId: frame.header.streamId,
        generation: receiver.generation,
        unitIndex: complete.descriptor.unitIndex,
        reason: integrityFailure
          ? "proof-mismatch"
          : "storage-failure",
        refundCreditBytes: complete.payload.byteLength
      });
      if (integrityFailure) {
        const failureKey = `${complete.descriptor.assetId}:${peerId}`;
        const failures = (this.integrityFailures.get(failureKey) ?? 0) + 1;
        this.integrityFailures.set(failureKey, failures);
        if (failures >= 2) {
          this.resetReceiver(frame.header.streamId, "protocol-error");
          this.removeProvider(complete.descriptor.assetId, peerId);
        }
      }
    }
  }

  private resetReceiver(streamId: string, reason: string, notify = true) {
    const receiver = this.receivers.get(streamId);
    if (!receiver) {
      return;
    }
    clearTimeout(receiver.timeoutId);
    this.receivers.delete(streamId);
    if (reason === "timeout") {
      const providers = this.providers.get(receiver.assetId);
      providers?.delete(receiver.peerId);
      if (providers?.size === 0) {
        this.providers.delete(receiver.assetId);
      }
    }
    if (notify) {
      this.callbacks.sendControl(receiver.peerId, {
        kind: "asset-stream-reset",
        protocolVersion: 4,
        streamId,
        generation: receiver.generation,
        reason:
          reason === "peer-closed" ||
          reason === "superseded" ||
          reason === "protocol-error"
            ? reason
            : "timeout"
      });
    }
    this.callbacks.onStreamReset?.({
      peerId: receiver.peerId,
      assetId: receiver.assetId,
      unitIndexes: [...receiver.wanted],
      reason
    });
    if (reason === "timeout" || reason === "peer-closed" || reason === "protocol-error") {
      const unitIndexes = [...receiver.wanted];
      queueMicrotask(() => {
        this.request({
          assetId: receiver.assetId,
          assetKind: receiver.assetKind,
          unitIndexes,
          totalUnits: receiver.totalUnits,
          priority: receiver.priority,
          maxReplicas: receiver.maxReplicas
        });
      });
    }
  }

  private activeReceiverPeers(assetId: string, unitIndex: number) {
    return new Set(
      [...this.receivers.values()]
        .filter((receiver) => receiver.assetId === assetId && receiver.wanted.has(unitIndex))
        .map((receiver) => receiver.peerId)
    );
  }

  private completeRedundantReceivers(
    completedStreamId: string,
    assetId: string,
    unitIndex: number
  ) {
    for (const [streamId, receiver] of this.receivers.entries()) {
      if (
        streamId === completedStreamId ||
        receiver.assetId !== assetId ||
        !receiver.wanted.delete(unitIndex)
      ) {
        continue;
      }
      if (receiver.wanted.size === 0) {
        this.resetReceiver(streamId, "superseded");
      }
    }
  }
}
