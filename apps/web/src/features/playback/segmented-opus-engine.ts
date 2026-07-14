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
  revision: number;
};

export type SourceHealthState =
  | "source-ready"
  | "source-underrun"
  | "source-silent"
  | "source-ended";

const scheduleLeadSeconds = 0.04;
// Two-second units keep roughly 24-30 seconds of decoded audio available.
const decodeAheadUnitCount = 15;

export class SegmentedOpusEngine {
  private timelineKey: string | null = null;
  private readonly scheduled = new Map<number, ScheduledSource>();
  private readonly completed = new Set<number>();
  private readonly decoded = new Map<number, Promise<AudioBuffer>>();
  private readonly unitRecords = new Map<number, AudioAssetUnitRecord>();
  private wasmDecoder: import("ogg-opus-decoder").OggOpusDecoder | null = null;
  private masterGain: GainNode | null = null;
  private broadcastGain: GainNode | null = null;
  private broadcastAnalyser: AnalyserNode | null = null;
  private masterGainContext: AudioContext | null = null;
  private contextAnchorTime: number | null = null;
  private playbackAnchorPositionMs = 0;
  private timelineStarted = false;
  private revision = 0;
  private destroyed = false;
  private sourceHealth: SourceHealthState = "source-underrun";
  private sourceEnergy = 0;

  async sync(input: {
    manifest: PlaybackAssetManifest;
    playback: PlaybackSnapshot;
    serverNowMs: number;
    volume: number;
    getUnit: (unitIndex: number) => Promise<AudioAssetUnitRecord | null>;
  }) {
    if (this.destroyed) {
      return { state: "idle" as const, bufferedUnits: 0 };
    }
    if (input.playback.status !== "playing" || !input.playback.startAt) {
      this.resetTimeline();
      this.sourceHealth = "source-ended";
      return { state: "paused" as const, bufferedUnits: 0 };
    }

    const timelineKey = [
      input.manifest.assetId,
      input.playback.mediaEpoch,
      input.playback.startAt,
      input.playback.playbackRevision
    ].join(":");
    if (timelineKey !== this.timelineKey) {
      this.resetTimeline();
      this.timelineKey = timelineKey;
    }

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
    if (
      roomPositionMs >= input.manifest.durationMs &&
      this.scheduled.size === 0 &&
      this.completed.has(input.manifest.unitCount - 1)
    ) {
      this.sourceHealth = "source-ended";
      return { state: "ended" as const, bufferedUnits: 0 };
    }
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
      const loaded = await input.getUnit(unitIndex);
      if (loaded) {
        this.unitRecords.set(unitIndex, loaded);
      }
      return loaded;
    }));
    if (this.destroyed || this.timelineKey !== timelineKey) {
      return { state: "idle" as const, bufferedUnits: 0 };
    }

    const contiguousUnits: AudioAssetUnitRecord[] = [];
    for (const unit of units) {
      if (!unit) break;
      contiguousUnits.push(unit);
    }
    const startupCount = resolveStartupUnitIndexes({
      manifest: input.manifest,
      positionMs: roomPositionMs
    }).length;
    const requiredUnits = this.timelineStarted ? 1 : startupCount;
    if (contiguousUnits.length < requiredUnits) {
      if (this.timelineStarted && !this.scheduled.has(currentIndex)) {
        this.enterUnderrun();
      }
      this.sourceHealth = "source-underrun";
      this.setBroadcastTrackEnabled(false);
      return { state: "buffering" as const, bufferedUnits: contiguousUnits.length };
    }

    if (!this.timelineStarted) {
      const currentUnit = contiguousUnits[0]!;
      let currentDecoded: AudioBuffer;
      try {
        currentDecoded = await this.getDecodedUnitWithRetry(
          context,
          currentUnit,
          input.manifest.sampleRate
        );
      } catch {
        this.enterUnderrun();
        return { state: "buffering" as const, bufferedUnits: 0 };
      }
      if (this.destroyed || this.timelineKey !== timelineKey) {
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
      decodeTargets.map((unit) => this.getDecodedUnitWithRetry(
        context,
        unit,
        input.manifest.sampleRate
      ))
    );
    if (this.destroyed || this.timelineKey !== timelineKey) {
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
    this.setBroadcastTrackEnabled(true);
    this.sampleSourceEnergy(context);
    const trackState = roomAudioOutput.getBroadcastStream()?.getAudioTracks()[0]?.readyState;
    this.sourceHealth = this.sourceEnergy > 0.002 && trackState === "live"
      ? "source-ready"
      : "source-silent";
    return {
      state: bufferedUnits >= Math.min(3, input.manifest.unitCount - currentIndex)
        ? "live" as const
        : "buffering" as const,
      bufferedUnits,
    };
  }

  setVolume(volume: number) {
    if (this.masterGain) {
      this.masterGain.gain.value = normalizeVolume(volume);
    }
  }

  destroy() {
    this.destroyed = true;
    this.resetTimeline();
    this.wasmDecoder?.free();
    this.wasmDecoder = null;
    roomAudioOutput.clearBroadcastDestination();
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

    const source = input.context.createBufferSource();
    source.buffer = input.decoded;
    source.playbackRate.value = 1;
    source.connect(this.masterGain);
    if (this.broadcastGain) {
      source.connect(this.broadcastGain);
    }
    const revision = this.revision;
    source.onended = () => {
      if (revision !== this.revision) return;
      this.scheduled.delete(input.unit.unitIndex);
      this.completed.add(input.unit.unitIndex);
      this.decoded.delete(input.unit.unitIndex);
      source.disconnect();
    };
    source.start(Math.max(earliestStart, desiredAudibleStart), offsetSeconds);
    this.scheduled.set(input.unit.unitIndex, { source, revision });
  }

  private getDecodedUnit(
    context: AudioContext,
    unit: AudioAssetUnitRecord,
    sourceSampleRate: number
  ) {
    const existing = this.decoded.get(unit.unitIndex);
    if (existing) return existing;
    const decoding = this.decodeUnit(context, unit, sourceSampleRate).catch((error) => {
      this.decoded.delete(unit.unitIndex);
      throw error;
    });
    this.decoded.set(unit.unitIndex, decoding);
    return decoding;
  }

  getSourceHealth() {
    return {
      state: this.sourceHealth,
      energy: this.sourceEnergy,
      trackState: roomAudioOutput.getBroadcastStream()?.getAudioTracks()[0]?.readyState ?? "ended",
      audioContextState: this.masterGainContext?.state ?? null
    } as const;
  }

  private getDecodedUnitWithRetry(
    context: AudioContext,
    unit: AudioAssetUnitRecord,
    sourceSampleRate: number
  ) {
    return this.getDecodedUnit(context, unit, sourceSampleRate).catch(async () => {
      this.decoded.delete(unit.unitIndex);
      return this.getDecodedUnit(context, unit, sourceSampleRate);
    });
  }

  private async decodeUnit(
    context: AudioContext,
    unit: AudioAssetUnitRecord,
    sourceSampleRate: number
  ) {
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(unit.payload.slice(0));
    } catch {
      const decoder = await this.getWasmDecoder();
      const result = await decoder.decodeFile(new Uint8Array(unit.payload));
      decoded = context.createBuffer(
        result.channelData.length,
        result.samplesDecoded,
        result.sampleRate
      );
      result.channelData.forEach((channel, index) =>
        decoded.copyToChannel(Float32Array.from(channel), index)
      );
    }
    const sampleScale = decoded.sampleRate / sourceSampleRate;
    const trimStart = Math.min(
      decoded.length,
      Math.round((unit.trimStartSamples ?? 0) * sampleScale)
    );
    const trimEnd = Math.min(
      decoded.length - trimStart,
      Math.round((unit.trimEndSamples ?? 0) * sampleScale)
    );
    if (trimStart === 0 && trimEnd === 0) return decoded;

    const length = Math.max(1, decoded.length - trimStart - trimEnd);
    const trimmed = context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      trimmed.copyToChannel(
        decoded.getChannelData(channel).subarray(trimStart, trimStart + length),
        channel
      );
    }
    return trimmed;
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
      this.masterGain.gain.value = normalizeVolume(volume);
      return;
    }
    this.masterGain?.disconnect();
    this.masterGain = context.createGain();
    this.masterGain.gain.value = normalizeVolume(volume);
    this.masterGain.connect(context.destination);
    const broadcastDestination = roomAudioOutput.getBroadcastDestination(context);
    if (broadcastDestination) {
      this.broadcastGain?.disconnect();
      this.broadcastGain = context.createGain();
      this.broadcastGain.gain.value = 1;
      this.broadcastAnalyser = context.createAnalyser();
      this.broadcastAnalyser.fftSize = 1024;
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

  private enterUnderrun() {
    this.stopScheduledSources();
    this.completed.clear();
    this.contextAnchorTime = null;
    this.timelineStarted = false;
    this.sourceHealth = "source-underrun";
    this.setBroadcastTrackEnabled(false);
  }

  private setBroadcastTrackEnabled(enabled: boolean) {
    for (const track of roomAudioOutput.getBroadcastStream()?.getAudioTracks() ?? []) {
      track.enabled = enabled;
    }
  }

  private sampleSourceEnergy(context: AudioContext) {
    const analyser = this.broadcastAnalyser;
    if (!analyser || context.state !== "running") {
      this.sourceEnergy = 0;
      return;
    }
    const values = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    let sum = 0;
    for (const value of values) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    this.sourceEnergy = Math.sqrt(sum / values.length);
  }

  private stopScheduledSources() {
    this.revision += 1;
    const scheduled = [...this.scheduled.values()];
    this.scheduled.clear();
    for (const { source } of scheduled) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    }
  }

  private resetTimeline() {
    this.stopScheduledSources();
    this.completed.clear();
    this.decoded.clear();
    this.timelineKey = null;
    this.contextAnchorTime = null;
    this.playbackAnchorPositionMs = 0;
    this.timelineStarted = false;
    this.unitRecords.clear();
    this.masterGain?.disconnect();
    this.masterGain = null;
    this.broadcastGain?.disconnect();
    this.broadcastGain = null;
    this.broadcastAnalyser?.disconnect();
    this.broadcastAnalyser = null;
    this.masterGainContext = null;
    this.sourceHealth = "source-underrun";
    this.sourceEnergy = 0;
    this.setBroadcastTrackEnabled(false);
  }
}

function normalizeVolume(volume: number) {
  return Math.min(1, Math.max(0, volume));
}
