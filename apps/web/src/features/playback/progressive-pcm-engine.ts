import { getCachedPiecesByIndexes, localCacheOwnerKey } from "@/lib/indexeddb";
import { pieceMemoryBuffer } from "@/features/p2p/piece-memory-buffer";
import {
  getChunkIndexForPositionMs,
  isWavTrack,
  type ProgressiveTrackManifest
} from "./progressive-playback";
import {
  extractFlacPacketsFromBitstream,
  type ProgressiveFlacFramePacket,
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

export type PcmPlaybackTimeline = {
  key: string | null;
  revision: number | null;
};

type NormalizedPcmPlaybackTimeline = {
  key: string;
  revision: number;
};

export type PcmEngineSyncPlaybackInput = {
  expectedSeconds: number;
  isPlaying: boolean;
  playbackTimeline?: PcmPlaybackTimeline | null;
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

const pcmScheduleAheadSeconds = 45;
const pcmSoftResyncDriftMs = 220;
const pcmHardResyncDriftMs = 720;
const pcmMaxSoftCorrectionSeconds = 0.05;
const pcmNativeHandoffFadeMs = 140;
const pcmNativeHandoffTailHoldMs = 120;
const pcmNativeHandoffReleasePaddingMs = 20;
const pcmDecodedSegmentRetentionSeconds = 75;
const pcmPlaybackRefillIntervalMs = 80;
const pcmPlaybackRefillTargetAheadMs = 60_000;
const pcmPlaybackRefillMinScheduledAheadMs = 25_000;
// Maximum gap between decoded segments that the coverage checker tolerates
// before declaring the buffer missing.  P2P delivery is unordered and FLAC
// frame extraction across chunk boundaries can produce small timing gaps;
// a slightly relaxed tolerance avoids false "buffer-missing" signals that
// would cause audible stutter.
const pcmCoverageGapToleranceSec = 0.25;
const pcmParsedByteCompactionThreshold = 512 * 1024;
// Steady-state: batch-read up to this many contiguous chunks per sync.
// With the in-memory buffer + batch IndexedDB reads, reading 16 chunks is
// nearly as cheap as reading 1, so a moderate value here keeps the decoder
// fed without blocking the main thread on large track switches.
const maxPcmCachedPiecesToAppendPerSync = 16;
// Catch-up mode: pull enough contiguous prefix for the requested playback
// point, but do not drain the full cache in one turn while the downloader is
// also writing. Current-window decoding handles far seeks through sparse reads.
const maxPcmCatchupPiecesToAppendPerSync = 32;
const pcmCatchupLookAheadChunks = 2;
const maxPcmPlaybackCatchupSyncBatches = 8;
export class ProgressivePcmEngine {
  private audioContext: AudioContext | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private gainNode: GainNode | null = null;
  private keepAliveOscillator: OscillatorNode | null = null;
  private keepAliveGain: GainNode | null = null;
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
  private decodedFlacPacketTimestampUs = new Set<number>();
  private pendingDecodedFlacPacketTimings: Array<{ timestampUs: number; durationUs: number }> = [];
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
  private refillTimerId: ReturnType<typeof setInterval> | null = null;
  private refillInFlight = false;
  private nativeHandoffTailReleaseAtMs: number | null = null;
  // Chunk index the decoder still needs to reach to cover the requested
  // playback position. While set, contiguous append runs in catch-up mode and
  // is not throttled by the small steady-state per-sync cap.
  private catchupTargetChunkIndex: number | null = null;
  private playbackTimelineKey: string | null = null;
  private playbackTimelineRevision: number | null = null;

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
      // Route decoded PCM straight to the AudioContext destination. On
      // Chrome/Edge a MediaStreamAudioDestinationNode stream attached to
      // <audio srcObject> stays silent (it is only wired for WebRTC), so the
      // element path is unreliable. Keeping both routes connected can also
      // play the same PCM twice in browsers that do render srcObject audio.
      this.gainNode.connect(this.audioContext.destination);
      this.directOutputConnected = true;

      // Chrome auto-suspends idle AudioContexts after ~30 s. During initial
      // caching there may be no decoded segments to schedule yet, so the
      // context would go idle and stay suspended — resuming it requires a
      // user gesture that we won't have. A silent inaudible oscillator
      // keeps the context "running" so scheduled audio flows immediately
      // once data becomes available.
      this.keepAliveGain = this.audioContext.createGain();
      this.keepAliveGain.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.keepAliveGain.connect(this.audioContext.destination);
      this.keepAliveOscillator = this.audioContext.createOscillator();
      this.keepAliveOscillator.frequency.setValueAtTime(440, this.audioContext.currentTime);
      this.keepAliveOscillator.connect(this.keepAliveGain);
      this.keepAliveOscillator.start();

      this.audio.srcObject = null;
      this.audio.muted = false;
      this.audio.volume = 1;
      return true;
    } catch {
      this.status = "failed";
      return false;
    }
  }

  async sync() {
    if (isTerminalEngineStatus(this.status)) {
      return false;
    }

    if (this.syncInFlight) {
      this.syncQueued = true;
      return false;
    }

    this.syncInFlight = true;
    let appendedAny = false;
    try {
      do {
        this.syncQueued = false;
        appendedAny = (await this.performSync()) || appendedAny;
      } while (this.syncQueued && !isTerminalEngineStatus(this.status));
    } catch (error) {
      if (!isDestroyedEngineStatus(this.status)) {
        // IndexedDB AbortError is transient (write/read transaction contention
        // or a page-lifecycle abort). Do NOT mark the engine failed for it —
        // that would permanently stop playback for a recoverable hiccup. Leave
        // state intact so the next tick simply retries the cache read.
        if (!isTransientCacheReadError(error)) {
          this.lastDecodeError = "cache-read-failed";
          this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
        }
      }
    } finally {
      this.syncInFlight = false;
    }
    return appendedAny;
  }

  async syncPlayback(input: PcmEngineSyncPlaybackInput): Promise<PcmEngineSyncResult> {
    const positionSeconds = normalizeTrackTimeSeconds(input.expectedSeconds);
    const timelineDecision = this.resolvePlaybackTimelineDecision(input.playbackTimeline);
    if (timelineDecision.stale) {
      return this.createStalePlaybackTimelineSyncResult(positionSeconds);
    }
    if (timelineDecision.timeline) {
      this.playbackTimelineKey = timelineDecision.timeline.key;
      this.playbackTimelineRevision = timelineDecision.timeline.revision;
    }

    this.pruneDecodedSegments(positionSeconds);

    if (!input.isPlaying) {
      this.pausedTrackTimeSec = positionSeconds;
      this.playing = false;
      this.stopPlaybackRefillLoop();
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

      // If the initial sync found no data (chunk 0 not cached yet for
      // FLAC/WAV header), yield to the macrotask queue.  IndexedDB
      // write transactions commit on macrotasks — microtask yields
      // (queueMicrotask) don't flush them.
      if (this.status === "opening" || this.status === "idle") {
        await yieldToMacrotask();
        if (!isTerminalEngineStatus(this.status)) {
          await this.sync();
        }
      }
    }

    if (!this.audioContext) {
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: this.getCurrentTimeSeconds(),
        blockedReason: "missing-audio-context"
      };
    }

    // Terminal / non-recoverable statuses can't be helped by retrying.
    if (this.status === "idle") {
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: this.getCurrentTimeSeconds(),
        blockedReason: "engine-not-attached"
      };
    }

    if (this.status === "failed" && !this.canUseDecodedPlaybackAt(positionSeconds)) {
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: this.getCurrentTimeSeconds(),
        blockedReason: this.lastDecodeError ? this.lastDecodeError : `engine-${this.status}`
      };
    }

    await this.syncUntilBufferedPosition(positionSeconds);

    if (!this.hasBufferedPosition(positionSeconds)) {
      this.playing = false;
      this.stopPlaybackRefillLoop();
      this.pausedTrackTimeSec = positionSeconds;
      this.stopScheduledSegments();
      // The direct AudioContext path outputs silence naturally when no
      // segments are scheduled. Avoid pausing the shared element here; it may
      // still be used by native full-local handoff in the same playback flow.
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
      this.stopPlaybackRefillLoop();
      this.pausedTrackTimeSec = positionSeconds;
      this.stopScheduledSegments();
      // Same reasoning as above: keep the shared element state intact while
      // the direct AudioContext path waits for resume.
      return {
        localReady: false,
        driftMs: Number.POSITIVE_INFINITY,
        playbackPositionSeconds: positionSeconds,
        blockedReason: `audio-context-${this.audioContext.state}`
      };
    }

    const driftMs = Math.abs(this.getCurrentTimeSeconds() - positionSeconds) * 1000;
    const shouldHardSync =
      !this.playing ||
      timelineDecision.hardSync ||
      driftMs > pcmHardResyncDriftMs ||
      (this.scheduledSegments.length === 0 && driftMs > pcmSoftResyncDriftMs);
    if (shouldHardSync) {
      const wasPlaying = this.playing;
      this.playing = true;
      this.pausedTrackTimeSec = positionSeconds;
      this.anchorTrackTimeSec = positionSeconds;
      // On the initial transition from not-playing, use a minimal anchor
      // offset: scheduleAhead already adds +0.02 s via Math.max, so 5 ms
      // here keeps the total under one render quantum (~25 ms).
      // When re-anchoring mid-playback (drift correction) keep the
      // original 50 ms margin to absorb clock skew between the system
      // timer and the AudioContext clock.
      this.anchorContextTimeSec =
        this.audioContext.currentTime + (wasPlaying ? 0.05 : 0.005);
      if (wasPlaying) {
        this.stopScheduledSegments();
      }
    } else if (driftMs > pcmSoftResyncDriftMs) {
      this.applySoftDriftCorrection(positionSeconds);
    }

    this.startPlaybackRefillLoop();
    this.scheduleAhead(positionSeconds);

    return {
      localReady: true,
      driftMs: Math.abs(this.getCurrentTimeSeconds() - positionSeconds) * 1000,
      playbackPositionSeconds: this.getCurrentTimeSeconds(),
      blockedReason: null
    };
  }

  prepareForNativeHandoff(fadeMs = pcmNativeHandoffFadeMs) {
    if (!this.audioContext || !this.gainNode || this.status === "destroyed") {
      return false;
    }

    const currentPlaybackSeconds = this.getCurrentTimeSeconds();
    const now = this.audioContext.currentTime;
    const fadeSeconds = Math.max(0, fadeMs) / 1000;
    const holdSeconds = pcmNativeHandoffTailHoldMs / 1000;
    const gain = this.gainNode.gain;
    try {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      if (holdSeconds > 0) {
        gain.setValueAtTime(gain.value, now + holdSeconds);
      }
      if (fadeSeconds > 0 && typeof gain.linearRampToValueAtTime === "function") {
        gain.linearRampToValueAtTime(0, now + holdSeconds + fadeSeconds);
      } else {
        gain.setValueAtTime(0, now + holdSeconds);
      }
    } catch {
      try {
        gain.setValueAtTime(0, now);
      } catch {
        // If the AudioParam is already detached, the engine is on its way out.
      }
    }
    this.playing = false;
    this.stopPlaybackRefillLoop();
    this.pausedTrackTimeSec = currentPlaybackSeconds;
    this.nativeHandoffTailReleaseAtMs =
      Date.now() +
      pcmNativeHandoffTailHoldMs +
      Math.max(0, fadeMs) +
      pcmNativeHandoffReleasePaddingMs;
    return true;
  }

  destroy() {
    if (this.status === "destroyed") {
      return;
    }

    this.status = "destroyed";
    this.stopPlaybackRefillLoop();
    const preserveNativeHandoffTail =
      this.nativeHandoffTailReleaseAtMs !== null && this.scheduledSegments.length > 0;
    const preservedScheduledSegments = preserveNativeHandoffTail
      ? [...this.scheduledSegments]
      : [];
    const preservedGainNode = preserveNativeHandoffTail ? this.gainNode : null;
    const preservedDestinationNode = preserveNativeHandoffTail ? this.destinationNode : null;
    const preservedAudioContext = preserveNativeHandoffTail ? this.audioContext : null;
    const nativeHandoffReleaseDelayMs = preserveNativeHandoffTail
      ? Math.max(0, (this.nativeHandoffTailReleaseAtMs ?? Date.now()) - Date.now())
      : 0;
    if (preserveNativeHandoffTail) {
      this.scheduledSegments = [];
    } else {
      this.stopScheduledSegments();
    }
    // Release in-memory buffered pieces for this track so they don't leak.
    pieceMemoryBuffer.clearTrack(this.manifest.trackId);
    // The engine runs on a shared AudioContext, so destroying it never closes
    // the context. Explicitly disconnect the graph, otherwise stale gain nodes
    // from previous engine instances stay wired to the destination and overlap
    // their output with the new engine, which is heard as popping/clipping.
    if (!preserveNativeHandoffTail) {
      try {
        this.gainNode?.disconnect();
      } catch {
        // The node may already be disconnected after a fatal graph teardown.
      }
      try {
        this.destinationNode?.disconnect();
      } catch {
        // Ignore double-disconnect races during teardown.
      }
    }
    this.directOutputConnected = false;
    const decoder = this.decoder;
    this.decoder = null;
    try {
      decoder?.close?.();
    } catch {
      // WebCodecs may have already closed the decoder after a fatal decode error.
    }
    if (this.audio.srcObject === this.destinationNode?.stream) {
      // Don't pause() or load() — both reset the element's sticky
      // autoplay activation granted during the user-gesture priming.
      // Setting srcObject to null alone triggers the media element load
      // algorithm per the HTML spec, which pauses the element. The
      // next engine's attach() will set a new stream and attempt to
      // resume playback via the still-valid gesture activation.
      this.audio.srcObject = null;
    }
    if (this.keepAliveOscillator) {
      try { this.keepAliveOscillator.stop(); } catch { /* already stopped */ }
      this.keepAliveOscillator.disconnect();
      this.keepAliveOscillator = null;
    }
    if (this.keepAliveGain) {
      this.keepAliveGain.disconnect();
      this.keepAliveGain = null;
    }
    if (!this.audioContextProvider && !preserveNativeHandoffTail) {
      void this.audioContext?.close().catch(() => undefined);
    }
    if (preserveNativeHandoffTail) {
      setTimeout(() => {
        this.stopScheduledSegmentList(preservedScheduledSegments);
        try {
          preservedGainNode?.disconnect();
        } catch {
          // The node may already be disconnected after a fatal graph teardown.
        }
        try {
          preservedDestinationNode?.disconnect();
        } catch {
          // Ignore double-disconnect races during teardown.
        }
        if (!this.audioContextProvider) {
          void preservedAudioContext?.close().catch(() => undefined);
        }
      }, nativeHandoffReleaseDelayMs);
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
    this.decodedFlacPacketTimestampUs.clear();
    this.pendingDecodedFlacPacketTimings = [];
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
    this.refillInFlight = false;
    this.nativeHandoffTailReleaseAtMs = null;
    this.catchupTargetChunkIndex = null;
    this.playbackTimelineKey = null;
    this.playbackTimelineRevision = null;
  }

  private startPlaybackRefillLoop() {
    if (this.refillTimerId !== null || this.status === "destroyed") {
      return;
    }

    this.refillTimerId = setInterval(() => {
      void this.refillPlaybackBuffer();
    }, pcmPlaybackRefillIntervalMs);
  }

  private stopPlaybackRefillLoop() {
    if (this.refillTimerId === null) {
      return;
    }

    clearInterval(this.refillTimerId);
    this.refillTimerId = null;
  }

  private async refillPlaybackBuffer() {
    if (
      this.refillInFlight ||
      !this.playing ||
      !this.audioContext ||
      isTerminalEngineStatus(this.status)
    ) {
      return;
    }

    this.refillInFlight = true;
    try {
      const currentPlaybackSeconds = this.getCurrentTimeSeconds();
      this.scheduleAhead(currentPlaybackSeconds);
      if (
        this.getScheduledAheadMs(currentPlaybackSeconds) >=
        pcmPlaybackRefillMinScheduledAheadMs
      ) {
        return;
      }
      if (
        this.getBufferedAheadMs(currentPlaybackSeconds) >= pcmPlaybackRefillTargetAheadMs ||
        isTerminalEngineStatus(this.status)
      ) {
        return;
      }

      await this.sync();
      if (!this.playing || !this.audioContext || isTerminalEngineStatus(this.status)) {
        return;
      }

      this.scheduleAhead(this.getCurrentTimeSeconds());
    } finally {
      this.refillInFlight = false;
    }
  }

  private resolvePlaybackTimelineDecision(playbackTimeline: PcmPlaybackTimeline | null | undefined) {
    const timeline = normalizePcmPlaybackTimeline(playbackTimeline);
    if (!timeline) {
      return {
        stale: false,
        hardSync: false,
        timeline: null
      };
    }

    if (this.playbackTimelineKey === null || this.playbackTimelineRevision === null) {
      return {
        stale: false,
        hardSync: true,
        timeline
      };
    }

    if (timeline.key !== this.playbackTimelineKey) {
      return {
        stale: false,
        hardSync: true,
        timeline
      };
    }

    if (timeline.revision < this.playbackTimelineRevision) {
      return {
        stale: true,
        hardSync: false,
        timeline: null
      };
    }

    return {
      stale: false,
      hardSync: timeline.revision > this.playbackTimelineRevision,
      timeline
    };
  }

  private createStalePlaybackTimelineSyncResult(positionSeconds: number): PcmEngineSyncResult {
    const currentPlaybackSeconds = this.getCurrentTimeSeconds();
    if (this.playing) {
      this.scheduleAhead(currentPlaybackSeconds);
    }
    return {
      localReady: this.hasBufferedPosition(currentPlaybackSeconds),
      driftMs: Math.abs(currentPlaybackSeconds - positionSeconds) * 1000,
      playbackPositionSeconds: this.getCurrentTimeSeconds(),
      blockedReason: null
    };
  }

  private applySoftDriftCorrection(positionSeconds: number) {
    const currentSeconds = this.getCurrentTimeSeconds();
    if (!Number.isFinite(currentSeconds) || !Number.isFinite(positionSeconds)) {
      return;
    }

    const correctionSeconds = clamp(
      positionSeconds - currentSeconds,
      -pcmMaxSoftCorrectionSeconds,
      pcmMaxSoftCorrectionSeconds
    );
    this.anchorTrackTimeSec = normalizeTrackTimeSeconds(
      this.anchorTrackTimeSec + correctionSeconds
    );
    this.pausedTrackTimeSec = normalizeTrackTimeSeconds(
      this.pausedTrackTimeSec + correctionSeconds
    );
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

          this.insertDecodedSegment(segment);
          this.lastDecodedAtMs = Date.now();
          if (this.playing) {
            this.scheduleAhead(this.getCurrentTimeSeconds());
          }
        },
        error: (error) => {
          this.lastDecodeError = error instanceof Error ? error.message : "decode-error";
          this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
          this.decoder = null;
          this.pendingDecodedFlacPacketTimings = [];
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
      return false;
    }

    if (!appendedBytes) {
      return false;
    }

    if (isWavTrack(this.manifest)) {
      this.decodeAvailableWavPcm();
      return true;
    }

    const extraction = extractFlacPacketsFromBitstream({
      bytes: this.contiguousBytes.subarray(0, this.contiguousByteLength),
      startOffset: this.parsedOffset,
      nextSampleIndex: this.nextSampleIndex,
      finalChunk: this.contiguousChunkCount >= this.manifest.totalChunks
    });

    if (!extraction.streamInfo) {
      return true;
    }

    if (!this.streamInfo) {
      this.streamInfo = extraction.streamInfo;
    }

    const decoderReady = await this.ensureDecoder(extraction.streamInfo);
    if (!decoderReady || !this.decoder) {
      this.lastDecodeError = "decoder-unavailable";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      return true;
    }

    await this.decodeFlacPackets(extraction.packets);

    this.parsedOffset = extraction.nextOffset;
    this.nextSampleIndex = extraction.nextSampleIndex;
    this.compactParsedFlacBytes(extraction.streamInfo);
    return true;
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
    this.insertDecodedSegment(segment);
    this.lastDecodedAtMs = Date.now();
    if (this.playing) {
      this.scheduleAhead(this.getCurrentTimeSeconds());
    }
  }

  private getAppendBudgetForCurrentSync() {
    if (
      this.catchupTargetChunkIndex !== null &&
      this.contiguousChunkCount <= this.catchupTargetChunkIndex
    ) {
      return Math.min(
        maxPcmCatchupPiecesToAppendPerSync,
        Math.max(
          1,
          this.catchupTargetChunkIndex - this.contiguousChunkCount + 1 + pcmCatchupLookAheadChunks
        )
      );
    }

    return maxPcmCachedPiecesToAppendPerSync;
  }

  private async appendAvailableContiguousPieces() {
    if (isTerminalEngineStatus(this.status)) {
      return false;
    }

    const budget = this.getAppendBudgetForCurrentSync();
    if (budget <= 0) {
      return false;
    }

    // Build the list of chunk indexes we need (contiguous from current position).
    const maxChunkIndex = Math.min(
      this.manifest.totalChunks - 1,
      this.contiguousChunkCount + budget - 1
    );
    const neededChunks: number[] = [];
    for (let i = this.contiguousChunkCount; i <= maxChunkIndex; i++) {
      neededChunks.push(i);
    }
    if (neededChunks.length === 0) {
      return false;
    }

    // 1. Check the in-memory piece buffer first (instant, no I/O).
    pieceMemoryBuffer.setActiveWindow(this.manifest.trackId, neededChunks);
    const memoryPieces = pieceMemoryBuffer.getBatch(this.manifest.trackId, neededChunks);

    // 2. For chunks not in memory, batch-read from IndexedDB in a single query.
    const idbNeededChunks = neededChunks.filter((c) => !memoryPieces.has(c));
    const idbPieces = new Map<number, ArrayBuffer>();
    if (idbNeededChunks.length > 0) {
      const records = await getCachedPiecesByIndexes(
        this.manifest.trackId,
        this.peerId,
        idbNeededChunks,
        {
          fileHash: this.manifest.fileHash || null,
          ownerKey: localCacheOwnerKey,
          chunkSize: this.manifest.chunkSize
        }
      );
      for (const record of records) {
        idbPieces.set(record.chunkIndex, record.payload);
      }
    }

    if (isTerminalEngineStatus(this.status)) {
      return false;
    }

    // 3. Append chunks in contiguous order. Stop at the first gap.
    let appended = false;
    for (const chunkIndex of neededChunks) {
      const payload = memoryPieces.get(chunkIndex) ?? idbPieces.get(chunkIndex);
      if (!payload) {
        break; // Gap — stop, can't append non-contiguous chunks
      }

      this.appendContiguousBytes(payload);
      this.contiguousChunkCount += 1;
      appended = true;

      // Evict from memory buffer now that the decoder owns the bytes.
      if (memoryPieces.has(chunkIndex)) {
        pieceMemoryBuffer.evict(this.manifest.trackId, chunkIndex);
      }
    }

    return appended;
  }

  private async decodeFlacPackets(packets: ProgressiveFlacFramePacket[]) {
    if (packets.length === 0 || !this.decoder) {
      return false;
    }

    const EncodedAudioChunkCtor = getEncodedAudioChunkCtor();
    if (!EncodedAudioChunkCtor) {
      this.lastDecodeError = "encoded-audio-chunk-unavailable";
      this.status = this.decodedSegments.length > 0 ? "degraded" : "failed";
      return false;
    }

    let decodedAny = false;
    for (const packet of packets) {
      if (this.decodedFlacPacketTimestampUs.has(packet.timestampUs)) {
        if (this.hasPlaybackCoverageForFlacPacket(packet)) {
          continue;
        }
        this.decodedFlacPacketTimestampUs.delete(packet.timestampUs);
      }

      try {
        this.decoder.decode(
          new EncodedAudioChunkCtor({
            type: "key",
            timestamp: packet.timestampUs,
            duration: packet.durationUs,
            data: packet.data
          })
        );
        this.decodedFlacPacketTimestampUs.add(packet.timestampUs);
        this.pendingDecodedFlacPacketTimings.push({
          timestampUs: packet.timestampUs,
          durationUs: packet.durationUs
        });
        this.decodedPacketCount += 1;
        decodedAny = true;
      } catch (error) {
        this.lastDecodeError = error instanceof Error ? error.message : "decode-throw";
        const hasDecodedBefore = this.decodedSegments.length > 0;
        this.status = hasDecodedBefore ? "degraded" : "failed";
        if (hasDecodedBefore) {
          // A decode() throw usually means WebCodecs has already closed the
          // decoder internally. Drop our handle so the next performSync rebuilds
          // a fresh decoder and playback can recover, instead of hammering a
          // dead decoder forever (which left playback stuck and silent even
          // after pause/resume).
          try {
            this.decoder?.close?.();
          } catch {
            // Already closed by WebCodecs after the fatal decode error.
          }
          this.decoder = null;
          this.pendingDecodedFlacPacketTimings = [];
        }
        break;
      }
    }

    if (decodedAny) {
      await this.flushDecoder();
    }

    return decodedAny;
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
      this.pendingDecodedFlacPacketTimings = [];
    }
  }

  private async waitForDecodedPosition(positionSeconds: number) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await yieldToMicrotasks();
      if (this.hasBufferedPosition(positionSeconds) || isTerminalEngineStatus(this.status)) {
        return;
      }
    }
    // IndexedDB write transactions from the downloader commit on the
    // macrotask queue, not the microtask queue.  Yield once so newly
    // cached chunks become visible before the catchup loop gives up.
    await yieldToMacrotask();
    if (this.hasBufferedPosition(positionSeconds) || isTerminalEngineStatus(this.status)) {
      return;
    }
  }

  private async syncUntilBufferedPosition(positionSeconds: number) {
    this.catchupTargetChunkIndex = getChunkIndexForPositionMs(
      this.manifest,
      positionSeconds * 1000
    );
    const trackLabel = `${this.manifest.trackId.slice(0, 8)}`;
    try {
      for (let attempt = 0; attempt < maxPcmPlaybackCatchupSyncBatches; attempt += 1) {
        if (this.hasBufferedPosition(positionSeconds) || isTerminalEngineStatus(this.status)) {
          return;
        }

        const appended = await this.sync();

        if (!appended) {
          // No new contiguous bytes were cached since the last sync.  Yield
          // once to let any in-flight decoder output callbacks materialize
          // before we give up; the previous performSync may have submitted
          // packets whose output hasn't reached the main thread yet.
          await this.waitForDecodedPosition(positionSeconds);
          if (attempt === 0) {
            console.debug(
              `[pcm] ${trackLabel} catchup stalled at iteration 0: ` +
              `contiguousChunks=${this.contiguousChunkCount} ` +
              `targetChunk=${this.catchupTargetChunkIndex} ` +
              `decodedSegments=${this.decodedSegments.length} ` +
              `hasStreamInfo=${!!this.streamInfo} ` +
              `hasDecoder=${!!this.decoder}`
            );
          }
          break;
        }

        await this.waitForDecodedPosition(positionSeconds);
      }
    } finally {
      this.catchupTargetChunkIndex = null;
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

    // Capture the AudioData geometry BEFORE any close(). WebCodecs releases the
    // backing frame on close() and subsequently reading numberOfFrames /
    // sampleRate / timestamp yields 0 or NaN, which previously made durationSec
    // NaN and caused every decoded segment to be rejected (progress advances but
    // no audio is ever scheduled).
    const numberOfChannels = data.numberOfChannels;
    const numberOfFrames = data.numberOfFrames;
    const sampleRate = data.sampleRate;
    const rawTimestamp = data.timestamp;

    const buffer = this.audioContext.createBuffer(
      numberOfChannels,
      numberOfFrames,
      sampleRate
    );
    let segmentPeak = 0;
    let segmentSquareSum = 0;
    let segmentSampleCount = 0;
    let segmentNonZeroSampleCount = 0;
    for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
      const channelBuffer = new Float32Array(numberOfFrames);
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
      typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)
        ? rawTimestamp / 1_000_000
        : null;
    const queuedFlacTiming = this.pendingDecodedFlacPacketTimings.shift() ?? null;
    const durationSec = numberOfFrames / sampleRate;
    const startTimeSec =
      timestampSec !== null && timestampSec >= 0
        ? timestampSec
        : queuedFlacTiming
          ? queuedFlacTiming.timestampUs / 1_000_000
          : this.nextDecodedStartTimeSec;
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
    if (!this.audioContext || !this.gainNode || !this.playing) {
      return;
    }

    this.pruneDecodedSegments(fromPositionSeconds);
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

      if (segment.startTimeSec > scheduledUntilSec + pcmCoverageGapToleranceSec) {
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

  private getScheduledAheadMs(positionSeconds = this.getCurrentTimeSeconds()) {
    if (!Number.isFinite(positionSeconds) || this.scheduledSegments.length === 0) {
      return 0;
    }

    const sortedSegments = [...this.scheduledSegments].sort(
      (left, right) => left.startTimeSec - right.startTimeSec
    );
    let coverageEnd = positionSeconds;
    for (const segment of sortedSegments) {
      if (!Number.isFinite(segment.startTimeSec) || !Number.isFinite(segment.endTimeSec)) {
        continue;
      }
      if (segment.endTimeSec <= coverageEnd + 0.001) {
        continue;
      }
      if (segment.startTimeSec > coverageEnd + pcmCoverageGapToleranceSec) {
        break;
      }
      coverageEnd = Math.max(coverageEnd, segment.endTimeSec);
    }

    return normalizeDurationMs(Math.round(Math.max(0, coverageEnd - positionSeconds) * 1000));
  }

  private hasPlaybackCoverageForFlacPacket(packet: ProgressiveFlacFramePacket) {
    const packetStartSec = packet.timestampUs / 1_000_000;
    const packetEndSec = packetStartSec + packet.durationUs / 1_000_000;
    if (!Number.isFinite(packetStartSec) || !Number.isFinite(packetEndSec)) {
      return false;
    }

    const coversPacket = (segment: { startTimeSec: number; endTimeSec: number }) =>
      Number.isFinite(segment.startTimeSec) &&
      Number.isFinite(segment.endTimeSec) &&
      segment.startTimeSec <= packetStartSec + 0.001 &&
      segment.endTimeSec >= Math.min(packetEndSec, packetStartSec + 0.02);

    return (
      this.decodedSegments.some(coversPacket) ||
      this.scheduledSegments.some(coversPacket)
    );
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

      if (segment.startTimeSec > coverageEnd + pcmCoverageGapToleranceSec) {
        break;
      }

      coverageEnd = Math.max(coverageEnd, segment.endTimeSec);
    }

    return coverageEnd;
  }

  private stopScheduledSegments() {
    this.stopScheduledSegmentList(this.scheduledSegments);
    this.scheduledSegments = [];
  }

  private stopScheduledSegmentList(segments: ScheduledSegment[]) {
    for (const segment of segments) {
      segment.source.onended = null;
      try {
        segment.source.stop();
      } catch {
        // noop
      }
      segment.source.disconnect();
    }
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

  private compactParsedFlacBytes(streamInfo: ProgressiveFlacStreamInfo | null) {
    if (
      !streamInfo ||
      this.parsedOffset <= pcmParsedByteCompactionThreshold
    ) {
      return;
    }

    const description = streamInfo.description;
    const safeParsedOffset = Math.min(this.parsedOffset, this.contiguousByteLength);
    if (safeParsedOffset <= description.byteLength) {
      return;
    }
    const remainingBytes = this.contiguousBytes.subarray(
      safeParsedOffset,
      this.contiguousByteLength
    );
    const compactedBytes = new Uint8Array(description.byteLength + remainingBytes.byteLength);
    compactedBytes.set(description, 0);
    compactedBytes.set(remainingBytes, description.byteLength);
    this.contiguousBytes = compactedBytes;
    this.contiguousByteLength = compactedBytes.byteLength;
    this.parsedOffset = description.byteLength;
  }

  private insertDecodedSegment(segment: DecodedSegment) {
    const segments = this.decodedSegments;
    if (segments.length === 0 || segment.startTimeSec >= segments[segments.length - 1]!.startTimeSec) {
      segments.push(segment);
      return;
    }

    if (segment.startTimeSec <= segments[0]!.startTimeSec) {
      segments.unshift(segment);
      return;
    }

    let low = 0;
    let high = segments.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (segments[mid]!.startTimeSec < segment.startTimeSec) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    segments.splice(low, 0, segment);
  }

  private pruneDecodedSegments(positionSeconds: number) {
    if (!Number.isFinite(positionSeconds) || this.decodedSegments.length === 0) {
      return;
    }

    const cutoffSeconds = Math.max(0, positionSeconds - pcmDecodedSegmentRetentionSeconds);
    if (cutoffSeconds <= 0) {
      return;
    }

    let firstRetainedIndex = 0;
    while (
      firstRetainedIndex < this.decodedSegments.length &&
      this.decodedSegments[firstRetainedIndex]!.endTimeSec < cutoffSeconds
    ) {
      firstRetainedIndex += 1;
    }

    if (firstRetainedIndex > 0) {
      this.decodedSegments = this.decodedSegments.slice(firstRetainedIndex);
    }
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

/** Yield to the macrotask queue so pending IndexedDB write transactions
 *  (from the downloader) commit before the engine reads again.  Without
 *  this the engine's catchup loop retries reads against stale storage
 *  and breaks early, reporting buffer-missing. */
function yieldToMacrotask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function isTerminalEngineStatus(status: EngineStatus) {
  return status === "destroyed" || status === "failed";
}

function isTransientCacheReadError(error: unknown) {
  // IndexedDB aborts a transaction (AbortError) on contention with concurrent
  // writes or during page-lifecycle teardown. These are recoverable and should
  // be retried, not treated as a fatal engine failure.
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? (error as { name?: unknown }).name
      : undefined;
  return name === "AbortError" || name === "TransactionInactiveError";
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

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizePcmPlaybackTimeline(
  playbackTimeline: PcmPlaybackTimeline | null | undefined
): NormalizedPcmPlaybackTimeline | null {
  const key =
    typeof playbackTimeline?.key === "string" && playbackTimeline.key.length > 0
      ? playbackTimeline.key
      : null;
  const revision =
    typeof playbackTimeline?.revision === "number" &&
    Number.isFinite(playbackTimeline.revision)
      ? Math.max(0, Math.floor(playbackTimeline.revision))
      : null;

  return key && revision !== null
    ? {
        key,
        revision
      }
    : null;
}

function normalizeDurationMs(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundPcmLevel(value: number) {
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 1_000_000) / 1_000_000 : 0;
}
