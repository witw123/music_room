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
  resolveFullLocalPlaybackSelection as pipelineResolveFullLocalPlaybackSelection,
  pruneContinuousPlaybackSegments as pipelinePruneContinuousPlaybackSegments,
  prunePlaybackQualityTimestamps as pipelinePrunePlaybackQualityTimestamps,
  appendPlaybackQualityTimestamp as pipelineAppendPlaybackQualityTimestamp,
  resolveTrackAvailabilityAnnouncement as pipelineResolveTrackAvailabilityAnnouncement,
  resolveNextQueueTrackPrefetch as pipelineResolveNextQueueTrackPrefetch,
  resolveLocalPlaybackPositionMs as pipelineResolveLocalPlaybackPositionMs,
  bucketDiagnosticDurationMs as pipelineBucketDiagnosticDurationMs,
  getAudibleElementVolume as pipelineGetAudibleElementVolume,
  getPcmEngineDiagnosticsKey as pipelineGetPcmEngineDiagnosticsKey,
  resolveLocalAudioDiagnostics as pipelineResolveLocalAudioDiagnostics,
  getSlidingWindowPlayBlockedReason as pipelineGetSlidingWindowPlayBlockedReason,
  hasSufficientBackingForFullLocalWarmup as pipelineHasSufficientBackingForFullLocalWarmup,
  isSlidingWindowPlaybackSource as pipelineIsSlidingWindowPlaybackSource,
  resolvePlaybackStartFailureReason as pipelineResolvePlaybackStartFailureReason,
  resolveSourceOwnerIdentity as pipelineResolveSourceOwnerIdentity,
  resolvePlaybackRecoveryStage as pipelineResolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive as pipelineResolveAudibleLocalFallbackActive,
  resolveFullLocalBlockedReason as pipelineResolveFullLocalBlockedReason,
  resolveFullLocalEligibility as pipelineResolveFullLocalEligibility,
  resolveFullLocalWarmupHoldState as pipelineResolveFullLocalWarmupHoldState,
  resolveFullLocalWarmupReadiness as pipelineResolveFullLocalWarmupReadiness,
  resolveFullLocalWarmupTransitionAction as pipelineResolveFullLocalWarmupTransitionAction,
  resolveFullLocalUpgradeAction as pipelineResolveFullLocalUpgradeAction,
  resolveForceSourceOwnerLocalPlaybackAction as pipelineResolveForceSourceOwnerLocalPlaybackAction,
  resolveIdleFullLocalUpgradeArmState as pipelineResolveIdleFullLocalUpgradeArmState,
  resolveImmediateFullLocalRecoveryAction as pipelineResolveImmediateFullLocalRecoveryAction,
  resolveLocalTakeoverCooldownArmAction as pipelineResolveLocalTakeoverCooldownArmAction,
  resolveLocalTakeoverCooldownResetAction as pipelineResolveLocalTakeoverCooldownResetAction,
  shouldAllowLocalTakeover as pipelineShouldAllowLocalTakeover,
  resolveFullLocalPlaybackSessionState as pipelineResolveFullLocalPlaybackSessionState,
  resolveMediaElementPlaybackRole as pipelineResolveMediaElementPlaybackRole,
  resolvePlaybackSourceAfterLatchedPcmRuntimeFailure as pipelineResolvePlaybackSourceAfterLatchedPcmRuntimeFailure,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure as pipelineResolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolveListenerMediaConnectionState as pipelineResolveListenerMediaConnectionState,
  resolveBufferingMediaConnectionState as pipelineResolveBufferingMediaConnectionState,
  resolveInactivePlaybackSchedulerAction as pipelineResolveInactivePlaybackSchedulerAction,
  resolveInactivePlaybackSchedulerMode as pipelineResolveInactivePlaybackSchedulerMode,
  resolveObservedPlaybackSeconds as pipelineResolveObservedPlaybackSeconds,
  resolvePausedPlaybackEventAction as pipelineResolvePausedPlaybackEventAction,
  resolveDriftSampleAction as pipelineResolveDriftSampleAction,
  resolveDriftSamplingPreflight as pipelineResolveDriftSamplingPreflight,
  resolvePausedPlaybackRecoveryState as pipelineResolvePausedPlaybackRecoveryState,
  resolvePlaybackSourceTransitionAction as pipelineResolvePlaybackSourceTransitionAction,
  resolvePlaybackTimelineResetAction as pipelineResolvePlaybackTimelineResetAction,
  resolvePlaybackSurfaceResetAction as pipelineResolvePlaybackSurfaceResetAction,
  resolvePlaybackSurfaceResetMediaConnectionState as pipelineResolvePlaybackSurfaceResetMediaConnectionState,
  resolvePlaybackStartMediaConnectionState as pipelineResolvePlaybackStartMediaConnectionState,
  resolvePlaybackStartFailureIntentAction as pipelineResolvePlaybackStartFailureIntentAction,
  resolvePlaybackStartFailureMessage as pipelineResolvePlaybackStartFailureMessage,
  resolvePlaybackStartIntentTimeoutPreflight as pipelineResolvePlaybackStartIntentTimeoutPreflight,
  resolvePlaybackStartIntentTimeoutResult as pipelineResolvePlaybackStartIntentTimeoutResult,
  resolvePlaybackStartRetryClearAction as pipelineResolvePlaybackStartRetryClearAction,
  resolvePlaybackStartRetryPreflight as pipelineResolvePlaybackStartRetryPreflight,
  resolvePlaybackStartRetryResult as pipelineResolvePlaybackStartRetryResult,
  resolvePcmRuntimeFailureAction as pipelineResolvePcmRuntimeFailureAction,
  resolvePcmRuntimeFailureResetAction as pipelineResolvePcmRuntimeFailureResetAction,
  resolvePcmSyncPlaybackOutcome as pipelineResolvePcmSyncPlaybackOutcome,
  resolveProgressiveEngineSetupPreflight as pipelineResolveProgressiveEngineSetupPreflight,
  resolveProgressiveEngineAttachErrorAction as pipelineResolveProgressiveEngineAttachErrorAction,
  resolveProgressiveEngineAttachFailureAction as pipelineResolveProgressiveEngineAttachFailureAction,
  resolveProgressiveEngineAttachResultAction as pipelineResolveProgressiveEngineAttachResultAction,
  resolveProgressiveEngineAttachSuccessFallbackReason as pipelineResolveProgressiveEngineAttachSuccessFallbackReason,
  resolvePlayingPlaybackEventAction as pipelineResolvePlayingPlaybackEventAction,
  resolvePlayingMediaConnectionState as pipelineResolvePlayingMediaConnectionState,
  resolveSeekedPlaybackEventAction as pipelineResolveSeekedPlaybackEventAction,
  resolveTrackAvailabilityManifestHint as pipelineResolveTrackAvailabilityManifestHint,
  resolveLocalReadyPlaybackAction as pipelineResolveLocalReadyPlaybackAction,
  resolveMainPlaybackPreflight as pipelineResolveMainPlaybackPreflight,
  resolveMainPlaybackResetIdleAction as pipelineResolveMainPlaybackResetIdleAction,
  resolveSeekedPlaybackPolicy as pipelineResolveSeekedPlaybackPolicy,
  resolveSlidingWindowLowBufferFallbackReason as pipelineResolveSlidingWindowLowBufferFallbackReason,
  resolveSlidingWindowFallbackPlaybackAction as pipelineResolveSlidingWindowFallbackPlaybackAction,
  resolveSlidingWindowNativeSyncOutcome as pipelineResolveSlidingWindowNativeSyncOutcome,
  resolveSlidingWindowNoEngineHoldAction as pipelineResolveSlidingWindowNoEngineHoldAction,
  resolveStalledFallbackReason as pipelineResolveStalledFallbackReason,
  resolveStalledPlaybackEventAction as pipelineResolveStalledPlaybackEventAction,
  resolveWaitingPlaybackEventAction as pipelineResolveWaitingPlaybackEventAction,
  resolveWaitingFallbackReason as pipelineResolveWaitingFallbackReason,
  resolveWarmupHoldState as pipelineResolveWarmupHoldState,
  resolveWarmupInactivePlaybackAction as pipelineResolveWarmupInactivePlaybackAction,
  resolveWarmupMseCatchupAction as pipelineResolveWarmupMseCatchupAction,
  resolveWarmupPcmSyncMode as pipelineResolveWarmupPcmSyncMode,
  resolveWarmupPcmAudioStartAction as pipelineResolveWarmupPcmAudioStartAction,
  resolveWarmupPcmAudioStartResultAction as pipelineResolveWarmupPcmAudioStartResultAction,
  resolveWarmupPreflight as pipelineResolveWarmupPreflight,
  resolveWarmupTakeoverBlockedReason as pipelineResolveWarmupTakeoverBlockedReason,
  resolveWarmupUnavailableAction as pipelineResolveWarmupUnavailableAction,
  resolveFullLocalUpgradePreflight as pipelineResolveFullLocalUpgradePreflight,
  resolveBufferSafetyMarginMs as pipelineResolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs as pipelineResolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics as pipelineResolvePlaybackQualityMetrics,
  resolveContinuousPlaybackStart as pipelineResolveContinuousPlaybackStart,
  resolveContinuousPlaybackInterruption as pipelineResolveContinuousPlaybackInterruption,
  resolveContinuousPlaybackWindowMetrics as pipelineResolveContinuousPlaybackWindowMetrics,
  resolveProgressiveDiagnosticSignature as pipelineResolveProgressiveDiagnosticSignature,
  resolveProgressiveDiagnosticBuckets as pipelineResolveProgressiveDiagnosticBuckets,
  resolveFullLocalAudioSourceAction as pipelineResolveFullLocalAudioSourceAction,
  resolveFullLocalPausedPlaybackAction as pipelineResolveFullLocalPausedPlaybackAction,
  resolveFullLocalPausedRecoveryAttemptAction as pipelineResolveFullLocalPausedRecoveryAttemptAction,
  resolveFullLocalPausedRecoveryPreflight as pipelineResolveFullLocalPausedRecoveryPreflight,
  resolveFullLocalPlaybackMode as pipelineResolveFullLocalPlaybackMode,
  resolveFullLocalPlaybackActivationAction as pipelineResolveFullLocalPlaybackActivationAction,
  resolveFullLocalReadyPlaybackResult as pipelineResolveFullLocalReadyPlaybackResult,
  resolveFullLocalPausedRecoveryResult as pipelineResolveFullLocalPausedRecoveryResult,
  resolveFullLocalBufferedWarmupPreflight as pipelineResolveFullLocalBufferedWarmupPreflight,
  resolveFullLocalWarmupMissingTrackAction as pipelineResolveFullLocalWarmupMissingTrackAction,
  resolveProgressiveLocalBlockedReason as pipelineResolveProgressiveLocalBlockedReason,
  resolveProgressiveLocalReadinessPreflight as pipelineResolveProgressiveLocalReadinessPreflight,
  resolveLocalPlaybackReady as pipelineResolveLocalPlaybackReady,
  resolveMainPausedPlaybackAction as pipelineResolveMainPausedPlaybackAction,
  resolveSchedulerBufferHealth as pipelineResolveSchedulerBufferHealth,
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
  shouldPrepareProgressiveRuntime as pipelineShouldPrepareProgressiveRuntime,
  shouldPrepareProgressiveRuntimeForSource as pipelineShouldPrepareProgressiveRuntimeForSource,
  resolveSilentSlidingWindowFullLocalRecoveryAction as pipelineResolveSilentSlidingWindowFullLocalRecoveryAction,
  shouldRecoverPausedFullLocalPlayback as pipelineShouldRecoverPausedFullLocalPlayback,
  shouldRecoverSilentSlidingWindowWithFullLocal as pipelineShouldRecoverSilentSlidingWindowWithFullLocal,
  shouldReportPlaybackStartFailure as pipelineShouldReportPlaybackStartFailure,
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
  resolveFullLocalPlaybackSelection,
  pruneContinuousPlaybackSegments,
  prunePlaybackQualityTimestamps,
  appendPlaybackQualityTimestamp,
  resolveTrackAvailabilityAnnouncement,
  resolveNextQueueTrackPrefetch,
  resolveLocalPlaybackPositionMs,
  resolveLocalAudioDiagnostics,
  resolveMediaElementPlaybackRole,
  resolvePlaybackSourceAfterLatchedPcmRuntimeFailure,
  resolvePlaybackStartFailureReason,
  resolveListenerMediaConnectionState,
  resolveBufferingMediaConnectionState,
  resolveInactivePlaybackSchedulerAction,
  resolveInactivePlaybackSchedulerMode,
  resolveObservedPlaybackSeconds,
  resolvePausedPlaybackEventAction,
  resolveDriftSampleAction,
  resolveDriftSamplingPreflight,
  resolvePausedPlaybackRecoveryState,
  resolvePlaybackSurfaceResetMediaConnectionState,
  resolvePlaybackStartMediaConnectionState,
  resolvePlaybackStartFailureIntentAction,
  resolvePlaybackStartFailureMessage,
  resolvePlaybackStartIntentTimeoutPreflight,
  resolvePlaybackStartIntentTimeoutResult,
  resolvePlaybackStartRetryClearAction,
  resolvePlaybackStartRetryPreflight,
  resolvePlaybackStartRetryResult,
  resolvePcmRuntimeFailureAction,
  resolvePcmRuntimeFailureResetAction,
  resolvePcmSyncPlaybackOutcome,
  resolveProgressiveEngineSetupPreflight,
  resolveProgressiveEngineAttachErrorAction,
  resolveProgressiveEngineAttachFailureAction,
  resolveProgressiveEngineAttachResultAction,
  resolveProgressiveEngineAttachSuccessFallbackReason,
  resolvePlayingPlaybackEventAction,
  resolvePlayingMediaConnectionState,
  resolveSeekedPlaybackEventAction,
  resolveTrackAvailabilityManifestHint,
  resolveLocalReadyPlaybackAction,
  resolveMainPlaybackPreflight,
  resolveMainPlaybackResetIdleAction,
  resolveSeekedPlaybackPolicy,
  resolveSlidingWindowLowBufferFallbackReason,
  resolveSlidingWindowFallbackPlaybackAction,
  resolveSlidingWindowNativeSyncOutcome,
  resolveSlidingWindowNoEngineHoldAction,
  resolveStalledFallbackReason,
  resolveStalledPlaybackEventAction,
  resolveWaitingPlaybackEventAction,
  resolveWaitingFallbackReason,
  resolveWarmupHoldState,
  resolveWarmupInactivePlaybackAction,
  resolveWarmupMseCatchupAction,
  resolveWarmupPcmSyncMode,
  resolveWarmupPcmAudioStartAction,
  resolveWarmupPcmAudioStartResultAction,
  resolveWarmupPreflight,
  resolveWarmupTakeoverBlockedReason,
  resolveWarmupUnavailableAction,
  resolveFullLocalUpgradePreflight,
  resolveSourceOwnerIdentity,
  resolvePlaybackRecoveryStage,
  resolveAudibleLocalFallbackActive,
  shouldAllowLocalTakeover,
  resolveBufferSafetyMarginMs,
  resolveEffectiveStartupBufferMs,
  resolvePlaybackQualityMetrics,
  resolveContinuousPlaybackStart,
  resolveContinuousPlaybackInterruption,
  resolveContinuousPlaybackWindowMetrics,
  resolveProgressiveDiagnosticSignature,
  resolveProgressiveDiagnosticBuckets,
  resolveFullLocalAudioSourceAction,
  resolveFullLocalPausedPlaybackAction,
  resolveFullLocalPausedRecoveryAttemptAction,
  resolveFullLocalPausedRecoveryPreflight,
  resolveFullLocalPlaybackMode,
  resolveFullLocalPlaybackActivationAction,
  resolveFullLocalReadyPlaybackResult,
  resolveFullLocalPausedRecoveryResult,
  resolveFullLocalBufferedWarmupPreflight,
  resolveFullLocalWarmupMissingTrackAction,
  resolveProgressiveLocalBlockedReason,
  resolveProgressiveLocalReadinessPreflight,
  resolveLocalPlaybackReady,
  resolveMainPausedPlaybackAction,
  resolveSchedulerBufferHealth,
  resolveMaxContinuousPlaybackMs,
  resolveSchedulerBudgetTier,
  resolveTransportGovernorMode,
  shouldEnableFullLocalHandoff,
  resolveFullLocalBlockedReason,
  resolveFullLocalEligibility,
  resolveFullLocalPlaybackSessionState,
  resolveFullLocalWarmupHoldState,
  resolveFullLocalWarmupReadiness,
  resolveFullLocalWarmupTransitionAction,
  resolveFullLocalUpgradeAction,
  resolveForceSourceOwnerLocalPlaybackAction,
  resolveIdleFullLocalUpgradeArmState,
  resolveImmediateFullLocalRecoveryAction,
  resolveLocalTakeoverCooldownArmAction,
  resolveLocalTakeoverCooldownResetAction,
  shouldPreferImmediateFullLocalRecovery,
  shouldPreferLocalTakeover,
  resolvePlaybackSourceAfterProgressiveRuntimeFailure,
  resolvePlaybackSourceTransitionAction,
  resolvePlaybackTimelineResetAction,
  resolvePlaybackSurfaceResetAction,
  shouldPrepareProgressiveRuntime,
  shouldPrepareProgressiveRuntimeForSource,
  shouldAttemptProgressiveLocalPlayback,
  shouldPublishProgressiveDiagnostic,
  resolveSilentSlidingWindowFullLocalRecoveryAction,
  shouldRecoverPausedFullLocalPlayback,
  shouldRecoverSilentSlidingWindowWithFullLocal,
  shouldReportPlaybackStartFailure,
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
  it("drives the progressive warmup loop through the playback orchestrator", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const runtimeTickHookSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/use-runtime-tick-orchestrator.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const warmupControllerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/progressive-warmup-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const intervalNeedle = [
      "const timerId = window.setInterval(() => {",
      "      void syncWarmup();",
      "    }, progressiveRuntimeTickIntervalMs);"
    ].join("\n");
    expect(runtimeSource).not.toContain(intervalNeedle);
    const orchestratorIndex = runtimeSource.indexOf(
      "const runtimeTickOrchestrator = new PlaybackOrchestrator"
    );
    expect(orchestratorIndex).toBe(-1);
    expect(runtimeTickHookSource).toContain(
      "const runtimeTickOrchestrator = new PlaybackOrchestrator"
    );
    expect(runtimeTickHookSource).toContain("\"sync-progressive-warmup\"");

    const warmupRefIndex = warmupControllerSource.indexOf("syncProgressiveWarmupRef.current = () => {");
    expect(warmupRefIndex).toBeGreaterThan(-1);

    const dependencyStart = warmupControllerSource.indexOf("  }, [", warmupRefIndex);
    const dependencyEnd = warmupControllerSource.indexOf("]);", dependencyStart);
    const dependencies = warmupControllerSource.slice(dependencyStart, dependencyEnd);

    expect(dependencies).toContain("progressiveWarmupTimerKey");
    expect(dependencies).not.toContain("currentProgressiveManifest,");
    expect(dependencies).not.toContain("canUseFullLocalForPlaybackSession,");
    expect(dependencies).not.toContain("progressiveHealthSnapshot.startupReady,");
    expect(dependencies).not.toContain("attemptPlaybackStart,");
    expect(dependencies).not.toContain("isLocalTakeoverAllowed,");
    expect(dependencies).not.toContain("markPcmRuntimeFailure,");
    expect(dependencies).not.toContain("transitionPlaybackSource,");
  });

  it("drives migrated runtime loops through the playback orchestrator with stable scalar dependencies", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const runtimeTickHookSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/use-runtime-tick-orchestrator.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const tickEffectsControllerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/runtime-tick-effects-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const orchestratorNeedle = "const runtimeTickOrchestrator = new PlaybackOrchestrator";
    expect(runtimeSource.indexOf(orchestratorNeedle)).toBe(-1);
    expect(runtimeTickHookSource.indexOf(orchestratorNeedle)).toBeGreaterThan(-1);
    expect(runtimeSource).not.toContain("const driftSamplingOrchestrator = new PlaybackOrchestrator");
    expect(runtimeSource).not.toContain(
      "const fullLocalUpgradeOrchestrator = new PlaybackOrchestrator"
    );
    expect(runtimeSource).not.toContain(
      "const timerId = window.setInterval(sampleDrift, playbackDriftSampleIntervalMs);"
    );
    expect(runtimeSource).not.toContain(
      "const timerId = window.setInterval(syncUpgrade, progressiveRuntimeTickIntervalMs);"
    );
    expect(runtimeSource).not.toContain(
      "const timerId = window.setInterval(syncWarmup, progressiveRuntimeTickIntervalMs);"
    );
    expect(runtimeSource).not.toContain(
      [
        "const timerId = window.setInterval(",
        "      recoverPausedFullLocalPlayback,",
        "      fullLocalPausedRecoveryIntervalMs",
        "    );"
      ].join("\n")
    );

    const callbackRefreshNeedle =
      "recoverPausedFullLocalPlaybackRef.current = recoverPausedFullLocalPlayback;";
    const callbackRefreshIndex = tickEffectsControllerSource.indexOf(callbackRefreshNeedle);
    expect(callbackRefreshIndex).toBeGreaterThan(-1);

    const dependencyStart = tickEffectsControllerSource.indexOf("  }, [", callbackRefreshIndex);
    const dependencyEnd = tickEffectsControllerSource.indexOf("]);", dependencyStart);
    const dependencies = tickEffectsControllerSource.slice(dependencyStart, dependencyEnd);

    expect(dependencies).toContain("playbackCurrentTrackId");
    expect(dependencies).toContain("playbackMediaEpoch");
    expect(dependencies).toContain("playbackStatus");
    expect(dependencies).not.toContain("playback,");
    expect(dependencies).not.toMatch(/^\s+currentTrack,\s*$/m);
  });

  it("keeps hook dependency arrays free of snapshot object identities", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const warmupControllerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/progressive-warmup-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const tickEffectsControllerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/runtime-tick-effects-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    const dependencySource = [runtimeSource, warmupControllerSource, tickEffectsControllerSource]
      .flatMap((source) => [...source.matchAll(/\n\s*\}, \[\n(?<deps>[\s\S]*?)\n\s*\]\);/g)])
      .map((match) => match.groups?.deps ?? "")
      .join("\n");

    expect(dependencySource).not.toMatch(/^\s+playback,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+currentTrack,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+currentBufferedFullLocalTrack,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+roomSnapshot\?\.room\.playback,\s*$/m);
  });

  it("subscribes to the playback orchestrator snapshot with useSyncExternalStore", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const runtimeTickHookSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/use-runtime-tick-orchestrator.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackRuntimeTickOrchestrator");
    expect(runtimeTickHookSource).toContain("noopPlaybackRuntimeTick");
    expect(runtimeSource).not.toContain("useSyncExternalStore");
    expect(runtimeSource).not.toContain("new PlaybackOrchestrator");
    expect(runtimeSource).not.toContain("type RuntimeTickState");
    expect(runtimeTickHookSource).toContain("useSyncExternalStore");
    expect(runtimeTickHookSource).toContain("new PlaybackOrchestrator");
    expect(runtimeTickHookSource).toContain("runtimeTickOrchestratorRef.current.subscribe");
    expect(runtimeTickHookSource).toContain("runtimeTickOrchestratorRef.current.getSnapshot");

    const mountIndex = runtimeTickHookSource.indexOf("runtimeTickOrchestratorRef.current.mount();");
    expect(mountIndex).toBeGreaterThan(-1);
    const dependencyStart = runtimeTickHookSource.indexOf("  }, [", mountIndex);
    const dependencyEnd = runtimeTickHookSource.indexOf("]);", dependencyStart);
    const dependencies = runtimeTickHookSource.slice(dependencyStart, dependencyEnd);

    expect(dependencies).toContain("runtimeTickOrchestratorRef");
    expect(dependencies).not.toContain("playbackCurrentTrackId");
    expect(dependencies).not.toContain("playbackStatus");
    expect(dependencies).not.toContain("currentTrack");
  });

  it("hosts runtime hook boundary types outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const runtimeTypesSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "playback-orchestrator/runtime-types.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain('} from "./playback-orchestrator/runtime-types";');
    expect(runtimeSource).toContain("FullLocalPlaybackTrack,");
    expect(runtimeSource).toContain("UseProgressiveRuntimeInput,");
    expect(runtimeSource).toContain("UseProgressiveRuntimeResult");
    expect(runtimeSource).not.toContain("type UseProgressiveRuntimeInput =");
    expect(runtimeSource).not.toContain("type UseProgressiveRuntimeResult =");
    expect(runtimeTypesSource).toContain("export type UseProgressiveRuntimeInput =");
    expect(runtimeTypesSource).toContain("export type UseProgressiveRuntimeResult =");
  });

  it("hosts playback start intent orchestration outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const controllerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-start-intent-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackStartIntentController");
    expect(runtimeSource).not.toContain("const updatePlaybackStartIntent = useCallback");
    expect(runtimeSource).not.toContain("const markPlaybackStartFailure = useCallback");
    expect(runtimeSource).not.toContain("const attemptPlaybackStart = useCallback");
    expect(runtimeSource).not.toContain("const ensurePlaybackStart = useCallback");
    expect(controllerSource).toContain("export function usePlaybackStartIntentController");
    expect(controllerSource).toContain("const attemptPlaybackStart = useCallback");
    expect(controllerSource).toContain("const ensurePlaybackStart = useCallback");
    expect(controllerSource).toContain("resolvePlaybackStartIntentTimeoutPreflight");
  });

  it("hosts progressive diagnostics publishing outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const publisherSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/progressive-diagnostics-publisher.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useProgressiveDiagnosticsPublisher");
    expect(runtimeSource).not.toContain('event: "progressive-status"');
    expect(runtimeSource).not.toContain("const diagnosticBuckets = useMemo");
    expect(runtimeSource).not.toContain("lastProgressiveDiagnosticSignatureRef");
    expect(publisherSource).toContain("export function useProgressiveDiagnosticsPublisher");
    expect(publisherSource).toContain("const diagnosticBuckets = useMemo");
    expect(publisherSource).toContain('event: "progressive-status"');
    expect(publisherSource).toContain("resolveProgressiveDiagnosticSignature");
  });

  it("hosts playback scheduler and low-buffer fallback state outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const schedulerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-scheduler-state.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackSchedulerState");
    expect(runtimeSource).not.toContain("const schedulerAction = resolveInactivePlaybackSchedulerAction");
    expect(runtimeSource).not.toContain("const fallbackReason = resolveSlidingWindowLowBufferFallbackReason");
    expect(schedulerSource).toContain("export function usePlaybackSchedulerState");
    expect(schedulerSource).toContain("resolveInactivePlaybackSchedulerAction");
    expect(schedulerSource).toContain("resolveSlidingWindowLowBufferFallbackReason");
  });

  it("hosts playback quality metrics state outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const qualityStateSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-quality-state.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackQualityState");
    expect(runtimeSource).not.toContain("waitingEventTimestampsRef");
    expect(runtimeSource).not.toContain("stalledEventTimestampsRef");
    expect(runtimeSource).not.toContain("driftSamplesRef");
    expect(runtimeSource).not.toContain("continuousPlaybackStartedAtRef");
    expect(runtimeSource).not.toContain("const pushQualityEvent = useCallback");
    expect(runtimeSource).not.toContain("const recordDriftSample = useCallback");
    expect(qualityStateSource).toContain("export function usePlaybackQualityState");
    expect(qualityStateSource).toContain("recordWaitingEvent");
    expect(qualityStateSource).toContain("recordStalledEvent");
    expect(qualityStateSource).toContain("resetPlaybackQualityState");
  });

  it("hosts local audio play-pause state outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const audioStateSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/local-audio-playback-state.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useLocalAudioPlaybackState");
    expect(runtimeSource).not.toContain("useState<boolean | null>");
    expect(runtimeSource).not.toContain("const handlePlay = () => setAudioPaused(false)");
    expect(runtimeSource).not.toContain("const handlePause = () => setAudioPaused(true)");
    expect(audioStateSource).toContain("export function useLocalAudioPlaybackState");
    expect(audioStateSource).toContain("audio.addEventListener(\"play\"");
    expect(audioStateSource).toContain("audio.addEventListener(\"pause\"");
  });

  it("hosts local audio event handling outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const eventControllerSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/local-audio-event-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useLocalAudioEventController");
    expect(runtimeSource).not.toContain("const handlePlaying = (event: Event)");
    expect(runtimeSource).not.toContain("const handleWaiting = (event: Event)");
    expect(runtimeSource).not.toContain("const handleStalled = (event: Event)");
    expect(runtimeSource).not.toContain("localAudio?.addEventListener(\"playing\"");
    expect(eventControllerSource).toContain("export function useLocalAudioEventController");
    expect(eventControllerSource).toContain("resolvePlayingPlaybackEventAction");
    expect(eventControllerSource).toContain("resolveWaitingPlaybackEventAction");
    expect(eventControllerSource).toContain("resolveStalledPlaybackEventAction");
  });

  it("hosts playback runtime lifecycle resets outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const lifecycleSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-runtime-lifecycle-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackRuntimeLifecycleController");
    expect(runtimeSource).not.toContain("const destroyProgressiveRuntime = useCallback");
    expect(runtimeSource).not.toContain("const resetAction = resolvePlaybackSurfaceResetAction");
    expect(runtimeSource).not.toContain("const resetAction = resolvePlaybackTimelineResetAction");
    expect(runtimeSource).not.toContain("resolvePcmRuntimeFailureResetAction({");
    expect(lifecycleSource).toContain("export function usePlaybackRuntimeLifecycleController");
    expect(lifecycleSource).toContain("resolvePlaybackSurfaceResetAction");
    expect(lifecycleSource).toContain("resolvePlaybackTimelineResetAction");
    expect(lifecycleSource).toContain("resolvePcmRuntimeFailureResetAction");
  });

  it("hosts playback runtime input derivation outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const inputStateSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-runtime-input-state.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackRuntimeInputState");
    expect(runtimeSource).not.toContain("const currentBufferedFullLocalTrack = useMemo(");
    expect(runtimeSource).not.toContain("const currentProgressiveManifestKey =");
    expect(runtimeSource).not.toContain("const nextCurrentProgressiveManifest =");
    expect(runtimeSource).not.toContain("const progressiveHealthSnapshot = useMemo(");
    expect(inputStateSource).toContain("export function usePlaybackRuntimeInputState");
    expect(inputStateSource).toContain("buildProgressiveTrackManifest");
    expect(inputStateSource).toContain("buildProgressiveHealthSnapshot");
    expect(inputStateSource).toContain("resolveTrackAvailabilityManifestHint");
    expect(inputStateSource).toContain("resolveFullLocalPlaybackSessionState");
  });

  it("hosts playback runtime refs outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const refsSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-runtime-refs.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackRuntimeRefs");
    expect(runtimeSource).not.toContain("const progressiveEngineRef = useRef<ProgressiveMseEngine | null>");
    expect(runtimeSource).not.toContain("const progressivePcmEngineRef = useRef<ProgressivePcmEngine | null>");
    expect(runtimeSource).not.toContain("const pcmRuntimeFailureRef = useRef<{ trackId: string; reason: string } | null>");
    expect(refsSource).toContain("export function usePlaybackRuntimeRefs");
    expect(refsSource).toContain("progressiveEngineRef");
    expect(refsSource).toContain("localTakeoverCooldownUntilRef");
    expect(refsSource).toContain("lastStablePlaybackAtRef");
  });

  it("hosts local playback readiness handling outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const readinessSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/local-playback-readiness-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useLocalPlaybackReadinessController");
    expect(runtimeSource).not.toContain("const localReadyEvents: Array<keyof HTMLMediaElementEventMap>");
    expect(runtimeSource).not.toContain("const localPlaybackReady = resolveLocalPlaybackReady");
    expect(runtimeSource).not.toContain("const nextMediaConnectionState = resolveListenerMediaConnectionState");
    expect(readinessSource).toContain("export function useLocalPlaybackReadinessController");
    expect(readinessSource).toContain("resolveLocalReadyPlaybackAction");
    expect(readinessSource).toContain("resolveListenerMediaConnectionState");
  });

  it("hosts playback source transition side effects outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const sourceController = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/playback-source-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("usePlaybackSourceController");
    expect(runtimeSource).not.toContain("const transitionPlaybackSource = useCallback");
    expect(runtimeSource).not.toContain("const forceLocalAction =\n      resolveForceSourceOwnerLocalPlaybackAction");
    expect(runtimeSource).not.toContain("const recoveryAction = resolveImmediateFullLocalRecoveryAction");
    expect(runtimeSource).not.toContain("resolveSilentSlidingWindowFullLocalRecoveryAction(");
    expect(sourceController).toContain("export function usePlaybackSourceController");
    expect(sourceController).toContain("resolvePlaybackSourceTransitionAction");
    expect(sourceController).toContain("resolveImmediateFullLocalRecoveryAction");
    expect(sourceController).toContain("resolveSilentSlidingWindowFullLocalRecoveryAction");
  });

  it("hosts progressive engine attachment outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const engineController = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/progressive-engine-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useProgressiveEngineController");
    expect(runtimeSource).not.toContain("const setupPreflight = resolveProgressiveEngineSetupPreflight");
    expect(runtimeSource).not.toContain("new ProgressivePcmEngine(");
    expect(runtimeSource).not.toContain("new ProgressiveMseEngine(");
    expect(runtimeSource).not.toContain("progressivePcmEngineRef.current?.setVolume(volume)");
    expect(engineController).toContain("export function useProgressiveEngineController");
    expect(engineController).toContain("resolveProgressiveEngineSetupPreflight");
    expect(engineController).toContain("resolveProgressiveEngineAttachResultAction");
    expect(engineController).toContain("resolveProgressiveEngineAttachErrorAction");
  });

  it("hosts main playback driving outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const mainPlaybackController = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/main-playback-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useMainPlaybackController");
    expect(runtimeSource).not.toContain("const mainPlaybackPreflight = resolveMainPlaybackPreflight");
    expect(runtimeSource).not.toContain("const resetIdleAction = resolveMainPlaybackResetIdleAction");
    expect(runtimeSource).not.toContain("const wantsFullLocalPlayback = resolveFullLocalPlaybackSelection");
    expect(runtimeSource).not.toContain("const playbackOutcome = resolvePcmSyncPlaybackOutcome");
    expect(mainPlaybackController).toContain("export function useMainPlaybackController");
    expect(mainPlaybackController).toContain("resolveMainPlaybackPreflight");
    expect(mainPlaybackController).toContain("resolveFullLocalPlaybackSelection");
    expect(mainPlaybackController).toContain("resolvePcmSyncPlaybackOutcome");
  });

  it("hosts progressive warmup driving outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const warmupController = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/progressive-warmup-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useProgressiveWarmupController");
    expect(runtimeSource).not.toContain("const warmupPreflight = resolveWarmupPreflight");
    expect(runtimeSource).not.toContain("const syncWarmup = async () =>");
    expect(runtimeSource).not.toContain("syncProgressiveWarmupRef.current = () =>");
    expect(warmupController).toContain("export function useProgressiveWarmupController");
    expect(warmupController).toContain("resolveWarmupPreflight");
    expect(warmupController).toContain("resolveProgressiveWarmupDecision");
    expect(warmupController).toContain("resolveWarmupInactivePlaybackAction");
  });

  it("hosts runtime tick effects outside the main runtime hook", () => {
    const runtimeSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-progressive-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const tickEffectsController = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/runtime-tick-effects-controller.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(runtimeSource).toContain("useRuntimeTickEffectsController");
    expect(runtimeSource).not.toContain("const recoverPausedFullLocalPlayback = () =>");
    expect(runtimeSource).not.toContain("const sampleDrift = () =>");
    expect(runtimeSource).not.toContain("const syncFullLocalBufferedWarmup = () =>");
    expect(runtimeSource).not.toContain("const syncUpgrade = () =>");
    expect(tickEffectsController).toContain("export function useRuntimeTickEffectsController");
    expect(tickEffectsController).toContain("resolveFullLocalPausedRecoveryPreflight");
    expect(tickEffectsController).toContain("resolveDriftSampleAction");
    expect(tickEffectsController).toContain("resolveFullLocalUpgradeAction");
    expect(tickEffectsController).toContain("resolveFullLocalWarmupTransitionAction");
  });

  it("memoizes diagnostic bucket objects before using them in effect dependencies", () => {
    const publisherSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "playback-orchestrator/progressive-diagnostics-publisher.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(publisherSource).toContain(
      "const diagnosticBuckets = useMemo(\n" +
        "    () =>\n" +
        "      resolveProgressiveDiagnosticBuckets({"
    );
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
    const fallbackAvailability = {
      roomId: "room-1",
      trackId: "track-1",
      ownerPeerId: "peer-fallback",
      nickname: "fallback",
      totalChunks: 4,
      chunkSize: 1024,
      availableChunks: [0],
      source: "local_cache" as const,
      announcedAt: "2026-01-01T00:00:00.000Z"
    };
    expect(
      pipelineResolveTrackAvailabilityManifestHint({
        currentTrackId: null,
        roomId: "room-1",
        availabilityByTrack: {},
        activeMemberPeerIds: new Set(["peer-a"]),
        fallbackAnnouncement: fallbackAvailability
      })
    ).toEqual(fallbackAvailability);
    expect(
      resolveTrackAvailabilityManifestHint({
        currentTrackId: "track-1",
        roomId: "room-1",
        availabilityByTrack: {
          "track-1": {
            "peer-a": {
              roomId: "room-1",
              trackId: "track-1",
              ownerPeerId: "peer-a",
              nickname: "A",
              availableChunks: [0, 1],
              totalChunks: 4,
              chunkSize: 1024,
              source: "local_cache",
              announcedAt: "2026-01-01T00:00:01.000Z"
            },
            "peer-b": {
              roomId: "room-1",
              trackId: "track-1",
              ownerPeerId: "peer-b",
              nickname: "B",
              availableChunks: [0, 1, 2],
              totalChunks: 4,
              chunkSize: 1024,
              source: "local_cache",
              announcedAt: "2026-01-01T00:00:02.000Z"
            },
            "peer-c": {
              roomId: "room-2",
              trackId: "track-1",
              ownerPeerId: "peer-c",
              nickname: "C",
              availableChunks: [0, 1, 2, 3],
              totalChunks: 4,
              chunkSize: 1024,
              source: "local_cache",
              announcedAt: "2026-01-01T00:00:03.000Z"
            }
          }
        },
        activeMemberPeerIds: new Set(["peer-a", "peer-b"]),
        fallbackAnnouncement: fallbackAvailability
      })
    ).toEqual({
      roomId: "room-1",
      trackId: "track-1",
      ownerPeerId: "peer-b",
      nickname: "B",
      availableChunks: [0, 1, 2],
      totalChunks: 4,
      chunkSize: 1024,
      source: "local_cache",
      announcedAt: "2026-01-01T00:00:02.000Z"
    });
    expect(pipelinePrunePlaybackQualityTimestamps([60, 70, 90, 100], 100, 30)).toEqual([
      70,
      90,
      100
    ]);
    expect(
      pipelineAppendPlaybackQualityTimestamp({
        timestamps: [60, 80],
        timestampMs: 100,
        windowMs: 30
      })
    ).toEqual([80, 100]);
    expect(
      appendPlaybackQualityTimestamp({
        timestamps: [],
        timestampMs: 100,
        windowMs: 30
      })
    ).toEqual([100]);
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
      pipelineResolveLocalPlaybackPositionMs({
        activePlaybackSource: "progressive-local",
        currentTimeSeconds: 12.345
      })
    ).toBe(12345);
    expect(
      resolveLocalPlaybackPositionMs({
        activePlaybackSource: "full-local",
        currentTimeSeconds: 1.2345
      })
    ).toBe(1235);
    expect(
      pipelineResolveLocalPlaybackPositionMs({
        activePlaybackSource: "remote",
        currentTimeSeconds: 12.345
      })
    ).toBe(null);
    expect(
      resolveLocalPlaybackPositionMs({
        activePlaybackSource: "lossless-local",
        currentTimeSeconds: Number.NaN
      })
    ).toBe(null);
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
      pipelineResolveProgressiveDiagnosticBuckets({
        contiguousBufferedMs: 1_499,
        aheadBufferedMs: 2_501,
        estimatedFillTimeMs: 3_100,
        remainingPlaybackMs: 12_499,
        bufferSafetyMarginMs: 1_499
      })
    ).toEqual({
      contiguousBufferedMs: 1_000,
      aheadBufferedMs: 3_000,
      estimatedFillTimeMs: 4_000,
      remainingPlaybackMs: 10_000,
      bufferSafetyMarginMs: 1_000
    });
    expect(
      resolveProgressiveDiagnosticBuckets({
        contiguousBufferedMs: null,
        aheadBufferedMs: Number.NaN,
        estimatedFillTimeMs: undefined,
        remainingPlaybackMs: 0,
        bufferSafetyMarginMs: 499
      })
    ).toEqual({
      contiguousBufferedMs: "",
      aheadBufferedMs: "",
      estimatedFillTimeMs: "",
      remainingPlaybackMs: 0,
      bufferSafetyMarginMs: 0
    });
    expect(
      pipelineResolveFullLocalPlaybackMode({
        activeSource: "full-local",
        localAudioHasSrcObject: true,
        localAudioCurrentSrc: "blob:track"
      })
    ).toBe("pcm-engine");
    expect(
      resolveFullLocalPlaybackMode({
        activeSource: "full-local",
        localAudioHasSrcObject: false,
        localAudioCurrentSrc: "blob:track"
      })
    ).toBe("native-blob");
    expect(
      resolveFullLocalPlaybackMode({
        activeSource: "progressive-local",
        localAudioHasSrcObject: false,
        localAudioCurrentSrc: "blob:track"
      })
    ).toBe(null);
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
      pipelineResolveProgressiveLocalReadinessPreflight({
        ...baseProgressiveLocalBlockInput,
        hasManifest: false
      })
    ).toEqual({
      blockedReason: "progressive-engine-unavailable",
      shouldProbeTakeoverReady: false
    });
    expect(
      resolveProgressiveLocalReadinessPreflight({
        ...baseProgressiveLocalBlockInput,
        startupReady: true
      })
    ).toEqual({
      blockedReason: null,
      shouldProbeTakeoverReady: false
    });
    expect(
      resolveProgressiveLocalReadinessPreflight(baseProgressiveLocalBlockInput)
    ).toEqual({
      blockedReason: null,
      shouldProbeTakeoverReady: true
    });
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

  it("keeps immediate full-local recovery actions in the pure pipeline module", () => {
    expect(
      pipelineResolveImmediateFullLocalRecoveryAction({
        immediateFullLocalRecoveryEligible: true,
        activePlaybackSource: "progressive-local",
        hasBufferedFullLocalTrack: true
      })
    ).toEqual({
      nextSource: "full-local",
      clearFallbackReason: true
    });
    expect(
      resolveImmediateFullLocalRecoveryAction({
        immediateFullLocalRecoveryEligible: true,
        activePlaybackSource: "full-local",
        hasBufferedFullLocalTrack: true
      })
    ).toBe(null);
    expect(
      resolveImmediateFullLocalRecoveryAction({
        immediateFullLocalRecoveryEligible: true,
        activePlaybackSource: "lossless-local",
        hasBufferedFullLocalTrack: false
      })
    ).toBe(null);
  });

  it("keeps playback source transition actions in the pure pipeline module", () => {
    expect(pipelineResolveForceSourceOwnerLocalPlaybackAction(false)).toBe(null);
    expect(resolveForceSourceOwnerLocalPlaybackAction(true)).toEqual({
      nextSource: "full-local"
    });
    expect(pipelineResolveLocalTakeoverCooldownResetAction()).toEqual({
      nextCooldownUntilMs: 0
    });
    expect(
      resolveLocalTakeoverCooldownArmAction({
        nowMs: 1_000,
        cooldownMs: 2_500
      })
    ).toEqual({
      nextCooldownUntilMs: 3_500
    });
    expect(resolvePlaybackTimelineResetAction()).toEqual({
      nextProgressiveWarmupReadyAt: null,
      nextFullLocalWarmupReadyAt: null,
      nextWaitingEventTimestamps: [],
      nextStalledEventTimestamps: [],
      nextDriftSamples: [],
      nextContinuousPlaybackStartedAt: null,
      nextContinuousPlaybackSegments: [],
      nextPcmSlidingWindowPlayAttemptAt: null,
      shouldClearFallbackReason: true
    });
    expect(
      pipelineResolvePlaybackSourceTransitionAction({
        currentSource: "progressive-local",
        nextSource: "full-local",
        fallbackReason: "buffer-underrun",
        armCooldown: true
      })
    ).toEqual({
      shouldArmCooldown: true,
      fallbackReason: "buffer-underrun",
      shouldClearFallbackReason: false,
      shouldSetSource: true
    });
    expect(
      resolvePlaybackSourceTransitionAction({
        currentSource: "full-local",
        nextSource: "full-local",
        clearFallbackReason: true
      })
    ).toEqual({
      shouldArmCooldown: false,
      fallbackReason: undefined,
      shouldClearFallbackReason: true,
      shouldSetSource: false
    });
  });

  it("prefers local takeover only for explicit local fallback reasons", () => {
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: "buffer-underrun" })).toBe(true);
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: "stalled" })).toBe(true);
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: "seek-outside-buffer" })).toBe(true);
    expect(shouldPreferLocalTakeover({ progressiveFallbackReason: null })).toBe(false);
  });

  it("keeps playback start retry reporting policy in the pure pipeline module", () => {
    expect(pipelineResolvePlaybackStartFailureReason("full-local")).toBe(
      "full-local-play-blocked"
    );
    expect(resolvePlaybackStartFailureReason("lossless-local")).toBe(
      "lossless-local-play-blocked"
    );
    expect(resolvePlaybackStartFailureReason("progressive-local")).toBe(
      "progressive-local-play-blocked"
    );
    expect(
      pipelineShouldReportPlaybackStartFailure({
        pendingIntent: true,
        attempt: 0,
        maxRetryAttempts: 3
      })
    ).toBe(true);
    expect(
      shouldReportPlaybackStartFailure({
        pendingIntent: false,
        attempt: 2,
        maxRetryAttempts: 3
      })
    ).toBe(false);
    expect(
      shouldReportPlaybackStartFailure({
        pendingIntent: false,
        attempt: 3,
        maxRetryAttempts: 3
      })
    ).toBe(true);
    expect(pipelineResolvePlaybackStartRetryClearAction(true)).toBe(false);
    expect(resolvePlaybackStartRetryClearAction(false)).toBe(true);
    expect(
      pipelineResolvePlaybackStartRetryPreflight({
        playbackHasActiveIntent: false,
        activePlaybackSource: "progressive-local",
        requestedSource: "progressive-local",
        pendingIntent: true,
        attempt: 0,
        maxRetryAttempts: 3
      })
    ).toBe(null);
    expect(
      resolvePlaybackStartRetryPreflight({
        playbackHasActiveIntent: true,
        activePlaybackSource: "full-local",
        requestedSource: "progressive-local",
        pendingIntent: true,
        attempt: 0,
        maxRetryAttempts: 3
      })
    ).toBe(null);
    expect(
      resolvePlaybackStartRetryPreflight({
        playbackHasActiveIntent: true,
        activePlaybackSource: "progressive-local",
        requestedSource: "progressive-local",
        pendingIntent: false,
        attempt: 3,
        maxRetryAttempts: 3
      })
    ).toEqual({
      failureReason: "progressive-local-play-blocked",
      reportFailure: true
    });
    expect(
      pipelineResolvePlaybackStartRetryResult({
        playbackStarted: true,
        attempt: 0,
        maxRetryAttempts: 3
      })
    ).toEqual({
      shouldClearRetry: true,
      shouldScheduleRetry: false
    });
    expect(
      resolvePlaybackStartRetryResult({
        playbackStarted: false,
        attempt: 2,
        maxRetryAttempts: 3
      })
    ).toEqual({
      shouldClearRetry: false,
      shouldScheduleRetry: true
    });
    expect(
      resolvePlaybackStartRetryResult({
        playbackStarted: false,
        attempt: 3,
        maxRetryAttempts: 3
      })
    ).toEqual({
      shouldClearRetry: false,
      shouldScheduleRetry: false
    });
    expect(
      pipelineResolvePlaybackStartFailureMessage({
        intentMatchesPlayback: true,
        blockedMessage: "blocked"
      })
    ).toBe("当前点击未能激活音频，请再次点击播放");
    expect(
      resolvePlaybackStartFailureMessage({
        intentMatchesPlayback: false,
        blockedMessage: "blocked"
      })
    ).toBe("blocked");
    expect(
      pipelineResolvePlaybackStartFailureIntentAction({
        reportFailure: false,
        intentMatchesPlayback: true,
        blockedMessage: "blocked"
      })
    ).toEqual({
      shouldMarkFailure: false,
      statusMessage: null
    });
    expect(
      resolvePlaybackStartFailureIntentAction({
        reportFailure: true,
        intentMatchesPlayback: true,
        blockedMessage: "blocked"
      })
    ).toEqual({
      shouldMarkFailure: true,
      statusMessage: "当前点击未能激活音频，请再次点击播放"
    });
    expect(
      resolvePlaybackStartFailureIntentAction({
        reportFailure: true,
        intentMatchesPlayback: false,
        blockedMessage: "blocked"
      })
    ).toEqual({
      shouldMarkFailure: true,
      statusMessage: "blocked"
    });
    expect(
      pipelineResolvePlaybackStartIntentTimeoutPreflight({
        hasIntent: false,
        intentPending: true,
        expiresAtMs: 1_500,
        nowMs: 1_000
      })
    ).toBe(null);
    expect(
      resolvePlaybackStartIntentTimeoutPreflight({
        hasIntent: true,
        intentPending: false,
        expiresAtMs: 1_500,
        nowMs: 1_000
      })
    ).toBe(null);
    expect(
      resolvePlaybackStartIntentTimeoutPreflight({
        hasIntent: true,
        intentPending: true,
        expiresAtMs: 900,
        nowMs: 1_000
      })
    ).toEqual({ timeoutMs: 0 });
    expect(
      pipelineResolvePlaybackStartIntentTimeoutResult({
        hasCurrentIntent: false,
        currentIntentId: null,
        targetIntentId: "intent-1",
        currentIntentPending: true
      })
    ).toBe("keep");
    expect(
      resolvePlaybackStartIntentTimeoutResult({
        hasCurrentIntent: true,
        currentIntentId: "intent-2",
        targetIntentId: "intent-1",
        currentIntentPending: true
      })
    ).toBe("keep");
    expect(
      resolvePlaybackStartIntentTimeoutResult({
        hasCurrentIntent: true,
        currentIntentId: "intent-1",
        targetIntentId: "intent-1",
        currentIntentPending: false
      })
    ).toBe("keep");
    expect(
      resolvePlaybackStartIntentTimeoutResult({
        hasCurrentIntent: true,
        currentIntentId: "intent-1",
        targetIntentId: "intent-1",
        currentIntentPending: true
      })
    ).toBe("fail");
    expect(
      pipelineResolvePcmRuntimeFailureResetAction({
        hasLatchedFailure: true,
        latchedTrackId: "track-1",
        currentManifestTrackId: "track-2"
      })
    ).toBe(true);
    expect(
      resolvePcmRuntimeFailureResetAction({
        hasLatchedFailure: true,
        latchedTrackId: "track-1",
        currentManifestTrackId: "track-1"
      })
    ).toBe(false);
    expect(
      pipelineResolvePcmRuntimeFailureAction({
        currentManifestTrackId: null,
        reason: "engine-failed",
        shouldLatchFailure: true,
        activePlaybackSource: "lossless-local",
        canUseFullLocalForPlaybackSession: false
      })
    ).toBe(null);
    expect(
      resolvePcmRuntimeFailureAction({
        currentManifestTrackId: "track-1",
        reason: "engine-opening",
        shouldLatchFailure: false,
        activePlaybackSource: "lossless-local",
        canUseFullLocalForPlaybackSession: false
      })
    ).toBe(null);
    expect(
      resolvePcmRuntimeFailureAction({
        currentManifestTrackId: "track-1",
        reason: "engine-failed",
        shouldLatchFailure: true,
        activePlaybackSource: "lossless-local",
        canUseFullLocalForPlaybackSession: false
      })
    ).toEqual({
      latchedFailure: {
        trackId: "track-1",
        reason: "engine-failed"
      },
      shouldDestroyPcmEngine: true,
      fallbackReason: "progressive-init-failed",
      nextSource: "progressive-local"
    });
    expect(
      resolvePcmRuntimeFailureAction({
        currentManifestTrackId: "track-1",
        reason: "decoder-unavailable",
        shouldLatchFailure: true,
        activePlaybackSource: "progressive-local",
        canUseFullLocalForPlaybackSession: true
      })?.nextSource
    ).toBe("full-local");
  });

  it("keeps listener media connection state policy in the pure pipeline module", () => {
    expect(
      pipelineResolveListenerMediaConnectionState({
        currentTrackId: null,
        isCurrentSourceOwner: false,
        playbackHasActiveIntent: true,
        localPlaybackReady: true
      })
    ).toBe("idle");
    expect(
      resolveListenerMediaConnectionState({
        currentTrackId: "track-1",
        isCurrentSourceOwner: true,
        playbackHasActiveIntent: true,
        localPlaybackReady: true
      })
    ).toBe(null);
    expect(
      resolveListenerMediaConnectionState({
        currentTrackId: "track-1",
        isCurrentSourceOwner: false,
        playbackHasActiveIntent: false,
        localPlaybackReady: true
      })
    ).toBe("idle");
    expect(
      resolveListenerMediaConnectionState({
        currentTrackId: "track-1",
        isCurrentSourceOwner: false,
        playbackHasActiveIntent: true,
        localPlaybackReady: true
      })
    ).toBe("live");
    expect(
      pipelineResolveListenerMediaConnectionState({
        currentTrackId: "track-1",
        isCurrentSourceOwner: false,
        playbackHasActiveIntent: true,
        localPlaybackReady: false
      })
    ).toBe("buffering");
  });

  it("keeps local playback readiness in the pure pipeline module", () => {
    expect(
      pipelineResolveLocalPlaybackReady({
        hasAudio: false,
        localAudioPaused: false,
        localAudioReadyState: 4,
        localAudioHasSrcObject: false,
        localAudioHasCurrentSrc: true
      })
    ).toBe(false);
    expect(
      resolveLocalPlaybackReady({
        hasAudio: true,
        localAudioPaused: true,
        localAudioReadyState: 4,
        localAudioHasSrcObject: true,
        localAudioHasCurrentSrc: false
      })
    ).toBe(false);
    expect(
      resolveLocalPlaybackReady({
        hasAudio: true,
        localAudioPaused: false,
        localAudioReadyState: 1,
        localAudioHasSrcObject: true,
        localAudioHasCurrentSrc: false
      })
    ).toBe(true);
    expect(
      pipelineResolveLocalPlaybackReady({
        hasAudio: true,
        localAudioPaused: false,
        localAudioReadyState: 2,
        localAudioHasSrcObject: false,
        localAudioHasCurrentSrc: false
      })
    ).toBe(true);
  });

  it("keeps local audio event media state policy in the pure pipeline module", () => {
    expect(
      pipelineResolvePlayingPlaybackEventAction({
        role: "inactive",
        currentMediaConnectionState: "buffering",
        currentTrackId: "track-1",
        nowIso: "2026-07-05T00:00:00.000Z"
      })
    ).toBe(null);
    expect(
      resolvePlayingPlaybackEventAction({
        role: "audible-local",
        currentMediaConnectionState: "buffering",
        currentTrackId: "track-1",
        nowIso: "2026-07-05T00:00:00.000Z"
      })
    ).toEqual({
      schedulerMode: "normal",
      bufferHealth: "healthy",
      shouldMarkContinuousPlaybackStarted: true,
      nextStablePlaybackAt: "2026-07-05T00:00:00.000Z",
      mediaConnectionState: "live"
    });
    expect(
      pipelineResolvePlayingMediaConnectionState({
        currentState: "idle",
        currentTrackId: null
      })
    ).toBe("idle");
    expect(
      resolvePlayingMediaConnectionState({
        currentState: "buffering",
        currentTrackId: "track-1"
      })
    ).toBe("live");
    expect(pipelineResolveBufferingMediaConnectionState("failed")).toBe("failed");
    expect(resolveBufferingMediaConnectionState("live")).toBe("buffering");
    expect(pipelineResolveInactivePlaybackSchedulerMode(true)).toBe("normal");
    expect(resolveInactivePlaybackSchedulerMode(false)).toBe("idle");
    expect(
      pipelineResolveInactivePlaybackSchedulerAction({
        currentTrackId: null,
        playbackStatus: "playing",
        isPageVisible: true
      })
    ).toEqual({ schedulerMode: "normal" });
    expect(
      resolveInactivePlaybackSchedulerAction({
        currentTrackId: "track-1",
        playbackStatus: "paused",
        isPageVisible: false
      })
    ).toEqual({ schedulerMode: "idle" });
    expect(
      resolveInactivePlaybackSchedulerAction({
        currentTrackId: "track-1",
        playbackStatus: "playing",
        isPageVisible: true
      })
    ).toBe(null);
    expect(pipelineResolvePlaybackSurfaceResetMediaConnectionState(true)).toBe("buffering");
    expect(resolvePlaybackSurfaceResetMediaConnectionState(false)).toBe("idle");
    expect(
      pipelineResolvePlaybackSurfaceResetAction({
        previousPlaybackSurfaceKey: null,
        nextPlaybackSurfaceKey: "track-1|1",
        hasAudio: true,
        playbackHasActiveIntent: true
      })
    ).toBe(null);
    expect(
      resolvePlaybackSurfaceResetAction({
        previousPlaybackSurfaceKey: "track-1|1",
        nextPlaybackSurfaceKey: "track-2|1",
        hasAudio: true,
        playbackHasActiveIntent: true
      })
    ).toEqual({
      shouldDestroyRuntime: true,
      shouldClearPcmLastBlockedReason: true,
      shouldResetAudioElement: true,
      mediaConnectionState: "buffering"
    });
    expect(
      resolvePlaybackSurfaceResetAction({
        previousPlaybackSurfaceKey: "track-1|1",
        nextPlaybackSurfaceKey: "track-2|1",
        hasAudio: false,
        playbackHasActiveIntent: false
      })
    ).toEqual({
      shouldDestroyRuntime: true,
      shouldClearPcmLastBlockedReason: true,
      shouldResetAudioElement: false,
      mediaConnectionState: null
    });
  });

  it("keeps local-ready playback action policy in the pure pipeline module", () => {
    expect(
      pipelineResolveLocalReadyPlaybackAction({
        activePlaybackSource: "progressive-local",
        playbackHasActiveIntent: true,
        localAudioPaused: true
      })
    ).toEqual({
      shouldEnsurePlaybackStart: true,
      shouldAttemptFullLocalPlayback: false
    });
    expect(
      resolveLocalReadyPlaybackAction({
        activePlaybackSource: "full-local",
        playbackHasActiveIntent: true,
        localAudioPaused: true
      })
    ).toEqual({
      shouldEnsurePlaybackStart: true,
      shouldAttemptFullLocalPlayback: true
    });
    expect(
      resolveLocalReadyPlaybackAction({
        activePlaybackSource: "full-local",
        playbackHasActiveIntent: true,
        localAudioPaused: false
      })
    ).toEqual({
      shouldEnsurePlaybackStart: true,
      shouldAttemptFullLocalPlayback: false
    });
    expect(pipelineResolveFullLocalReadyPlaybackResult(true)).toEqual({
      mediaConnectionState: "live",
      diagnosticEvent: "full-local-ready-played",
      diagnosticSummary: "本地完整缓存 ready 后已启动播放",
      recordEvent: false
    });
    expect(resolveFullLocalReadyPlaybackResult(false)).toEqual({
      mediaConnectionState: "buffering",
      diagnosticEvent: "full-local-ready-play-failed",
      diagnosticSummary: "本地完整缓存 ready 后播放启动失败",
      recordEvent: true
    });
  });

  it("keeps progressive engine attach fallback policy in the pure pipeline module", () => {
    expect(
      pipelineResolveProgressiveEngineSetupPreflight({
        hasAudio: false,
        canPrepareProgressiveLocal: true,
        hasManifest: true
      })
    ).toBe("skip");
    expect(
      resolveProgressiveEngineSetupPreflight({
        hasAudio: true,
        canPrepareProgressiveLocal: false,
        hasManifest: true
      })
    ).toBe("destroy-existing");
    expect(
      resolveProgressiveEngineSetupPreflight({
        hasAudio: true,
        canPrepareProgressiveLocal: true,
        hasManifest: false
      })
    ).toBe("destroy-existing");
    expect(
      pipelineResolveProgressiveEngineSetupPreflight({
        hasAudio: true,
        canPrepareProgressiveLocal: true,
        hasManifest: true
      })
    ).toBe("create");
    expect(
      pipelineResolveProgressiveEngineAttachResultAction({
        isCurrentEngine: false,
        attached: false,
        isPcmEngine: true
      })
    ).toBe(null);
    expect(
      resolveProgressiveEngineAttachResultAction({
        isCurrentEngine: true,
        attached: false,
        isPcmEngine: true
      })
    ).toEqual({
      kind: "failure",
      failureAction: "pcm-runtime-failure"
    });
    expect(
      resolveProgressiveEngineAttachResultAction({
        isCurrentEngine: true,
        attached: false,
        isPcmEngine: false
      })
    ).toEqual({
      kind: "failure",
      failureAction: "progressive-init-failed"
    });
    expect(
      resolveProgressiveEngineAttachResultAction({
        isCurrentEngine: true,
        attached: true,
        isPcmEngine: true
      })
    ).toEqual({
      kind: "attached",
      shouldSyncEngine: true
    });
    expect(
      pipelineResolveProgressiveEngineAttachErrorAction({
        isCurrentEngine: false,
        isPcmEngine: true
      })
    ).toBe(null);
    expect(
      resolveProgressiveEngineAttachErrorAction({
        isCurrentEngine: true,
        isPcmEngine: false
      })
    ).toEqual({
      kind: "failure",
      failureAction: "progressive-init-failed"
    });
    expect(pipelineResolveProgressiveEngineAttachFailureAction(true)).toBe(
      "pcm-runtime-failure"
    );
    expect(resolveProgressiveEngineAttachFailureAction(false)).toBe(
      "progressive-init-failed"
    );
    expect(
      pipelineResolveProgressiveEngineAttachSuccessFallbackReason("progressive-init-failed")
    ).toBe(null);
    expect(resolveProgressiveEngineAttachSuccessFallbackReason("buffer-underrun")).toBe(
      "buffer-underrun"
    );
  });

  it("keeps local audio fallback event policy in the pure pipeline module", () => {
    expect(
      pipelineResolveWaitingPlaybackEventAction({
        role: "inactive",
        activePlaybackSource: "progressive-local",
        aheadBufferedMs: 0,
        criticalBufferThresholdMs: 30
      })
    ).toBe(null);
    expect(
      resolveWaitingPlaybackEventAction({
        role: "audible-local",
        activePlaybackSource: "progressive-local",
        aheadBufferedMs: 10,
        criticalBufferThresholdMs: 30
      })
    ).toEqual({
      shouldMarkContinuousPlaybackInterrupted: true,
      qualityEvent: "waiting",
      schedulerMode: "conservative",
      bufferHealth: "low",
      fallbackReason: "buffer-underrun",
      mediaConnectionState: "buffering"
    });
    expect(
      pipelineResolveStalledPlaybackEventAction("inactive")
    ).toBe(null);
    expect(
      resolveStalledPlaybackEventAction("audible-local")
    ).toEqual({
      shouldMarkContinuousPlaybackInterrupted: true,
      qualityEvent: "stalled",
      schedulerMode: "conservative",
      bufferHealth: "critical",
      fallbackReason: "stalled",
      mediaConnectionState: "buffering"
    });
    expect(
      pipelineResolveWaitingFallbackReason({
        role: "audible-local",
        activePlaybackSource: "progressive-local",
        aheadBufferedMs: 10,
        criticalBufferThresholdMs: 30
      })
    ).toBe("buffer-underrun");
    expect(
      resolveWaitingFallbackReason({
        role: "audible-local",
        activePlaybackSource: "full-local",
        aheadBufferedMs: 20,
        criticalBufferThresholdMs: 30
      })
    ).toBe(null);
    expect(
      resolveWaitingFallbackReason({
        role: "inactive",
        activePlaybackSource: "lossless-local",
        aheadBufferedMs: 0,
        criticalBufferThresholdMs: 30
      })
    ).toBe(null);
    expect(pipelineResolveStalledFallbackReason("audible-local")).toBe("stalled");
    expect(resolveStalledFallbackReason("inactive")).toBe(null);
  });

  it("keeps pause and seek recovery policy in the pure pipeline module", () => {
    expect(
      pipelineResolvePausedPlaybackEventAction({
        role: "inactive",
        playbackHasActiveIntent: false,
        isPageVisible: true,
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing"
      })
    ).toBe(null);
    expect(
      resolvePausedPlaybackEventAction({
        role: "audible-local",
        playbackHasActiveIntent: false,
        isPageVisible: false,
        activePlaybackSource: "lossless-local",
        playbackStatus: "paused"
      })
    ).toEqual({
      shouldMarkContinuousPlaybackInterrupted: true,
      diagnosticEvent: "local-audio-pause",
      diagnosticSummary:
        "本地音频暂停 role=audible-local source=lossless-local status=paused",
      recordEvent: false,
      schedulerMode: "idle",
      bufferHealth: "healthy"
    });
    expect(
      pipelineResolvePausedPlaybackRecoveryState({
        playbackHasActiveIntent: true,
        isPageVisible: true
      })
    ).toBe(null);
    expect(
      resolvePausedPlaybackRecoveryState({
        playbackHasActiveIntent: false,
        isPageVisible: true
      })
    ).toEqual({
      schedulerMode: "normal",
      bufferHealth: "healthy"
    });
    expect(
      resolvePausedPlaybackRecoveryState({
        playbackHasActiveIntent: false,
        isPageVisible: false
      })
    ).toEqual({
      schedulerMode: "idle",
        bufferHealth: "healthy"
      });
    expect(
      pipelineResolveSeekedPlaybackEventAction({
        hasAudio: false,
        activePlaybackSource: "progressive-local",
        hasProgressiveManifest: true,
        soughtPositionMs: 5_000,
        contiguousBufferedMs: 4_999
      })
    ).toBe(null);
    expect(
      resolveSeekedPlaybackEventAction({
        hasAudio: true,
        activePlaybackSource: "progressive-local",
        hasProgressiveManifest: true,
        soughtPositionMs: 5_000,
        contiguousBufferedMs: 4_999
      })
    ).toEqual({
      schedulerMode: "conservative",
      bufferHealth: "critical",
      fallbackReason: "seek-outside-buffer"
    });
    expect(
      pipelineResolveSeekedPlaybackPolicy({
        activePlaybackSource: "progressive-local",
        hasProgressiveManifest: true,
        soughtPositionMs: 5_000,
        contiguousBufferedMs: 4_999
      })
    ).toEqual({
      schedulerMode: "conservative",
      bufferHealth: "critical",
      fallbackReason: "seek-outside-buffer"
    });
    expect(
      resolveSeekedPlaybackPolicy({
        activePlaybackSource: "full-local",
        hasProgressiveManifest: true,
        soughtPositionMs: 5_000,
        contiguousBufferedMs: 4_000
      })
    ).toBe(null);
    expect(
      resolveSeekedPlaybackPolicy({
        activePlaybackSource: "lossless-local",
        hasProgressiveManifest: false,
        soughtPositionMs: 5_000,
        contiguousBufferedMs: 4_000
      })
    ).toBe(null);
  });

  it("keeps sliding-window low-buffer fallback policy in the pure pipeline module", () => {
    expect(
      pipelineResolveSlidingWindowLowBufferFallbackReason({
        activePlaybackSource: "progressive-local",
        playbackHasActiveIntent: true,
        startupReady: true,
        aheadBufferedMs: 29,
        criticalBufferThresholdMs: 30
      })
    ).toBe("seek-outside-buffer");
    expect(
      resolveSlidingWindowLowBufferFallbackReason({
        activePlaybackSource: "lossless-local",
        playbackHasActiveIntent: true,
        startupReady: true,
        aheadBufferedMs: 30,
        criticalBufferThresholdMs: 30
      })
    ).toBe(null);
    expect(
      resolveSlidingWindowLowBufferFallbackReason({
        activePlaybackSource: "full-local",
        playbackHasActiveIntent: true,
        startupReady: true,
        aheadBufferedMs: 0,
        criticalBufferThresholdMs: 30
      })
    ).toBe(null);
  });

  it("keeps main playback source selection policy in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalPlaybackSelection({
        activePlaybackSource: "full-local",
        forceSourceOwnerLocalPlayback: false,
        sourceOwnerHasLocalTrack: false,
        hasUploadedTrack: true
      })
    ).toBe(true);
    expect(
      resolveFullLocalPlaybackSelection({
        activePlaybackSource: "progressive-local",
        forceSourceOwnerLocalPlayback: true,
        sourceOwnerHasLocalTrack: false,
        hasUploadedTrack: true
      })
    ).toBe(true);
    expect(
      resolveFullLocalPlaybackSelection({
        activePlaybackSource: "lossless-local",
        forceSourceOwnerLocalPlayback: false,
        sourceOwnerHasLocalTrack: true,
        hasUploadedTrack: true
      })
    ).toBe(true);
    expect(
      resolveFullLocalPlaybackSelection({
        activePlaybackSource: "progressive-local",
        forceSourceOwnerLocalPlayback: true,
        sourceOwnerHasLocalTrack: false,
        hasUploadedTrack: false
      })
    ).toBe(false);
    expect(
      pipelineResolveFullLocalAudioSourceAction({
        hasSrcObject: true,
        currentSrc: "blob:track",
        nextSrc: "blob:track"
      })
    ).toEqual({
      shouldClearSrcObject: true,
      shouldAssignSource: true,
      shouldLoadSource: true
    });
    expect(
      resolveFullLocalAudioSourceAction({
        hasSrcObject: false,
        currentSrc: "blob:track",
        nextSrc: "blob:track"
      })
    ).toEqual({
      shouldClearSrcObject: false,
      shouldAssignSource: false,
      shouldLoadSource: false
    });
    expect(
      resolveFullLocalPlaybackActivationAction({
        shouldPlayPlayback: false,
        activePlaybackSource: "progressive-local"
      })
    ).toBe(null);
    expect(
      pipelineResolveFullLocalPlaybackActivationAction({
        shouldPlayPlayback: true,
        activePlaybackSource: "progressive-local"
      })
    ).toEqual({
      shouldSetSourceToFullLocal: true,
      shouldClearFallbackReason: true,
      shouldAttemptPlaybackStart: true
    });
    expect(
      resolveFullLocalPlaybackActivationAction({
        shouldPlayPlayback: true,
        activePlaybackSource: "full-local"
      })
    ).toEqual({
      shouldSetSourceToFullLocal: false,
      shouldClearFallbackReason: false,
      shouldAttemptPlaybackStart: true
    });
    expect(pipelineResolveFullLocalPausedPlaybackAction("playing")).toBe(null);
    expect(resolveFullLocalPausedPlaybackAction("paused")).toEqual({
      shouldPausePlayback: true,
      shouldResetPlaybackRate: true,
      mediaConnectionState: "idle"
    });
    expect(
      pipelineResolveMainPlaybackPreflight({
        hasAudio: false,
        currentTrackId: "track-1"
      })
    ).toBe("skip");
    expect(
      resolveMainPlaybackPreflight({
        hasAudio: true,
        currentTrackId: null
      })
    ).toBe("reset-idle");
    expect(
      resolveMainPlaybackPreflight({
        hasAudio: true,
        currentTrackId: "track-1"
      })
    ).toBe("run");
    expect(pipelineResolveMainPlaybackResetIdleAction("skip")).toBe(null);
    expect(resolveMainPlaybackResetIdleAction("run")).toBe(null);
    expect(resolveMainPlaybackResetIdleAction("reset-idle")).toEqual({
      shouldDestroyRuntime: true,
      shouldPauseAudio: true,
      shouldClearAudioSource: true,
      shouldClearPlaybackStartIntent: true,
      mediaConnectionState: "idle"
    });
    expect(pipelineResolvePlaybackStartMediaConnectionState(true)).toBe("live");
    expect(resolvePlaybackStartMediaConnectionState(false)).toBe("buffering");
    expect(resolveMainPausedPlaybackAction("playing")).toBe(null);
    expect(pipelineResolveMainPausedPlaybackAction("paused")).toEqual({
      shouldPausePlayback: true,
      shouldResetPlaybackRate: true
    });
  });

  it("keeps PCM sync playback outcomes in the pure pipeline module", () => {
    expect(
      pipelineResolvePcmSyncPlaybackOutcome({
        shouldPlayPlayback: true,
        localReady: false,
        shouldLatchFailure: true
      })
    ).toEqual({
      mediaConnectionState: "buffering",
      playbackStartFailureKind: "init-failed"
    });
    expect(
      resolvePcmSyncPlaybackOutcome({
        shouldPlayPlayback: true,
        localReady: false,
        shouldLatchFailure: false
      })
    ).toEqual({
      progressiveFallbackReason: "buffer-underrun",
      mediaConnectionState: "buffering",
      playbackStartFailureKind: "buffer-underrun"
    });
    expect(
      resolvePcmSyncPlaybackOutcome({
        shouldPlayPlayback: true,
        localReady: true,
        shouldLatchFailure: false
      })
    ).toEqual({
      progressiveFallbackReason: null,
      mediaConnectionState: "live",
      shouldEnsurePlaybackStart: true
    });
    expect(
      resolvePcmSyncPlaybackOutcome({
        shouldPlayPlayback: false,
        localReady: false,
        shouldLatchFailure: false
      })
    ).toBe(null);
  });

  it("keeps native sliding-window sync outcomes in the pure pipeline module", () => {
    expect(
      pipelineResolveSlidingWindowNativeSyncOutcome({
        shouldPlayPlayback: true,
        localReady: false
      })
    ).toEqual({
      mediaConnectionState: "buffering",
      playbackStartFailureKind: "buffer-underrun"
    });
    expect(
      resolveSlidingWindowNativeSyncOutcome({
        shouldPlayPlayback: true,
        localReady: true
      })
    ).toEqual({
      progressiveFallbackReason: null,
      mediaConnectionState: "live",
      shouldEnsurePlaybackStart: true
    });
    expect(
      resolveSlidingWindowNativeSyncOutcome({
        shouldPlayPlayback: false,
        localReady: true
      })
    ).toEqual({
      shouldPausePlayback: true
    });
    expect(
      pipelineResolveSlidingWindowFallbackPlaybackAction({
        shouldPlayPlayback: true,
        startupReady: true
      })
    ).toEqual({
      shouldClearFallbackReason: true,
      shouldEnsurePlaybackStart: true,
      shouldPausePlayback: false
    });
    expect(
      resolveSlidingWindowFallbackPlaybackAction({
        shouldPlayPlayback: true,
        startupReady: false
      })
    ).toEqual({
      shouldClearFallbackReason: false,
      shouldEnsurePlaybackStart: true,
      shouldPausePlayback: false
    });
    expect(
      resolveSlidingWindowFallbackPlaybackAction({
        shouldPlayPlayback: false,
        startupReady: true
      })
    ).toEqual({
      shouldClearFallbackReason: false,
      shouldEnsurePlaybackStart: false,
      shouldPausePlayback: true
    });
  });

  it("keeps progressive warmup PCM sync mode in the pure pipeline module", () => {
    expect(pipelineResolveWarmupPcmSyncMode("progressive-local")).toBe("snapshot-only");
    expect(resolveWarmupPcmSyncMode("lossless-local")).toBe("snapshot-only");
    expect(resolveWarmupPcmSyncMode("full-local")).toBe("sync-playback");
    expect(
      pipelineResolveWarmupPcmAudioStartAction({
        hasSyncResult: false,
        shouldStartAudioElement: true,
        nowMs: 1_000
      })
    ).toBe(null);
    expect(
      resolveWarmupPcmAudioStartAction({
        hasSyncResult: true,
        shouldStartAudioElement: false,
        nowMs: 1_000
      })
    ).toBe(null);
    expect(
      resolveWarmupPcmAudioStartAction({
        hasSyncResult: true,
        shouldStartAudioElement: true,
        nowMs: 1_000
      })
    ).toEqual({
      lastAttemptAtMs: 1_000,
      shouldAttemptPlaybackStart: true
    });
    expect(
      pipelineResolveWarmupPcmAudioStartResultAction({
        cancelled: true,
        playbackStarted: true
      })
    ).toBe(null);
    expect(
      resolveWarmupPcmAudioStartResultAction({
        cancelled: false,
        playbackStarted: false
      })
    ).toBe(null);
    expect(
      resolveWarmupPcmAudioStartResultAction({
        cancelled: false,
        playbackStarted: true
      })
    ).toEqual({
      shouldClearFallbackReason: true,
      mediaConnectionState: "live"
    });
    expect(
      pipelineResolveWarmupMseCatchupAction({
        localReady: false,
        activePlaybackSource: "progressive-local",
        shadowWarmupReady: true
      })
    ).toEqual({
      shouldCatchup: false,
      shouldMuteAudio: null,
      shouldPlayElement: false
    });
    expect(
      resolveWarmupMseCatchupAction({
        localReady: true,
        activePlaybackSource: "full-local",
        shadowWarmupReady: true
      })
    ).toEqual({
      shouldCatchup: true,
      shouldMuteAudio: true,
      shouldPlayElement: true
    });
    expect(
      resolveWarmupMseCatchupAction({
        localReady: true,
        activePlaybackSource: "lossless-local",
        shadowWarmupReady: false
      })
    ).toEqual({
      shouldCatchup: true,
      shouldMuteAudio: false,
      shouldPlayElement: true
    });
  });

  it("keeps progressive warmup preflight policy in the pure pipeline module", () => {
    expect(
      pipelineResolveWarmupPreflight({
        currentTrackId: "track-1",
        hasAudio: true,
        hasProgressiveEngine: true,
        hasManifest: true,
        activePlaybackSource: "progressive-local"
      })
    ).toEqual({
      shouldRun: true,
      shouldResetWarmupReadyAt: false
    });
    expect(
      resolveWarmupPreflight({
        currentTrackId: null,
        hasAudio: true,
        hasProgressiveEngine: true,
        hasManifest: true,
        activePlaybackSource: "progressive-local"
      })
    ).toEqual({
      shouldRun: false,
      shouldResetWarmupReadyAt: true
    });
    expect(
      resolveWarmupPreflight({
        currentTrackId: "track-1",
        hasAudio: true,
        hasProgressiveEngine: true,
        hasManifest: true,
        activePlaybackSource: "full-local"
      })
    ).toEqual({
      shouldRun: false,
      shouldResetWarmupReadyAt: true
    });
  });

  it("keeps progressive warmup unavailable action in the pure pipeline module", () => {
    expect(
      pipelineResolveWarmupUnavailableAction({
        engineType: "mse",
        engineReady: false,
        localReady: false,
        hasPcmEngine: true
      })
    ).toEqual({
      shouldRunSecondaryPcmSync: true,
      shouldPauseAudio: false
    });
    expect(
      resolveWarmupUnavailableAction({
        engineType: "pcm",
        engineReady: false,
        localReady: false,
        hasPcmEngine: false
      })
    ).toEqual({
      shouldRunSecondaryPcmSync: false,
      shouldPauseAudio: true
    });
    expect(
      resolveWarmupUnavailableAction({
        engineType: "pcm",
        engineReady: false,
        localReady: false,
        hasPcmEngine: true
      })
    ).toEqual({
      shouldRunSecondaryPcmSync: false,
      shouldPauseAudio: false
    });
    expect(
      resolveWarmupUnavailableAction({
        engineType: "mse",
        engineReady: true,
        localReady: true,
        hasPcmEngine: false
      })
    ).toBe(null);
  });

  it("keeps progressive warmup hold state in the pure pipeline module", () => {
    expect(
      pipelineResolveWarmupHoldState({
        directProgressiveTakeoverEnabled: false,
        localTakeoverAllowed: true,
        shouldAttemptTakeover: true,
        shadowWarmupReady: true,
        localReady: true,
        progressiveFallbackReason: "buffer-underrun",
        playbackRecoveryStage: "steady",
        nowMs: 1_000
      })
    ).toEqual({
      shouldHold: true,
      nextWarmupReadyAt: 1_000,
      shouldClearFallbackReason: true
    });
    expect(
      resolveWarmupHoldState({
        directProgressiveTakeoverEnabled: true,
        localTakeoverAllowed: false,
        shouldAttemptTakeover: true,
        shadowWarmupReady: true,
        localReady: true,
        progressiveFallbackReason: "buffer-underrun",
        playbackRecoveryStage: "degraded",
        nowMs: 1_000
      })
    ).toEqual({
      shouldHold: true,
      nextWarmupReadyAt: 1_000,
      shouldClearFallbackReason: false
    });
    expect(
      resolveWarmupHoldState({
        directProgressiveTakeoverEnabled: true,
        localTakeoverAllowed: true,
        shouldAttemptTakeover: true,
        shadowWarmupReady: true,
        localReady: true,
        progressiveFallbackReason: null,
        playbackRecoveryStage: "steady",
        nowMs: 1_000
      })
    ).toEqual({
      shouldHold: false,
      nextWarmupReadyAt: null,
      shouldClearFallbackReason: false
    });
  });

  it("keeps inactive warmup cleanup policy in the pure pipeline module", () => {
    expect(
      pipelineResolveWarmupInactivePlaybackAction({
        playbackHasActiveIntent: true,
        hasPcmEngine: true
      })
    ).toBe(null);
    expect(
      resolveWarmupInactivePlaybackAction({
        playbackHasActiveIntent: false,
        hasPcmEngine: true
      })
    ).toEqual({
      shouldSyncPcmPlayback: true,
      shouldPauseAudio: true,
      shouldResetWarmupReadyAt: true
    });
    expect(
      resolveWarmupInactivePlaybackAction({
        playbackHasActiveIntent: false,
        hasPcmEngine: false
      })
    ).toEqual({
      shouldSyncPcmPlayback: false,
      shouldPauseAudio: true,
      shouldResetWarmupReadyAt: true
    });
  });

  it("keeps full-local upgrade preflight policy in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalUpgradePreflight({
        currentTrackId: "track-1",
        hasPlaybackState: true,
        hasBufferedFullLocalObjectUrl: true,
        canWarmBufferedFullLocal: true,
        activePlaybackSource: "progressive-local",
        playbackHasActiveIntent: true
      })
    ).toEqual({
      shouldRun: true,
      shouldResetWarmupReadyAt: false
    });
    expect(
      resolveFullLocalUpgradePreflight({
        currentTrackId: "track-1",
        hasPlaybackState: true,
        hasBufferedFullLocalObjectUrl: true,
        canWarmBufferedFullLocal: true,
        activePlaybackSource: "full-local",
        playbackHasActiveIntent: true
      })
    ).toEqual({
      shouldRun: false,
      shouldResetWarmupReadyAt: true
    });
    expect(
      resolveFullLocalUpgradePreflight({
        currentTrackId: "track-1",
        hasPlaybackState: true,
        hasBufferedFullLocalObjectUrl: true,
        canWarmBufferedFullLocal: true,
        activePlaybackSource: "lossless-local",
        playbackHasActiveIntent: false
      })
    ).toEqual({
      shouldRun: false,
      shouldResetWarmupReadyAt: true
    });
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
      pipelineResolveSchedulerBufferHealth({
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 1
      })
    ).toBe("critical");
    expect(
      resolveSchedulerBufferHealth({
        waitingEventsLast30s: 1,
        stalledEventsLast30s: 0
      })
    ).toBe("low");
    expect(
      resolveSchedulerBufferHealth({
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0
      })
    ).toBe("healthy");
    expect(
      resolveSchedulerBudgetTier({
        bufferHealth: "low",
        activePlaybackSource: "progressive-local",
        playbackRecoveryStage: "degraded"
      })
    ).toBe("protected");
  });

  it("keeps full-local eligibility in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalEligibility({
        fullLocalReady: true,
        fullLocalBlockedReason: null
      })
    ).toBe(true);
    expect(
      resolveFullLocalEligibility({
        fullLocalReady: true,
        fullLocalBlockedReason: "listener-takeover-disabled"
      })
    ).toBe(false);
    expect(
      resolveFullLocalEligibility({
        fullLocalReady: false,
        fullLocalBlockedReason: null
      })
    ).toBe(false);
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

  it("keeps drift sampling observed position policy in the pure pipeline module", () => {
    expect(
      pipelineResolveDriftSamplingPreflight({
        currentTrackId: null,
        hasPlaybackState: true,
        playbackHasActiveIntent: true
      })
    ).toBe(false);
    expect(
      resolveDriftSamplingPreflight({
        currentTrackId: "track-1",
        hasPlaybackState: false,
        playbackHasActiveIntent: true
      })
    ).toBe(false);
    expect(
      resolveDriftSamplingPreflight({
        currentTrackId: "track-1",
        hasPlaybackState: true,
        playbackHasActiveIntent: false
      })
    ).toBe(false);
    expect(
      pipelineResolveDriftSamplingPreflight({
        currentTrackId: "track-1",
        hasPlaybackState: true,
        playbackHasActiveIntent: true
      })
    ).toBe(true);
    expect(
      pipelineResolveObservedPlaybackSeconds({
        activePlaybackSource: "lossless-local",
        localPlaybackPositionMs: 12_340,
        audioCurrentTimeSeconds: 4,
        audioPaused: false
      })
    ).toBe(12.34);
    expect(
      resolveObservedPlaybackSeconds({
        activePlaybackSource: "progressive-local",
        localPlaybackPositionMs: null,
        audioCurrentTimeSeconds: 4.25,
        audioPaused: false
      })
    ).toBe(4.25);
    expect(
      resolveObservedPlaybackSeconds({
        activePlaybackSource: "remote",
        localPlaybackPositionMs: 12_340,
        audioCurrentTimeSeconds: 8.5,
        audioPaused: false
      })
    ).toBe(8.5);
    expect(
      pipelineResolveObservedPlaybackSeconds({
        activePlaybackSource: "remote",
        localPlaybackPositionMs: null,
        audioCurrentTimeSeconds: 8.5,
        audioPaused: true
      })
    ).toBe(null);
    expect(
      resolveObservedPlaybackSeconds({
        activePlaybackSource: "progressive-local",
        localPlaybackPositionMs: null,
        audioCurrentTimeSeconds: Number.NaN,
        audioPaused: false
      })
    ).toBe(null);
    expect(
      pipelineResolveDriftSampleAction({
        expectedSeconds: 12.5,
        observedSeconds: null
      })
    ).toBe(null);
    expect(
      resolveDriftSampleAction({
        expectedSeconds: 12.5,
        observedSeconds: 12
      })
    ).toEqual({ driftMs: 500 });
  });

  it("keeps progressive warmup takeover blocked reason in the pure pipeline module", () => {
    expect(
      pipelineResolveWarmupTakeoverBlockedReason({
        shouldAttemptTakeover: true,
        progressiveLocalBlockedReason: "buffer-underrun"
      })
    ).toBe(null);
    expect(
      resolveWarmupTakeoverBlockedReason({
        shouldAttemptTakeover: false,
        progressiveLocalBlockedReason: "local-prefix-not-ready"
      })
    ).toBe("local-prefix-not-ready");
  });

  it("keeps continuous playback start state transitions in the pure pipeline module", () => {
    expect(
      pipelineResolveContinuousPlaybackStart({
        activeStartedAtMs: null,
        timestampMs: 100
      })
    ).toBe(100);
    expect(
      resolveContinuousPlaybackStart({
        activeStartedAtMs: 80,
        timestampMs: 100
      })
    ).toBe(80);
  });

  it("keeps continuous playback interruption state transitions in the pure pipeline module", () => {
    const existingSegments = [{ startedAtMs: 10, endedAtMs: 40 }];
    expect(
      pipelineResolveContinuousPlaybackInterruption({
        segments: existingSegments,
        activeStartedAtMs: null,
        timestampMs: 100,
        windowMs: 50
      })
    ).toEqual({
      segments: existingSegments,
      activeStartedAtMs: null
    });
    expect(
      resolveContinuousPlaybackInterruption({
        segments: [
          { startedAtMs: 10, endedAtMs: 40 },
          { startedAtMs: 45, endedAtMs: 49 }
        ],
        activeStartedAtMs: 70,
        timestampMs: 100,
        windowMs: 50
      })
    ).toEqual({
      segments: [{ startedAtMs: 70, endedAtMs: 100 }],
      activeStartedAtMs: null
    });
  });

  it("keeps continuous playback window metrics in the pure pipeline module", () => {
    expect(
      pipelineResolveContinuousPlaybackWindowMetrics({
        segments: [
          { startedAtMs: 10, endedAtMs: 40 },
          { startedAtMs: 60, endedAtMs: 90 }
        ],
        activeStartedAtMs: 70,
        nowMs: 100,
        windowMs: 50
      })
    ).toEqual({
      segments: [{ startedAtMs: 60, endedAtMs: 90 }],
      maxContinuousPlaybackMs: 30
    });
    expect(
      resolveContinuousPlaybackWindowMetrics({
        segments: [{ startedAtMs: 10, endedAtMs: 95 }],
        activeStartedAtMs: null,
        nowMs: 100,
        windowMs: 50
      })
    ).toEqual({
      segments: [{ startedAtMs: 10, endedAtMs: 95 }],
      maxContinuousPlaybackMs: 45
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

  it("keeps full-local warmup readiness policy in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalBufferedWarmupPreflight({
        currentTrackId: "track-1",
        hasPlaybackState: true,
        hasAudio: true,
        hasBufferedFullLocalObjectUrl: true,
        canWarmBufferedFullLocal: true
      })
    ).toEqual({
      shouldRun: true,
      shouldResetWarmupReadyAt: false
    });
    expect(
      resolveFullLocalBufferedWarmupPreflight({
        currentTrackId: null,
        hasPlaybackState: true,
        hasAudio: true,
        hasBufferedFullLocalObjectUrl: true,
        canWarmBufferedFullLocal: true
      })
    ).toEqual({
      shouldRun: false,
      shouldResetWarmupReadyAt: true
    });
    expect(
      resolveFullLocalWarmupMissingTrackAction({
        hasBufferedFullLocalTrack: false,
        playbackHasActiveIntent: true
      })
    ).toEqual({
      shouldPauseAudio: true,
      shouldResetWarmupReadyAt: true
    });
    expect(
      pipelineResolveFullLocalWarmupMissingTrackAction({
        hasBufferedFullLocalTrack: true,
        playbackHasActiveIntent: false
      })
    ).toEqual({
      shouldPauseAudio: true,
      shouldResetWarmupReadyAt: true
    });
    expect(
      resolveFullLocalWarmupMissingTrackAction({
        hasBufferedFullLocalTrack: true,
        playbackHasActiveIntent: true
      })
    ).toBe(null);
    expect(
      pipelineResolveFullLocalWarmupReadiness({
        localReady: true,
        driftMs: 100,
        maxDriftMs: 180,
        fullLocalBlockedReason: null,
        progressiveEngineType: "pcm",
        aheadBufferedMs: 2_000,
        requiredAheadMs: 1_000
      })
    ).toBe(true);
    expect(
      resolveFullLocalWarmupReadiness({
        localReady: true,
        driftMs: 200,
        maxDriftMs: 180,
        fullLocalBlockedReason: null,
        progressiveEngineType: "none",
        aheadBufferedMs: 0,
        requiredAheadMs: 1_000
      })
    ).toBe(false);
    expect(
      resolveFullLocalWarmupReadiness({
        localReady: true,
        driftMs: 100,
        maxDriftMs: 180,
        fullLocalBlockedReason: "track-not-fully-cached",
        progressiveEngineType: "none",
        aheadBufferedMs: 0,
        requiredAheadMs: 1_000
      })
    ).toBe(false);
  });

  it("keeps full-local warmup hold policy in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalWarmupHoldState({
        localTakeoverAllowed: false,
        shouldAttemptFullLocalHandoff: true,
        readyForFullLocal: true,
        nowMs: 2_000
      })
    ).toEqual({
      shouldHold: true,
      nextWarmupReadyAt: 2_000
    });
    expect(
      resolveFullLocalWarmupHoldState({
        localTakeoverAllowed: true,
        shouldAttemptFullLocalHandoff: false,
        readyForFullLocal: false,
        nowMs: 2_000
      })
    ).toEqual({
      shouldHold: true,
      nextWarmupReadyAt: null
    });
    expect(
      resolveFullLocalWarmupHoldState({
        localTakeoverAllowed: true,
        shouldAttemptFullLocalHandoff: true,
        readyForFullLocal: true,
        nowMs: 2_000
      })
    ).toEqual({
      shouldHold: false,
      nextWarmupReadyAt: null
    });
  });

  it("keeps full-local warmup source transition policy in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalWarmupTransitionAction({
        currentSource: "progressive-local",
        nextSource: "progressive-local",
        nextWarmupReadyAt: 1_500,
        clearFallbackReason: false
      })
    ).toEqual({
      nextWarmupReadyAt: 1_500,
      transition: null
    });
    expect(
      resolveFullLocalWarmupTransitionAction({
        currentSource: "progressive-local",
        nextSource: "full-local",
        nextWarmupReadyAt: 2_000,
        clearFallbackReason: true
      })
    ).toEqual({
      nextWarmupReadyAt: 2_000,
      transition: {
        nextSource: "full-local",
        clearFallbackReason: true
      }
    });
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

  it("keeps idle full-local upgrade arming policy in the pure pipeline module", () => {
    expect(
      pipelineResolveIdleFullLocalUpgradeArmState({
        progressiveEngineType: "none",
        canUseFullLocalForPlaybackSession: true,
        fullLocalBlockedReason: null,
        localTakeoverAllowed: true,
        aheadBufferedMs: 2_000,
        comfortBufferMs: 1_000
      })
    ).toBe(true);
    expect(
      resolveIdleFullLocalUpgradeArmState({
        progressiveEngineType: "pcm",
        canUseFullLocalForPlaybackSession: true,
        fullLocalBlockedReason: null,
        localTakeoverAllowed: true,
        aheadBufferedMs: 2_000,
        comfortBufferMs: 1_000
      })
    ).toBe(false);
    expect(
      resolveIdleFullLocalUpgradeArmState({
        progressiveEngineType: "none",
        canUseFullLocalForPlaybackSession: true,
        fullLocalBlockedReason: null,
        localTakeoverAllowed: true,
        aheadBufferedMs: 500,
        comfortBufferMs: 1_000
      })
    ).toBe(true);
  });

  it("keeps full-local upgrade loop action policy in the pure pipeline module", () => {
    expect(
      pipelineResolveFullLocalUpgradeAction({
        shouldUpgrade: true,
        canArmIdleFullLocalUpgrade: true,
        currentWarmupReadyAt: 1_000,
        now: 2_000
      })
    ).toEqual({
      kind: "transition",
      nextSource: "full-local"
    });
    expect(
      resolveFullLocalUpgradeAction({
        shouldUpgrade: false,
        canArmIdleFullLocalUpgrade: false,
        currentWarmupReadyAt: 1_000,
        now: 2_000
      })
    ).toEqual({
      kind: "set-warmup-ready-at",
      nextWarmupReadyAt: null
    });
    expect(
      resolveFullLocalUpgradeAction({
        shouldUpgrade: false,
        canArmIdleFullLocalUpgrade: true,
        currentWarmupReadyAt: null,
        now: 2_000
      })
    ).toEqual({
      kind: "set-warmup-ready-at",
      nextWarmupReadyAt: 2_000
    });
    expect(
      resolveFullLocalUpgradeAction({
        shouldUpgrade: false,
        canArmIdleFullLocalUpgrade: true,
        currentWarmupReadyAt: 1_000,
        now: 2_000
      })
    ).toEqual({
      kind: "none"
    });
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
    expect(pipelineResolveSilentSlidingWindowFullLocalRecoveryAction(false)).toBe(null);
    expect(resolveSilentSlidingWindowFullLocalRecoveryAction(true)).toEqual({
      nextSource: "full-local",
      clearFallbackReason: true,
      mediaConnectionState: "buffering"
    });
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
      pipelineResolveFullLocalPausedRecoveryPreflight({
        currentTrackId: null,
        hasPlaybackState: true,
        hasAudio: true,
        activePlaybackSource: "full-local"
      })
    ).toBe(false);
    expect(
      resolveFullLocalPausedRecoveryPreflight({
        currentTrackId: "track_1",
        hasPlaybackState: true,
        hasAudio: true,
        activePlaybackSource: "progressive-local"
      })
    ).toBe(false);
    expect(
      resolveFullLocalPausedRecoveryPreflight({
        currentTrackId: "track_1",
        hasPlaybackState: true,
        hasAudio: true,
        activePlaybackSource: "full-local"
      })
    ).toBe(true);
    expect(
      pipelineResolveFullLocalPausedRecoveryAttemptAction({
        cancelled: true,
        recoveryInFlight: false,
        shouldRecover: true
      })
    ).toBe(false);
    expect(
      resolveFullLocalPausedRecoveryAttemptAction({
        cancelled: false,
        recoveryInFlight: true,
        shouldRecover: true
      })
    ).toBe(false);
    expect(
      resolveFullLocalPausedRecoveryAttemptAction({
        cancelled: false,
        recoveryInFlight: false,
        shouldRecover: false
      })
    ).toBe(false);
    expect(
      resolveFullLocalPausedRecoveryAttemptAction({
        cancelled: false,
        recoveryInFlight: false,
        shouldRecover: true
      })
    ).toBe(true);
    expect(pipelineResolveFullLocalPausedRecoveryResult(true)).toEqual({
      mediaConnectionState: "live",
      diagnosticEvent: "full-local-paused-recovered",
      diagnosticSummary: "已自动恢复本地完整缓存播放",
      recordEvent: false
    });
    expect(resolveFullLocalPausedRecoveryResult(false)).toEqual({
      mediaConnectionState: "buffering",
      diagnosticEvent: "full-local-paused-recovery-failed",
      diagnosticSummary: "本地完整缓存自动恢复播放失败",
      recordEvent: true
    });
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
      pipelineShouldPrepareProgressiveRuntime({
        trackCachingEnabled: true,
        hasProgressiveManifest: true,
        progressivePlaybackSupported: true,
        shouldRetryAfterRuntimeFailure: true,
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(true);
    expect(
      shouldPrepareProgressiveRuntime({
        trackCachingEnabled: false,
        hasProgressiveManifest: true,
        progressivePlaybackSupported: true,
        shouldRetryAfterRuntimeFailure: true,
        activePlaybackSource: "progressive-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(false);
    expect(
      shouldPrepareProgressiveRuntime({
        trackCachingEnabled: true,
        hasProgressiveManifest: true,
        progressivePlaybackSupported: true,
        shouldRetryAfterRuntimeFailure: false,
        activePlaybackSource: "lossless-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(false);
    expect(
      shouldPrepareProgressiveRuntime({
        trackCachingEnabled: true,
        hasProgressiveManifest: true,
        progressivePlaybackSupported: true,
        shouldRetryAfterRuntimeFailure: true,
        activePlaybackSource: "full-local",
        progressiveEngineType: "pcm"
      })
    ).toBe(false);
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
      pipelineResolveSlidingWindowNoEngineHoldAction({
        activePlaybackSource: "lossless-local",
        playbackStatus: "playing",
        hasPcmEngine: false,
        hasMseEngine: false,
        localAudioHasSource: true
      })
    ).toEqual({
      shouldHold: true,
      shouldPauseAudio: true,
      shouldClearAudioSource: true,
      mediaConnectionState: "buffering"
    });
    expect(
      resolveSlidingWindowNoEngineHoldAction({
        activePlaybackSource: "progressive-local",
        playbackStatus: "playing",
        hasPcmEngine: true,
        hasMseEngine: false,
        localAudioHasSource: true
      })
    ).toEqual({
      shouldHold: false,
      shouldPauseAudio: false,
      shouldClearAudioSource: false,
      mediaConnectionState: null
    });
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
    expect(
      pipelineResolvePlaybackSourceAfterLatchedPcmRuntimeFailure({
        activePlaybackSource: "lossless-local",
        canUseFullLocalForPlaybackSession: true
      })
    ).toBe("full-local");
    expect(
      resolvePlaybackSourceAfterLatchedPcmRuntimeFailure({
        activePlaybackSource: "lossless-local",
        canUseFullLocalForPlaybackSession: false
      })
    ).toBe("progressive-local");
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
