import { afterEach, describe, expect, it, vi } from "vitest";
import { getCachedPiecesForTrack } from "@/lib/indexeddb";
import { ProgressiveMseEngine } from "./progressive-mse-engine";

vi.mock("@/lib/indexeddb", () => ({
  getCachedPiecesForTrack: vi.fn(),
  localCacheOwnerKey: "__local__"
}));

describe("ProgressiveMseEngine", () => {
  afterEach(() => {
    vi.mocked(getCachedPiecesForTrack).mockReset();
    vi.unstubAllGlobals();
  });

  it("fails gracefully when MediaSource cannot be attached", async () => {
    class FakeMediaSource {
      readyState = "closed";

      addEventListener() {
        return undefined;
      }

      removeEventListener() {
        return undefined;
      }
    }

    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => {
        throw new Error("unsupported");
      }),
      revokeObjectURL: vi.fn()
    });

    const audio = {
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn()
    } as unknown as HTMLAudioElement;

    const engine = new ProgressiveMseEngine(audio, "peer_local", {
      trackId: "track_1",
      fileHash: "hash_1",
      mimeType: "audio/mpeg",
      codec: "mpeg",
      sizeBytes: 1024,
      durationMs: 10_000,
      totalChunks: 4,
      chunkSize: 256
    });

    await expect(engine.attach()).resolves.toBe(false);
    expect(engine.engineStatus).toBe("failed");
  });

  it("reports playback readiness from partially appended contiguous cache", async () => {
    class FakeSourceBuffer extends EventTarget {
      mode = "";
      updating = false;
      appendedBuffers: ArrayBuffer[] = [];

      appendBuffer(payload: ArrayBuffer) {
        this.appendedBuffers.push(payload);
      }
    }

    class FakeMediaSource extends EventTarget {
      static latest: FakeMediaSource | null = null;
      readyState = "closed";
      duration = Number.NaN;
      sourceBuffer = new FakeSourceBuffer();

      constructor() {
        super();
        FakeMediaSource.latest = this;
      }

      addSourceBuffer() {
        return this.sourceBuffer;
      }

      open() {
        this.readyState = "open";
        this.dispatchEvent(new Event("sourceopen"));
      }
    }

    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:progressive"),
      revokeObjectURL: vi.fn()
    });
    vi.mocked(getCachedPiecesForTrack).mockResolvedValue([
      buildCachedPiece(0),
      buildCachedPiece(1),
      buildCachedPiece(2)
    ]);

    const audio = {
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn()
    } as unknown as HTMLAudioElement;

    const engine = new ProgressiveMseEngine(audio, "peer_local", {
      trackId: "track_1",
      fileHash: "hash_1",
      mimeType: "audio/mpeg",
      codec: "mpeg",
      sizeBytes: 12 * 256,
      durationMs: 120_000,
      totalChunks: 12,
      chunkSize: 256
    });

    await expect(engine.attach()).resolves.toBe(true);
    FakeMediaSource.latest?.open();
    await engine.sync();
    FakeMediaSource.latest?.sourceBuffer.dispatchEvent(new Event("updateend"));
    FakeMediaSource.latest?.sourceBuffer.dispatchEvent(new Event("updateend"));

    expect(FakeMediaSource.latest?.duration).toBe(120);
    expect(engine.getBufferedAheadMs(10)).toBe(20_000);
    expect(engine.isPlaybackReady(10, 8_000)).toBe(true);
    expect(engine.isPlaybackReady(40, 1)).toBe(false);
  });

  it("marks the engine failed when cached pieces cannot be read", async () => {
    class FakeSourceBuffer extends EventTarget {
      mode = "";
      updating = false;

      appendBuffer() {
        return undefined;
      }
    }

    class FakeMediaSource extends EventTarget {
      static latest: FakeMediaSource | null = null;
      readyState = "closed";
      sourceBuffer = new FakeSourceBuffer();

      constructor() {
        super();
        FakeMediaSource.latest = this;
      }

      addSourceBuffer() {
        return this.sourceBuffer;
      }

      open() {
        this.readyState = "open";
        this.dispatchEvent(new Event("sourceopen"));
      }
    }

    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:progressive"),
      revokeObjectURL: vi.fn()
    });
    vi.mocked(getCachedPiecesForTrack).mockRejectedValue(new Error("idb-failed"));

    const audio = {
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      removeAttribute: vi.fn()
    } as unknown as HTMLAudioElement;

    const engine = new ProgressiveMseEngine(audio, "peer_local", {
      trackId: "track_1",
      fileHash: "hash_1",
      mimeType: "audio/mpeg",
      codec: "mpeg",
      sizeBytes: 1024,
      durationMs: 10_000,
      totalChunks: 4,
      chunkSize: 256
    });

    await expect(engine.attach()).resolves.toBe(true);
    FakeMediaSource.latest?.open();
    await expect(engine.sync()).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.engineStatus).toBe("failed");
  });
});

function buildCachedPiece(chunkIndex: number) {
  return {
    pieceId: `hash_1:256:__local__:${chunkIndex}`,
    trackId: "track_1",
    peerId: "peer_local",
    ownerKey: "__local__",
    fileHash: "hash_1",
    chunkIndex,
    chunkSize: 256,
    hash: `hash_${chunkIndex}`,
    createdAt: new Date(0).toISOString(),
    payload: new Uint8Array([chunkIndex]).buffer
  };
}
