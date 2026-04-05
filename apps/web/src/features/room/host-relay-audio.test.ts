import { describe, expect, it } from "vitest";
import { resolveHostRelayAudioElement } from "./host-relay-audio";

describe("host relay audio", () => {
  it("prefers the remote audio element when remote-stream is the active source", () => {
    const localAudio = { id: "local" } as HTMLAudioElement;
    const remoteAudio = { id: "remote" } as HTMLAudioElement;

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "remote-stream",
        localAudio,
        remoteAudio
      })
    ).toBe(remoteAudio);
  });

  it("prefers the local audio element for local playback sources", () => {
    const localAudio = { id: "local" } as HTMLAudioElement;
    const remoteAudio = { id: "remote" } as HTMLAudioElement;

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "full-local",
        localAudio,
        remoteAudio
      })
    ).toBe(localAudio);
  });

  it("can force source-owner relay capture to stay on the local audio element", () => {
    const localAudio = { id: "local" } as HTMLAudioElement;
    const remoteAudio = { id: "remote" } as HTMLAudioElement;

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "remote-stream",
        preferLocalAudio: true,
        localAudio,
        remoteAudio
      })
    ).toBe(localAudio);
  });
});
