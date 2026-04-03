import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressiveMseEngine } from "./progressive-mse-engine";

describe("ProgressiveMseEngine", () => {
  afterEach(() => {
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
});
