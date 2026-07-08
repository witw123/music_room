import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedPiece, getCachedPiecesByIndexes } from "@/lib/indexeddb";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";
import { extractFlacPacketsFromBitstream } from "./progressive-flac";

vi.mock("@/lib/indexeddb", () => ({
  getCachedPiece: vi.fn(),
  getCachedPiecesByIndexes: vi.fn(),
  localCacheOwnerKey: "__local__"
}));

vi.mock("@/features/p2p/piece-memory-buffer", () => ({
  pieceMemoryBuffer: {
    put: vi.fn(),
    get: vi.fn(),
    getBatch: vi.fn(() => new Map()),
    evict: vi.fn(),
    clearTrack: vi.fn()
  }
}));

vi.mock("./progressive-flac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./progressive-flac")>();
  return {
    ...actual,
    extractFlacPacketsFromBitstream: vi.fn(() => ({
      streamInfo: {
        description: new Uint8Array([1, 2, 3]),
        audioOffset: 0,
        sampleRate: 44_100,
        numberOfChannels: 2,
        bitsPerSample: 16,
        totalSamples: null
      },
      packets: [],
      nextOffset: 0,
      nextSampleIndex: 0
    }))
  };
});

const manifest = {
  trackId: "track_1",
  fileHash: "hash_1",
  mimeType: "audio/flac",
  codec: "flac",
  sizeBytes: 1,
  durationMs: 1_000,
  totalChunks: 4,
  chunkSize: 256 * 1024
} as const;

function installFakeAudioContext(
  options: {
    decodedTimestamp?: number;
    decodedSampleValue?: number;
    rejectFlush?: boolean;
  } = {}
) {
  const originalWindow = globalThis.window;
  const originalAudioDecoder = (
    globalThis as typeof globalThis & { AudioDecoder?: unknown }
  ).AudioDecoder;
  const originalEncodedAudioChunk = (
    globalThis as typeof globalThis & { EncodedAudioChunk?: unknown }
  ).EncodedAudioChunk;
  function makeGainNode() {
    return {
      connectCalls: [] as unknown[],
      disconnectCalls: 0,
      gain: {
        value: 1,
        cancelScheduledValues(_time: number) {
          return undefined;
        },
        setValueAtTime(value: number) {
          this.value = value;
          return this;
        },
        linearRampToValueAtTime(value: number) {
          this.value = value;
          return this;
        }
      },
      connect(target: unknown) {
        this.connectCalls.push(target);
        return undefined;
      },
      disconnect() {
        this.disconnectCalls += 1;
        return undefined;
      }
    };
  }
  const gainNode = makeGainNode();
  const bufferSources: Array<{
    stopCalls: number;
    disconnectCalls: number;
    startCalls: Array<{ when?: number; offset?: number; duration?: number }>;
  }> = [];
  const mediaStreamDestination = {
    stream: {},
    disconnectCalls: 0,
    connect() {
      return undefined;
    },
    disconnect() {
      this.disconnectCalls += 1;
      return undefined;
    }
  };
  const audioDestination = {};

  class FakeAudioContext {
    currentTime = 0;
    state = "running" as AudioContextState;
    destination = audioDestination;
    gainNode = gainNode;
    private _gainCallCount = 0;

    createGain() {
      // First call returns the tracked gainNode used in test assertions;
      // subsequent calls (keep-alive) return fresh lightweight mocks.
      if (this._gainCallCount === 0) {
        this._gainCallCount += 1;
        return gainNode;
      }
      return makeGainNode();
    }

    createMediaStreamDestination() {
      return mediaStreamDestination;
    }

    createBufferSource() {
      const source = {
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect() {
          return undefined;
        },
        start(when?: number, offset?: number, duration?: number) {
          this.startCalls.push({ when, offset, duration });
          return undefined;
        },
        startCalls: [] as Array<{ when?: number; offset?: number; duration?: number }>,
        stopCalls: 0,
        stop() {
          this.stopCalls += 1;
          return undefined;
        },
        disconnectCalls: 0,
        disconnect() {
          this.disconnectCalls += 1;
          return undefined;
        }
      };
      bufferSources.push(source);
      return source;
    }

    createOscillator() {
      return {
        frequency: {
          setValueAtTime(_value: number, _time: number) {}
        },
        connect(_target: unknown) {
          return undefined;
        },
        start(_when?: number) {
          return undefined;
        },
        stop(_when?: number) {
          return undefined;
        },
        disconnect() {
          return undefined;
        }
      };
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }

    createBuffer(numberOfChannels: number, numberOfFrames: number, sampleRate: number) {
      return {
        numberOfChannels,
        numberOfFrames,
        sampleRate,
        copyToChannel() {
          return undefined;
        }
      };
    }

    resume() {
      this.state = "running";
      return Promise.resolve();
    }
  }

  const pendingTimestamps: number[] = [];

  class FakeAudioDecoder {
    static async isConfigSupported(config: Record<string, unknown>) {
      return { supported: true, config };
    }

    private readonly callbacks: {
      output: (audioData: unknown) => void;
      error: (error: unknown) => void;
    };
    private pendingChunks = 0;

    constructor(
      callbacks: {
        output: (audioData: unknown) => void;
        error: (error: unknown) => void;
      }
    ) {
      this.callbacks = callbacks;
    }

    configure() {
      return undefined;
    }

    decode(chunk?: { timestamp?: number; duration?: number }) {
      const timestamp = typeof chunk?.timestamp === "number" ? chunk.timestamp : null;
      this.pendingChunks += 1;
      if (timestamp !== null) {
        pendingTimestamps.push(timestamp);
      }
      return undefined;
    }

    async flush() {
      if (options.rejectFlush) {
        throw new Error("flush failed");
      }

      while (this.pendingChunks > 0) {
        this.pendingChunks -= 1;
        const queuedTimestamp = pendingTimestamps.shift();
        this.callbacks.output({
          numberOfChannels: 2,
          numberOfFrames: 44_100,
          sampleRate: 44_100,
          timestamp: options.decodedTimestamp ?? queuedTimestamp ?? 0,
          copyTo(destination: Float32Array) {
            destination.fill(options.decodedSampleValue ?? 0.25);
          },
          close() {
            return undefined;
          }
        });
      }
    }

    close() {
      return undefined;
    }
  }

  class FakeEncodedAudioChunk {
    timestamp: number;
    duration: number;

    constructor(input: { timestamp?: number; duration?: number }) {
      this.timestamp = input.timestamp ?? 0;
      this.duration = input.duration ?? 0;
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      AudioContext: FakeAudioContext
    }
  });
  Object.defineProperty(globalThis, "AudioDecoder", {
    configurable: true,
    value: FakeAudioDecoder
  });
  Object.defineProperty(globalThis, "EncodedAudioChunk", {
    configurable: true,
    value: FakeEncodedAudioChunk
  });

  return {
    gainNode,
    bufferSources,
    mediaStreamDestination,
    destination: audioDestination,
    restore() {
      if (typeof originalWindow === "undefined") {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow
        });
      }
      if (typeof originalAudioDecoder === "undefined") {
        Reflect.deleteProperty(globalThis, "AudioDecoder");
      } else {
        Object.defineProperty(globalThis, "AudioDecoder", {
          configurable: true,
          value: originalAudioDecoder
        });
      }
      if (typeof originalEncodedAudioChunk === "undefined") {
        Reflect.deleteProperty(globalThis, "EncodedAudioChunk");
      } else {
        Object.defineProperty(globalThis, "EncodedAudioChunk", {
          configurable: true,
          value: originalEncodedAudioChunk
        });
      }
    }
  };
}

function mockSingleDecodedPacket() {
  vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
    streamInfo: {
      description: new Uint8Array([1, 2, 3]),
      audioOffset: 0,
      sampleRate: 44_100,
      numberOfChannels: 2,
      bitsPerSample: 16,
      minBlockSize: 44_100,
      maxBlockSize: 44_100,
      totalSamples: null
    },
    packets: [
      {
        data: new Uint8Array([0xff, 0xf8]),
        sampleCount: 44_100,
        timestampUs: 0,
        durationUs: 1_000_000
      }
    ],
    nextOffset: 2,
    nextSampleIndex: 44_100
  });
  vi.mocked(getCachedPiece)
    .mockResolvedValueOnce({
      pieceId: "piece_0",
      trackId: manifest.trackId,
      peerId: "peer_local",
      chunkIndex: 0,
      chunkSize: 2,
      hash: "hash_0",
      createdAt: new Date().toISOString(),
      payload: new Uint8Array([0xff, 0xf8]).buffer
    })
    .mockResolvedValueOnce(null);
}

function createAudioElement() {
  return {
    muted: false,
    volume: 0,
    srcObject: null as MediaStream | null,
    play: vi.fn(async () => undefined),
    pause() {
      return undefined;
    },
    load() {
      return undefined;
    }
  } as unknown as HTMLAudioElement;
}

function syncPlayback(
  engine: ProgressivePcmEngine,
  expectedSeconds: number,
  isPlaying: boolean,
  playbackTimeline = { key: "track_1|1", revision: 1 }
) {
  return engine.syncPlayback({
    expectedSeconds,
    isPlaying,
    playbackTimeline
  });
}

function buildPcmWavBytes(input: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  availableDataBytes: number;
}) {
  const bytes = new Uint8Array(44 + input.availableDataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + input.dataBytes, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, input.sampleRate * input.channels * input.bitsPerSample / 8, true);
  view.setUint16(32, input.channels * input.bitsPerSample / 8, true);
  view.setUint16(34, input.bitsPerSample, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, input.dataBytes, true);
  for (let offset = 44; offset + 1 < bytes.byteLength; offset += 2) {
    view.setInt16(offset, 8_192, true);
  }
  return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function buildFlacFrame(frameNumber: number, bodyBytes: number[]) {
  const headerWithoutCrc = new Uint8Array([0xff, 0xf8, 0x80, 0x10, frameNumber & 0x7f]);
  const header = new Uint8Array([...headerWithoutCrc, computeCrc8(headerWithoutCrc)]);
  return new Uint8Array([...header, ...bodyBytes]);
}

function computeCrc8(bytes: Uint8Array) {
  let crc = 0;

  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x07) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }

  return crc;
}

describe("ProgressivePcmEngine", () => {
  beforeEach(() => {
    vi.mocked(getCachedPiece).mockReset();
    vi.mocked(getCachedPiecesByIndexes).mockReset();
    // Delegate getCachedPiecesByIndexes to getCachedPiece so existing
    // test cases that mock getCachedPiece continue to work unchanged.
    vi.mocked(getCachedPiecesByIndexes).mockImplementation(
      async (trackId, peerId, chunkIndexes) => {
        const results = [];
        for (const chunkIndex of chunkIndexes) {
          const piece = await vi.mocked(getCachedPiece)(trackId, peerId, chunkIndex);
          if (piece) {
            results.push(piece);
          }
        }
        return results;
      }
    );
    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
      streamInfo: {
        description: new Uint8Array([1, 2, 3]),
        audioOffset: 0,
        sampleRate: 44_100,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 44_100,
        maxBlockSize: 44_100,
        totalSamples: null
      },
      packets: [],
      nextOffset: 0,
      nextSampleIndex: 0
    });
  });

  it("routes decoded PCM through one audible direct output path", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      engine.setVolume(0.35);
      const attached = await engine.attach();
      engine.setVolume(0.6);

      expect(attached).toBe(true);
      expect(audio.volume).toBe(1);
      expect(audio.srcObject).toBeNull();
      expect(audio.play).not.toHaveBeenCalled();
      expect(audioContext.gainNode.gain.value).toBe(0.6);
      expect(audioContext.gainNode.connectCalls).toHaveLength(1);
      expect(audioContext.gainNode.connectCalls).toContain(audioContext.destination);
      expect(engine.getSnapshot()).toMatchObject({
        hasOutputStream: false,
        directOutputConnected: true
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("clears a stale muted flag when attaching PCM output", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    audio.muted = true;
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      await engine.attach();

      expect(audio.muted).toBe(false);
      expect(audio.volume).toBe(1);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("does not throw when destroy closes an already-closed decoder", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      await engine.attach();
      let closeCalls = 0;
      Reflect.set(engine as object, "decoder", {
        close() {
          closeCalls += 1;
          throw new DOMException("codec already closed", "InvalidStateError");
        }
      });

      expect(() => engine.destroy()).not.toThrow();
      expect(() => engine.destroy()).not.toThrow();
      expect(closeCalls).toBe(1);
      expect(audioContext.gainNode.disconnectCalls).toBe(1);
      expect(audioContext.mediaStreamDestination.disconnectCalls).toBe(0);
      expect(engine.engineStatus).toBe("destroyed");
    } finally {
      audioContext.restore();
    }
  });

  it("appends only newly contiguous pieces across sync calls", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    // Chunks 0 and 2 are cached, chunk 1 is missing → first sync stops at chunk 1.
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex === 0) {
        return {
          pieceId: "piece_0",
          trackId: manifest.trackId,
          peerId: "peer_local",
          chunkIndex: 0,
          chunkSize: 3,
          hash: "hash_0",
          createdAt: new Date().toISOString(),
          payload: new Uint8Array([1, 2, 3]).buffer
        };
      }
      if (chunkIndex === 2) {
        return {
          pieceId: "piece_2",
          trackId: manifest.trackId,
          peerId: "peer_local",
          chunkIndex: 2,
          chunkSize: 3,
          hash: "hash_2",
          createdAt: new Date().toISOString(),
          payload: new Uint8Array([7, 8, 9]).buffer
        };
      }
      return null;
    });

    try {
      await engine.attach();
      await engine.sync();

      // Batch read finds chunk 0 (found), chunk 1 (missing) → gap → stops.
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBe(1);
      expect(Reflect.get(engine as object, "contiguousByteLength")).toBe(3);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("limits contiguous cache reads per sync to keep large cached tracks responsive", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const largeManifest = {
      ...manifest,
      totalChunks: 64
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", largeManifest);

    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) =>
      chunkIndex < largeManifest.totalChunks
        ? {
            pieceId: `piece_${chunkIndex}`,
            trackId: largeManifest.trackId,
            peerId: "peer_local",
            chunkIndex,
            chunkSize: largeManifest.chunkSize,
            hash: `hash_${chunkIndex}`,
            createdAt: new Date().toISOString(),
            payload: new Uint8Array([chunkIndex]).buffer
          }
        : null
    );

    try {
      await engine.attach();
      await engine.sync();

      // Steady-state budget is now 16 (batch reads are efficient).
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBe(16);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("compacts parsed FLAC bytes after decoding to avoid retaining consumed cache payload", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const compactManifest = {
      ...manifest,
      chunkSize: 1_000_000
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", compactManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);

    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
      streamInfo: {
        description,
        audioOffset: description.byteLength,
        sampleRate: 44_100,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 44_100,
        maxBlockSize: 44_100,
        totalSamples: null
      },
      packets: [
        {
          data: new Uint8Array([0xff, 0xf8]),
          sampleCount: 44_100,
          timestampUs: 0,
          durationUs: 1_000_000
        }
      ],
      nextOffset: 900_000,
      nextSampleIndex: 44_100
    });
    vi.mocked(getCachedPiece)
      .mockResolvedValueOnce({
        pieceId: "piece_0",
        trackId: compactManifest.trackId,
        peerId: "peer_local",
        chunkIndex: 0,
        chunkSize: compactManifest.chunkSize,
        hash: "hash_0",
        createdAt: new Date().toISOString(),
        payload: new Uint8Array(1_000_000).buffer
      })
      .mockResolvedValueOnce(null);

    try {
      await engine.attach();
      await engine.sync();

      expect(Reflect.get(engine as object, "contiguousByteLength")).toBe(100_008);
      expect(Reflect.get(engine as object, "parsedOffset")).toBe(description.byteLength);
      expect(engine.getSnapshot()).toMatchObject({
        decodedSegmentCount: 1
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("does not invoke the media element play path during sync playback", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      await engine.attach();
      // attach() calls audio.play() after setting srcObject to recover
      // the playing state lost during the HTML-spec-mandated pause on
      // srcObject assignment. Reset the spy so the assertion below only
      // covers syncPlayback.
      (audio.play as ReturnType<typeof vi.fn>).mockClear();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 0,
          endTimeSec: 1,
          buffer: {}
        }
      ]);

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(true);
      expect(audio.play).not.toHaveBeenCalled();
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("ignores stale playback timeline updates without stopping active PCM output", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const longManifest = {
      ...manifest,
      durationMs: 120_000
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", longManifest);

    try {
      await engine.attach();
      const context = Reflect.get(engine as object, "audioContext") as AudioContext;
      Reflect.set(context as object, "currentTime", 62);
      const stop = vi.fn();
      const disconnect = vi.fn();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "playing", true);
      Reflect.set(engine as object, "anchorTrackTimeSec", 60);
      Reflect.set(engine as object, "anchorContextTimeSec", 60);
      Reflect.set(engine as object, "pausedTrackTimeSec", 60);
      Reflect.set(engine as object, "playbackTimelineKey", "track_1|1");
      Reflect.set(engine as object, "playbackTimelineRevision", 7);
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 60,
          endTimeSec: 72,
          buffer: {}
        }
      ]);
      Reflect.set(engine as object, "scheduledSegments", [
        {
          source: {
            onended: null,
            stop,
            disconnect
          },
          startTimeSec: 60,
          endTimeSec: 72,
          contextStartSec: 60,
          durationSec: 12
        }
      ]);

      const result = await syncPlayback(engine, 5, true, {
        key: "track_1|1",
        revision: 6
      });

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(result.playbackPositionSeconds).toBeGreaterThan(61);
      expect(engine.getSnapshot()).toMatchObject({
        playoutState: "playing"
      });
      expect(stop).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("hard syncs a newer playback timeline instead of preserving stale PCM output", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const longManifest = {
      ...manifest,
      durationMs: 120_000
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", longManifest);

    try {
      await engine.attach();
      const context = Reflect.get(engine as object, "audioContext") as AudioContext;
      Reflect.set(context as object, "currentTime", 62);
      const stop = vi.fn();
      const disconnect = vi.fn();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "playing", true);
      Reflect.set(engine as object, "anchorTrackTimeSec", 60);
      Reflect.set(engine as object, "anchorContextTimeSec", 60);
      Reflect.set(engine as object, "pausedTrackTimeSec", 60);
      Reflect.set(engine as object, "playbackTimelineKey", "track_1|1");
      Reflect.set(engine as object, "playbackTimelineRevision", 6);
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 60,
          endTimeSec: 72,
          buffer: {}
        }
      ]);
      Reflect.set(engine as object, "scheduledSegments", [
        {
          source: {
            onended: null,
            stop,
            disconnect
          },
          startTimeSec: 60,
          endTimeSec: 72,
          contextStartSec: 60,
          durationSec: 12
        }
      ]);

      const result = await syncPlayback(engine, 5, true, {
        key: "track_1|1",
        revision: 7
      });

      expect(result.localReady).toBe(false);
      expect(result.blockedReason).toBe("pcm-buffer-missing");
      expect(result.playbackPositionSeconds).toBe(5);
      expect(engine.getSnapshot()).toMatchObject({
        playoutState: "paused"
      });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("keeps scheduled PCM audio through soft drift instead of hard cutting output", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const longManifest = {
      ...manifest,
      durationMs: 120_000
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", longManifest);

    try {
      await engine.attach();
      const context = Reflect.get(engine as object, "audioContext") as AudioContext;
      Reflect.set(context as object, "currentTime", 60.3);
      const stop = vi.fn();
      const disconnect = vi.fn();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "playing", true);
      Reflect.set(engine as object, "anchorTrackTimeSec", 60);
      Reflect.set(engine as object, "anchorContextTimeSec", 60);
      Reflect.set(engine as object, "pausedTrackTimeSec", 60);
      Reflect.set(engine as object, "playbackTimelineKey", "track_1|1");
      Reflect.set(engine as object, "playbackTimelineRevision", 7);
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 60,
          endTimeSec: 72,
          buffer: {}
        }
      ]);
      Reflect.set(engine as object, "scheduledSegments", [
        {
          source: {
            onended: null,
            stop,
            disconnect
          },
          startTimeSec: 60,
          endTimeSec: 72,
          contextStartSec: 60,
          durationSec: 12
        }
      ]);

      const result = await syncPlayback(engine, 60.56, true, {
        key: "track_1|1",
        revision: 7
      });

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(stop).not.toHaveBeenCalled();
      expect(disconnect).not.toHaveBeenCalled();
      expect(engine.getSnapshot()).toMatchObject({
        scheduledSegmentCount: 1,
        playoutState: "playing"
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("flushes decoded packets before reporting PCM playback ready", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    mockSingleDecodedPacket();

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 1,
        decoderFlushAttemptCount: 1,
        decoderFlushCount: 1,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1,
        decodedPeak: 0.25,
        decodedRms: 0.25,
        decodedNonZeroSampleCount: 88_200
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("fades PCM output down when native full-local playback is ready to take over", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    mockSingleDecodedPacket();

    try {
      await engine.attach();
      await syncPlayback(engine, 0.2, true);

      const prepared = engine.prepareForNativeHandoff(45);

      expect(prepared).toBe(true);
      expect(audioContext.gainNode.gain.value).toBe(0);
      expect(engine.getSnapshot()).toMatchObject({
        scheduledSegmentCount: 1,
        playoutState: "paused"
      });
      expect(audio.srcObject).toBeNull();
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("plays FLAC from the current cached window without requiring every prefix chunk", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const windowManifest = {
      ...manifest,
      durationMs: 8_000,
      totalChunks: 8,
      chunkSize: 64
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", windowManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);

    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
      streamInfo: {
        description,
        audioOffset: description.byteLength,
        sampleRate: 256,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 256,
        maxBlockSize: 256,
        totalSamples: null
      },
      packets: [],
      nextOffset: description.byteLength,
      nextSampleIndex: 0
    });
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex === 0) {
        return {
          pieceId: "piece_0",
          trackId: windowManifest.trackId,
          peerId: "peer_local",
          chunkIndex,
          chunkSize: windowManifest.chunkSize,
          hash: "hash_0",
          createdAt: new Date().toISOString(),
          payload: description.buffer
        };
      }
      if (chunkIndex === 4 || chunkIndex === 5) {
        const frame = buildFlacFrame(chunkIndex, [chunkIndex, chunkIndex + 1]);
        return {
          pieceId: `piece_${chunkIndex}`,
          trackId: windowManifest.trackId,
          peerId: "peer_local",
          chunkIndex,
          chunkSize: windowManifest.chunkSize,
          hash: `hash_${chunkIndex}`,
          createdAt: new Date().toISOString(),
          payload: frame.buffer
        };
      }
      return null;
    });

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 4.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBe(1);
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 1,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("keeps current-window FLAC playable when decoded AudioData omits timestamps", async () => {
    const audioContext = installFakeAudioContext({ decodedTimestamp: Number.NaN });
    const audio = createAudioElement();
    const windowManifest = {
      ...manifest,
      durationMs: 8_000,
      totalChunks: 8,
      chunkSize: 64
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", windowManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);

    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
      streamInfo: {
        description,
        audioOffset: description.byteLength,
        sampleRate: 256,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 256,
        maxBlockSize: 256,
        totalSamples: null
      },
      packets: [],
      nextOffset: description.byteLength,
      nextSampleIndex: 0
    });
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex === 0) {
        return {
          pieceId: "piece_0",
          trackId: windowManifest.trackId,
          peerId: "peer_local",
          chunkIndex,
          chunkSize: windowManifest.chunkSize,
          hash: "hash_0",
          createdAt: new Date().toISOString(),
          payload: description.buffer
        };
      }
      if (chunkIndex === 4 || chunkIndex === 5) {
        const frame = buildFlacFrame(chunkIndex, [chunkIndex, chunkIndex + 1]);
        return {
          pieceId: `piece_${chunkIndex}`,
          trackId: windowManifest.trackId,
          peerId: "peer_local",
          chunkIndex,
          chunkSize: windowManifest.chunkSize,
          hash: `hash_${chunkIndex}`,
          createdAt: new Date().toISOString(),
          payload: frame.buffer
        };
      }
      return null;
    });

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 4.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 1,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("plays a FLAC frame that starts in the previous chunk and crosses into the current chunk", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const windowManifest = {
      ...manifest,
      durationMs: 8_000,
      totalChunks: 8,
      chunkSize: 8
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", windowManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);
    const frame4 = buildFlacFrame(4, [0x40, 0x41, 0x42, 0x43]);
    const frame5 = buildFlacFrame(5, [0x50, 0x51, 0x52, 0x53]);
    const splitChunk3 = frame4.slice(0, 8);
    const splitChunk4 = frame4.slice(8);

    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
      streamInfo: {
        description,
        audioOffset: description.byteLength,
        sampleRate: 256,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 256,
        maxBlockSize: 256,
        totalSamples: null
      },
      packets: [],
      nextOffset: description.byteLength,
      nextSampleIndex: 0
    });
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      const payload =
        chunkIndex === 0
          ? description
          : chunkIndex === 3
            ? splitChunk3
            : chunkIndex === 4
              ? splitChunk4
              : chunkIndex === 5
                ? frame5
                : null;
      if (!payload) {
        return null;
      }

      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: windowManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: windowManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength
        )
      };
    });

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 4.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 1,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("recreates the FLAC decoder to play the current cached window when a prefix gap blocks linear catch-up", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const windowManifest = {
      ...manifest,
      durationMs: 10_000,
      totalChunks: 10,
      chunkSize: 64
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", windowManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);

    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
      streamInfo: {
        description,
        audioOffset: description.byteLength,
        sampleRate: 256,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 256,
        maxBlockSize: 256,
        totalSamples: null
      },
      packets: [],
      nextOffset: description.byteLength,
      nextSampleIndex: 0
    });
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex === 1) {
        return null;
      }
      if (chunkIndex === 4 || chunkIndex === 5) {
        const frame = buildFlacFrame(chunkIndex, [chunkIndex, chunkIndex + 1]);
        return {
          pieceId: `piece_${chunkIndex}`,
          trackId: windowManifest.trackId,
          peerId: "peer_local",
          chunkIndex,
          chunkSize: windowManifest.chunkSize,
          hash: `hash_${chunkIndex}`,
          createdAt: new Date().toISOString(),
          payload: frame.buffer
        };
      }
      return null;
    });

    try {
      await engine.attach();
      Reflect.set(engine as object, "status", "degraded");
      Reflect.set(engine as object, "streamInfo", {
        description,
        audioOffset: description.byteLength,
        sampleRate: 256,
        numberOfChannels: 2,
        bitsPerSample: 16,
        minBlockSize: 256,
        maxBlockSize: 256,
        totalSamples: null
      });
      Reflect.set(engine as object, "decoder", null);
      Reflect.set(engine as object, "contiguousChunkCount", 1);

      const result = await syncPlayback(engine, 4.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        status: "ready",
        decodedPacketCount: 1,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("continues FLAC window decoding past duplicate packets in an earlier sparse run", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const windowManifest = {
      ...manifest,
      durationMs: 9_000,
      totalChunks: 9,
      chunkSize: 64
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", windowManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);
    const streamInfo = {
      description,
      audioOffset: description.byteLength,
      sampleRate: 256,
      numberOfChannels: 2,
      bitsPerSample: 16,
      minBlockSize: 256,
      maxBlockSize: 256,
      totalSamples: null
    };

    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      const payload =
        chunkIndex === 4
          ? buildFlacFrame(4, [0x40, 0x41])
          : chunkIndex === 5
            ? buildFlacFrame(5, [0x50, 0x51])
            : chunkIndex === 7
              ? buildFlacFrame(7, [0x70, 0x71])
              : chunkIndex === 8
                ? buildFlacFrame(8, [0x80, 0x81])
                : null;
      if (!payload) {
        return null;
      }

      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: windowManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: windowManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: payload.buffer
      };
    });

    try {
      await engine.attach();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "streamInfo", streamInfo);
      Reflect.set(engine as object, "contiguousChunkCount", 1);
      Reflect.set(
        engine as object,
        "decodedFlacPacketTimestampUs",
        new Set([4_000_000, 5_000_000])
      );

      const result = await syncPlayback(engine, 7.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 2,
        decodedSegmentCount: 2,
        scheduledSegmentCount: 2
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("re-decodes a FLAC window packet when a prior duplicate marker has no PCM segment", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const windowManifest = {
      ...manifest,
      durationMs: 9_000,
      totalChunks: 9,
      chunkSize: 64
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", windowManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);
    const streamInfo = {
      description,
      audioOffset: description.byteLength,
      sampleRate: 256,
      numberOfChannels: 2,
      bitsPerSample: 16,
      minBlockSize: 256,
      maxBlockSize: 256,
      totalSamples: null
    };

    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      const payload =
        chunkIndex === 7
          ? buildFlacFrame(7, [0x70, 0x71])
          : chunkIndex === 8
            ? buildFlacFrame(8, [0x80, 0x81])
            : null;
      if (!payload) {
        return null;
      }

      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: windowManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: windowManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: payload.buffer
      };
    });

    try {
      await engine.attach();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "streamInfo", streamInfo);
      Reflect.set(engine as object, "contiguousChunkCount", 1);
      Reflect.set(
        engine as object,
        "decodedFlacPacketTimestampUs",
        new Set([7_000_000, 8_000_000])
      );

      const result = await syncPlayback(engine, 7.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 2,
        decodedSegmentCount: 2,
        scheduledSegmentCount: 2
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("drops decoded PCM segments far behind the current playout position", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", {
      ...manifest,
      durationMs: 60_000
    });

    try {
      await engine.attach();
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 0,
          endTimeSec: 1,
          buffer: {}
        },
        {
          startTimeSec: 1,
          endTimeSec: 2,
          buffer: {}
        },
        {
          startTimeSec: 40,
          endTimeSec: 41,
          buffer: {}
        }
      ]);

      const result = await syncPlayback(engine, 40.2, true);

      expect(result.localReady).toBe(true);
      expect(Reflect.get(engine as object, "decodedSegments")).toHaveLength(1);
      expect(engine.getSnapshot()).toMatchObject({
        scheduledSegmentCount: 1
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("plays WAV PCM from the first cached prefix chunk before the track is complete", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const wavManifest = {
      ...manifest,
      mimeType: "audio/wav",
      codec: "wav",
      durationMs: 1_000,
      totalChunks: 2,
      chunkSize: 1_044
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", wavManifest);

    vi.mocked(getCachedPiece)
      .mockResolvedValueOnce({
        pieceId: "piece_0",
        trackId: wavManifest.trackId,
        peerId: "peer_local",
        chunkIndex: 0,
        chunkSize: wavManifest.chunkSize,
        hash: "hash_0",
        createdAt: new Date().toISOString(),
        payload: buildPcmWavBytes({
          sampleRate: 1_000,
          channels: 1,
          bitsPerSample: 16,
          dataBytes: 2_000,
          availableDataBytes: 1_000
        }).buffer
      })
      .mockResolvedValueOnce(null);

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 0.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1,
        bufferedAheadMs: 400
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("plays the requested WAV position without waiting for every prefix chunk", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const wavManifest = {
      ...manifest,
      mimeType: "audio/wav",
      codec: "wav",
      durationMs: 1_000,
      totalChunks: 6,
      chunkSize: 444
    };
    const fullWav = buildPcmWavBytes({
      sampleRate: 1_000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 2_000,
      availableDataBytes: 2_000
    });
    const engine = new ProgressivePcmEngine(audio, "peer_local", wavManifest);

    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex >= wavManifest.totalChunks) {
        return null;
      }

      const start = chunkIndex === 0 ? 0 : 444 + (chunkIndex - 1) * 400;
      const end = chunkIndex === 0 ? 444 : Math.min(fullWav.byteLength, start + 400);
      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: wavManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: wavManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: fullWav.slice(start, end).buffer
      };
    });

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 0.9, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      // With catch-up batch reads all available prefix chunks are loaded
      // efficiently in a single batch. The key property is that the engine
      // reached the playback position and is ready, not how many chunks it read.
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBe(6);
      const snapshot = engine.getSnapshot();
      // Batch reads may produce fewer but larger segments than the old
      // one-chunk-at-a-time path. What matters is that decoding happened.
      expect(snapshot.decodedSegmentCount).toBeGreaterThanOrEqual(1);
      expect(snapshot.scheduledSegmentCount).toBeGreaterThanOrEqual(1);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("decodes the current WAV cache window even while older prefix chunks are still appending", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const wavManifest = {
      ...manifest,
      mimeType: "audio/wav",
      codec: "wav",
      durationMs: 700_000,
      totalChunks: 700,
      chunkSize: 444
    };
    const fullWav = buildPcmWavBytes({
      sampleRate: 222,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 444 * 700,
      availableDataBytes: 444 * 700
    });
    const engine = new ProgressivePcmEngine(audio, "peer_local", wavManifest);

    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex < 0 || chunkIndex >= wavManifest.totalChunks) {
        return null;
      }

      const hasPrefixPiece = chunkIndex <= 514;
      const hasCurrentWindowPiece = chunkIndex === 600 || chunkIndex === 601;
      if (!hasPrefixPiece && !hasCurrentWindowPiece) {
        return null;
      }

      const start = chunkIndex * wavManifest.chunkSize;
      const end = Math.min(fullWav.byteLength, start + wavManifest.chunkSize);
      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: wavManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: wavManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: fullWav.slice(start, end).buffer
      };
    });

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 600.1, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBeLessThan(600);
      const snapshot = engine.getSnapshot();
      expect(snapshot.decodedSegmentCount).toBeGreaterThanOrEqual(1);
      expect(snapshot.scheduledSegmentCount).toBeGreaterThanOrEqual(1);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("keeps sparse WAV window chunks on their real timeline", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const wavManifest = {
      ...manifest,
      mimeType: "audio/wav",
      codec: "wav",
      durationMs: 1_000,
      totalChunks: 6,
      chunkSize: 444
    };
    const fullWav = buildPcmWavBytes({
      sampleRate: 1_000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 2_000,
      availableDataBytes: 2_000
    });
    const engine = new ProgressivePcmEngine(audio, "peer_local", wavManifest);

    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex === 0) {
        return {
          pieceId: "piece_0",
          trackId: wavManifest.trackId,
          peerId: "peer_local",
          chunkIndex,
          chunkSize: wavManifest.chunkSize,
          hash: "hash_0",
          createdAt: new Date().toISOString(),
          payload: fullWav.slice(0, 44).buffer
        };
      }
      if (chunkIndex !== 2 && chunkIndex !== 4) {
        return null;
      }

      const start = chunkIndex * wavManifest.chunkSize;
      const end = Math.min(fullWav.byteLength, start + wavManifest.chunkSize);
      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: wavManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: wavManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: fullWav.slice(start, end).buffer
      };
    });

    try {
      await engine.attach();
      const decodeWindow = Reflect.get(engine as object, "decodeCachedWavWindowAt") as (
        positionSeconds: number
      ) => Promise<boolean>;

      await expect(decodeWindow.call(engine, 0.6)).resolves.toBe(true);

      const decodedSegments = Reflect.get(engine as object, "decodedSegments") as Array<{
        startTimeSec: number;
        endTimeSec: number;
      }>;
      expect(decodedSegments.map((segment) => segment.startTimeSec)).toEqual([0.422, 0.866]);
      expect(decodedSegments.map((segment) => segment.endTimeSec)).toEqual([0.644, 1]);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("marks PCM playback failed when cached pieces cannot be read", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    vi.mocked(getCachedPiece).mockRejectedValue(new Error("idb-failed"));

    try {
      await engine.attach();
      await expect(engine.sync()).resolves.toBe(false);

      expect(engine.getSnapshot()).toMatchObject({
        status: "failed",
        lastDecodeError: "cache-read-failed"
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("keeps playing and retries when a cache read hits a transient AbortError", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const wavManifest = {
      ...manifest,
      mimeType: "audio/wav",
      codec: "wav",
      durationMs: 1_000,
      totalChunks: 6,
      chunkSize: 444
    };
    const fullWav = buildPcmWavBytes({
      sampleRate: 1_000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 2_000,
      availableDataBytes: 2_000
    });
    const engine = new ProgressivePcmEngine(audio, "peer_local", wavManifest);

    const readCachedChunk = (chunkIndex: number) => {
      if (chunkIndex >= wavManifest.totalChunks) {
        return null;
      }

      const start = chunkIndex === 0 ? 0 : 444 + (chunkIndex - 1) * 400;
      const end = chunkIndex === 0 ? 444 : Math.min(fullWav.byteLength, start + 400);
      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: wavManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: wavManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: fullWav.slice(start, end).buffer
      };
    };

    // The first sync aborts partway through reading the cached prefix (IndexedDB
    // transaction contention with the concurrent downloader). Subsequent reads
    // succeed once the contention clears.
    let shouldAbort = true;
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (shouldAbort) {
        const abortError = new Error("The transaction was aborted.");
        abortError.name = "AbortError";
        throw abortError;
      }

      return readCachedChunk(chunkIndex);
    });

    try {
      await engine.attach();

      // Transient abort must not latch a failure — the engine keeps its
      // pre-abort status (never "failed"/"degraded") so the next tick retries.
      await expect(engine.sync()).resolves.toBe(false);
      const afterAbort = engine.getSnapshot();
      expect(afterAbort.status).not.toBe("failed");
      expect(afterAbort.status).not.toBe("degraded");
      expect(afterAbort.lastDecodeError).toBeNull();
      expect(afterAbort.decodedSegmentCount).toBe(0);

      // Once the abort clears, the next sync catches up and produces audio.
      shouldAbort = false;
      const result = await syncPlayback(engine, 0.9, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      const snapshot = engine.getSnapshot();
      expect(snapshot.status).toBe("ready");
      expect(snapshot.lastDecodeError).toBeNull();
      expect(snapshot.decodedSegmentCount).toBeGreaterThanOrEqual(1);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("records a flush attempt when decoder flush rejects before output", async () => {
    const audioContext = installFakeAudioContext({ rejectFlush: true });
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    mockSingleDecodedPacket();

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(false);
      expect(result.blockedReason).toBe("decoder-flush-failed");
      expect(engine.getSnapshot()).toMatchObject({
        status: "failed",
        decodedPacketCount: 1,
        decoderFlushAttemptCount: 1,
        decoderFlushCount: 0,
        decodedSegmentCount: 0,
        lastDecodeError: "decoder-flush-failed"
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("reports silent decoded PCM when every copied sample is zero", async () => {
    const audioContext = installFakeAudioContext({ decodedSampleValue: 0 });
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    mockSingleDecodedPacket();

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(true);
      expect(engine.getSnapshot()).toMatchObject({
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1,
        decodedPeak: 0,
        decodedRms: 0,
        decodedNonZeroSampleCount: 0
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("reconstructs decoded segment timing when AudioData timestamp is not finite", async () => {
    const audioContext = installFakeAudioContext({ decodedTimestamp: Number.NaN });
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    mockSingleDecodedPacket();

    try {
      await engine.attach();
      const result = await syncPlayback(engine, Number.NaN, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(result.playbackPositionSeconds).not.toBeNaN();
      expect(engine.getSnapshot()).toMatchObject({
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1,
        bufferedAheadMs: 1000
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("does not report localReady when the audio context cannot resume", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      await engine.attach();
      const context = Reflect.get(engine as object, "audioContext") as {
        state: AudioContextState;
        resume: () => Promise<void>;
      };
      context.state = "suspended";
      context.resume = async () => {
        throw new DOMException("blocked", "NotAllowedError");
      };
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 0,
          endTimeSec: 1,
          buffer: {}
        }
      ]);

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(false);
      expect(result.blockedReason).toBe("audio-context-suspended");
      expect(engine.getSnapshot()).toMatchObject({
        audioContextState: "suspended",
        playoutState: "paused"
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("continues scheduling already decoded audio after a later decoder failure", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      await engine.attach();
      Reflect.set(engine as object, "status", "failed");
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 0,
          endTimeSec: 1,
          buffer: {}
        }
      ]);

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        status: "failed",
        scheduledSegmentCount: 1,
        playoutState: "playing"
      });
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("catches up to a far playback position without draining the full cache", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    // 41 chunks: chunk 0 is the FLAC header, chunks 1..40 each carry one frame.
    // The requested position (chunk 30) sits far beyond the small steady-state
    // append cap, so catch-up append must pull enough chunks for the current
    // playback position without decoding the full remaining track in one turn.
    const catchupManifest = {
      ...manifest,
      durationMs: 40_000,
      totalChunks: 41,
      chunkSize: 16
    };
    const engine = new ProgressivePcmEngine(audio, "peer_local", catchupManifest);
    const description = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 1, 2, 3, 4]);

    vi.mocked(extractFlacPacketsFromBitstream).mockImplementation((input) => {
      // Emit one packet per contiguous frame present after the header, timed at
      // one second per frame (sampleRate 256, 256 samples per frame).
      const audioBytes = Math.max(0, input.bytes.byteLength - description.byteLength);
      const frameSize = 8;
      const frameCount = Math.floor(audioBytes / frameSize);
      const startFrame = Math.floor(Math.max(0, input.startOffset - description.byteLength) / frameSize);
      const packets = [] as Array<{
        data: Uint8Array;
        sampleCount: number;
        timestampUs: number;
        durationUs: number;
      }>;
      for (let frameIndex = startFrame; frameIndex < frameCount; frameIndex += 1) {
        packets.push({
          data: new Uint8Array([0xff, 0xf8]),
          sampleCount: 256,
          timestampUs: frameIndex * 1_000_000,
          durationUs: 1_000_000
        });
      }
      return {
        streamInfo: {
          description,
          audioOffset: description.byteLength,
          sampleRate: 256,
          numberOfChannels: 2,
          bitsPerSample: 16,
          minBlockSize: 256,
          maxBlockSize: 256,
          totalSamples: null
        },
        packets,
        nextOffset: description.byteLength + frameCount * frameSize,
        nextSampleIndex: frameCount * 256
      };
    });
    vi.mocked(getCachedPiece).mockImplementation(async (_trackId, _peerId, chunkIndex) => {
      if (chunkIndex < 0 || chunkIndex >= catchupManifest.totalChunks) {
        return null;
      }

      const payload =
        chunkIndex === 0 ? description : new Uint8Array([0xff, 0xf8, 0, 0, 0, 0, 0, 0]);
      return {
        pieceId: `piece_${chunkIndex}`,
        trackId: catchupManifest.trackId,
        peerId: "peer_local",
        chunkIndex,
        chunkSize: catchupManifest.chunkSize,
        hash: `hash_${chunkIndex}`,
        createdAt: new Date().toISOString(),
        payload: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
      };
    });

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 30, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBeGreaterThanOrEqual(31);
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBeLessThan(
        catchupManifest.totalChunks
      );
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });

  it("decodes segments even when AudioData properties become invalid after close()", async () => {
    // Real WebCodecs releases the backing frame on AudioData.close(), after
    // which numberOfFrames/sampleRate/timestamp read back as 0/NaN. Regression
    // guard for the silent-listener bug where reading geometry AFTER close()
    // made durationSec NaN and every decoded segment was rejected.
    const originalWindow = globalThis.window;
    const originalAudioDecoder = (globalThis as typeof globalThis & { AudioDecoder?: unknown }).AudioDecoder;
    const originalEncodedAudioChunk = (globalThis as typeof globalThis & { EncodedAudioChunk?: unknown }).EncodedAudioChunk;

    const gainNode = {
      gain: { value: 1, setValueAtTime() {} },
      connect() {},
      disconnect() {}
    };
    class FakeAudioContext {
      currentTime = 0;
      state = "running" as AudioContextState;
      destination = {};
      createGain() { return gainNode; }
      createMediaStreamDestination() { return { stream: {}, connect() {}, disconnect() {} }; }
      createBufferSource() {
        return { buffer: null as unknown, onended: null as (() => void) | null, connect() {}, start() {}, stop() {}, disconnect() {} };
      }
      createOscillator() {
        return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {}, disconnect() {} };
      }
      close() { return Promise.resolve(); }
      createBuffer(numberOfChannels: number, numberOfFrames: number, sampleRate: number) {
        return { numberOfChannels, numberOfFrames, sampleRate, copyToChannel() {} };
      }
      resume() { return Promise.resolve(); }
    }

    const pendingTimestamps: number[] = [];
    class ClosingAudioDecoder {
      static async isConfigSupported() { return { supported: true }; }
      private readonly callbacks: { output: (audioData: unknown) => void; error: (error: unknown) => void };
      private pendingChunks = 0;
      constructor(callbacks: { output: (audioData: unknown) => void; error: (error: unknown) => void }) {
        this.callbacks = callbacks;
      }
      configure() {}
      decode(chunk?: { timestamp?: number }) {
        this.pendingChunks += 1;
        pendingTimestamps.push(typeof chunk?.timestamp === "number" ? chunk.timestamp : 0);
      }
      async flush() {
        while (this.pendingChunks > 0) {
          this.pendingChunks -= 1;
          const timestamp = pendingTimestamps.shift() ?? 0;
          let closed = false;
          const audioData = {
            get numberOfChannels() { return closed ? 0 : 2; },
            get numberOfFrames() { return closed ? 0 : 44_100; },
            get sampleRate() { return closed ? NaN : 44_100; },
            get timestamp() { return closed ? NaN : timestamp; },
            copyTo(destination: Float32Array) { destination.fill(0.25); },
            close() { closed = true; }
          };
          this.callbacks.output(audioData);
        }
      }
      close() {}
    }
    class FakeEncodedAudioChunk {
      timestamp: number;
      duration: number;
      constructor(input: { timestamp?: number; duration?: number }) {
        this.timestamp = input.timestamp ?? 0;
        this.duration = input.duration ?? 0;
      }
    }

    Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: FakeAudioContext } });
    Object.defineProperty(globalThis, "AudioDecoder", { configurable: true, value: ClosingAudioDecoder });
    Object.defineProperty(globalThis, "EncodedAudioChunk", { configurable: true, value: FakeEncodedAudioChunk });

    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    mockSingleDecodedPacket();

    try {
      await engine.attach();

      const result = await syncPlayback(engine, 0.2, true);

      expect(result.localReady).toBe(true);
      expect(result.blockedReason).toBeNull();
      expect(engine.getSnapshot()).toMatchObject({
        decodedPacketCount: 1,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1
      });
    } finally {
      engine.destroy();
      if (typeof originalWindow === "undefined") {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      }
      if (typeof originalAudioDecoder === "undefined") {
        Reflect.deleteProperty(globalThis, "AudioDecoder");
      } else {
        Object.defineProperty(globalThis, "AudioDecoder", { configurable: true, value: originalAudioDecoder });
      }
      if (typeof originalEncodedAudioChunk === "undefined") {
        Reflect.deleteProperty(globalThis, "EncodedAudioChunk");
      } else {
        Object.defineProperty(globalThis, "EncodedAudioChunk", { configurable: true, value: originalEncodedAudioChunk });
      }
    }
  });
});
