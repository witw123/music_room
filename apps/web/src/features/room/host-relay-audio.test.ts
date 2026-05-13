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

    expect(
      resolveHostRelayAudioElement({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: true,
        localAudio,
        hasPlayableLiveUpload: true
      })
    ).toBe(localAudio);
  });

  it("keeps listener relay resolution on the local audio element", () => {
    const localAudio = createAudioElement({ paused: false, readyState: 4, srcObject: {} });

    expect(
      resolveHostRelayAudioElement({
        isCurrentSourceOwner: false,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        hasPlayableLiveUpload: false
      })
    ).toBe(localAudio);
  });

  it("falls back to the local audio element when remote-stream has no audible remote element", () => {
    const localAudio = createAudioElement({ paused: false, readyState: 4, currentSrc: "blob:local" });

    expect(
      resolveHostRelayAudioElement({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        hasPlayableLiveUpload: true
      })
    ).toBe(localAudio);
  });

  it("keeps source owners on the local audio element even when a stale remote audio element is still bound", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });

    expect(
      resolveHostRelayAudioElement({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        hasPlayableLiveUpload: true
      })
    ).toBe(localAudio);
  });

  it("never selects the remote audio element while the current peer is the source owner", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });

    expect(
      resolveHostRelayAudioElement({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        hasPlayableLiveUpload: false
      })
    ).toBe(localAudio);
  });

  it("resolves a source-owner live upload to local-audio publish target", () => {
    const localAudio = createAudioElement({ paused: false, readyState: 4, currentSrc: "blob:local" });

    expect(
      resolveHostPublishSource({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: true,
        localAudio,
        hasPlayableLiveUpload: true
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      trackKind: "host-capture",
      readiness: "ready",
      resolvedPublishElement: "local-audio"
    });
  });

  it("does not reuse a stale PCM relay stream when the current source owner has a real local upload", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 0, currentSrc: "" });

    expect(
      resolveHostPublishSource({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
        hasPlayableLiveUpload: true
      })
    ).toMatchObject({
      publishTarget: "local-audio",
      resolvedPublishElement: "local-audio",
      resolvedPublishStreamKind: "audio-element-capture"
    });
  });

  it("does not reuse the relay stream for a source owner even before the upload registry catches up", () => {
    const localAudio = createAudioElement({ paused: true, readyState: 1, currentSrc: "blob:pending" });

    expect(
      resolveHostPublishSource({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
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
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: true,
        localAudio,
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

    expect(
      resolveHostPublishSource({
        isCurrentSourceOwner: true,
        forceSourceOwnerLocalPlayback: false,
        localAudio,
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
