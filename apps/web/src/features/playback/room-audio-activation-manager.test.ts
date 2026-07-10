import { describe, expect, it, vi } from "vitest";
import { RoomAudioActivationManager } from "./room-audio-activation-manager";

function createAudioElementMock() {
  const audio = {
    src: "",
    srcObject: null,
    currentSrc: "",
    muted: false,
    volume: 0.72,
    preload: "none",
    paused: true,
    play: vi.fn(async () => undefined),
    pause: vi.fn(() => undefined),
    load: vi.fn(() => undefined),
    getAttribute: vi.fn((name: string) => (name === "src" ? audio.src : null)),
    removeAttribute: vi.fn((name: string) => {
      if (name === "src") {
        audio.src = "";
        audio.currentSrc = "";
      }
    })
  };

  return audio as unknown as HTMLAudioElement;
}

describe("RoomAudioActivationManager", () => {
  it("primes empty audio elements with a silent source inside the click gesture", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();

    await expect(
      manager.activateOutputs({
        localAudio: audio
      })
    ).resolves.toEqual({
      ok: true,
      local: {
        ok: true,
        error: null
      }
    });

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.load).toHaveBeenCalledTimes(2);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.72);
    expect(audio.preload).toBe("none");
    expect(manager.isActivated()).toBe(true);
  });

  it("does not mark outputs activated when priming never actually plays", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();
    audio.play = vi.fn(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });

    await expect(
      manager.activateOutputs({
        localAudio: audio
      })
    ).resolves.toEqual({
      ok: false,
      local: {
        ok: false,
        error: "blocked"
      }
    });

    expect(manager.isActivated()).toBe(false);
  });

  it("does not reject when an embedded webview throws during priming", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();
    audio.load = vi.fn(() => {
      throw new DOMException("load failed", "InvalidStateError");
    });

    await expect(
      manager.activateOutputs({
        localAudio: audio
      })
    ).resolves.toEqual({
      ok: true,
      local: {
        ok: true,
        error: null
      }
    });
  });

  it("marks outputs activated after a successful play call", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();

    await expect(manager.playElement(audio)).resolves.toEqual({
      ok: true,
      error: null
    });
    expect(manager.isActivated()).toBe(true);
  });

  it("plays again when a not-paused element has switched to a new media source", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();
    Object.defineProperty(audio, "paused", {
      configurable: true,
      value: false
    });
    audio.src = "blob:next-track";
    Object.defineProperty(audio, "currentSrc", {
      configurable: true,
      value: "blob:next-track"
    });

    await expect(manager.playElement(audio)).resolves.toEqual({
      ok: true,
      error: null
    });

    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(manager.isActivated()).toBe(true);
  });

  it("returns a structured failure when playback is rejected", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();
    audio.play = vi.fn(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });

    await expect(manager.playElement(audio)).resolves.toEqual({
      ok: false,
      error: "blocked"
    });
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.72);
  });

  it("recovers a blocked audible source by starting muted and restoring sound", async () => {
    const manager = new RoomAudioActivationManager();
    const audio = createAudioElementMock();
    audio.src = "blob:cached-track";
    audio.play = vi.fn(async () => {
      if (!audio.muted) {
        throw new DOMException("blocked", "NotAllowedError");
      }
    });

    await expect(manager.playElement(audio)).resolves.toEqual({
      ok: true,
      error: null
    });

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.72);
    expect(manager.isActivated()).toBe(true);
  });
});
