import { describe, expect, it } from "vitest";
import { resolveHostPublishSource, resolveHostRelayAudioElement } from "./host-relay-audio";

function createAudioElement(input?: {
  paused?: boolean;
  readyState?: number;
  srcObject?: object | null;
  currentSrc?: string;
  src?: string;
}) {
  return {
    paused: input?.paused ?? true,
    readyState: input?.readyState ?? 0,
    srcObject: input?.srcObject ?? null,
    currentSrc: input?.currentSrc ?? "",
    src: input?.src ?? ""
  } as HTMLAudioElement;
}

describe("host relay audio", () => {
  it("prefers the local audio element when source-owner local playback is forced", () => {
    const localAudio = createAudioElement({ paused: false, readyState: 4, currentSrc: "blob:local" });
    const remoteAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: true,
        localAudio,
        remoteAudio,
        hasPlayableLiveUpload: true,
        hostRelayStreamAvailable: false
      })
    ).toBe(localAudio);
  });

  it("prefers the remote audio element only when remote playback is actually audible", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 1 });
    const remoteAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: false,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        remoteAudio,
        hasPlayableLiveUpload: false,
        hostRelayStreamAvailable: false
      })
    ).toBe(remoteAudio);
  });

  it("falls back to the local audio element when remote-stream has no audible remote element", () => {
    const localAudio = createAudioElement({ paused: false, readyState: 4, currentSrc: "blob:local" });
    const remoteAudio = createAudioElement({ paused: true, readyState: 0, srcObject: null });

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        remoteAudio,
        hasPlayableLiveUpload: true,
        hostRelayStreamAvailable: false
      })
    ).toBe(localAudio);
  });

  it("resolves a source-owner live upload to local-audio publish target", () => {
    const localAudio = createAudioElement({ paused: false, readyState: 4, currentSrc: "blob:local" });
    const remoteAudio = createAudioElement();

    expect(
      resolveHostPublishSource({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: true,
        localAudio,
        remoteAudio,
        hostRelayStream: null,
        hasPlayableLiveUpload: true
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      trackKind: "host-capture",
      readiness: "ready",
      resolvedPublishElement: "local-audio"
    });
  });

  it("prefers the PCM relay stream when a stable relay output track is available", () => {
    const hostRelayStream = {
      getAudioTracks: () => [{ enabled: true, muted: false, readyState: "live" }]
    } as unknown as MediaStream;

    expect(
      resolveHostPublishSource({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: false,
        forceSourceOwnerLocalPlayback: false,
        localAudio: createAudioElement(),
        remoteAudio: createAudioElement(),
        hostRelayStream,
        hasPlayableLiveUpload: false
      })
    ).toMatchObject({
      publishTarget: "pcm-relay-stream",
      trackKind: "relay-stream",
      readiness: "ready",
      resolvedPublishStreamKind: "pcm-relay-stream"
    });
  });

  it("reports awaiting-audio when the chosen publish element is bound but not yet playing", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 1, currentSrc: "blob:local" });

    expect(
      resolveHostPublishSource({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: true,
        localAudio,
        remoteAudio: createAudioElement(),
        hostRelayStream: null,
        hasPlayableLiveUpload: true
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      readiness: "awaiting-audio",
      reason: "local-audio-not-yet-playing"
    });
  });
});
