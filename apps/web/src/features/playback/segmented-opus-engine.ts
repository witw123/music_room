"use client";

import type {
  AudioAssetUnitRecord
} from "@/lib/indexeddb";
import type { PlaybackAssetManifest, PlaybackSnapshot } from "@music-room/shared";
import { roomAudioOutput } from "./room-audio-output";
import {
  playbackUnitIndexAt,
  resolveStartupUnitIndexes
} from "./playback-segment-scheduler";

type ScheduledSource = {
  source: AudioBufferSourceNode;
  gain: GainNode;
};

export class SegmentedOpusEngine {
  private timelineKey: string | null = null;
  private readonly scheduled = new Map<number, ScheduledSource>();
  private readonly completed = new Set<number>();
  private wasmDecoder: import("ogg-opus-decoder").OggOpusDecoder | null = null;
  private timelineStarted = false;
  private destroyed = false;

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
      return { state: "paused" as const, bufferedUnits: 0 };
    }
    const timelineKey = [
      input.manifest.assetId,
      input.playback.mediaEpoch,
      input.playback.startAt,
      input.playback.positionMs
    ].join(":");
    if (timelineKey !== this.timelineKey) {
      this.resetTimeline();
      this.timelineKey = timelineKey;
    }

    const context = roomAudioOutput.getSharedAudioContext();
    if (!context || context.state !== "running") {
      return { state: "awaiting-unlock" as const, bufferedUnits: 0 };
    }
    const startAtMs = Date.parse(input.playback.startAt);
    const roomPositionMs = Math.min(
      input.manifest.durationMs,
      input.playback.positionMs + Math.max(0, input.serverNowMs - startAtMs)
    );
    const currentIndex = playbackUnitIndexAt(input.manifest, roomPositionMs);
    const contextStartTime = context.currentTime + (startAtMs - input.serverNowMs) / 1000;
    const resolvedUnits = new Map<number, AudioAssetUnitRecord>();
    if (!this.timelineStarted) {
      const startupUnitIndexes = resolveStartupUnitIndexes({
        manifest: input.manifest,
        positionMs: roomPositionMs
      });
      for (const [offset, unitIndex] of startupUnitIndexes.entries()) {
        const unit = await input.getUnit(unitIndex);
        if (!unit) {
          return { state: "buffering" as const, bufferedUnits: offset };
        }
        resolvedUnits.set(unitIndex, unit);
      }
      this.timelineStarted = true;
    }
    let bufferedUnits = 0;

    for (
      let unitIndex = currentIndex;
      unitIndex < Math.min(input.manifest.unitCount, currentIndex + 16);
      unitIndex += 1
    ) {
      if (this.scheduled.has(unitIndex) || this.completed.has(unitIndex)) {
        bufferedUnits += 1;
        continue;
      }
      const unit = resolvedUnits.get(unitIndex) ?? await input.getUnit(unitIndex);
      if (!unit) {
        if (unitIndex === currentIndex) {
          return { state: "buffering" as const, bufferedUnits };
        }
        break;
      }
      const decoded = await this.decodeUnit(context, unit);
      const segmentStartMs = unit.startMs ?? unitIndex * input.manifest.segmentDurationMs;
      const desiredWhen = contextStartTime + (segmentStartMs - input.playback.positionMs) / 1000;
      const when = Math.max(context.currentTime + 0.03, desiredWhen);
      const lateOffsetSeconds = Math.max(0, (context.currentTime + 0.03 - desiredWhen));
      if (lateOffsetSeconds >= decoded.duration) {
        this.completed.add(unitIndex);
        continue;
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = decoded;
      source.playbackRate.value = 1;
      gain.gain.value = Math.min(1, Math.max(0, input.volume));
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = () => {
        this.scheduled.delete(unitIndex);
        this.completed.add(unitIndex);
        source.disconnect();
        gain.disconnect();
      };
      source.start(when, lateOffsetSeconds);
      this.scheduled.set(unitIndex, { source, gain });
      bufferedUnits += 1;
    }
    return {
      state: bufferedUnits >= 3 ? "live" as const : "buffering" as const,
      bufferedUnits
    };
  }

  setVolume(volume: number) {
    const normalized = Math.min(1, Math.max(0, volume));
    for (const scheduled of this.scheduled.values()) {
      scheduled.gain.gain.value = normalized;
    }
  }

  destroy() {
    this.destroyed = true;
    this.resetTimeline();
    this.wasmDecoder?.free();
    this.wasmDecoder = null;
  }

  private async decodeUnit(context: AudioContext, unit: AudioAssetUnitRecord) {
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(unit.payload.slice(0));
    } catch {
      const decoder = await this.getWasmDecoder();
      const result = await decoder.decodeFile(new Uint8Array(unit.payload));
      decoded = context.createBuffer(result.channelData.length, result.samplesDecoded, result.sampleRate);
      result.channelData.forEach((channel, index) =>
        decoded.copyToChannel(Float32Array.from(channel), index)
      );
    }
    const trimStart = Math.min(decoded.length, unit.trimStartSamples ?? 0);
    const trimEnd = Math.min(decoded.length - trimStart, unit.trimEndSamples ?? 0);
    if (trimStart === 0 && trimEnd === 0) {
      return decoded;
    }
    const length = Math.max(1, decoded.length - trimStart - trimEnd);
    const trimmed = context.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      trimmed.copyToChannel(decoded.getChannelData(channel).subarray(trimStart, trimStart + length), channel);
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

  private resetTimeline() {
    for (const scheduled of this.scheduled.values()) {
      try {
        scheduled.source.stop();
      } catch {
        // The source may already have ended.
      }
      scheduled.source.disconnect();
      scheduled.gain.disconnect();
    }
    this.scheduled.clear();
    this.completed.clear();
    this.timelineKey = null;
    this.timelineStarted = false;
  }
}
