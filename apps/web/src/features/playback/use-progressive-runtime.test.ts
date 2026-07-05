import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAvailableChunksKey,
  buildCurrentTrackFormatKey,
  buildPlaybackPositionKey,
  buildProgressiveWarmupTimerKey,
  bucketDiagnosticDurationMs as pipelineBucketDiagnosticDurationMs,
  getAudibleElementVolume as pipelineGetAudibleElementVolume,
  getPcmEngineDiagnosticsKey as pipelineGetPcmEngineDiagnosticsKey,
  getSlidingWindowPlayBlockedReason as pipelineGetSlidingWindowPlayBlockedReason,
  hasSufficientBackingForFullLocalWarmup as pipelineHasSufficientBackingForFullLocalWarmup,
  resolvePlaybackRecoveryStage as pipelineResolvePlaybackRecoveryStage,
  resolveFullLocalPlaybackSessionState as pipelineResolveFullLocalPlaybackSessionState,
  resolveMediaElementPlaybackRole as pipelineResolveMediaElementPlaybackRole,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure as pipelineResolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveSchedulerBudgetTier as pipelineResolveSchedulerBudgetTier,
  shouldAttemptProgressiveLocalPlayback as pipelineShouldAttemptProgressiveLocalPlayback,
  shouldEnableFullLocalHandoff as pipelineShouldEnableFullLocalHandoff,
  shouldHoldSlidingWindowPlaybackForEngine as pipelineShouldHoldSlidingWindowPlaybackForEngine,
  shouldPreferLocalTakeover as pipelineShouldPreferLocalTakeover,
  shouldPreferImmediateFullLocalRecovery as pipelineShouldPreferImmediateFullLocalRecovery,
  shouldPublishProgressiveDiagnostic as pipelineShouldPublishProgressiveDiagnostic,
  shouldPrepareProgressiveRuntimeForSource as pipelineShouldPrepareProgressiveRuntimeForSource,
  shouldRecoverPausedFullLocalPlayback as pipelineShouldRecoverPausedFullLocalPlayback,
  shouldRecoverSilentSlidingWindowWithFullLocal as pipelineShouldRecoverSilentSlidingWindowWithFullLocal,
  shouldResetAudioForPlaybackSurfaceChange as pipelineShouldResetAudioForPlaybackSurfaceChange,
  shouldSkipSecondaryPcmWarmupSync as pipelineShouldSkipSecondaryPcmWarmupSync,
  shouldStartListenerProgressivePlayback as pipelineShouldStartListenerProgressivePlayback,
  shouldStartPcmSlidingWindowAudioElement as pipelineShouldStartPcmSlidingWindowAudioElement,
  shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup as pipelineShouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup,
  shouldUsePcmEngineForFullLocal as pipelineShouldUsePcmEngineForFullLocal,
  shouldWarmFullLocalWithSharedAudioElement as pipelineShouldWarmFullLocalWithSharedAudioElement
} from "./playback-orchestrator/pipeline";
import {
  getAudibleElementVolume,
  getPcmEngineDiagnosticsKey,
  hasSufficientBackingForFullLocalWarmup,
  resolveMediaElementPlaybackRole,
  resolvePlaybackRecoveryStage,
  resolveSchedulerBudgetTier,
  shouldEnableFullLocalHandoff,
  resolveFullLocalPlaybackSessionState,
  shouldPreferImmediateFullLocalRecovery,
  shouldPreferLocalTakeover,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure,
  shouldPrepareProgressiveRuntimeForSource,
  shouldAttemptProgressiveLocalPlayback,
  shouldPublishProgressiveDiagnostic,
  shouldRecoverPausedFullLocalPlayback,
  shouldRecoverSilentSlidingWindowWithFullLocal,
  shouldStartListenerProgressivePlayback,
  shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup,
  shouldWarmFullLocalWithSharedAudioElement,
  shouldHoldSlidingWindowPlaybackForEngine,
  shouldLatchPcmRuntimeFailure,
  shouldResetAudioForPlaybackSurfaceChange,
  shouldRetryPcmRuntimeAfterFailure,
  shouldStartPcmSlidingWindowAudioElement,
  shouldSkipSecondaryPcmWarmupSync,
  shouldUsePcmEngineForFullLocal
} from "./use-progressive-runtime";

describe("playback runtime pipeline keys", () => {
  it("drives the progressive warmup interval from a stable dependency key", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const intervalNeedle = [
      "const timerId = window.setInterval(() => {",
      "      void syncWarmup();",
      "    }, progressiveRuntimeTickIntervalMs);"
    ].join("\n");
    const intervalIndex = runtimeSource.indexOf(intervalNeedle);
    expect(intervalIndex).toBeGreaterThan(-1);

    const dependencyStart = runtimeSource.indexOf("  }, [", intervalIndex);
    const dependencyEnd = runtimeSource.indexOf("]);", dependencyStart);
    const dependencies = runtimeSource.slice(dependencyStart, dependencyEnd);

    expect(dependencies).toContain("progressiveWarmupTimerKey");
    expect(dependencies).not.toContain("currentProgressiveManifest,");
    expect(dependencies).not.toContain("canUseFullLocalForPlaybackSession,");
    expect(dependencies).not.toContain("progressiveHealthSnapshot.startupReady,");
    expect(dependencies).not.toContain("attemptPlaybackStart,");
    expect(dependencies).not.toContain("isLocalTakeoverAllowed,");
    expect(dependencies).not.toContain("markPcmRuntimeFailure,");
    expect(dependencies).not.toContain("transitionPlaybackSource,");
  });

  it("hosts diagnostic and media element helpers in the pure pipeline module", () => {
    expect(pipelineBucketDiagnosticDurationMs(null, 1000)).toBe("");
    expect(pipelineBucketDiagnosticDurationMs(Number.NaN, 1000)).toBe("");
    expect(pipelineBucketDiagnosticDurationMs(1499, 1000)).toBe(1000);
    expect(pipelineBucketDiagnosticDurationMs(1500, 1000)).toBe(2000);
    expect(pipelineGetAudibleElementVolume(0)).toBe(0.72);
    expect(
      pipelineGetPcmEngineDiagnosticsKey({
        status: "ready",
        audioContextState: "running",
        hasOutputStream: true,
        directOutputConnected: true,
        contiguousChunkCount: 1,
        contiguousByteLength: 1024,
        decodedSegmentCount: 1,
        scheduledSegmentCount: 1,
        decodedPacketCount: 1,
        decoderFlushAttemptCount: 0,
        decoderFlushCount: 0,
        lastDecodedAtMs: 1000,
        lastDecodeError: null,
        decodedPeak: 0.5,
        decodedRms: 0.2,
        decodedNonZeroSampleCount: 100,
        bufferedAheadMs: 5000,
        playoutState: "playing"
      })
    ).toBe("ready|running|direct|decoded|scheduled|none");
    expect(
      pipelineResolveMediaElementPlaybackRole({
        target: "remote",
        activePlaybackSource: "full-local",
        shadowWarmupActive: false
      })
    ).toBe("inactive");
  });

  it("hosts recovery guard policy in the pure pipeline module", () => {
    expect(
      pipelineShouldPreferImmediateFullLocalRecovery({
        isCurrentSourceOwner: false,
        audioUnlocked: true,
        hasBufferedFullLocalTrack: true,
        fullLocalRecoveryActive: true,
        recoveryPhase: "resyncing",
        recoveryMode: "rejoin",
        playbackStatus: "playing"
      })
    ).toBe(true);
    expect(
      pipelineShouldEnableFullLocalHandoff({
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(true);
    expect(
      pipelineShouldRecoverPausedFullLocalPlayback({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        currentTrackId: "track-1",
        audioUnlocked: false,
        localAudioPaused: true,
        localAudioReadyState: 2,
        localAudioHasSrc: false,
        localAudioHasSrcObject: false
      })
    ).toBe(true);
    expect(
      pipelineShouldSkipSecondaryPcmWarmupSync({
        engineType: "pcm",
        engineReady: false,
        localReady: true
      })
    ).toBe(true);
  });

  it("hosts playback session and source guard policy in the pure pipeline module", () => {
    expect(
      pipelineShouldPublishProgressiveDiagnostic({
        previousSignature: "old",
        nextSignature: "new"
      })
    ).toBe(true);
    expect(
      pipelineShouldHoldSlidingWindowPlaybackForEngine({
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        hasPcmEngine: false,
        hasMseEngine: false
      })
    ).toBe(true);
    expect(
      pipelineShouldResetAudioForPlaybackSurfaceChange({
        previousPlaybackSurfaceKey: "track-1|1",
        nextPlaybackSurfaceKey: "track-2|1"
      })
    ).toBe(true);
    expect(
      pipelineResolvePlaybackSourceAfterProgressiveRuntimeFailure({
        activePlaybackSource: "lossless-local",
        hasProgressiveRuntimeFailure: true
      })
    ).toBe("progressive-local");
    expect(
      pipelineResolveFullLocalPlaybackSessionState({
        currentSession: {
          key: "surface-a",
          availableInSession: false
        },
        playbackSurfaceKey: "surface-a",
        hasBufferedFullLocalTrack: true
      })
    ).toEqual({
      key: "surface-a",
      availableInSession: true
    });
  });

  it("hosts recovery and scheduler policy in the pure pipeline module", () => {
    const recoveryStage = pipelineResolvePlaybackRecoveryStage({
      activePlaybackSource: "progressive-local",
      playbackStatus: "playing",
      startupGatePending: false,
      waitingEventsLast30s: 1,
      stalledEventsLast30s: 0,
      shadowWarmupActive: false,
      audibleLocalFallbackActive: false
    });

    expect(recoveryStage).toBe("degraded");
    expect(
      pipelineResolveSchedulerBudgetTier({
        bufferHealth: "low",
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: recoveryStage
      })
    ).toBe("protected");
    expect(pipelineShouldPreferLocalTakeover({ progressiveFallbackReason: "stalled" })).toBe(true);
  });

  it("hosts listener sliding-window playback policy in the pure pipeline module", () => {
    expect(pipelineGetSlidingWindowPlayBlockedReason("progressive-local")).toBe(
      "progressive-local-play-blocked"
    );
    expect(pipelineGetSlidingWindowPlayBlockedReason("lossless-local")).toBe(
      "lossless-local-play-blocked"
    );
    expect(
      pipelineShouldPrepareProgressiveRuntimeForSource({
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(true);
    expect(
      pipelineShouldStartListenerProgressivePlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: null
      })
    ).toBe(true);
    expect(
      pipelineShouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner: true,
        activePlaybackSource: "lossless-local",
        playbackStatus: "buffering",
        engineType: "pcm",
        startupReady: false,
        hasFullLocalTrack: false,
        progressiveFallbackReason: null
      })
    ).toBe(true);
    expect(
      pipelineShouldStartPcmSlidingWindowAudioElement({
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        localReady: true,
        audioPaused: true,
        lastAttemptAtMs: 1000,
        nowMs: 2100,
        retryIntervalMs: 1000
      })
    ).toBe(true);
    expect(
      pipelineShouldUsePcmEngineForFullLocal({
        activePlaybackSource: "full-local",
        forceSourceOwnerLocalPlayback: false,
        sourceOwnerHasLocalTrack: false,
        hasFullLocalTrack: false,
        progressiveEngineType: "pcm"
      })
    ).toBe(true);
  });

  it("hosts full-local warmup policy in the pure pipeline module", () => {
    expect(
      pipelineShouldWarmFullLocalWithSharedAudioElement({
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "none",
        canUseFullLocalForPlaybackSession: true,
        isCurrentSourceOwner: false
      })
    ).toBe(true);
    expect(
      pipelineHasSufficientBackingForFullLocalWarmup({
        progressiveEngineType: "none",
        aheadBufferedMs: 0,
        requiredAheadMs: 3000
      })
    ).toBe(true);
    expect(
      pipelineShouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup({
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "none",
        canUseFullLocalForPlaybackSession: true,
        fullLocalBlockedReason: null,
        localTakeoverAllowed: true,
        aheadBufferedMs: 5000,
        comfortBufferMs: 1000,
        warmupReadyAt: 1000,
        now: 1800,
        switchDelayMs: 500
      })
    ).toBe(true);
  });

  it("keeps playback position and availability keys stable across cloned snapshots", () => {
    const playback = {
      status: "playing" as const,
      currentTrackId: "track-1",
      currentQueueItemId: "queue-1",
      sourceSessionId: "session-1",
      sourcePeerId: "peer-1",
      sourceTrackId: "track-1",
      positionMs: 12_000,
      startedAt: "2026-07-05T09:00:00.000Z",
      queueVersion: 3,
      playbackRevision: 5,
      mediaEpoch: 7
    };

    expect(buildPlaybackPositionKey({ ...playback })).toBe(buildPlaybackPositionKey(playback));
    expect(buildAvailableChunksKey([0, 1, 2, 3])).toBe(buildAvailableChunksKey([0, 1, 2, 3]));
  });

  it("keeps warmup timer keys stable when only snapshot object references change", () => {
    const track = {
      id: "track-1",
      title: "Warmup",
      artist: null,
      durationMs: 180_000,
      mimeType: "audio/flac",
      codec: "flac",
      fileHash: "hash-1",
      sizeBytes: 1024
    };
    const sameTrackFromNextSnapshot = {
      ...track
    };

    const firstTrackKey = buildCurrentTrackFormatKey(track);
    const nextTrackKey = buildCurrentTrackFormatKey(sameTrackFromNextSnapshot);

    expect(nextTrackKey).toBe(firstTrackKey);
    expect(
      buildProgressiveWarmupTimerKey({
        playbackCurrentTrackId: "track-1",
        playbackStatus: "playing",
        playbackMediaEpoch: 7,
        currentTrackFormatKey: firstTrackKey,
        progressiveManifestKey: "manifest:track-1:hash-1",
        activePlaybackSource: "progressive-local",
        canUseFullLocalForPlaybackSession: false,
        progressiveEngineType: "pcm",
        progressiveStartupReady: true,
        startupBufferMs: 60,
        progressiveLocalBlockedReason: null,
        isCurrentSourceOwner: false,
        playbackRecoveryStage: "steady",
        progressiveFallbackReason: null,
        stalledEventsLast30s: 0,
        waitingEventsLast30s: 0
      })
    ).toBe(
      buildProgressiveWarmupTimerKey({
        playbackCurrentTrackId: "track-1",
        playbackStatus: "playing",
        playbackMediaEpoch: 7,
        currentTrackFormatKey: nextTrackKey,
        progressiveManifestKey: "manifest:track-1:hash-1",
        activePlaybackSource: "progressive-local",
        canUseFullLocalForPlaybackSession: false,
        progressiveEngineType: "pcm",
        progressiveStartupReady: true,
        startupBufferMs: 60,
        progressiveLocalBlockedReason: null,
        isCurrentSourceOwner: false,
        playbackRecoveryStage: "steady",
        progressiveFallbackReason: null,
        stalledEventsLast30s: 0,
        waitingEventsLast30s: 0
      })
    );
  });
});

describe("use-progressive-runtime policy helpers", () => {
  it("uses a non-zero audible fallback when the local audio element was left at volume zero", () => {
    expect(getAudibleElementVolume(0)).toBe(0.72);
    expect(getAudibleElementVolume(Number.NaN)).toBe(0.72);
    expect(getAudibleElementVolume(0.35)).toBe(0.35);
    expect(getAudibleElementVolume(2)).toBe(1);
  });

  it("treats the local element as the only audible media element in the current playback model", () => {
    expect(
      resolveMediaElementPlaybackRole({
        target: "local",
        activePlaybackSource: "progressive-local",
        shadowWarmupActive: true
      })
    ).toBe("audible-local");
    expect(
      resolveMediaElementPlaybackRole({
        target: "remote",
        activePlaybackSource: "full-local",
        shadowWarmupActive: false
      })
    ).toBe("inactive");
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

  it("does not prefer immediate full-local recovery when locked, missing cache, or already steady", () => {
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
        recoveryPhase: "bootstrapping-data",
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

  it("prefers local takeover only for explicit local fallback reasons", () => {
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: "buffer-underrun" })).toBe(true);
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: "stalled" })).toBe(true);
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: "seek-outside-buffer" })).toBe(true);
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: null })).toBe(false);
  });

  it("reports startup, degraded, audible fallback, and steady recovery stages", () => {
    expect(
      resolvePlaybackRecoveryStage({
        activePlaybackSource: "progressive-local",
        playbackStatus: "paused",
        startupGatePending: false,
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0,
        shadowWarmupActive: false,
        audibleLocalFallbackActive: false
      })
    ).toBe("startup-buffering");
    expect(
      resolvePlaybackRecoveryStage({
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        startupGatePending: false,
        waitingEventsLast30s: 1,
        stalledEventsLast30s: 0,
        shadowWarmupActive: false,
        audibleLocalFallbackActive: false
      })
    ).toBe("degraded");
    expect(
      resolvePlaybackRecoveryStage({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        startupGatePending: false,
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0,
        shadowWarmupActive: false,
        audibleLocalFallbackActive: true
      })
    ).toBe("audible-local-fallback");
    expect(
      resolvePlaybackRecoveryStage({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        startupGatePending: false,
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0,
        shadowWarmupActive: false,
        audibleLocalFallbackActive: false
      })
    ).toBe("steady");
  });

  it("maps degraded playback to a protected scheduler budget", () => {
    expect(
      resolveSchedulerBudgetTier({
        bufferHealth: "low",
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "degraded"
      })
    ).toBe("protected");
  });

  it("allows full-local handoff from progressive-local after readiness and drift checks pass", () => {
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(true);
  });

  it("does not warm full-local on the shared audio element while sliding-window playback owns it", () => {
    expect(
      shouldWarmFullLocalWithSharedAudioElement({
        activePlaybackSource: "lossless-local",
        progressiveEngineType: "pcm",
        canUseFullLocalForPlaybackSession: true,
        isCurrentSourceOwner: false
      })
    ).toBe(false);
    expect(
      shouldWarmFullLocalWithSharedAudioElement({
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "mse",
        canUseFullLocalForPlaybackSession: true,
        isCurrentSourceOwner: false
      })
    ).toBe(false);
    expect(
      shouldWarmFullLocalWithSharedAudioElement({
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "none",
        canUseFullLocalForPlaybackSession: true,
        isCurrentSourceOwner: false
      })
    ).toBe(true);
  });

  it("does not directly upgrade sliding-window playback to full-local while an engine owns the shared audio element", () => {
    const readyInput = {
      activePlaybackSource: "lossless-local" as const,
      canUseFullLocalForPlaybackSession: true,
      fullLocalBlockedReason: null,
      localTakeoverAllowed: true,
      aheadBufferedMs: 5000,
      comfortBufferMs: 1000,
      warmupReadyAt: 1000,
      now: 2000,
      switchDelayMs: 500
    };

    expect(
      shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup({
        ...readyInput,
        progressiveEngineType: "pcm"
      })
    ).toBe(false);
    expect(
      shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup({
        ...readyInput,
        progressiveEngineType: "mse"
      })
    ).toBe(false);
  });

  it("does not require progressive ahead buffer when native full-local is the only playback path", () => {
    expect(
      hasSufficientBackingForFullLocalWarmup({
        progressiveEngineType: "none",
        aheadBufferedMs: 0,
        requiredAheadMs: 1000
      })
    ).toBe(true);
    expect(
      hasSufficientBackingForFullLocalWarmup({
        progressiveEngineType: "mse",
        aheadBufferedMs: 0,
        requiredAheadMs: 1000
      })
    ).toBe(false);
    expect(
      hasSufficientBackingForFullLocalWarmup({
        progressiveEngineType: "pcm",
        aheadBufferedMs: 1200,
        requiredAheadMs: 1000
      })
    ).toBe(true);
  });

  it("recovers silent sliding-window playback with ready full-local cache", () => {
    const readyInput = {
      activePlaybackSource: "progressive-local" as const,
      playbackStatus: "playing" as const,
      canUseFullLocalForPlaybackSession: true,
      fullLocalBlockedReason: null,
      slidingWindowStartupReady: true,
      localAudioPaused: true,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 0,
      localAudioHasSrc: false,
      localAudioHasSrcObject: false,
      pcmAudioContextState: null,
      pcmDirectOutputConnected: null,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null
    };

    expect(shouldRecoverSilentSlidingWindowWithFullLocal(readyInput)).toBe(true);
    expect(pipelineShouldRecoverSilentSlidingWindowWithFullLocal(readyInput)).toBe(true);
    expect(
      shouldRecoverSilentSlidingWindowWithFullLocal({
        ...readyInput,
        slidingWindowStartupReady: false,
        localAudioPaused: true
      })
    ).toBe(false);
    expect(
      shouldRecoverSilentSlidingWindowWithFullLocal({
        ...readyInput,
        localAudioPaused: false,
        localAudioReadyState: 4,
        localAudioHasSrc: true
      })
    ).toBe(false);
    expect(
      shouldRecoverSilentSlidingWindowWithFullLocal({
        ...readyInput,
        activePlaybackSource: "lossless-local",
        localAudioPaused: true,
        pcmAudioContextState: "running",
        pcmDirectOutputConnected: true,
        pcmDecodedSegmentCount: 2,
        pcmScheduledSegmentCount: 1
      })
    ).toBe(false);
    expect(
      shouldRecoverSilentSlidingWindowWithFullLocal({
        ...readyInput,
        activePlaybackSource: "lossless-local",
        localAudioPaused: false,
        localAudioHasSrcObject: true,
        localAudioReadyState: 0,
        pcmAudioContextState: "running",
        pcmDirectOutputConnected: false,
        pcmDecodedSegmentCount: 2,
        pcmScheduledSegmentCount: 1
      })
    ).toBe(false);
  });

  it("publishes progressive diagnostics only when the stable signature changes", () => {
    expect(
      shouldPublishProgressiveDiagnostic({
        previousSignature: "source=progressive-local|state=live",
        nextSignature: "source=progressive-local|state=live"
      })
    ).toBe(false);
    expect(
      shouldPublishProgressiveDiagnostic({
        previousSignature: "source=progressive-local|state=buffering",
        nextSignature: "source=full-local|state=live"
      })
    ).toBe(true);
  });

  it("skips the secondary idle sync after a PCM warmup miss", () => {
    expect(
      shouldSkipSecondaryPcmWarmupSync({
        engineType: "pcm",
        engineReady: true,
        localReady: false
      })
    ).toBe(true);
    expect(
      shouldSkipSecondaryPcmWarmupSync({
        engineType: "mse",
        engineReady: true,
        localReady: false
      })
    ).toBe(false);
  });

  it("keeps the PCM diagnostics dependency stable when playback health is unchanged", () => {
    const snapshot = {
      status: "ready" as const,
      audioContextState: "running" as const,
      hasOutputStream: true,
      directOutputConnected: true,
      contiguousChunkCount: 4,
      contiguousByteLength: 1024,
      decodedSegmentCount: 2,
      scheduledSegmentCount: 1,
      decodedPacketCount: 3,
      decoderFlushAttemptCount: 1,
      decoderFlushCount: 1,
      lastDecodedAtMs: 100,
      lastDecodeError: null,
      decodedPeak: 0.5,
      decodedRms: 0.25,
      decodedNonZeroSampleCount: 4096,
      bufferedAheadMs: 8000,
      playoutState: "playing" as const
    };

    expect(getPcmEngineDiagnosticsKey(null)).toBe("none");
    expect(getPcmEngineDiagnosticsKey(snapshot)).toBe(
      getPcmEngineDiagnosticsKey({ ...snapshot })
    );
    expect(getPcmEngineDiagnosticsKey(snapshot)).toBe(
      getPcmEngineDiagnosticsKey({
        ...snapshot,
        scheduledSegmentCount: 2,
        decodedPacketCount: 99,
        decoderFlushAttemptCount: 10,
        decoderFlushCount: 10,
        lastDecodedAtMs: 200,
        decodedPeak: 0.75,
        decodedRms: 0.33,
        decodedNonZeroSampleCount: 8192,
        bufferedAheadMs: 8500
      })
    );
    expect(getPcmEngineDiagnosticsKey(snapshot)).not.toBe(
      getPcmEngineDiagnosticsKey({
        ...snapshot,
        audioContextState: "suspended"
      })
    );
  });

  it("allows full-local playback once the complete cache appears during the same playback session", () => {
    const initialSession = resolveFullLocalPlaybackSessionState({
      currentSession: {
        key: null,
        availableInSession: false
      },
      playbackSurfaceKey: "track_1:epoch_1",
      hasBufferedFullLocalTrack: false
    });

    expect(initialSession).toEqual({
      key: "track_1:epoch_1",
      availableInSession: false
    });

    expect(
      resolveFullLocalPlaybackSessionState({
        currentSession: initialSession,
        playbackSurfaceKey: "track_1:epoch_1",
        hasBufferedFullLocalTrack: true
      })
    ).toEqual({
      key: "track_1:epoch_1",
      availableInSession: true
    });
  });

  it("blocks full-local handoff while startup gate, cooldown, drift, or local readiness is bad", () => {
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "startup-buffering",
        startupGatePending: true,
        localReady: true,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(false);
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: false,
        driftMs: 80,
        cooldownMs: 0
      })
    ).toBe(false);
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: true,
        driftMs: 400,
        cooldownMs: 0
      })
    ).toBe(false);
    expect(
      shouldEnableFullLocalHandoff({
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "steady",
        startupGatePending: false,
        localReady: true,
        driftMs: 80,
        cooldownMs: 1
      })
    ).toBe(false);
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

  it("recovers paused full-local playback from an already ready media element even if unlock state is stale", () => {
    expect(
      shouldRecoverPausedFullLocalPlayback({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        currentTrackId: "track_1",
        audioUnlocked: false,
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
    expect(
      shouldPrepareProgressiveRuntimeForSource({
        activePlaybackSource: "lossless-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(true);
  });

  it("holds sliding-window playback when no local engine is attached", () => {
    expect(
      shouldHoldSlidingWindowPlaybackForEngine({
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        hasPcmEngine: false,
        hasMseEngine: false
      })
    ).toBe(true);
    expect(
      shouldHoldSlidingWindowPlaybackForEngine({
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        hasPcmEngine: true,
        hasMseEngine: false
      })
    ).toBe(false);
    expect(
      shouldHoldSlidingWindowPlaybackForEngine({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        hasPcmEngine: false,
        hasMseEngine: false
      })
    ).toBe(false);
  });

  it("clears the previous audio source only after the playback surface changes", () => {
    expect(
      shouldResetAudioForPlaybackSurfaceChange({
        previousPlaybackSurfaceKey: null,
        nextPlaybackSurfaceKey: "track_1:epoch_1"
      })
    ).toBe(false);
    expect(
      shouldResetAudioForPlaybackSurfaceChange({
        previousPlaybackSurfaceKey: "track_1:epoch_1",
        nextPlaybackSurfaceKey: "track_1:epoch_1"
      })
    ).toBe(false);
    expect(
      shouldResetAudioForPlaybackSurfaceChange({
        previousPlaybackSurfaceKey: "track_1:epoch_1",
        nextPlaybackSurfaceKey: "track_2:epoch_2"
      })
    ).toBe(true);
  });

  it("latches fatal PCM runtime failures while keeping cache misses recoverable", () => {
    expect(shouldLatchPcmRuntimeFailure("engine-failed")).toBe(true);
    expect(shouldLatchPcmRuntimeFailure("decoder-unavailable")).toBe(true);
    expect(shouldLatchPcmRuntimeFailure("decoder-config-failed")).toBe(true);
    expect(shouldLatchPcmRuntimeFailure("encoded-audio-chunk-unavailable")).toBe(true);
    expect(shouldLatchPcmRuntimeFailure("cache-read-failed")).toBe(true);
    expect(shouldLatchPcmRuntimeFailure("engine-opening")).toBe(false);
    expect(shouldLatchPcmRuntimeFailure("pcm-buffer-missing")).toBe(false);
    expect(shouldLatchPcmRuntimeFailure("audio-context-suspended")).toBe(false);
    expect(shouldLatchPcmRuntimeFailure("decoder-flush-failed")).toBe(true);
  });

  it("does not recreate PCM for the same failed track until playback moves to another track", () => {
    expect(
      shouldRetryPcmRuntimeAfterFailure({
        currentTrackId: "track_1",
        failureTrackId: "track_1",
        failureReason: "decoder-unavailable"
      })
    ).toBe(false);
    expect(
      shouldRetryPcmRuntimeAfterFailure({
        currentTrackId: "track_2",
        failureTrackId: "track_1",
        failureReason: "decoder-unavailable"
      })
    ).toBe(true);
    expect(
      shouldRetryPcmRuntimeAfterFailure({
        currentTrackId: "track_1",
        failureTrackId: "track_1",
        failureReason: "pcm-buffer-missing"
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
        activePlaybackSource: "progressive-local",
        forceSourceOwnerLocalPlayback: true,
        sourceOwnerHasLocalTrack: false,
        hasFullLocalTrack: false,
        progressiveEngineType: "pcm"
      })
    ).toBe(true);
  });

  it("allows a listener to use progressive-local once startup buffering is ready", () => {
    expect(
      shouldStartListenerProgressivePlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: null
      })
    ).toBe(true);
  });

  it("keeps listener sliding-window playback available after the full cache appears", () => {
    expect(
      shouldStartListenerProgressivePlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: true,
        progressiveFallbackReason: null
      })
    ).toBe(true);
  });

  it("allows a listener to use lossless-local once startup buffering is ready", () => {
    expect(
      shouldStartListenerProgressivePlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: null
      })
    ).toBe(true);
  });

  it("keeps a listener buffering while progressive startup data is not ready", () => {
    expect(
      shouldStartListenerProgressivePlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: false,
        hasFullLocalTrack: false,
        progressiveFallbackReason: null
      })
    ).toBe(false);
  });

  it("allows a listener to attempt progressive playback after the startup window is ready", () => {
    expect(
      shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: "buffer-underrun"
      })
    ).toBe(true);
  });

  it("allows a listener to attempt lossless local playback after the startup window is ready", () => {
    expect(
      shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: "buffer-underrun"
      })
    ).toBe(true);
  });

  it("keeps listener progressive playback blocked for unrecoverable init failure", () => {
    expect(
      shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: "progressive-init-failed"
      })
    ).toBe(false);
  });

  it("downgrades lossless local playback after the PCM runtime fails", () => {
    expect(
      resolvePlaybackSourceAfterProgressiveRuntimeFailure({
        activePlaybackSource: "lossless-local",
        hasProgressiveRuntimeFailure: true
      })
    ).toBe("progressive-local");
    expect(
      resolvePlaybackSourceAfterProgressiveRuntimeFailure({
        activePlaybackSource: "full-local",
        hasProgressiveRuntimeFailure: true
      })
    ).toBe("full-local");
  });

  it("starts the PCM sliding-window media element once warmup has local audio", () => {
    expect(
      shouldStartPcmSlidingWindowAudioElement({
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        localReady: true,
        audioPaused: true,
        lastAttemptAtMs: null,
        nowMs: 10_000,
        retryIntervalMs: 1_000
      })
    ).toBe(true);
    expect(
      shouldStartPcmSlidingWindowAudioElement({
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        localReady: true,
        audioPaused: false,
        lastAttemptAtMs: null,
        nowMs: 10_000,
        retryIntervalMs: 1_000
      })
    ).toBe(false);
    expect(
      shouldStartPcmSlidingWindowAudioElement({
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        localReady: true,
        audioPaused: true,
        lastAttemptAtMs: null,
        nowMs: 10_000,
        retryIntervalMs: 1_000
      })
    ).toBe(false);
    expect(
      shouldStartPcmSlidingWindowAudioElement({
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        localReady: true,
        audioPaused: true,
        lastAttemptAtMs: 9_500,
        nowMs: 10_000,
        retryIntervalMs: 1_000
      })
    ).toBe(false);
  });
});
