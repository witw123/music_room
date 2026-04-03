import { describe, expect, it } from "vitest";
import { ProgressivePcmEngine } from "./progressive-pcm-engine";

describe("ProgressivePcmEngine volume control", () => {
  it("uses a gain node for volume when the audio context is attached", async () => {
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

    const audio = {
      volume: 0,
      srcObject: null as MediaStream | null,
      pause() {
        return undefined;
      },
      load() {
        return undefined;
      }
    } as HTMLAudioElement;
    const engine = new ProgressivePcmEngine(audio, "peer_local", {
      trackId: "track_1",
      fileHash: "hash_1",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: 1,
      durationMs: 1_000,
      totalChunks: 4,
      chunkSize: 256 * 1024
    });

    engine.setVolume(0.35);
    const attached = await engine.attach();
    engine.setVolume(0.6);

    expect(attached).toBe(true);
    expect(audio.volume).toBe(1);
    expect(gainNode.gain.value).toBe(0.6);

    engine.destroy();

    if (typeof originalWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  });
});
