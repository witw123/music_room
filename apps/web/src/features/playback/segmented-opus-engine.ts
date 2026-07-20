"use client";

import type { AudioAssetUnitRecord } from "@/lib/indexeddb";
import type { PlaybackAssetManifest, PlaybackSnapshot } from "@music-room/shared";
import { roomAudioOutput } from "./room-audio-output";
import {
  playbackUnitIndexAt,
  resolveStartupUnitIndexes
} from "./playback-segment-scheduler";

type ScheduledSource = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  revision: number;
};

type SyncInput = {
  manifest: PlaybackAssetManifest;
  playback: PlaybackSnapshot;
  serverNowMs: number;
  volume: number;
  getUnit: (unitIndex: number) => Promise<AudioAssetUnitRecord | null>;
};

type SyncResult = {
  state: "idle" | "awaiting-unlock" | "paused" | "buffering" | "live" | "ended";
  bufferedUnits: number;
};

export type SourceHealthState =
  | "source-ready"
  | "source-underrun"
  | "source-silent"
  | "source-ended";

const scheduleLeadSeconds = 0.08;
const startupBufferMs = 4_000;
const targetBufferedAheadMs = 12_000;
const scheduleAheadMs = 20_000;
const underrunGuardMs = 1_000;
const fadeDurationSeconds = 0.02;
const assetOperationTimeoutMs = 5_000;

export class SegmentedOpusEngine {
  private timelineKey: string | null = null;
  private readonly scheduled = new Map<number, ScheduledSource>();
  private readonly completed = new Set<number>();
  private readonly decoded = new Map<number, Promise<AudioBuffer>>();
  private readonly unitRecords = new Map<number, AudioAssetUnitRecord>();
  private wasmDecoder: import("ogg-opus-decoder").OggOpusDecoder | null = null;
  private mixBus: GainNode | null = null;
  private playbackGate: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private broadcastGain: GainNode | null = null;
  private limiterInputAnalyser: AnalyserNode | null = null;
  private broadcastAnalyser: AnalyserNode | null = null;
  private masterGainContext: AudioContext | null = null;
  private contextAnchorTime: number | null = null;
  private playbackAnchorPositionMs = 0;
  private timelineStarted = false;
  private revision = 0;
  private destroyed = false;
  private sourceHealth: SourceHealthState = "source-underrun";
  private sourceEnergy = 0;
  private decodedPeak = 0;
  private decodedRms = 0;
  private maxSampleDelta = 0;
  private limiterInputPeak = 0;
  private limiterInputRms = 0;
  private limiterInputMaxSampleDelta = 0;
  private limiterOutputPeak = 0;
  private limiterOutputRms = 0;
  private limiterOutputMaxSampleDelta = 0;
  private underrunCount = 0;
  private lastUnderrunAt: string | null = null;
  private lastDecodeError: string | null = null;
  private syncInFlight: Promise<SyncResult> | null = null;
  private queuedSyncInput: SyncInput | null = null;
  private timelineGeneration = 0;

  async sync(input: SyncInput): Promise<SyncResult> {
    if (this.syncInFlight) {
      this.queuedSyncInput = input;
      return this.syncInFlight;
    }

    const run = this.runSyncLoop(input);
    this.syncInFlight = run;
    try {
      return await run;
    } finally {
      if (this.syncInFlight === run) {
        this.syncInFlight = null;
      }
    }
  }

  private async runSyncLoop(input: SyncInput): Promise<SyncResult> {
    let nextInput: SyncInput | null = input;
    let result: SyncResult = { state: "idle", bufferedUnits: 0 };
    while (nextInput && !this.destroyed) {
      result = await this.syncOnce(nextInput);
      nextInput = this.queuedSyncInput;
      this.queuedSyncInput = null;
    }
    return result;
  }

  private async syncOnce(input: SyncInput): Promise<SyncResult> {
    if (this.destroyed) {
      return { state: "idle" as const, bufferedUnits: 0 };
    }
    if (input.playback.status !== "playing" || !input.playback.startAt) {
      this.resetTimeline({ preserveCache: true });
      this.pruneDecodedCache(
        playbackUnitIndexAt(input.manifest, input.playback.positionMs),
        input.manifest.segmentDurationMs
      );
      this.sourceHealth = "source-ended";
      return { state: "paused" as const, bufferedUnits: 0 };
    }

    const timelineKey = [
      input.manifest.assetId,
      input.playback.mediaEpoch,
      input.playback.startAt
    ].join(":");
    if (timelineKey !== this.timelineKey) {
      // Pause, resume, seek, and media changes create a new room timeline.
      // Playback-order changes only bump the room revision, so keep audio
      // already scheduled for the current timeline intact.
      this.resetTimeline({ preserveCache: true });
      this.timelineKey = timelineKey;
      this.timelineGeneration += 1;
    }
    const generation = this.timelineGeneration;

    const context = roomAudioOutput.getSharedAudioContext();
    if (!context || context.state !== "running") {
      this.sourceHealth = "source-silent";
      return { state: "awaiting-unlock" as const, bufferedUnits: 0 };
    }
    this.ensureMasterGain(context, input.volume);

    const startAtMs = Date.parse(input.playback.startAt);
    const elapsedMs = Math.max(0, input.serverNowMs - startAtMs);
    const roomPositionMs = Math.min(
      input.manifest.durationMs,
      input.playback.positionMs + elapsedMs
    );
    const currentIndex = playbackUnitIndexAt(input.manifest, roomPositionMs);
    this.pruneDecodedCache(currentIndex, input.manifest.segmentDurationMs);
    if (
      roomPositionMs >= input.manifest.durationMs &&
      this.scheduled.size === 0 &&
      this.completed.has(input.manifest.unitCount - 1)
    ) {
      this.sourceHealth = "source-ended";
      return { state: "ended" as const, bufferedUnits: 0 };
    }
    const decodeAheadUnitCount = Math.max(
      1,
      Math.ceil(scheduleAheadMs / input.manifest.segmentDurationMs)
    );
    const unitIndexes = Array.from(
      {
        length: Math.min(
          decodeAheadUnitCount,
          input.manifest.unitCount - currentIndex
        )
      },
      (_, offset) => currentIndex + offset
    );
    // IndexedDB reads are considerably more expensive than the in-memory
    // scheduler tick. Re-reading the same twelve units every 100ms can starve
    // decoding on slower devices and make the source stream go silent even
    // though the audio is already cached locally.
    const units = await Promise.all(unitIndexes.map(async (unitIndex) => {
      const cached = this.unitRecords.get(unitIndex);
      if (cached) {
        return cached;
      }
      const loaded = await withTimeout(
        input.getUnit(unitIndex),
        assetOperationTimeoutMs,
        "Audio asset read timed out."
      );
      if (loaded) {
        this.unitRecords.set(unitIndex, loaded);
      }
      return loaded;
    }));
    if (this.destroyed || this.timelineKey !== timelineKey || generation !== this.timelineGeneration) {
      return { state: "idle" as const, bufferedUnits: 0 };
    }

    const contiguousUnits: AudioAssetUnitRecord[] = [];
    for (const unit of units) {
      if (!unit) break;
      contiguousUnits.push(unit);
    }
    const startupCount = resolveStartupUnitIndexes({
      manifest: input.manifest,
      positionMs: roomPositionMs,
      startupBufferMs
    }).length;
    const requiredUnits = this.timelineStarted ? 1 : startupCount;
    if (contiguousUnits.length < requiredUnits) {
      if (
        this.timelineStarted &&
        !this.scheduled.has(currentIndex) &&
        roomPositionMs + underrunGuardMs < input.manifest.durationMs
      ) {
        this.enterUnderrun();
      }
      this.sourceHealth = "source-underrun";
      return { state: "buffering" as const, bufferedUnits: contiguousUnits.length };
    }

    if (!this.timelineStarted) {
      const currentUnit = contiguousUnits[0]!;
      let currentDecoded: AudioBuffer;
      try {
        currentDecoded = await this.getDecodedUnitWithRetry(context, currentUnit);
      } catch {
        this.enterUnderrun();
        return { state: "buffering" as const, bufferedUnits: 0 };
      }
      if (this.destroyed || this.timelineKey !== timelineKey || generation !== this.timelineGeneration) {
        return { state: "idle" as const, bufferedUnits: 0 };
      }
      this.establishTimelineAnchor({
        context,
        manifest: input.manifest,
        playback: input.playback,
        serverNowMs: input.serverNowMs,
        startAtMs,
        roomPositionMs,
        currentUnit
      });
      this.scheduleUnit({
        context,
        decoded: currentDecoded,
        unit: currentUnit,
        roomPositionMs,
        currentIndex
      });
    }

    const decodeTargets = contiguousUnits.filter(
      (unit) => !this.scheduled.has(unit.unitIndex) && !this.completed.has(unit.unitIndex)
    );
    const decodeResults = await Promise.allSettled(
      decodeTargets.map((unit) => this.getDecodedUnitWithRetry(context, unit))
    );
    if (this.destroyed || this.timelineKey !== timelineKey || generation !== this.timelineGeneration) {
      return { state: "idle" as const, bufferedUnits: 0 };
    }

    for (const [index, unit] of decodeTargets.entries()) {
      if (decodeResults[index]?.status === "rejected") {
        continue;
      }
      const decoded = await this.decoded.get(unit.unitIndex)!;
      this.scheduleUnit({
        context,
        decoded,
        unit,
        roomPositionMs,
        currentIndex
      });
    }

    const bufferedUnits = this.countContiguousScheduledUnits(currentIndex);
    this.fadePlaybackGateTo(1);
    this.setBroadcastTrackEnabled(true);
    this.sampleSourceEnergy(context);
    const trackState = roomAudioOutput.getBroadcastStream()?.getAudioTracks()[0]?.readyState;
    // A live RTP track may legitimately carry zero-energy PCM during a quiet
    // or silent part of a song. Energy is useful telemetry, but it cannot
    // distinguish valid silence from a broken media path.
    this.sourceHealth = trackState === "live" ? "source-ready" : "source-silent";
    return {
      state: bufferedUnits * input.manifest.segmentDurationMs >= Math.min(
        targetBufferedAheadMs,
        Math.max(0, input.manifest.durationMs - roomPositionMs)
      )
        ? "live" as const
        : "buffering" as const,
      bufferedUnits,
    };
  }

  setVolume(volume: number) {
    if (this.masterGain) {
      rampAudioParam(this.masterGain.gain, normalizeVolume(volume), this.masterGainContext);
    }
  }

  destroy() {
    this.destroyed = true;
    this.queuedSyncInput = null;
    this.timelineGeneration += 1;
    this.resetTimeline();
    this.wasmDecoder?.free();
    this.wasmDecoder = null;
    this.disposeOutputGraph();
  }

  private establishTimelineAnchor(input: {
    context: AudioContext;
    manifest: PlaybackAssetManifest;
    playback: PlaybackSnapshot;
    serverNowMs: number;
    startAtMs: number;
    roomPositionMs: number;
    currentUnit: AudioAssetUnitRecord;
  }) {
    this.playbackAnchorPositionMs = input.playback.positionMs;
    const serverAnchor =
      input.context.currentTime + (input.startAtMs - input.serverNowMs) / 1000;
    const roomPositionContextTime =
      serverAnchor + (input.roomPositionMs - input.playback.positionMs) / 1000;
    this.contextAnchorTime = roomPositionContextTime < input.context.currentTime + scheduleLeadSeconds
      ? input.context.currentTime + scheduleLeadSeconds -
        (input.roomPositionMs - input.playback.positionMs) / 1000
      : serverAnchor;
    this.timelineStarted = true;
  }

  private scheduleUnit(input: {
    context: AudioContext;
    decoded: AudioBuffer;
    unit: AudioAssetUnitRecord;
    roomPositionMs: number;
    currentIndex: number;
  }) {
    if (this.contextAnchorTime === null || !this.masterGain) return;
    const segmentStartMs = input.unit.startMs ?? input.unit.unitIndex * 2_000;
    const desiredSegmentStart =
      this.contextAnchorTime + (segmentStartMs - this.playbackAnchorPositionMs) / 1000;
    const timelineOffset = input.unit.unitIndex === input.currentIndex
      ? Math.max(0, (input.roomPositionMs - segmentStartMs) / 1000)
      : 0;
    const earliestStart = input.context.currentTime + scheduleLeadSeconds;
    const desiredAudibleStart = desiredSegmentStart + timelineOffset;
    const lateBy = Math.max(0, earliestStart - desiredAudibleStart);
    const offsetSeconds = timelineOffset + lateBy;
    if (offsetSeconds >= input.decoded.duration) {
      this.completed.add(input.unit.unitIndex);
      return;
    }

    if (
      this.scheduled.has(input.unit.unitIndex) ||
      this.completed.has(input.unit.unitIndex)
    ) {
      return;
    }
    const source = input.context.createBufferSource();
    const sourceGain = input.context.createGain();
    source.buffer = input.decoded;
    source.playbackRate.value = 1;
    sourceGain.gain.value = 0;
    source.connect(sourceGain);
    const mixBus = this.mixBus ?? this.masterGain;
    if (!mixBus) {
      source.disconnect();
      sourceGain.disconnect();
      return;
    }
    sourceGain.connect(mixBus);
    const revision = this.revision;
    source.onended = () => {
      if (revision !== this.revision) return;
      this.scheduled.delete(input.unit.unitIndex);
      this.completed.add(input.unit.unitIndex);
      this.decoded.delete(input.unit.unitIndex);
      source.disconnect();
      sourceGain.disconnect();
    };
    const startAt = Math.max(earliestStart, desiredAudibleStart);
    if (input.unit.unitIndex === input.currentIndex) {
      // Only a timeline entry point needs a fade-in. Reapplying it to every
      // 2s continuation creates a periodic dip even when the buffers are
      // sample-contiguous.
      const fadeInEnd = startAt + fadeDurationSeconds;
      setAudioParamValueAt(sourceGain.gain, 0, startAt);
      rampAudioParamTo(sourceGain.gain, 1, fadeInEnd);
    } else {
      setAudioParamValueAt(sourceGain.gain, 1, startAt);
    }
    source.start(startAt, offsetSeconds);
    this.scheduled.set(input.unit.unitIndex, { source, gain: sourceGain, revision });
  }

  private getDecodedUnit(
    context: AudioContext,
    unit: AudioAssetUnitRecord
  ) {
    const existing = this.decoded.get(unit.unitIndex);
    if (existing) return existing;
    const decoding = this.decodeUnit(context, unit).catch((error) => {
      if (this.decoded.get(unit.unitIndex) === decoding) {
        this.decoded.delete(unit.unitIndex);
      }
      throw error;
    });
    this.decoded.set(unit.unitIndex, decoding);
    return decoding;
  }

  getSourceHealth() {
    return {
      state: this.sourceHealth,
      energy: this.sourceEnergy,
      decodedPeak: this.decodedPeak,
      decodedRms: this.decodedRms,
      maxSampleDelta: this.maxSampleDelta,
      limiterInputPeak: this.limiterInputPeak,
      limiterInputRms: this.limiterInputRms,
      limiterInputMaxSampleDelta: this.limiterInputMaxSampleDelta,
      limiterOutputPeak: this.limiterOutputPeak,
      limiterOutputRms: this.limiterOutputRms,
      limiterOutputMaxSampleDelta: this.limiterOutputMaxSampleDelta,
      underrunCount: this.underrunCount,
      lastUnderrunAt: this.lastUnderrunAt,
      lastDecodeError: this.lastDecodeError,
      trackState: roomAudioOutput.getBroadcastStream()?.getAudioTracks()[0]?.readyState ?? "ended",
      audioContextState: this.masterGainContext?.state ?? null
    } as const;
  }

  private getDecodedUnitWithRetry(
    context: AudioContext,
    unit: AudioAssetUnitRecord
  ) {
    return this.getDecodedUnit(context, unit).catch(async (firstError) => {
      this.lastDecodeError = formatDecodeError(firstError);
      this.decoded.delete(unit.unitIndex);
      try {
        return await this.getDecodedUnit(context, unit);
      } catch (retryError) {
        this.lastDecodeError = formatDecodeError(retryError);
        throw retryError;
      }
    });
  }

  private async decodeUnit(
    context: AudioContext,
    unit: AudioAssetUnitRecord
  ) {
    let decoded: AudioBuffer;
    try {
      decoded = await withTimeout(
        context.decodeAudioData(unit.payload.slice(0)),
        assetOperationTimeoutMs,
        "Audio asset decode timed out."
      );
    } catch {
      const decoder = await this.getWasmDecoder();
      const result = await withTimeout(
        decoder.decodeFile(new Uint8Array(unit.payload)),
        assetOperationTimeoutMs,
        "WASM audio asset decode timed out."
      );
      decoded = context.createBuffer(
        result.channelData.length,
        result.samplesDecoded,
        result.sampleRate
      );
      result.channelData.forEach((channel, index) =>
        decoded.copyToChannel(Float32Array.from(channel), index)
      );
    }
    // @audio/opus-encode writes an 80ms OpusHead pre-skip and each encoded
    // unit includes the matching seek preroll. Native and WASM Opus decoders
    // already remove that pre-skip. Applying descriptor trim metadata here a
    // second time drops 80ms at every 2s boundary and creates audible gaps.
    return decoded;
  }

  private async getWasmDecoder() {
    if (!this.wasmDecoder) {
      const { OggOpusDecoder } = await import("ogg-opus-decoder");
      this.wasmDecoder = new OggOpusDecoder();
      await this.wasmDecoder.ready;
    }
    return this.wasmDecoder;
  }

  private ensureMasterGain(context: AudioContext, volume: number) {
    if (this.masterGain && this.masterGainContext === context) {
      rampAudioParam(this.masterGain.gain, normalizeVolume(volume), context);
      return;
    }
    this.disposeOutputGraph();
    this.mixBus = context.createGain();
    this.playbackGate = context.createGain();
    this.playbackGate.gain.value = 0;
    this.mixBus.connect(this.playbackGate);
    this.limiter = typeof context.createDynamicsCompressor === "function"
      ? context.createDynamicsCompressor()
      : null;
    if (this.limiter) {
      this.limiter.threshold.value = -1;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.05;
      if (typeof context.createAnalyser === "function") {
        this.limiterInputAnalyser = context.createAnalyser();
        this.limiterInputAnalyser.fftSize = 1024;
        this.playbackGate.connect(this.limiterInputAnalyser);
        this.limiterInputAnalyser.connect(this.limiter);
      } else {
        this.playbackGate.connect(this.limiter);
      }
    }
    const output = this.limiter ?? this.playbackGate;
    this.masterGain = context.createGain();
    this.masterGain.gain.value = normalizeVolume(volume);
    output.connect(this.masterGain);
    this.masterGain.connect(context.destination);
    const broadcastDestination = roomAudioOutput.getBroadcastDestination(context);
    if (broadcastDestination) {
      this.broadcastGain = context.createGain();
      this.broadcastGain.gain.value = 1;
      this.broadcastAnalyser = context.createAnalyser();
      this.broadcastAnalyser.fftSize = 1024;
      output.connect(this.broadcastGain);
      this.broadcastGain.connect(this.broadcastAnalyser);
      this.broadcastAnalyser.connect(broadcastDestination);
    } else {
      this.broadcastGain = null;
    }
    this.masterGainContext = context;
  }

  private countContiguousScheduledUnits(currentIndex: number) {
    let count = 0;
    for (let unitIndex = currentIndex; ; unitIndex += 1) {
      if (!this.scheduled.has(unitIndex) && !this.completed.has(unitIndex)) break;
      count += 1;
    }
    return count;
  }

  private pruneDecodedCache(currentIndex: number, segmentDurationMs: number) {
    const retainAheadUnitCount = Math.max(1, Math.ceil(scheduleAheadMs / segmentDurationMs) + 1);
    const lastRetainedIndex = currentIndex + retainAheadUnitCount;
    for (const unitIndex of this.decoded.keys()) {
      if (unitIndex < currentIndex || unitIndex > lastRetainedIndex) {
        this.decoded.delete(unitIndex);
      }
    }
  }

  private enterUnderrun() {
    this.underrunCount += 1;
    this.lastUnderrunAt = new Date().toISOString();
    this.stopScheduledSources();
    this.completed.clear();
    this.contextAnchorTime = null;
    this.timelineStarted = false;
    this.sourceHealth = "source-underrun";
    this.fadePlaybackGateTo(0);
  }

  private setBroadcastTrackEnabled(enabled: boolean) {
    for (const track of roomAudioOutput.getBroadcastStream()?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
  }

  private sampleSourceEnergy(context: AudioContext) {
    const outputAnalyser = this.broadcastAnalyser;
    if (!outputAnalyser || context.state !== "running") {
      this.sourceEnergy = 0;
      return;
    }
    const outputMetrics = readAnalyserMetrics(outputAnalyser);
    const inputMetrics = this.limiterInputAnalyser
      ? readAnalyserMetrics(this.limiterInputAnalyser)
      : outputMetrics;
    this.sourceEnergy = outputMetrics.rms;
    this.decodedRms = outputMetrics.rms;
    this.decodedPeak = outputMetrics.peak;
    this.maxSampleDelta = outputMetrics.maxSampleDelta;
    this.limiterInputPeak = inputMetrics.peak;
    this.limiterInputRms = inputMetrics.rms;
    this.limiterInputMaxSampleDelta = inputMetrics.maxSampleDelta;
    this.limiterOutputPeak = outputMetrics.peak;
    this.limiterOutputRms = outputMetrics.rms;
    this.limiterOutputMaxSampleDelta = outputMetrics.maxSampleDelta;
  }

  private stopScheduledSources() {
    this.revision += 1;
    const scheduled = [...this.scheduled.values()];
    this.scheduled.clear();
    const context = this.masterGainContext;
    const now = context?.currentTime ?? 0;
    const stopAt = now + fadeDurationSeconds;
    for (const scheduledSource of scheduled) {
      const { source, gain: sourceGain } = scheduledSource;
      source.onended = null;
      setAudioParamValueAt(sourceGain.gain, sourceGain.gain.value, now);
      rampAudioParamTo(sourceGain.gain, 0, stopAt);
      const cleanup = () => {
        source.disconnect();
        sourceGain.disconnect();
      };
      source.onended = cleanup;
      try {
        source.stop(stopAt);
      } catch {
        // The source may already have ended.
        cleanup();
      }
    }
  }

  private resetTimeline(options: { preserveCache?: boolean } = {}) {
    this.stopScheduledSources();
    this.completed.clear();
    this.timelineKey = null;
    this.contextAnchorTime = null;
    this.playbackAnchorPositionMs = 0;
    this.timelineStarted = false;
    if (!options.preserveCache) {
      this.decoded.clear();
      this.unitRecords.clear();
    }
    this.sourceHealth = "source-underrun";
    this.sourceEnergy = 0;
    this.decodedPeak = 0;
    this.decodedRms = 0;
    this.maxSampleDelta = 0;
    this.limiterInputPeak = 0;
    this.limiterInputRms = 0;
    this.limiterInputMaxSampleDelta = 0;
    this.limiterOutputPeak = 0;
    this.limiterOutputRms = 0;
    this.limiterOutputMaxSampleDelta = 0;
    this.lastDecodeError = null;
    this.fadePlaybackGateTo(0);
  }

  private fadePlaybackGateTo(value: number) {
    if (!this.playbackGate || !this.masterGainContext) return;
    rampAudioParam(this.playbackGate.gain, value, this.masterGainContext);
  }

  private disposeOutputGraph() {
    this.mixBus?.disconnect();
    this.playbackGate?.disconnect();
    this.limiter?.disconnect();
    this.masterGain?.disconnect();
    this.broadcastGain?.disconnect();
    this.limiterInputAnalyser?.disconnect();
    this.broadcastAnalyser?.disconnect();
    this.mixBus = null;
    this.playbackGate = null;
    this.limiter = null;
    this.masterGain = null;
    this.broadcastGain = null;
    this.limiterInputAnalyser = null;
    this.broadcastAnalyser = null;
    this.masterGainContext = null;
  }
}

function normalizeVolume(volume: number) {
  return Math.min(1, Math.max(0, volume));
}

function formatDecodeError(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : String(error);
}

function readAnalyserMetrics(analyser: AnalyserNode) {
  const values = new Float32Array(analyser.fftSize);
  if (typeof analyser.getFloatTimeDomainData === "function") {
    analyser.getFloatTimeDomainData(values);
  } else {
    const bytes = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(bytes);
    for (let index = 0; index < bytes.length; index += 1) {
      values[index] = (bytes[index]! - 128) / 128;
    }
  }

  let sum = 0;
  let peak = 0;
  let maxSampleDelta = 0;
  let previous = 0;
  for (const value of values) {
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
    maxSampleDelta = Math.max(maxSampleDelta, Math.abs(value - previous));
    previous = value;
  }
  return {
    peak,
    rms: values.length > 0 ? Math.sqrt(sum / values.length) : 0,
    maxSampleDelta
  };
}

function setAudioParamValueAt(param: AudioParam, value: number, time: number) {
  if (typeof param.cancelScheduledValues === "function") {
    param.cancelScheduledValues(time);
  }
  if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
}

function rampAudioParamTo(param: AudioParam, value: number, time: number) {
  if (typeof param.linearRampToValueAtTime === "function") {
    param.linearRampToValueAtTime(value, time);
  } else {
    param.value = value;
  }
}

function rampAudioParam(param: AudioParam, value: number, context: AudioContext | null) {
  const now = context?.currentTime ?? 0;
  setAudioParamValueAt(param, param.value, now);
  rampAudioParamTo(param, value, now + fadeDurationSeconds);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
