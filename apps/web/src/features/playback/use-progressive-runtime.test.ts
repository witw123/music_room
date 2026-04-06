import { describe, expect, it } from "vitest";
import {
  resolveAdaptiveStartupBufferMs,
  resolveAudioQualityTier,
  resolveMediaElementPlaybackRole,
  shouldBlockFullLocalHandoffForRecentRemoteRecovery,
  shouldEnableFullLocalHandoff,
  resolvePlaybackRecoveryStage,
  resolveRemoteAudioHoldDurationMs,
  resolveRemoteStartupGateState,
  resolveSchedulerBudgetTier,
  shouldEnableAudibleLocalFallback,
  shouldPreferLocalTakeover,
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

  it("classifies shadow warmup events separately from the audible source", () => {
    expect(
      resolveMediaElementPlaybackRole({
        target: "local",
        activePlaybackSource: "remote-stream",
        shadowWarmupActive: true
      })
    ).toBe("shadow-local");
    expect(
      resolveMediaElementPlaybackRole({
        target: "remote",
        activePlaybackSource: "remote-stream",
        shadowWarmupActive: true
      })
    ).toBe("audible-remote");
    expect(
      resolveMediaElementPlaybackRole({
        target: "remote",
        activePlaybackSource: "full-local",
        shadowWarmupActive: false
      })
    ).toBe("inactive");
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
    ).toBe(400);
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

  it("keeps recovery polling active without remuting an already established remote stream", () => {
    expect(
      resolveRemoteStartupGateState({
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        readyState: 1,
        paused: false,
        hasSrcObject: true,
        stableSinceMs: 1_000,
        startupBufferMs: 320,
        muteDuringGate: false,
        now: 1_200,
        lastWaitingAtMs: 1_150
      })
    ).toEqual({
      shouldPoll: true,
      shouldMute: false,
      nextStableSinceMs: 1_200
    });
  });

  it("does not keep a bound remote MediaStream muted forever just because readyState stays low", () => {
    expect(
      resolveRemoteStartupGateState({
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        readyState: 1,
        paused: false,
        hasSrcObject: true,
        stableSinceMs: 1_000,
        startupBufferMs: 320,
        now: 1_400,
        lastWaitingAtMs: null
      })
    ).toEqual({
      shouldPoll: false,
      shouldMute: false,
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

  it("does not prefer listener local takeover while remote-first lock is active", () => {
    expect(
      shouldPreferLocalTakeover({
        remoteFirstLock: true,
        progressiveFallbackReason: "stalled"
      })
    ).toBe(false);
  });

  it("prefers listener local takeover only for explicit local fallback reasons", () => {
    expect(
      shouldPreferLocalTakeover({
        remoteFirstLock: false,
        progressiveFallbackReason: "buffer-underrun"
      })
    ).toBe(true);
    expect(
      shouldPreferLocalTakeover({
        remoteFirstLock: false,
        progressiveFallbackReason: null
      })
    ).toBe(false);
  });

  it("requires repeated remote degradation before enabling audible local fallback", () => {
    expect(
      shouldEnableAudibleLocalFallback({
        activePlaybackSource: "remote-stream",
        remoteFirstLock: false,
        waitingEventsLast30s: 1,
        stalledEventsLast30s: 0,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(false);
    expect(
      shouldEnableAudibleLocalFallback({
        activePlaybackSource: "remote-stream",
        remoteFirstLock: false,
        waitingEventsLast30s: 2,
        stalledEventsLast30s: 0,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(true);
  });

  it("keeps remote-first lock from switching locally until degradation is persistent", () => {
    expect(
      shouldEnableAudibleLocalFallback({
        activePlaybackSource: "remote-stream",
        remoteFirstLock: true,
        waitingEventsLast30s: 2,
        stalledEventsLast30s: 0,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(false);
    expect(
      shouldEnableAudibleLocalFallback({
        activePlaybackSource: "remote-stream",
        remoteFirstLock: true,
        waitingEventsLast30s: 3,
        stalledEventsLast30s: 0,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(true);
  });

  it("reports shadow catchup while remote playback is degraded but warming locally", () => {
    expect(
      resolvePlaybackRecoveryStage({
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        startupGatePending: false,
        waitingEventsLast30s: 2,
        stalledEventsLast30s: 0,
        shadowWarmupActive: true,
        audibleLocalFallbackActive: false
      })
    ).toBe("shadow-catchup");
  });

  it("maps degraded remote playback to a protected scheduler budget", () => {
    expect(
      resolveSchedulerBudgetTier({
        bufferHealth: "low",
        activePlaybackSource: "remote-stream",
        playbackRecoveryStage: "degraded"
      })
    ).toBe("protected");
  });

  it("allows a listener to hand off from remote-stream to full-local once the full cache is ready", () => {
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "remote-stream",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(true);
  });

  it("keeps full-local handoff blocked until remote startup buffering is over", () => {
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "remote-stream",
        playbackRecoveryStage: "startup-buffering",
        startupGatePending: true,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(false);
  });

  it("does not keep full-local handoff blocked after an old waiting event has aged out", () => {
    expect(
      shouldBlockFullLocalHandoffForRecentRemoteRecovery({
        lastRemoteWaitingAtMs: 1_000,
        startupBufferMs: 680,
        now: 3_000
      })
    ).toBe(false);
  });

  it("still blocks full-local handoff during the short post-waiting recovery window", () => {
    expect(
      shouldBlockFullLocalHandoffForRecentRemoteRecovery({
        lastRemoteWaitingAtMs: 1_000,
        startupBufferMs: 680,
        now: 1_900
      })
    ).toBe(true);
  });

  it("keeps the low-level full-local handoff predicate independent from listener policy", () => {
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "remote-stream",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(true);
  });
});
