import { describe, expect, it } from "vitest";
import {
  resolveAdaptiveStartupBufferMs,
  resolveAudioQualityTier,
  resolveRemoteAudioHoldDurationMs,
  resolveRemoteStartupGateState,
  shouldPollRemoteStartupGate
} from "./use-progressive-runtime";

describe("shouldPollRemoteStartupGate", () => {
  it("keeps polling while remote-stream playback is waiting for current data", () => {
    expect(shouldPollRemoteStartupGate("remote-stream", "playing", 1)).toBe(true);
  });

  it("stops polling once the remote audio element has current data", () => {
    expect(shouldPollRemoteStartupGate("remote-stream", "playing", 2)).toBe(false);
  });

  it("does not poll outside active remote-stream playback", () => {
    expect(shouldPollRemoteStartupGate("full-local", "playing", 0)).toBe(false);
    expect(shouldPollRemoteStartupGate("remote-stream", "paused", 0)).toBe(false);
  });

  it("uses a larger startup gate on weak constrained links", () => {
    expect(
      resolveAdaptiveStartupBufferMs({
        sourceDiagnostics: {
          currentRoundTripTimeMs: 210,
          packetLossRate: 7.5,
          jitterMs: 38,
          mediaCandidateType: "relay",
          mediaProtocol: "tcp"
        },
        hasRecentStablePlayback: false
      })
    ).toBeGreaterThanOrEqual(420);
  });

  it("fades startup buffering down after recent stable playback", () => {
    expect(
      resolveAdaptiveStartupBufferMs({
        sourceDiagnostics: {
          currentRoundTripTimeMs: 90,
          packetLossRate: 1.2,
          jitterMs: 4,
          mediaCandidateType: "relay",
          mediaProtocol: "tcp"
        },
        hasRecentStablePlayback: true
      })
    ).toBeLessThan(320);
  });

  it("holds the remote audio element muted until the startup window matures", () => {
    expect(
      resolveRemoteStartupGateState({
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        readyState: 4,
        paused: false,
        hasSrcObject: true,
        stableSinceMs: 1_000,
        startupBufferMs: 320,
        now: 1_200,
        lastWaitingAtMs: null
      })
    ).toEqual({
      shouldPoll: true,
      shouldMute: true,
      nextStableSinceMs: 1_000
    });
  });

  it("restarts the startup gate after a recent waiting event", () => {
    expect(
      resolveRemoteStartupGateState({
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        readyState: 4,
        paused: false,
        hasSrcObject: true,
        stableSinceMs: 1_000,
        startupBufferMs: 320,
        now: 1_500,
        lastWaitingAtMs: 1_400
      })
    ).toEqual({
      shouldPoll: true,
      shouldMute: true,
      nextStableSinceMs: 1_500
    });
  });

  it("uses a longer remote hold when the path is recovering", () => {
    expect(
      resolveRemoteAudioHoldDurationMs({
        activePlaybackSource: "full-local",
        remoteFirstLock: true,
        waitingEventsLast30s: 0,
        shadowWarmupActive: true
      })
    ).toBeGreaterThan(500);
  });

  it("maps bitrate and jitter targets to coarse quality tiers", () => {
    expect(
      resolveAudioQualityTier({
        targetAudioBitrateKbps: 192,
        receiverJitterTargetMs: 280
      })
    ).toEqual({
      audioBitrateTier: "high",
      receiverJitterTier: "low"
    });
  });
});
