import { describe, expect, it } from "vitest";
import {
  resolveAdaptiveStartupBufferMs,
  resolveMediaElementPlaybackRole,
  resolveRemoteOutputMode,
  shouldBlockFullLocalHandoffForRecentRemoteRecovery,
  shouldEnableFullLocalHandoff,
  shouldPreferImmediateFullLocalRecovery,
  resolvePlaybackRecoveryStage,
  resolveRemoteAudioHoldDurationMs,
  resolveRemoteStartupGateState,
  resolveSchedulerBudgetTier,
  shouldPrepareProgressiveRuntimeForSource,
  shouldEnableAudibleLocalFallback,
  shouldPreferLocalTakeover,
  shouldRecoverPausedFullLocalPlayback,
  shouldUsePcmEngineForFullLocal,
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
    ).toBe(180);
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
    ).toBe(80);
  });

  it("ramps volume up during the startup gate window instead of hard-muting", () => {
    const result = resolveRemoteStartupGateState({
      activePlaybackSource: "remote-stream",
      playbackStatus: "playing",
      readyState: 4,
      paused: false,
      hasSrcObject: true,
      stableSinceMs: 1_000,
      startupBufferMs: 320,
      now: 1_200,
      lastWaitingAtMs: null
    });
    expect(result.shouldPoll).toBe(true);
    expect(result.shouldMute).toBe(false);
    expect(result.nextStableSinceMs).toBe(1_000);
    expect(result.volumeRamp).toBeGreaterThan(0.2);
    expect(result.volumeRamp).toBeLessThan(1.0);
  });

  it("keeps recovery polling active without remuting an already established remote stream", () => {
    const result = resolveRemoteStartupGateState({
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
    });
    expect(result.shouldPoll).toBe(true);
    expect(result.shouldMute).toBe(false);
    expect(result.nextStableSinceMs).toBeNull();
    expect(result.volumeRamp).toBe(0.15);
  });

  it("keeps the startup gate active while a bound remote stream still lacks current data", () => {
    const result = resolveRemoteStartupGateState({
      activePlaybackSource: "remote-stream",
      playbackStatus: "playing",
      readyState: 1,
      paused: false,
      hasSrcObject: true,
      stableSinceMs: 1_000,
      startupBufferMs: 320,
      now: 1_400,
      lastWaitingAtMs: null
    });
    expect(result.shouldPoll).toBe(true);
    expect(result.shouldMute).toBe(false);
    expect(result.nextStableSinceMs).toBeNull();
    expect(result.volumeRamp).toBe(0.15);
  });

  it("restarts the startup gate after a recent waiting event with low volume ramp", () => {
    const result = resolveRemoteStartupGateState({
      activePlaybackSource: "remote-stream",
      playbackStatus: "playing",
      readyState: 4,
      paused: false,
      hasSrcObject: true,
      stableSinceMs: 1_000,
      startupBufferMs: 320,
      now: 1_500,
      lastWaitingAtMs: 1_400
    });
    expect(result.shouldPoll).toBe(true);
    expect(result.shouldMute).toBe(false);
    expect(result.nextStableSinceMs).toBe(1_500);
    expect(result.volumeRamp).toBe(0.3);
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

  it("does not prefer listener local takeover while remote-first lock is active", () => {
    expect(
      shouldPreferLocalTakeover({
        remoteFirstLock: true,
        progressiveFallbackReason: "stalled"
      })
    ).toBe(false);
  });

  it("prefers immediate full-local recovery for late-join or rejoin when the full cache is already ready", () => {
    expect(
      shouldPreferImmediateFullLocalRecovery({
        isCurrentSourceOwner: false,
        audioUnlocked: true,
        hasBufferedFullLocalTrack: true,
        fullLocalRecoveryActive: true,
        recoveryPhase: "resyncing",
        recoveryMode: "rejoin",
        playbackStatus: "playing"
      })
    ).toBe(true);
  });

  it("allows full-local recovery after a steady member is moved back into fallback recovery", () => {
    expect(
      shouldPreferImmediateFullLocalRecovery({
        isCurrentSourceOwner: false,
        audioUnlocked: true,
        hasBufferedFullLocalTrack: true,
        fullLocalRecoveryActive: true,
        recoveryPhase: "playing-local-fallback",
        recoveryMode: "steady",
        playbackStatus: "playing"
      })
    ).toBe(true);
  });

  it("does not prefer immediate full-local recovery when the member is still locked, lacks a full cache, or is already steady", () => {
    expect(
      shouldPreferImmediateFullLocalRecovery({
        isCurrentSourceOwner: false,
        audioUnlocked: false,
        hasBufferedFullLocalTrack: true,
        fullLocalRecoveryActive: true,
        recoveryPhase: "resyncing",
        recoveryMode: "late-join",
        playbackStatus: "playing"
      })
    ).toBe(false);
    expect(
      shouldPreferImmediateFullLocalRecovery({
        isCurrentSourceOwner: false,
        audioUnlocked: true,
        hasBufferedFullLocalTrack: false,
        fullLocalRecoveryActive: true,
        recoveryPhase: "bootstrapping-media",
        recoveryMode: "rejoin",
        playbackStatus: "playing"
      })
    ).toBe(false);
    expect(
      shouldPreferImmediateFullLocalRecovery({
        isCurrentSourceOwner: false,
        audioUnlocked: true,
        hasBufferedFullLocalTrack: true,
        fullLocalRecoveryActive: true,
        recoveryPhase: "steady",
        recoveryMode: "steady",
        playbackStatus: "playing"
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

  it("classifies remote output mode separately from the active playback source", () => {
    expect(
      resolveRemoteOutputMode({
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        hasRemoteSrcObject: true
      })
    ).toBe("audible");
    expect(
      resolveRemoteOutputMode({
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        hasRemoteSrcObject: true
      })
    ).toBe("held-silent");
    expect(
      resolveRemoteOutputMode({
        activePlaybackSource: "full-local",
        playbackStatus: "paused",
        hasRemoteSrcObject: false
      })
    ).toBe("inactive");
  });

  it("recovers full-local playback when the ready local audio element is paused", () => {
    expect(
      shouldRecoverPausedFullLocalPlayback({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        currentTrackId: "track_1",
        audioUnlocked: true,
        localAudioPaused: true,
        localAudioReadyState: 4,
        localAudioHasSrc: true,
        localAudioHasSrcObject: false
      })
    ).toBe(true);
  });

  it("does not recover paused full-local playback while room playback is paused", () => {
    expect(
      shouldRecoverPausedFullLocalPlayback({
        activePlaybackSource: "full-local",
        playbackStatus: "paused",
        currentTrackId: "track_1",
        audioUnlocked: true,
        localAudioPaused: true,
        localAudioReadyState: 4,
        localAudioHasSrc: true,
        localAudioHasSrcObject: false
      })
    ).toBe(false);
  });

  it("does not prepare a progressive runtime while native full-local playback is active", () => {
    expect(
      shouldPrepareProgressiveRuntimeForSource({
        activePlaybackSource: "full-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(false);
    expect(
      shouldPrepareProgressiveRuntimeForSource({
        activePlaybackSource: "full-local",
        progressiveEngineType: "mse"
      })
    ).toBe(false);
    expect(
      shouldPrepareProgressiveRuntimeForSource({
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "mse"
      })
    ).toBe(true);
  });

  it("uses the native blob URL instead of the PCM engine when full-local cache exists", () => {
    expect(
      shouldUsePcmEngineForFullLocal({
        activePlaybackSource: "full-local",
        forceSourceOwnerLocalPlayback: false,
        sourceOwnerHasLocalTrack: false,
        hasFullLocalTrack: true,
        progressiveEngineType: "pcm"
      })
    ).toBe(false);
    expect(
      shouldUsePcmEngineForFullLocal({
        activePlaybackSource: "full-local",
        forceSourceOwnerLocalPlayback: false,
        sourceOwnerHasLocalTrack: false,
        hasFullLocalTrack: true,
        progressiveEngineType: "mse"
      })
    ).toBe(false);
    expect(
      shouldUsePcmEngineForFullLocal({
        activePlaybackSource: "remote-stream",
        forceSourceOwnerLocalPlayback: true,
        sourceOwnerHasLocalTrack: false,
        hasFullLocalTrack: false,
        progressiveEngineType: "pcm"
      })
    ).toBe(true);
  });
});
