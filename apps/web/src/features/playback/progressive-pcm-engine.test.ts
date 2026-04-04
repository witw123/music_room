import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedPiece } from "@/lib/indexeddb";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";

vi.mock("@/lib/indexeddb", () => ({
  getCachedPiece: vi.fn()
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

function installFakeAudioContext() {
  const originalWindow = globalThis.window;
  const originalAudioDecoder = (
    globalThis as typeof globalThis & { AudioDecoder?: unknown }
  ).AudioDecoder;
  const originalEncodedAudioChunk = (
    globalThis as typeof globalThis & { EncodedAudioChunk?: unknown }
  ).EncodedAudioChunk;
  const gainNode = {
    gain: {
      value: 1,
      setValueAtTime(value: number) {
        this.value = value;
      }
    },
    connect() {
      return undefined;
    }
  };

  class FakeAudioContext {
    currentTime = 0;

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

    close() {
      return Promise.resolve();
    }
  }

  class FakeAudioDecoder {
    static async isConfigSupported(config: Record<string, unknown>) {
      return { supported: true, config };
    }

    constructor(
      _callbacks: {
        output: (audioData: unknown) => void;
        error: (error: unknown) => void;
      }
    ) {}

    configure() {
      return undefined;
    }

    decode() {
      return undefined;
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

function createAudioElement() {
  return {
    volume: 0,
    srcObject: null as MediaStream | null,
    pause() {
      return undefined;
    },
    load() {
      return undefined;
    }
  } as HTMLAudioElement;
}

describe("ProgressivePcmEngine", () => {
  beforeEach(() => {
    vi.mocked(getCachedPiece).mockReset();
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

      expect(vi.mocked(getCachedPiece).mock.calls).toEqual([
        [manifest.trackId, "peer_local", 0],
        [manifest.trackId, "peer_local", 1],
        [manifest.trackId, "peer_local", 1],
        [manifest.trackId, "peer_local", 2]
      ]);
      expect(Reflect.get(engine as object, "contiguousChunkCount")).toBe(2);
      expect(Reflect.get(engine as object, "contiguousByteLength")).toBe(6);
    } finally {
      engine.destroy();
      audioContext.restore();
    }
  });
});
