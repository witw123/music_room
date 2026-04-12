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

  it("keeps source owners on the local audio element even when a stale remote audio element is still bound", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });
    const remoteAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

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

  it("never selects the remote audio element while the current peer is the source owner", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });
    const remoteAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

    expect(
      resolveHostRelayAudioElement({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        remoteAudio,
        hasPlayableLiveUpload: false,
        hostRelayStreamAvailable: true
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

  it("does not reuse a stale PCM relay stream when the current source owner has a real local upload", () => {
    const hostRelayStream = {
      getAudioTracks: () => [{ enabled: true, muted: false, readyState: "live" }]
    } as unknown as MediaStream;
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });
    const remoteAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

    expect(
      resolveHostPublishSource({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        remoteAudio,
        hostRelayStream,
        hasPlayableLiveUpload: true
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      resolvedPublishElement: "local-audio",
      resolvedPublishStreamKind: "audio-element-capture"
    });
  });

  it("does not reuse the relay stream for a source owner even before the upload registry catches up", () => {
    const hostRelayStream = {
      getAudioTracks: () => [{ enabled: true, muted: false, readyState: "live" }]
    } as unknown as MediaStream;
    const localAudio = createAudioElement({ paused: true, readyState: 1, currentSrc: "blob:pending" });

    expect(
      resolveHostPublishSource({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        remoteAudio: createAudioElement({ paused: false, readyState: 4, srcObject: {} }),
        hostRelayStream,
        hasPlayableLiveUpload: false
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      readiness: "awaiting-audio",
      resolvedPublishElement: "local-audio"
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

  it("does not promote a stale remote audio element to the source-owner publish target", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });
    const remoteAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

    expect(
      resolveHostPublishSource({
        activePlaybackSource: "remote-stream",
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        remoteAudio,
        hostRelayStream: null,
        hasPlayableLiveUpload: true
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      readiness: "failed",
      reason: "local-audio-has-no-bound-source",
      resolvedPublishElement: "local-audio"
    });
  });
});
