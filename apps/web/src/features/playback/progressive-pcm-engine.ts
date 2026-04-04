import { getCachedPiece } from "@/lib/indexeddb";
import type { ProgressiveTrackManifest } from "./progressive-playback";
import {
  extractFlacPacketsFromBitstream,
  type ProgressiveFlacStreamInfo
} from "./progressive-flac";

type EngineStatus = "idle" | "opening" | "ready" | "failed" | "destroyed";

type DecodedSegment = {
  startTimeSec: number;
  endTimeSec: number;
  buffer: AudioBuffer;
};

type ScheduledSegment = {
  source: AudioBufferSourceNode;
  startTimeSec: number;
  endTimeSec: number;
  contextStartSec: number;
  durationSec: number;
};

type EncodedAudioChunkCtor = typeof EncodedAudioChunk;

type AudioDecoderCtor = typeof AudioDecoder;

type PcmEngineSyncResult = {
  localReady: boolean;
  driftMs: number;
  playbackPositionSeconds: number;
};

const pcmScheduleAheadSeconds = 18;

export class ProgressivePcmEngine {
  private audioContext: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  private decoder: AudioDecoder | null = null;
  private streamInfo: ProgressiveFlacStreamInfo | null = null;
  private status: EngineStatus = "idle";
  private parsedOffset = 0;
  private nextSampleIndex = 0;
  private contiguousChunkCount = 0;
  private contiguousByteLength = 0;
  private contiguousBytes = new Uint8Array(0);
  private decodedSegments: DecodedSegment[] = [];
  private scheduledSegments: ScheduledSegment[] = [];
  private playing = false;
  private pausedTrackTimeSec = 0;
  private anchorTrackTimeSec = 0;
  private anchorContextTimeSec = 0;
  private volume = 1;
  private syncInFlight = false;
  private syncQueued = false;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly peerId: string,
    private readonly manifest: ProgressiveTrackManifest
  ) {}

  get engineStatus() {
    return this.status;
  }

  get ready() {
    return this.status === "ready";
  }

  getCurrentTimeSeconds() {
    if (!this.playing || !this.audioContext) {
      return this.pausedTrackTimeSec;
    }

    const elapsed = Math.max(0, this.audioContext.currentTime - this.anchorContextTimeSec);
    return this.anchorTrackTimeSec + elapsed;
  }

  getBufferedAheadMs(positionSeconds = this.getCurrentTimeSeconds()) {
    const coverageEnd = this.findBufferedCoverageEnd(positionSeconds);
    if (coverageEnd <= positionSeconds) {
      return 0;
    }

    return Math.round((coverageEnd - positionSeconds) * 1000);
  }

  setVolume(nextVolume: number) {
    this.volume = nextVolume;
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setValueAtTime(nextVolume, this.audioContext.currentTime);
      this.audio.volume = 1;
      return;
    }

    this.audio.volume = nextVolume;
  }

  async attach() {
    if (this.status !== "idle") {
      return this.status === "ready";
    }

    try {
      this.status = "opening";
      const AudioContextCtor = getAudioContextCtor();
      if (!AudioContextCtor) {
        this.status = "failed";
        return false;
      }

      this.audioContext = new AudioContextCtor();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.gainNode.connect(this.destinationNode);
      this.audio.srcObject = this.destinationNode.stream;
      this.audio.volume = 1;
      return true;
    } catch {
      this.status = "failed";
      return false;
    }
  }

  async sync() {
    if (isTerminalEngineStatus(this.status)) {
      return;
    }

    if (this.syncInFlight) {
      this.syncQueued = true;
      return;
    }

    this.syncInFlight = true;
    try {
      do {
        this.syncQueued = false;
        await this.performSync();
      } while (this.syncQueued && !isTerminalEngineStatus(this.status));
    } finally {
      this.syncInFlight = false;
    }
  }

  async syncPlayback(expectedSeconds: number, isPlaying: boolean): Promise<PcmEngineSyncResult> {
    const positionSeconds = Math.max(0, expectedSeconds);

    if (!isPlaying) {
      this.pausedTrackTimeSec = positionSeconds;
      this.playing = false;
      this.stopScheduledSegments();
      this.audio.pause();
      return {
        localReady: this.hasBufferedPosition(positionSeconds),
        driftMs: 0,
        playbackPositionSeconds: positionSeconds
      };
    }

    if (!this.audioContext || this.status !== "ready") {
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: this.getCurrentTimeSeconds()
      };
    }

    if (!this.hasBufferedPosition(positionSeconds)) {
      this.playing = false;
      this.pausedTrackTimeSec = positionSeconds;
      this.stopScheduledSegments();
      this.audio.pause();
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: positionSeconds
      };
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume().catch(() => undefined);
    }

    const driftMs = Math.abs(this.getCurrentTimeSeconds() - positionSeconds) * 1000;
    if (!this.playing || driftMs > 220) {
      this.playing = true;
      this.pausedTrackTimeSec = positionSeconds;
      this.anchorTrackTimeSec = positionSeconds;
      this.anchorContextTimeSec = this.audioContext.currentTime + 0.05;
      this.stopScheduledSegments();
    }

    this.scheduleAhead(positionSeconds);
    void this.audio.play().catch(() => undefined);

    return {
      localReady: true,
      driftMs: Math.abs(this.getCurrentTimeSeconds() - positionSeconds) * 1000,
      playbackPositionSeconds: this.getCurrentTimeSeconds()
    };
  }

  destroy() {
    if (this.status === "destroyed") {
      return;
    }

    this.status = "destroyed";
    this.stopScheduledSegments();
    const decoder = this.decoder;
    this.decoder = null;
    try {
      decoder?.close?.();
    } catch {
      // WebCodecs may have already closed the decoder after a fatal decode error.
    }
    if (this.audio.srcObject === this.destinationNode?.stream) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.load();
    }
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.destinationNode = null;
    this.gainNode = null;
    this.streamInfo = null;
    this.decodedSegments = [];
    this.contiguousChunkCount = 0;
    this.parsedOffset = 0;
    this.nextSampleIndex = 0;
    this.contiguousByteLength = 0;
    this.contiguousBytes = new Uint8Array(0);
    this.syncInFlight = false;
    this.syncQueued = false;
  }

  private async ensureDecoder(streamInfo: ProgressiveFlacStreamInfo) {
    if (this.decoder) {
      return true;
    }

    const AudioDecoderCtor = getAudioDecoderCtor();
    if (!AudioDecoderCtor || !this.audioContext) {
      return false;
    }

    if (typeof AudioDecoderCtor.isConfigSupported === "function") {
      try {
        const support = await AudioDecoderCtor.isConfigSupported({
          codec: "flac",
          description: streamInfo.description,
          sampleRate: streamInfo.sampleRate,
          numberOfChannels: streamInfo.numberOfChannels
        });
        if (!support.supported) {
          return false;
        }
      } catch {
        return false;
      }
    }

    try {
      const decoder = new AudioDecoderCtor({
        output: (audioData) => {
          const segment = this.createDecodedSegment(audioData);
          if (!segment) {
            return;
          }

          this.decodedSegments.push(segment);
          this.decodedSegments.sort((left, right) => left.startTimeSec - right.startTimeSec);
          if (this.playing) {
            this.scheduleAhead(this.getCurrentTimeSeconds());
          }
        },
        error: () => {
          this.status = "failed";
          this.decoder = null;
        }
      });
      decoder.configure({
        codec: "flac",
        description: streamInfo.description,
        sampleRate: streamInfo.sampleRate,
        numberOfChannels: streamInfo.numberOfChannels
      });
      this.decoder = decoder;
      this.status = "ready";
      return true;
    } catch {
      this.status = "failed";
      return false;
    }
  }

  private async performSync() {
    const appendedBytes = await this.appendAvailableContiguousPieces();
    if (!appendedBytes) {
      return;
    }

    const extraction = extractFlacPacketsFromBitstream({
      bytes: this.contiguousBytes.subarray(0, this.contiguousByteLength),
      startOffset: this.parsedOffset,
      nextSampleIndex: this.nextSampleIndex,
      finalChunk: this.contiguousChunkCount >= this.manifest.totalChunks
    });

    if (!extraction.streamInfo) {
      return;
    }

    if (!this.streamInfo) {
      this.streamInfo = extraction.streamInfo;
    }

    const decoderReady = await this.ensureDecoder(extraction.streamInfo);
    if (!decoderReady || !this.decoder) {
      this.status = "failed";
      return;
    }

    const EncodedAudioChunkCtor = getEncodedAudioChunkCtor();
    if (!EncodedAudioChunkCtor) {
      this.status = "failed";
      return;
    }

    for (const packet of extraction.packets) {
      this.decoder.decode(
        new EncodedAudioChunkCtor({
          type: "key",
          timestamp: packet.timestampUs,
          duration: packet.durationUs,
          data: packet.data
        })
      );
    }

    this.parsedOffset = extraction.nextOffset;
    this.nextSampleIndex = extraction.nextSampleIndex;
  }

  private async appendAvailableContiguousPieces() {
    let appended = false;

    while (this.contiguousChunkCount < this.manifest.totalChunks) {
      const piece = await getCachedPiece(
        this.manifest.trackId,
        this.peerId,
        this.contiguousChunkCount
      );
      if (!piece) {
        break;
      }

      this.appendContiguousBytes(piece.payload);
      this.contiguousChunkCount += 1;
      appended = true;
    }

    return appended;
  }

  private appendContiguousBytes(payload: ArrayBuffer) {
    const nextBytes = new Uint8Array(payload);
    const nextLength = this.contiguousByteLength + nextBytes.byteLength;
    if (this.contiguousBytes.byteLength < nextLength) {
      let nextCapacity = Math.max(this.contiguousBytes.byteLength, 256 * 1024);
      while (nextCapacity < nextLength) {
        nextCapacity *= 2;
      }

      const grownBuffer = new Uint8Array(nextCapacity);
      if (this.contiguousByteLength > 0) {
        grownBuffer.set(this.contiguousBytes.subarray(0, this.contiguousByteLength));
      }
      this.contiguousBytes = grownBuffer;
    }

    this.contiguousBytes.set(nextBytes, this.contiguousByteLength);
    this.contiguousByteLength = nextLength;
  }

  private createDecodedSegment(audioData: unknown): DecodedSegment | null {
    if (!this.audioContext) {
      return null;
    }

    const data = audioData as {
      numberOfChannels: number;
      numberOfFrames: number;
      sampleRate: number;
      timestamp: number;
      copyTo: (destination: Float32Array, options: { planeIndex: number; format: string }) => void;
      close?: () => void;
    };

    if (
      typeof data.numberOfChannels !== "number" ||
      typeof data.numberOfFrames !== "number" ||
      typeof data.sampleRate !== "number" ||
      typeof data.timestamp !== "number" ||
      typeof data.copyTo !== "function"
    ) {
      return null;
    }

    const buffer = this.audioContext.createBuffer(
      data.numberOfChannels,
      data.numberOfFrames,
      data.sampleRate
    );
    for (let channelIndex = 0; channelIndex < data.numberOfChannels; channelIndex += 1) {
      const channelBuffer = new Float32Array(data.numberOfFrames);
      data.copyTo(channelBuffer, {
        planeIndex: channelIndex,
        format: "f32-planar"
      });
      buffer.copyToChannel(channelBuffer, channelIndex);
    }
    data.close?.();

    const startTimeSec = data.timestamp / 1_000_000;
    return {
      startTimeSec,
      endTimeSec: startTimeSec + data.numberOfFrames / data.sampleRate,
      buffer
    };
  }

  private scheduleAhead(fromPositionSeconds: number) {
    if (!this.audioContext || !this.destinationNode || !this.gainNode || !this.playing) {
      return;
    }

    this.pruneScheduledSegments();
    let scheduledUntilSec = Math.max(fromPositionSeconds, this.getCurrentTimeSeconds());
    for (const scheduledSegment of this.scheduledSegments) {
      if (scheduledSegment.endTimeSec > scheduledUntilSec) {
        scheduledUntilSec = scheduledSegment.endTimeSec;
      }
    }

    const scheduleTargetSec = Math.min(
      this.manifest.durationMs / 1000,
      this.getCurrentTimeSeconds() + pcmScheduleAheadSeconds
    );

    for (const segment of this.decodedSegments) {
      if (segment.endTimeSec <= scheduledUntilSec + 0.001) {
        continue;
      }

      if (segment.startTimeSec > scheduledUntilSec + 0.12) {
        break;
      }

      const playbackStartSec = Math.max(segment.startTimeSec, scheduledUntilSec);
      const desiredContextStartSec =
        this.anchorContextTimeSec + (playbackStartSec - this.anchorTrackTimeSec);
      const actualContextStartSec = Math.max(
        desiredContextStartSec,
        this.audioContext.currentTime + 0.02
      );
      const contextDelaySec = actualContextStartSec - desiredContextStartSec;
      const playbackOffsetSec = playbackStartSec - segment.startTimeSec + contextDelaySec;
      const durationSec = segment.endTimeSec - segment.startTimeSec - playbackOffsetSec;

      if (
        durationSec <= 0 ||
        actualContextStartSec + durationSec <= this.audioContext.currentTime
      ) {
        continue;
      }

      const source = this.audioContext.createBufferSource();
      source.buffer = segment.buffer;
      source.connect(this.gainNode);

      const scheduledSegment: ScheduledSegment = {
        source,
        startTimeSec: playbackStartSec,
        endTimeSec: segment.endTimeSec,
        contextStartSec: actualContextStartSec,
        durationSec
      };
      source.onended = () => {
        this.scheduledSegments = this.scheduledSegments.filter(
          (entry) => entry.source !== source
        );
      };
      source.start(actualContextStartSec, playbackOffsetSec, durationSec);
      this.scheduledSegments.push(scheduledSegment);
      scheduledUntilSec = segment.endTimeSec;

      if (scheduledUntilSec >= scheduleTargetSec) {
        break;
      }
    }
  }

  private hasBufferedPosition(positionSeconds: number) {
    return this.findBufferedCoverageEnd(positionSeconds) > positionSeconds + 0.02;
  }

  private findBufferedCoverageEnd(positionSeconds: number) {
    let coverageEnd = positionSeconds;

    for (const segment of this.decodedSegments) {
      if (segment.endTimeSec <= coverageEnd + 0.001) {
        continue;
      }

      if (segment.startTimeSec > coverageEnd + 0.12) {
        break;
      }

      if (segment.startTimeSec <= coverageEnd + 0.001) {
        coverageEnd = Math.max(coverageEnd, segment.endTimeSec);
      }
    }

    return coverageEnd;
  }

  private stopScheduledSegments() {
    for (const segment of this.scheduledSegments) {
      segment.source.onended = null;
      try {
        segment.source.stop();
      } catch {
        // noop
      }
      segment.source.disconnect();
    }
    this.scheduledSegments = [];
  }

  private pruneScheduledSegments() {
    if (!this.audioContext) {
      return;
    }

    this.scheduledSegments = this.scheduledSegments.filter((segment) => {
      const stillActive =
        segment.contextStartSec + segment.durationSec > this.audioContext!.currentTime - 0.05;
      if (!stillActive) {
        segment.source.onended = null;
        segment.source.disconnect();
      }
      return stillActive;
    });
  }
}

function getAudioContextCtor() {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    window.AudioContext ??
    ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null)
  );
}

function getAudioDecoderCtor() {
  return (
    globalThis as typeof globalThis & {
      AudioDecoder?: AudioDecoderCtor;
    }
  ).AudioDecoder ?? null;
}

function getEncodedAudioChunkCtor() {
  return (
    globalThis as typeof globalThis & {
      EncodedAudioChunk?: EncodedAudioChunkCtor;
    }
  ).EncodedAudioChunk ?? null;
}

function isTerminalEngineStatus(status: EngineStatus) {
  return status === "destroyed" || status === "failed";
}
