import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedPiece } from "@/lib/indexeddb";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";
import { extractFlacPacketsFromBitstream } from "./progressive-flac";

vi.mock("@/lib/indexeddb", () => ({
  getCachedPiece: vi.fn(),
  localCacheOwnerKey: "__local__"
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
  const gainNode = {
    connectCalls: [] as unknown[],
    gain: {
      value: 1,
      setValueAtTime(value: number) {
        this.value = value;
      }
    },
    connect(target: unknown) {
      this.connectCalls.push(target);
      return undefined;
    }
  };

  class FakeAudioContext {
    currentTime = 0;
    state = "running" as AudioContextState;
    destination = {};

    createGain() {
      return gainNode;
    }

    createMediaStreamDestination() {
      return {
        stream: {},
        connect() {
          return undefined;
        }
      };
    }

    createBufferSource() {
      return {
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect() {
          return undefined;
        },
        start() {
          return undefined;
        },
        stop() {
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

    decode() {
      this.pendingChunks += 1;
      return undefined;
    }

    async flush() {
      if (options.rejectFlush) {
        throw new Error("flush failed");
      }

      while (this.pendingChunks > 0) {
        this.pendingChunks -= 1;
        this.callbacks.output({
          numberOfChannels: 2,
          numberOfFrames: 44_100,
          sampleRate: 44_100,
          timestamp: options.decodedTimestamp ?? 0,
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
    constructor(_input: Record<string, unknown>) {}
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

describe("ProgressivePcmEngine", () => {
  beforeEach(() => {
    vi.mocked(getCachedPiece).mockReset();
    vi.mocked(extractFlacPacketsFromBitstream).mockReturnValue({
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
    });
  });

  it("uses a gain node for volume when the audio context is attached", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    try {
      engine.setVolume(0.35);
      const attached = await engine.attach();
      engine.setVolume(0.6);

      expect(attached).toBe(true);
      expect(audio.volume).toBe(1);
      expect(audioContext.gainNode.gain.value).toBe(0.6);
      expect(audioContext.gainNode.connectCalls).toHaveLength(2);
      expect(engine.getSnapshot()).toMatchObject({
        hasOutputStream: true,
        directOutputConnected: true
      });
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
      expect(engine.engineStatus).toBe("destroyed");
    } finally {
      audioContext.restore();
    }
  });

  it("appends only newly contiguous pieces across sync calls", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    vi.mocked(getCachedPiece)
      .mockResolvedValueOnce({
        pieceId: "piece_0",
        trackId: manifest.trackId,
        peerId: "peer_local",
        chunkIndex: 0,
        chunkSize: 3,
        hash: "hash_0",
        createdAt: new Date().toISOString(),
        payload: new Uint8Array([1, 2, 3]).buffer
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        pieceId: "piece_1",
        trackId: manifest.trackId,
        peerId: "peer_local",
        chunkIndex: 1,
        chunkSize: 3,
        hash: "hash_1",
        createdAt: new Date().toISOString(),
        payload: new Uint8Array([4, 5, 6]).buffer
      })
      .mockResolvedValueOnce(null);

    try {
      await engine.attach();
      await engine.sync();
      await engine.sync();

      const cacheOptions = {
        fileHash: manifest.fileHash,
        ownerKey: "__local__",
        chunkSize: manifest.chunkSize
      };
      expect(vi.mocked(getCachedPiece).mock.calls).toEqual([
        [manifest.trackId, "peer_local", 0, cacheOptions],
        [manifest.trackId, "peer_local", 1, cacheOptions],
        [manifest.trackId, "peer_local", 1, cacheOptions],
        [manifest.trackId, "peer_local", 2, cacheOptions]
      ]);
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBe(2);
      expect(Reflect.get(engine as object, "contiguousByteLength")).toBe(6);
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
      Reflect.set(engine as object, "status", "ready");
      Reflect.set(engine as object, "decodedSegments", [
        {
          startTimeSec: 0,
          endTimeSec: 1,
          buffer: {}
        }
      ]);

      const result = await engine.syncPlayback(0.2, true);

      expect(result.localReady).toBe(true);
      expect(audio.play).not.toHaveBeenCalled();
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

      const result = await engine.syncPlayback(0.2, true);

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

      const result = await engine.syncPlayback(0.1, true);

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

  it("marks PCM playback failed when cached pieces cannot be read", async () => {
    const audioContext = installFakeAudioContext();
    const audio = createAudioElement();
    const engine = new ProgressivePcmEngine(audio, "peer_local", manifest);

    vi.mocked(getCachedPiece).mockRejectedValue(new Error("idb-failed"));

    try {
      await engine.attach();
      await expect(engine.sync()).resolves.toBeUndefined();

      expect(engine.getSnapshot()).toMatchObject({
        status: "failed",
        lastDecodeError: "cache-read-failed"
      });
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

      const result = await engine.syncPlayback(0.2, true);

      expect(result.localReady).toBe(false);
      expect(result.blockedReason).toBe("engine-failed");
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

      const result = await engine.syncPlayback(0.2, true);

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
      const result = await engine.syncPlayback(Number.NaN, true);

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

      const result = await engine.syncPlayback(0.2, true);

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

      const result = await engine.syncPlayback(0.2, true);

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
});
