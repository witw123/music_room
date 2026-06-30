import { getCachedPiece, localCacheOwnerKey } from "@/lib/indexeddb";
import { isWavTrack, type ProgressiveTrackManifest } from "./progressive-playback";
import {
  extractFlacPacketsFromBitstream,
  type ProgressiveFlacStreamInfo
} from "./progressive-flac";
import { parseWavHeader, type WavHeader } from "./codecs/wav-parser";

type EngineStatus = "idle" | "opening" | "ready" | "failed" | "degraded" | "destroyed";

type DecodedSegment = {
  startTimeSec: number;
  endTimeSec: number;
  buffer: AudioBuffer;
  peak: number;
  rms: number;
  nonZeroSampleCount: number;
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
type AudioDecoderLike = AudioDecoder & {
  flush?: () => Promise<void>;
};

type PcmEngineSyncResult = {
  localReady: boolean;
  driftMs: number;
  playbackPositionSeconds: number;
  blockedReason: string | null;
};

export type PcmEnginePlayoutState = "playing" | "buffering" | "paused";
export type ProgressivePcmEngineSnapshot = {
  status: EngineStatus;
  audioContextState: AudioContextState | null;
  hasOutputStream: boolean;
  directOutputConnected: boolean;
  contiguousChunkCount: number;
  contiguousByteLength: number;
  decodedSegmentCount: number;
  scheduledSegmentCount: number;
  decodedPacketCount: number;
  decoderFlushAttemptCount: number;
  decoderFlushCount: number;
  lastDecodedAtMs: number | null;
  lastDecodeError: string | null;
  decodedPeak: number;
  decodedRms: number;
  decodedNonZeroSampleCount: number;
  bufferedAheadMs: number;
  playoutState: PcmEnginePlayoutState;
};

const pcmScheduleAheadSeconds = 18;
const maxPcmCachedPiecesToAppendPerSync = 8;

export class ProgressivePcmEngine {
  private audioContext: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  private directOutputConnected = false;
  private decoder: AudioDecoderLike | null = null;
  private streamInfo: ProgressiveFlacStreamInfo | null = null;
  private wavHeader: WavHeader | null = null;
  private wavDecodedByteOffset = 0;
  private status: EngineStatus = "idle";
  private parsedOffset = 0;
  private nextSampleIndex = 0;
  private contiguousChunkCount = 0;
  private contiguousByteLength = 0;
  private contiguousBytes = new Uint8Array(0);
  private decodedSegments: DecodedSegment[] = [];
  private scheduledSegments: ScheduledSegment[] = [];
  private decodedPacketCount = 0;
  private decoderFlushAttemptCount = 0;
  private decoderFlushCount = 0;
  private lastDecodedAtMs: number | null = null;
  private lastDecodeError: string | null = null;
  private decodedPeak = 0;
  private decodedSquareSum = 0;
  private decodedSampleCount = 0;
  private decodedNonZeroSampleCount = 0;
  private nextDecodedStartTimeSec = 0;
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
    private readonly manifest: ProgressiveTrackManifest,
    private readonly audioContextProvider?: () => AudioContext | null
  ) {}

  get engineStatus() {
    return this.status;
  }

  get ready() {
    return this.status === "ready";
  }

  getCurrentTimeSeconds() {
    if (!this.playing || !this.audioContext) {
      return normalizeTrackTimeSeconds(this.pausedTrackTimeSec);
    }

    if (!Number.isFinite(this.audioContext.currentTime) || !Number.isFinite(this.anchorContextTimeSec)) {
      return normalizeTrackTimeSeconds(this.pausedTrackTimeSec);
    }

    const elapsed = Math.max(0, this.audioContext.currentTime - this.anchorContextTimeSec);
    const currentTimeSeconds = this.anchorTrackTimeSec + elapsed;
    return normalizeTrackTimeSeconds(currentTimeSeconds);
  }

  getOutputStream() {
    return this.destinationNode?.stream ?? null;
  }

  getPlayoutState(): PcmEnginePlayoutState {
    if (!this.playing || this.audioContext?.state !== "running") {
      return "paused";
    }

    return this.getBufferedAheadMs() > 0 ? "playing" : "buffering";
  }

  getSnapshot(): ProgressivePcmEngineSnapshot {
    return {
      status: this.status,
      audioContextState: this.audioContext?.state ?? null,
      hasOutputStream: !!this.destinationNode?.stream,
      directOutputConnected: this.directOutputConnected,
      contiguousChunkCount: this.contiguousChunkCount,
      contiguousByteLength: this.contiguousByteLength,
      decodedSegmentCount: this.decodedSegments.length,
      scheduledSegmentCount: this.scheduledSegments.length,
      decodedPacketCount: this.decodedPacketCount,
      decoderFlushAttemptCount: this.decoderFlushAttemptCount,
      decoderFlushCount: this.decoderFlushCount,
      lastDecodedAtMs: this.lastDecodedAtMs,
      lastDecodeError: this.lastDecodeError,
      decodedPeak: roundPcmLevel(this.decodedPeak),
      decodedRms: roundPcmLevel(
        this.decodedSampleCount > 0
          ? Math.sqrt(this.decodedSquareSum / this.decodedSampleCount)
          : 0
      ),
      decodedNonZeroSampleCount: this.decodedNonZeroSampleCount,
      bufferedAheadMs: normalizeDurationMs(this.getBufferedAheadMs()),
      playoutState: this.getPlayoutState()
    };
  }

  getBufferedAheadMs(positionSeconds = this.getCurrentTimeSeconds()) {
    const normalizedPositionSeconds = normalizeTrackTimeSeconds(positionSeconds);
    const coverageEnd = this.findBufferedCoverageEnd(normalizedPositionSeconds);
    if (coverageEnd <= normalizedPositionSeconds) {
      return 0;
    }

    return normalizeDurationMs(Math.round((coverageEnd - normalizedPositionSeconds) * 1000));
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

      this.audioContext = this.audioContextProvider?.() ?? new AudioContextCtor();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.gainNode.connect(this.destinationNode);
      this.gainNode.connect(this.audioContext.destination);
      this.directOutputConnected = true;
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
    } catch {
      if (!isDestroyedEngineStatus(this.status)) {
        this.lastDecodeError = "cache-read-failed";
        this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      }
    } finally {
      this.syncInFlight = false;
    }
  }

  async syncPlayback(expectedSeconds: number, isPlaying: boolean): Promise<PcmEngineSyncResult> {
    const positionSeconds = normalizeTrackTimeSeconds(expectedSeconds);

    if (!isPlaying) {
      this.pausedTrackTimeSec = positionSeconds;
      this.playing = false;
      this.stopScheduledSegments();
      this.audio.pause();
      return {
        localReady: this.hasBufferedPosition(positionSeconds),
        driftMs: 0,
        playbackPositionSeconds: positionSeconds,
        blockedReason: null
      };
    }

    if (!this.canUseDecodedPlaybackAt(positionSeconds) && this.status !== "ready") {
      await this.sync();
    }

    if (!this.audioContext || (!this.canUseDecodedPlaybackAt(positionSeconds) && this.status !== "ready")) {
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: this.getCurrentTimeSeconds(),
        blockedReason: this.status !== "ready" ? `engine-${this.status}` : "missing-audio-context"
      };
    }

    if (!this.hasBufferedPosition(positionSeconds)) {
      await this.sync();
    }

    if (!this.hasBufferedPosition(positionSeconds)) {
      await this.waitForDecodedPosition(positionSeconds);
    }

    if (!this.hasBufferedPosition(positionSeconds)) {
      this.playing = false;
      this.pausedTrackTimeSec = positionSeconds;
      this.stopScheduledSegments();
      this.audio.pause();
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: positionSeconds,
        blockedReason: "pcm-buffer-missing"
      };
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume().catch(() => undefined);
    }
    if (this.audioContext.state !== "running") {
      this.playing = false;
      this.pausedTrackTimeSec = positionSeconds;
      this.stopScheduledSegments();
      this.audio.pause();
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: positionSeconds,
        blockedReason: `audio-context-${this.audioContext.state}`
      };
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

    return {
      localReady: true,
      driftMs: Math.abs(this.getCurrentTimeSeconds() - positionSeconds) * 1000,
      playbackPositionSeconds: this.getCurrentTimeSeconds(),
      blockedReason: null
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
    if (!this.audioContextProvider) {
      void this.audioContext?.close().catch(() => undefined);
    }
    this.audioContext = null;
    this.destinationNode = null;
    this.gainNode = null;
    this.directOutputConnected = false;
    this.streamInfo = null;
    this.wavHeader = null;
    this.wavDecodedByteOffset = 0;
    this.decodedSegments = [];
    this.decodedPacketCount = 0;
    this.decoderFlushAttemptCount = 0;
    this.decoderFlushCount = 0;
    this.lastDecodedAtMs = null;
    this.lastDecodeError = null;
    this.decodedPeak = 0;
    this.decodedSquareSum = 0;
    this.decodedSampleCount = 0;
    this.decodedNonZeroSampleCount = 0;
    this.nextDecodedStartTimeSec = 0;
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
          this.lastDecodedAtMs = Date.now();
          this.decodedSegments.sort((left, right) => left.startTimeSec - right.startTimeSec);
          if (this.playing) {
            this.scheduleAhead(this.getCurrentTimeSeconds());
          }
        },
        error: (error) => {
          this.lastDecodeError = error instanceof Error ? error.message : "decode-error";
          this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
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
      this.lastDecodeError = "decoder-config-failed";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      return false;
    }
  }

  private async performSync() {
    const appendedBytes = await this.appendAvailableContiguousPieces();
    if (isTerminalEngineStatus(this.status)) {
      return;
    }

    if (!appendedBytes) {
      return;
    }

    if (isWavTrack(this.manifest)) {
      this.decodeAvailableWavPcm();
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
      this.lastDecodeError = "decoder-unavailable";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      return;
    }

    const EncodedAudioChunkCtor = getEncodedAudioChunkCtor();
    if (!EncodedAudioChunkCtor) {
      this.lastDecodeError = "encoded-audio-chunk-unavailable";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      return;
    }

    for (const packet of extraction.packets) {
      try {
        this.decoder.decode(
          new EncodedAudioChunkCtor({
            type: "key",
            timestamp: packet.timestampUs,
            duration: packet.durationUs,
            data: packet.data
          })
        );
        this.decodedPacketCount += 1;
      } catch (error) {
        this.lastDecodeError = error instanceof Error ? error.message : "decode-throw";
        this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
        break;
      }
    }

    if (extraction.packets.length > 0) {
      await this.flushDecoder();
    }

    this.parsedOffset = extraction.nextOffset;
    this.nextSampleIndex = extraction.nextSampleIndex;
  }

  private decodeAvailableWavPcm() {
    if (!this.audioContext) {
      return;
    }

    const bytes = this.contiguousBytes.subarray(0, this.contiguousByteLength);
    const header = this.wavHeader ?? parseWavHeader(bytes);
    if (!header) {
      return;
    }

    this.wavHeader = header;
    this.status = "ready";

    const dataStartByte = header.dataOffset;
    const dataEndByte = Math.min(
      this.contiguousByteLength,
      header.dataOffset + header.dataBytes
    );
    const decodeStartByte = Math.max(dataStartByte, this.wavDecodedByteOffset || dataStartByte);
    const alignedStartByte =
      dataStartByte +
      Math.max(0, Math.floor((decodeStartByte - dataStartByte) / header.blockAlign)) *
        header.blockAlign;
    const alignedEndByte =
      dataStartByte +
      Math.max(0, Math.floor((dataEndByte - dataStartByte) / header.blockAlign)) *
        header.blockAlign;
    if (alignedEndByte <= alignedStartByte) {
      return;
    }

    const segment = this.createDecodedWavSegment(
      header,
      bytes.subarray(alignedStartByte, alignedEndByte),
      alignedStartByte
    );
    if (!segment) {
      this.lastDecodeError = "wav-decode-failed";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      return;
    }

    this.wavDecodedByteOffset = alignedEndByte;
    this.decodedSegments.push(segment);
    this.decodedSegments.sort((left, right) => left.startTimeSec - right.startTimeSec);
    this.lastDecodedAtMs = Date.now();
    if (this.playing) {
      this.scheduleAhead(this.getCurrentTimeSeconds());
    }
  }

  private async appendAvailableContiguousPieces() {
    let appended = false;
    let appendedPieceCount = 0;

    while (
      this.contiguousChunkCount < this.manifest.totalChunks &&
      appendedPieceCount < maxPcmCachedPiecesToAppendPerSync
    ) {
      const piece = await getCachedPiece(
        this.manifest.trackId,
        this.peerId,
        this.contiguousChunkCount,
        {
          fileHash: this.manifest.fileHash,
          ownerKey: localCacheOwnerKey,
          chunkSize: this.manifest.chunkSize
        }
      );
      if (isTerminalEngineStatus(this.status)) {
        break;
      }

      if (!piece) {
        break;
      }

      this.appendContiguousBytes(piece.payload);
      this.contiguousChunkCount += 1;
      appendedPieceCount += 1;
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

  private async flushDecoder() {
    const decoder = this.decoder;
    if (!decoder || typeof decoder.flush !== "function") {
      await yieldToMicrotasks();
      return;
    }

    try {
      this.decoderFlushAttemptCount += 1;
      await decoder.flush();
      this.decoderFlushCount += 1;
    } catch {
      this.lastDecodeError = "decoder-flush-failed";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      this.decoder = null;
    }
  }

  private async waitForDecodedPosition(positionSeconds: number) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await yieldToMicrotasks();
      if (this.hasBufferedPosition(positionSeconds) || isTerminalEngineStatus(this.status)) {
        return;
      }
    }
  }

  private createDecodedWavSegment(
    header: WavHeader,
    payload: Uint8Array,
    absoluteStartByte: number
  ): DecodedSegment | null {
    if (!this.audioContext || payload.byteLength < header.blockAlign) {
      return null;
    }

    const bytesPerSample = header.bitsPerSample / 8;
    if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
      return null;
    }

    const frameCount = Math.floor(payload.byteLength / header.blockAlign);
    if (frameCount <= 0) {
      return null;
    }

    const buffer = this.audioContext.createBuffer(
      header.channels,
      frameCount,
      header.sampleRate
    );
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let segmentPeak = 0;
    let segmentSquareSum = 0;
    let segmentSampleCount = 0;
    let segmentNonZeroSampleCount = 0;

    for (let channelIndex = 0; channelIndex < header.channels; channelIndex += 1) {
      const channelBuffer = new Float32Array(frameCount);
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const sampleOffset =
          frameIndex * header.blockAlign + channelIndex * bytesPerSample;
        const sample = decodeWavSample(view, sampleOffset, header);
        if (!Number.isFinite(sample)) {
          return null;
        }

        channelBuffer[frameIndex] = sample;
        const absoluteSample = Math.abs(sample);
        segmentPeak = Math.max(segmentPeak, absoluteSample);
        segmentSquareSum += sample * sample;
        segmentSampleCount += 1;
        if (absoluteSample > 0.000001) {
          segmentNonZeroSampleCount += 1;
        }
      }
      buffer.copyToChannel(channelBuffer, channelIndex);
    }

    const startFrame = Math.floor(
      Math.max(0, absoluteStartByte - header.dataOffset) / header.blockAlign
    );
    const startTimeSec = startFrame / header.sampleRate;
    const endTimeSec = startTimeSec + frameCount / header.sampleRate;
    this.decodedPeak = Math.max(this.decodedPeak, segmentPeak);
    this.decodedSquareSum += segmentSquareSum;
    this.decodedSampleCount += segmentSampleCount;
    this.decodedNonZeroSampleCount += segmentNonZeroSampleCount;

    return {
      startTimeSec,
      endTimeSec,
      buffer,
      peak: segmentPeak,
      rms: segmentSampleCount > 0 ? Math.sqrt(segmentSquareSum / segmentSampleCount) : 0,
      nonZeroSampleCount: segmentNonZeroSampleCount
    };
  }

  private createDecodedSegment(audioData: unknown): DecodedSegment | null {
    if (!this.audioContext) {
      return null;
    }

    const data = audioData as {
      numberOfChannels: number;
      numberOfFrames: number;
      sampleRate: number;
      timestamp?: number;
      copyTo: (destination: Float32Array, options: { planeIndex: number; format: string }) => void;
      close?: () => void;
    };

    if (
      typeof data.numberOfChannels !== "number" ||
      typeof data.numberOfFrames !== "number" ||
      typeof data.sampleRate !== "number" ||
      !Number.isFinite(data.numberOfChannels) ||
      !Number.isFinite(data.numberOfFrames) ||
      !Number.isFinite(data.sampleRate) ||
      data.numberOfChannels <= 0 ||
      data.numberOfFrames <= 0 ||
      data.sampleRate <= 0 ||
      typeof data.copyTo !== "function"
    ) {
      return null;
    }

    const buffer = this.audioContext.createBuffer(
      data.numberOfChannels,
      data.numberOfFrames,
      data.sampleRate
    );
    let segmentPeak = 0;
    let segmentSquareSum = 0;
    let segmentSampleCount = 0;
    let segmentNonZeroSampleCount = 0;
    for (let channelIndex = 0; channelIndex < data.numberOfChannels; channelIndex += 1) {
      const channelBuffer = new Float32Array(data.numberOfFrames);
      data.copyTo(channelBuffer, {
        planeIndex: channelIndex,
        format: "f32-planar"
      });
      for (const sample of channelBuffer) {
        if (!Number.isFinite(sample)) {
          continue;
        }

        const absoluteSample = Math.abs(sample);
        segmentPeak = Math.max(segmentPeak, absoluteSample);
        segmentSquareSum += sample * sample;
        segmentSampleCount += 1;
        if (absoluteSample > 0.000001) {
          segmentNonZeroSampleCount += 1;
        }
      }
      buffer.copyToChannel(channelBuffer, channelIndex);
    }
    data.close?.();

    const timestampSec =
      typeof data.timestamp === "number" && Number.isFinite(data.timestamp)
        ? data.timestamp / 1_000_000
        : null;
    const durationSec = data.numberOfFrames / data.sampleRate;
    const startTimeSec =
      timestampSec !== null && timestampSec >= 0 ? timestampSec : this.nextDecodedStartTimeSec;
    const endTimeSec = startTimeSec + durationSec;
    if (!Number.isFinite(startTimeSec) || !Number.isFinite(endTimeSec) || endTimeSec <= startTimeSec) {
      return null;
    }
    this.nextDecodedStartTimeSec = Math.max(this.nextDecodedStartTimeSec, endTimeSec);
    this.decodedPeak = Math.max(this.decodedPeak, segmentPeak);
    this.decodedSquareSum += segmentSquareSum;
    this.decodedSampleCount += segmentSampleCount;
    this.decodedNonZeroSampleCount += segmentNonZeroSampleCount;

    return {
      startTimeSec,
      endTimeSec,
      buffer,
      peak: segmentPeak,
      rms: segmentSampleCount > 0 ? Math.sqrt(segmentSquareSum / segmentSampleCount) : 0,
      nonZeroSampleCount: segmentNonZeroSampleCount
    };
  }

  private scheduleAhead(fromPositionSeconds: number) {
    if (!this.audioContext || !this.destinationNode || !this.gainNode || !this.playing) {
      return;
    }

    this.pruneScheduledSegments();
    const currentTimeSeconds = this.getCurrentTimeSeconds();
    if (!Number.isFinite(fromPositionSeconds) || !Number.isFinite(currentTimeSeconds)) {
      return;
    }

    let scheduledUntilSec = Math.max(fromPositionSeconds, currentTimeSeconds);
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

      if (!Number.isFinite(segment.startTimeSec) || !Number.isFinite(segment.endTimeSec)) {
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
    if (!Number.isFinite(positionSeconds)) {
      return false;
    }

    return this.findBufferedCoverageEnd(positionSeconds) > positionSeconds + 0.02;
  }

  private findBufferedCoverageEnd(positionSeconds: number) {
    if (!Number.isFinite(positionSeconds)) {
      return 0;
    }

    let coverageEnd = positionSeconds;

    for (const segment of this.decodedSegments) {
      if (!Number.isFinite(segment.startTimeSec) || !Number.isFinite(segment.endTimeSec)) {
        continue;
      }
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

  private canUseDecodedPlaybackAt(positionSeconds: number) {
    return (
      (this.status === "ready" || this.status === "degraded" || this.status === "failed") &&
      this.hasBufferedPosition(positionSeconds)
    );
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

function yieldToMicrotasks() {
  return new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

function isTerminalEngineStatus(status: EngineStatus) {
  return status === "destroyed" || status === "failed";
}

function isDestroyedEngineStatus(status: EngineStatus) {
  return status === "destroyed";
}

function decodeWavSample(view: DataView, offset: number, header: WavHeader) {
  if (offset < 0 || offset + header.bitsPerSample / 8 > view.byteLength) {
    return Number.NaN;
  }

  if (header.format === "float") {
    return header.bitsPerSample === 32 ? view.getFloat32(offset, true) : Number.NaN;
  }

  if (header.bitsPerSample === 8) {
    return (view.getUint8(offset) - 128) / 128;
  }

  if (header.bitsPerSample === 16) {
    return Math.max(-1, view.getInt16(offset, true) / 32768);
  }

  if (header.bitsPerSample === 24) {
    const value =
      view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    const signed = value & 0x800000 ? value | 0xff000000 : value;
    return Math.max(-1, signed / 8388608);
  }

  if (header.bitsPerSample === 32) {
    return Math.max(-1, view.getInt32(offset, true) / 2147483648);
  }

  return Number.NaN;
}

function normalizeTrackTimeSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeDurationMs(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundPcmLevel(value: number) {
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 1_000_000) / 1_000_000 : 0;
}
