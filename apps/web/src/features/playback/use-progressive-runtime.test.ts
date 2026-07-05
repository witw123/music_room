import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAvailableChunksKey,
  buildCurrentTrackFormatKey,
  buildPlaybackPositionKey,
  buildProgressiveWarmupTimerKey,
  appendPlaybackDriftSample as pipelineAppendPlaybackDriftSample,
  resolveActiveMemberPeerIds as pipelineResolveActiveMemberPeerIds,
  resolveAggregatePieceDownloadRateKbps as pipelineResolveAggregatePieceDownloadRateKbps,
  resolveCurrentBufferedFullLocalTrack as pipelineResolveCurrentBufferedFullLocalTrack,
  pruneContinuousPlaybackSegments as pipelinePruneContinuousPlaybackSegments,
  prunePlaybackQualityTimestamps as pipelinePrunePlaybackQualityTimestamps,
  resolveTrackAvailabilityAnnouncement as pipelineResolveTrackAvailabilityAnnouncement,
  resolveNextQueueTrackPrefetch as pipelineResolveNextQueueTrackPrefetch,
  bucketDiagnosticDurationMs as pipelineBucketDiagnosticDurationMs,
  getAudibleElementVolume as pipelineGetAudibleElementVolume,
  getPcmEngineDiagnosticsKey as pipelineGetPcmEngineDiagnosticsKey,
  resolveLocalAudioDiagnostics as pipelineResolveLocalAudioDiagnostics,
  getSlidingWindowPlayBlockedReason as pipelineGetSlidingWindowPlayBlockedReason,
  hasSufficientBackingForFullLocalWarmup as pipelineHasSufficientBackingForFullLocalWarmup,
  isSlidingWindowPlaybackSource as pipelineIsSlidingWindowPlaybackSource,
  resolveSourceOwnerIdentity as pipelineResolveSourceOwnerIdentity,
  resolvePlaybackRecoveryStage as pipelineResolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive as pipelineResolveAudibleLocalFallbackActive,
  resolveFullLocalBlockedReason as pipelineResolveFullLocalBlockedReason,
  shouldAllowLocalTakeover as pipelineShouldAllowLocalTakeover,
  resolveFullLocalPlaybackSessionState as pipelineResolveFullLocalPlaybackSessionState,
  resolveMediaElementPlaybackRole as pipelineResolveMediaElementPlaybackRole,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure as pipelineResolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveBufferSafetyMarginMs as pipelineResolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs as pipelineResolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics as pipelineResolvePlaybackQualityMetrics,
  resolveProgressiveDiagnosticSignature as pipelineResolveProgressiveDiagnosticSignature,
  resolveProgressiveLocalBlockedReason as pipelineResolveProgressiveLocalBlockedReason,
  resolveMaxContinuousPlaybackMs as pipelineResolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier as pipelineResolveSchedulerBudgetTier,
  resolveTransportGovernorMode as pipelineResolveTransportGovernorMode,
  shouldAttemptProgressiveLocalPlayback as pipelineShouldAttemptProgressiveLocalPlayback,
  shouldEnableFullLocalHandoff as pipelineShouldEnableFullLocalHandoff,
  shouldHoldSlidingWindowPlaybackForEngine as pipelineShouldHoldSlidingWindowPlaybackForEngine,
  isRecoverableProgressiveFallbackReason as pipelineIsRecoverableProgressiveFallbackReason,
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
  appendPlaybackDriftSample,
  isSlidingWindowPlaybackSource,
  resolveActiveMemberPeerIds,
  resolveAggregatePieceDownloadRateKbps,
  resolveCurrentBufferedFullLocalTrack,
  pruneContinuousPlaybackSegments,
  prunePlaybackQualityTimestamps,
  resolveTrackAvailabilityAnnouncement,
  resolveNextQueueTrackPrefetch,
  resolveLocalAudioDiagnostics,
  resolveMediaElementPlaybackRole,
  resolveSourceOwnerIdentity,
  resolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive,
  shouldAllowLocalTakeover,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics,
  resolveProgressiveDiagnosticSignature,
  resolveProgressiveLocalBlockedReason,
  resolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier,
  resolveTransportGovernorMode,
  shouldEnableFullLocalHandoff,
  resolveFullLocalBlockedReason,
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

  it("drives the drift sampling interval from stable scalar dependencies", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const intervalNeedle =
      "const timerId = window.setInterval(sampleDrift, playbackDriftSampleIntervalMs);";
    const intervalIndex = runtimeSource.indexOf(intervalNeedle);
    expect(intervalIndex).toBeGreaterThan(-1);

    const dependencyStart = runtimeSource.indexOf("  }, [", intervalIndex);
    const dependencyEnd = runtimeSource.indexOf("]);", dependencyStart);
    const dependencies = runtimeSource.slice(dependencyStart, dependencyEnd);

    expect(dependencies).toContain("playbackCurrentTrackId");
    expect(dependencies).toContain("playbackMediaEpoch");
    expect(dependencies).toContain("playbackStatus");
    expect(dependencies).not.toContain("playback,");
    expect(dependencies).not.toContain("currentTrack");
  });

  it("keeps hook dependency arrays free of snapshot object identities", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    const dependencySource = [...runtimeSource.matchAll(/\n\s*\}, \[\n(?<deps>[\s\S]*?)\n\s*\]\);/g)]
      .map((match) => match.groups?.deps ?? "")
      .join("\n");

    expect(dependencySource).not.toMatch(/^\s+playback,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+currentTrack,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+currentBufferedFullLocalTrack,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+roomSnapshot\?\.room\.playback,\s*$/m);
  });

  it("hosts diagnostic and media element helpers in the pure pipeline module", () => {
    expect(
      Array.from(
        pipelineResolveActiveMemberPeerIds([
          { peerId: "peer-a" },
          { peerId: null },
          { peerId: "" },
          { peerId: "peer-b" }
        ])
      )
    ).toEqual(["peer-a", "peer-b"]);
    expect(
      pipelineResolveAggregatePieceDownloadRateKbps({
        activeMemberPeerIds: new Set(["peer-a", "peer-c"]),
        peerDiagnostics: [
          { peerId: "peer-a", pieceDownloadRateKbps: 10.4 },
          { peerId: "peer-b", pieceDownloadRateKbps: 100 },
          { peerId: "peer-c", pieceDownloadRateKbps: 20.2 },
          { peerId: "peer-c", pieceDownloadRateKbps: Number.NaN }
        ]
      })
    ).toBe(31);
    expect(
      pipelineResolveAggregatePieceDownloadRateKbps({
        activeMemberPeerIds: new Set(["peer-a"]),
        peerDiagnostics: [{ peerId: "peer-b", pieceDownloadRateKbps: 100 }]
      })
    ).toBe(null);
    expect(
      pipelineResolveCurrentBufferedFullLocalTrack({
        currentTrackId: "track-1",
        fullLocalPlaybackTracks: { "track-1": { objectUrl: "full" } },
        uploadedTracks: { "track-1": { objectUrl: "uploaded" } }
      })
    ).toEqual({ objectUrl: "full" });
    expect(
      pipelineResolveCurrentBufferedFullLocalTrack({
        currentTrackId: "track-2",
        fullLocalPlaybackTracks: {},
        uploadedTracks: { "track-2": { objectUrl: "uploaded" } }
      })
    ).toEqual({ objectUrl: "uploaded" });
    expect(
      pipelineResolveCurrentBufferedFullLocalTrack({
        currentTrackId: null,
        fullLocalPlaybackTracks: { "track-1": { objectUrl: "full" } },
        uploadedTracks: { "track-1": { objectUrl: "uploaded" } }
      })
    ).toBe(null);
    expect(
      pipelineResolveTrackAvailabilityAnnouncement({
        currentTrackId: "track-1",
        availabilityByTrack: {
          "track-1": {
            "peer-a": { ownerPeerId: "peer-a" }
          }
        },
        peerId: "peer-a"
      })
    ).toEqual({ ownerPeerId: "peer-a" });
    expect(pipelinePrunePlaybackQualityTimestamps([60, 70, 90, 100], 100, 30)).toEqual([
      70,
      90,
      100
    ]);
    expect(prunePlaybackQualityTimestamps([60, 69, 70, 101], 100, 30)).toEqual([
      70,
      101
    ]);
    expect(
      pipelinePruneContinuousPlaybackSegments(
        [
          { startedAtMs: 10, endedAtMs: 60 },
          { startedAtMs: 40, endedAtMs: 69 },
          { startedAtMs: 50, endedAtMs: 70 },
          { startedAtMs: 90, endedAtMs: 110 }
        ],
        100,
        30
      )
    ).toEqual([
      { startedAtMs: 50, endedAtMs: 70 },
      { startedAtMs: 90, endedAtMs: 110 }
    ]);
    expect(
      pruneContinuousPlaybackSegments(
        [
          { startedAtMs: 10, endedAtMs: 60 },
          { startedAtMs: 50, endedAtMs: 70 }
        ],
        100,
        30
      )
    ).toEqual([{ startedAtMs: 50, endedAtMs: 70 }]);
    expect(
      pipelineResolveMaxContinuousPlaybackMs({
        segments: [
          { startedAtMs: 20, endedAtMs: 80 },
          { startedAtMs: 90, endedAtMs: 120 }
        ],
        activeStartedAtMs: 50,
        nowMs: 100,
        windowMs: 30
      })
    ).toBe(30);
    expect(
      resolveMaxContinuousPlaybackMs({
        segments: [{ startedAtMs: 90, endedAtMs: 95 }],
        activeStartedAtMs: 60,
        nowMs: 100,
        windowMs: 30
      })
    ).toBe(30);
    expect(
      pipelineAppendPlaybackDriftSample({
        samples: [
          { timestampMs: 10, driftMs: 3 },
          { timestampMs: 80, driftMs: 5 }
        ],
        driftMs: -12.4,
        timestampMs: 100,
        windowMs: 30
      })
    ).toEqual([
      { timestampMs: 80, driftMs: 5 },
      { timestampMs: 100, driftMs: 12.4 }
    ]);
    const existingDriftSamples = [{ timestampMs: 80, driftMs: 5 }];
    expect(
      appendPlaybackDriftSample({
        samples: existingDriftSamples,
        driftMs: Number.NaN,
        timestampMs: 100,
        windowMs: 30
      })
    ).toBe(existingDriftSamples);
    expect(
      pipelineResolveTrackAvailabilityAnnouncement({
        currentTrackId: "track-1",
        availabilityByTrack: {},
        peerId: "peer-a"
      })
    ).toBe(null);
    expect(
      pipelineResolveNextQueueTrackPrefetch({
        queue: [
          { id: "queue-1", trackId: "track-1" },
          { id: "queue-2", trackId: "track-2" }
        ],
        currentQueueItemId: "queue-1",
        currentTrackId: null,
        tracks: [
          { id: "track-1", title: "Current" },
          { id: "track-2", title: "Next" }
        ],
        availabilityByTrack: {
          "track-2": {
            "peer-a": { availableChunks: [0, 1, 2], totalChunks: 8 }
          }
        },
        peerId: "peer-a"
      })
    ).toBe("Next 3/8");
    expect(
      pipelineResolveNextQueueTrackPrefetch({
        queue: [
          { id: "queue-1", trackId: "track-1" },
          { id: "queue-2", trackId: "track-2" }
        ],
        currentQueueItemId: null,
        currentTrackId: "track-1",
        tracks: [{ id: "track-2", title: "Next" }],
        availabilityByTrack: {},
        peerId: "peer-a"
      })
    ).toBe("Next 0/0");
    expect(
      pipelineResolveNextQueueTrackPrefetch({
        queue: [{ id: "queue-1", trackId: "track-1" }],
        currentQueueItemId: "queue-1",
        currentTrackId: null,
        tracks: [{ id: "track-1", title: "Current" }],
        availabilityByTrack: {},
        peerId: "peer-a"
      })
    ).toBe(null);
    expect(pipelineBucketDiagnosticDurationMs(null, 1000)).toBe("");
    expect(pipelineBucketDiagnosticDurationMs(Number.NaN, 1000)).toBe("");
    expect(pipelineBucketDiagnosticDurationMs(1499, 1000)).toBe(1000);
    expect(pipelineBucketDiagnosticDurationMs(1500, 1000)).toBe(2000);
    expect(pipelineGetAudibleElementVolume(0)).toBe(0.72);
    expect(pipelineResolveLocalAudioDiagnostics(null)).toEqual({
      localAudioPaused: null,
      localAudioMuted: null,
      localAudioVolume: null,
      localAudioReadyState: null,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: null
    });
    expect(
      pipelineResolveLocalAudioDiagnostics({
        paused: false,
        muted: true,
        volume: 0.4,
        readyState: 3,
        currentSrc: "",
        srcObject: {} as MediaStream
      })
    ).toEqual({
      localAudioPaused: false,
      localAudioMuted: true,
      localAudioVolume: 0.4,
      localAudioReadyState: 3,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: true
    });
    const diagnosticSignatureInput = {
      activeSource: "progressive-local" as const,
      playbackSurfaceKey: "surface",
      playbackTimelineKey: "timeline",
      recoveryPhase: "steady",
      recoveryMode: "rejoin",
      recoveryGeneration: 3,
      fullLocalRecoveryActive: true,
      transportGovernorMode: "local-primary" as const,
      engineType: "pcm" as const,
      contiguousBufferedMs: 2000,
      aheadBufferedMs: 3000,
      schedulerPolicy: "steady",
      startupReady: true,
      fallbackReason: null,
      estimatedFillTimeMs: "",
      remainingPlaybackMs: 120000,
      bufferSafetyMarginMs: -1000,
      playbackStartIntentLabel: "恢复播放",
      intentMatchedSource: "full-local" as const,
      lastPlayStartFailure: "blocked",
      nextQueueTrackPrefetch: "Next 1/8",
      localTakeoverCooldownActive: true,
      progressiveLocalEligible: false,
      progressiveLocalBlockedReason: "piece-download-not-ready",
      fullLocalReady: true,
      fullLocalEligible: false,
      fullLocalBlockedReason: "cache-recovery-window",
      currentSessionUserId: "user",
      playbackSourceSessionId: null,
      currentPeerId: "peer",
      playbackSourcePeerId: "source-peer",
      isSourceOwner: false,
      localAudioPaused: false,
      localAudioMuted: true,
      localAudioVolume: 0.4,
      localAudioReadyState: 4,
      localAudioCurrentSrc: "blob:local",
      localAudioHasSrcObject: false,
      pcmEngineStatus: "ready",
      pcmAudioContextState: "running",
      pcmDirectOutputConnected: true,
      pcmLastDecodeError: null,
      pcmDecodedSegmentCount: 0,
      pcmScheduledSegmentCount: 2,
      pcmLastBlockedReason: null,
      startupBufferMs: 60,
      comfortBufferedMs: 5000,
      waitingEventsLast30s: 1,
      stalledEventsLast30s: 0,
      shadowWarmupActive: true,
      playbackRecoveryStage: "steady" as const,
      audibleLocalFallbackActive: false,
      schedulerBudgetTier: "comfort" as const,
      lastStablePlaybackAt: "2026-07-05T00:00:00.000Z"
    };
    const expectedDiagnosticSignature = [
      "progressive-local",
      "surface",
      "timeline",
      "steady",
      "rejoin",
      3,
      true,
      "local-primary",
      "pcm",
      2000,
      3000,
      "steady",
      true,
      "",
      "",
      120000,
      -1000,
      "恢复播放",
      "full-local",
      "blocked",
      "Next 1/8",
      "cooldown",
      false,
      "piece-download-not-ready",
      true,
      false,
      "cache-recovery-window",
      "user",
      "",
      "peer",
      "source-peer",
      false,
      false,
      true,
      0.4,
      4,
      "src",
      false,
      "ready",
      "running",
      true,
      "",
      "no-decoded",
      "scheduled",
      "",
      60,
      5000,
      1,
      0,
      true,
      "steady",
      false,
      "comfort",
      "2026-07-05T00:00:00.000Z"
    ].join("|");
    expect(pipelineResolveProgressiveDiagnosticSignature(diagnosticSignatureInput)).toBe(
      expectedDiagnosticSignature
    );
    expect(resolveProgressiveDiagnosticSignature(diagnosticSignatureInput)).toBe(
      expectedDiagnosticSignature
    );
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
      pipelineResolveAudibleLocalFallbackActive({
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        progressiveFallbackReason: "buffer-underrun"
      })
    ).toBe(true);
    expect(
      resolveAudibleLocalFallbackActive({
        isCurrentSourceOwner: false,
        activePlaybackSource: "full-local",
        progressiveFallbackReason: "stalled"
      })
    ).toBe(true);
    expect(
      pipelineResolveAudibleLocalFallbackActive({
        isCurrentSourceOwner: false,
        activePlaybackSource: "lossless-local",
        progressiveFallbackReason: "seek-outside-buffer"
      })
    ).toBe(true);
    expect(
      pipelineResolveAudibleLocalFallbackActive({
        isCurrentSourceOwner: true,
        activePlaybackSource: "progressive-local",
        progressiveFallbackReason: "buffer-underrun"
      })
    ).toBe(false);
    expect(
      pipelineResolveAudibleLocalFallbackActive({
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote",
        progressiveFallbackReason: "buffer-underrun"
      })
    ).toBe(false);
    expect(
      pipelineResolveAudibleLocalFallbackActive({
        isCurrentSourceOwner: false,
        activePlaybackSource: "full-local",
        progressiveFallbackReason: "progressive-init-failed"
      })
    ).toBe(false);
    expect(
      pipelineShouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: false,
        nowMs: 1000,
        cooldownUntilMs: 0,
        immediateFullLocalRecoveryEligible: true,
        canUseFullLocalForPlaybackSession: false,
        connectedPeersCount: 0
      })
    ).toBe(false);
    expect(
      pipelineShouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: true,
        nowMs: 1000,
        cooldownUntilMs: 1001,
        immediateFullLocalRecoveryEligible: true,
        canUseFullLocalForPlaybackSession: true,
        connectedPeersCount: 1
      })
    ).toBe(false);
    expect(
      pipelineShouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: true,
        nowMs: 1000,
        cooldownUntilMs: 1000,
        immediateFullLocalRecoveryEligible: true,
        canUseFullLocalForPlaybackSession: false,
        connectedPeersCount: 0
      })
    ).toBe(true);
    expect(
      shouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: true,
        nowMs: 1000,
        cooldownUntilMs: 0,
        immediateFullLocalRecoveryEligible: false,
        canUseFullLocalForPlaybackSession: true,
        connectedPeersCount: 0
      })
    ).toBe(true);
    expect(
      pipelineShouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: true,
        nowMs: 1000,
        cooldownUntilMs: 0,
        immediateFullLocalRecoveryEligible: false,
        canUseFullLocalForPlaybackSession: false,
        connectedPeersCount: 1
      })
    ).toBe(true);
    expect(
      pipelineShouldAllowLocalTakeover({
        listenerLocalTakeoverEnabled: true,
        nowMs: 1000,
        cooldownUntilMs: 0,
        immediateFullLocalRecoveryEligible: false,
        canUseFullLocalForPlaybackSession: false,
        connectedPeersCount: 0
      })
    ).toBe(false);
    expect(
      pipelineResolveFullLocalBlockedReason({
        hasBufferedFullLocalTrack: true,
        canUseFullLocalForPlaybackSession: false,
        isCurrentSourceOwner: false,
        listenerLocalTakeoverEnabled: true,
        activePlaybackSource: "progressive-local",
        startupGatePending: false,
        fullLocalRecoveryActive: false
      })
    ).toBe("full-local-not-available-at-playback-start");
    expect(
      pipelineResolveFullLocalBlockedReason({
        hasBufferedFullLocalTrack: true,
        canUseFullLocalForPlaybackSession: true,
        isCurrentSourceOwner: false,
        listenerLocalTakeoverEnabled: true,
        activePlaybackSource: "progressive-local",
        startupGatePending: false,
        fullLocalRecoveryActive: false
      })
    ).toBe(null);
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
    expect(pipelineIsSlidingWindowPlaybackSource("progressive-local")).toBe(true);
    expect(pipelineIsSlidingWindowPlaybackSource("lossless-local")).toBe(true);
    expect(pipelineIsSlidingWindowPlaybackSource("full-local")).toBe(false);
    expect(
      pipelineResolveTransportGovernorMode({
        activePlaybackSource: "full-local",
        mediaConnectedPeersCount: 0,
        connectedPeersCount: 0,
        pendingPlaybackIntent: true,
        progressiveFallbackReason: "stalled",
        progressiveLocalEligible: false
      })
    ).toBe("local-primary");
    expect(
      pipelineResolveSourceOwnerIdentity({
        members: [
          { id: "session-a", peerId: "peer-a" },
          { id: "session-b", peerId: "peer-b" }
        ],
        peerId: "peer-b",
        playbackSourceSessionId: "session-a",
        playbackSourcePeerId: "peer-a",
        isSourceOwner: false
      })
    ).toEqual({
      currentSessionUserId: "session-b",
      playbackSourceSessionId: "session-a",
      currentPeerId: "peer-b",
      playbackSourcePeerId: "peer-a",
      isSourceOwner: false
    });
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
    expect(
      pipelineResolveBufferSafetyMarginMs({
        aheadBufferedMs: 5_000,
        estimatedFillTimeMs: null
      })
    ).toBe(null);
    expect(
      pipelineResolveBufferSafetyMarginMs({
        aheadBufferedMs: 5_000,
        estimatedFillTimeMs: 2_000
      })
    ).toBe(3_000);
    expect(
      pipelineResolveBufferSafetyMarginMs({
        aheadBufferedMs: 1_000,
        estimatedFillTimeMs: 2_000
      })
    ).toBe(-1_000);
    expect(
      pipelineResolveEffectiveStartupBufferMs({
        baseStartupBufferMs: 60,
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 1
      })
    ).toBe(280);
    expect(
      pipelineResolveEffectiveStartupBufferMs({
        baseStartupBufferMs: 60,
        waitingEventsLast30s: 2,
        stalledEventsLast30s: 0
      })
    ).toBe(200);
    expect(
      pipelineResolveEffectiveStartupBufferMs({
        baseStartupBufferMs: 60,
        waitingEventsLast30s: 1,
        stalledEventsLast30s: 0
      })
    ).toBe(140);
    expect(
      pipelineResolveEffectiveStartupBufferMs({
        baseStartupBufferMs: 60,
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0
      })
    ).toBe(60);
    expect(
      pipelineResolvePlaybackQualityMetrics({
        nowMs: 10_000,
        windowMs: 1_000,
        waitingEventTimestamps: [8_999, 9_000, 9_500],
        stalledEventTimestamps: [9_200],
        driftSamples: [
          { timestampMs: 8_999, driftMs: 100 },
          { timestampMs: 9_100, driftMs: 100 },
          { timestampMs: 9_800, driftMs: 250 }
        ],
        maxContinuousPlaybackMsLast30s: 7_000
      })
    ).toEqual({
      waitingEventsLast30s: 2,
      stalledEventsLast30s: 1,
      averageDriftMs: 175,
      maxDriftMs: 250,
      maxContinuousPlaybackMsLast30s: 7_000
    });
    expect(
      pipelineResolvePlaybackQualityMetrics({
        nowMs: 10_000,
        windowMs: 1_000,
        waitingEventTimestamps: [],
        stalledEventTimestamps: [],
        driftSamples: [],
        maxContinuousPlaybackMsLast30s: 0
      })
    ).toMatchObject({
      averageDriftMs: null,
      maxDriftMs: null
    });
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
    expect(pipelineIsRecoverableProgressiveFallbackReason("buffer-underrun")).toBe(true);
    expect(pipelineIsRecoverableProgressiveFallbackReason("stalled")).toBe(true);
    expect(pipelineIsRecoverableProgressiveFallbackReason("seek-outside-buffer")).toBe(true);
    expect(pipelineIsRecoverableProgressiveFallbackReason("progressive-init-failed")).toBe(false);
    expect(pipelineIsRecoverableProgressiveFallbackReason(null)).toBe(false);
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
    const baseProgressiveLocalBlockInput = {
      hasManifest: true,
      isCurrentSourceOwner: false,
      activePlaybackSource: "progressive-local" as const,
      playbackStatus: "playing" as const,
      engineType: "pcm" as const,
      startupReady: false,
      hasFullLocalTrack: false,
      progressiveFallbackReason: null,
      localTakeoverCooldownMs: 0,
      connectedPeersCount: 1,
      aggregatePieceDownloadRateKbps: 64,
      progressiveTakeoverReady: true
    };
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        hasManifest: false
      })
    ).toBe("progressive-engine-unavailable");
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        playbackStatus: "paused"
      })
    ).toBe("playback-paused");
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        progressiveFallbackReason: "progressive-init-failed"
      })
    ).toBe("progressive-init-failed");
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        startupReady: true
      })
    ).toBe(null);
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        localTakeoverCooldownMs: 1
      })
    ).toBe("takeover-cooldown");
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        connectedPeersCount: 0
      })
    ).toBe("data-channel-not-ready");
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        aggregatePieceDownloadRateKbps: null
      })
    ).toBe("piece-download-not-ready");
    expect(
      pipelineResolveProgressiveLocalBlockedReason({
        ...baseProgressiveLocalBlockInput,
        progressiveTakeoverReady: false
      })
    ).toBe("local-prefix-not-ready");
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
    expect(Array.from(resolveActiveMemberPeerIds([{ peerId: "peer-a" }]))).toEqual(["peer-a"]);
    expect(
      resolveCurrentBufferedFullLocalTrack({
        currentTrackId: "track-1",
        fullLocalPlaybackTracks: {},
        uploadedTracks: { "track-1": { objectUrl: "uploaded" } }
      })
    ).toEqual({ objectUrl: "uploaded" });
    expect(
      resolveTrackAvailabilityAnnouncement({
        currentTrackId: "track-1",
        availabilityByTrack: {
          "track-1": {
            "peer-a": { ownerPeerId: "peer-a" }
          }
        },
        peerId: "peer-a"
      })
    ).toEqual({ ownerPeerId: "peer-a" });
    expect(
      resolveNextQueueTrackPrefetch({
        queue: [
          { id: "queue-1", trackId: "track-1" },
          { id: "queue-2", trackId: "track-2" }
        ],
        currentQueueItemId: "queue-1",
        currentTrackId: null,
        tracks: [{ id: "track-2", title: "Next" }],
        availabilityByTrack: {},
        peerId: "peer-a"
      })
    ).toBe("Next 0/0");
    expect(
      resolveAggregatePieceDownloadRateKbps({
        activeMemberPeerIds: new Set(["peer-a"]),
        peerDiagnostics: [{ peerId: "peer-a", pieceDownloadRateKbps: 12.6 }]
      })
    ).toBe(13);
    expect(getAudibleElementVolume(0)).toBe(0.72);
    expect(getAudibleElementVolume(Number.NaN)).toBe(0.72);
    expect(getAudibleElementVolume(0.35)).toBe(0.35);
    expect(getAudibleElementVolume(2)).toBe(1);
    expect(
      resolveLocalAudioDiagnostics({
        paused: true,
        muted: false,
        volume: 1,
        readyState: 4,
        currentSrc: "blob:track",
        srcObject: null
      })
    ).toEqual({
      localAudioPaused: true,
      localAudioMuted: false,
      localAudioVolume: 1,
      localAudioReadyState: 4,
      localAudioCurrentSrc: "blob:track",
      localAudioHasSrcObject: false
    });
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

  it("keeps effective startup buffer policy available through the runtime module", () => {
    expect(
      resolveBufferSafetyMarginMs({
        aheadBufferedMs: 5_000,
        estimatedFillTimeMs: 2_000
      })
    ).toBe(3_000);
    expect(
      resolveEffectiveStartupBufferMs({
        baseStartupBufferMs: 60,
        waitingEventsLast30s: 2,
        stalledEventsLast30s: 0
      })
    ).toBe(200);
    expect(
      resolvePlaybackQualityMetrics({
        nowMs: 1_000,
        windowMs: 500,
        waitingEventTimestamps: [400, 700],
        stalledEventTimestamps: [],
        driftSamples: [{ timestampMs: 900, driftMs: 40 }],
        maxContinuousPlaybackMsLast30s: 120
      })
    ).toEqual({
      waitingEventsLast30s: 1,
      stalledEventsLast30s: 0,
      averageDriftMs: 40,
      maxDriftMs: 40,
      maxContinuousPlaybackMsLast30s: 120
    });
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

  it("keeps migrated source and full-local policies available through the runtime module", () => {
    expect(isSlidingWindowPlaybackSource("lossless-local")).toBe(true);
    expect(
      resolveTransportGovernorMode({
        activePlaybackSource: "progressive-local",
        mediaConnectedPeersCount: 2,
        connectedPeersCount: 2,
        pendingPlaybackIntent: false,
        progressiveFallbackReason: null,
        progressiveLocalEligible: true
      })
    ).toBe("local-primary");
    expect(
      resolveFullLocalBlockedReason({
        hasBufferedFullLocalTrack: false,
        canUseFullLocalForPlaybackSession: false,
        isCurrentSourceOwner: true,
        listenerLocalTakeoverEnabled: true,
        activePlaybackSource: "full-local",
        startupGatePending: false,
        fullLocalRecoveryActive: false
      })
    ).toBe("track-not-fully-cached");
    expect(
      resolveSourceOwnerIdentity({
        members: [{ id: "session-a", peerId: "peer-a" }],
        peerId: "",
        playbackSourceSessionId: null,
        playbackSourcePeerId: null,
        isSourceOwner: true
      })
    ).toEqual({
      currentSessionUserId: null,
      playbackSourceSessionId: null,
      currentPeerId: null,
      playbackSourcePeerId: null,
      isSourceOwner: true
    });
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
      resolveProgressiveLocalBlockedReason({
        hasManifest: true,
        isCurrentSourceOwner: false,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        engineType: "pcm",
        startupReady: true,
        hasFullLocalTrack: false,
        progressiveFallbackReason: null,
        localTakeoverCooldownMs: 0,
        connectedPeersCount: 1,
        aggregatePieceDownloadRateKbps: 64,
        progressiveTakeoverReady: false
      })
    ).toBe(null);
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
