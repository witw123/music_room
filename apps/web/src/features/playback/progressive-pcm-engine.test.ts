import { describe, expect, it } from "vitest";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";

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

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      AudioContext: FakeAudioContext
    }
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
});
