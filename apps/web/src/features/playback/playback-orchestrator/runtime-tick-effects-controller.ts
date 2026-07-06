"use client";

import {
  useEffect,
  type MutableRefObject,
  type RefObject
} from "react";
import type {
  PlaybackSnapshot,
  RoomMediaConnectionState,
  TrackMeta
} from "@music-room/shared";
import type { Dispatch, SetStateAction } from "react";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import { syncLocalPlaybackWindow } from "../playback-sync";
import {
  getEffectivePlaybackPositionMs,
  getStartupWindowMs,
  hasActivePlaybackIntent,
  type ProgressiveEngineType,
  type ProgressivePlaybackSource
} from "../progressive-playback";
import type { FullLocalPlaybackTrack } from "./runtime-types";
import { roomAudioOutput } from "../room-audio-output";
import { noopPlaybackRuntimeTick } from "./use-runtime-tick-orchestrator";
import {
  getAudibleElementVolume,
  resolveDriftSampleAction,
  resolveDriftSamplingPreflight,
  resolveFullLocalAudioSourceAction,
  resolveFullLocalBufferedWarmupPreflight,
  resolveFullLocalPausedRecoveryAttemptAction,
  resolveFullLocalPausedRecoveryPreflight,
  resolveFullLocalPausedRecoveryResult,
  resolveFullLocalUpgradeAction,
  resolveFullLocalUpgradePreflight,
  resolveFullLocalWarmupHoldState,
  resolveFullLocalWarmupMissingTrackAction,
  resolveFullLocalWarmupReadiness,
  resolveFullLocalWarmupTransitionAction,
  resolveIdleFullLocalUpgradeArmState,
  resolveObservedPlaybackSeconds,
  shouldEnableFullLocalHandoff,
  shouldRecoverPausedFullLocalPlayback,
  shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup,
  type PlaybackRecoveryStage
} from "./pipeline";
import { resolveFullLocalWarmupDecision } from "../progressive-source-controller";

type AttemptPlaybackStart = (
  audio: HTMLAudioElement,
  source: ProgressivePlaybackSource,
  blockedMessage: string,
  blockedReason: string,
  options: { reportFailure: boolean }
) => Promise<boolean>;

type TransitionPlaybackSource = (
  nextSource: ProgressivePlaybackSource,
  options?: { clearFallbackReason?: boolean }
) => boolean;

type RuntimeTickEffectsControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  attemptPlaybackStart: AttemptPlaybackStart;
  audioRef: RefObject<HTMLAudioElement | null>;
  audioUnlocked: boolean;
  canUseFullLocalForPlaybackSession: boolean;
  canWarmBufferedFullLocal: boolean;
  currentBufferedFullLocalTrackObjectUrl: string | null;
  currentBufferedFullLocalTrackRef: MutableRefObject<FullLocalPlaybackTrack | null | undefined>;
  currentProgressiveEngineType: ProgressiveEngineType;
  currentTrackFormatKey: string;
  currentTrackRef: MutableRefObject<TrackMeta | null>;
  fullLocalBlockedReason: string | null;
  fullLocalMaxDriftMs: number;
  fullLocalSwitchDelayMs: number;
  fullLocalWarmupReadyAtRef: MutableRefObject<number | null>;
  getLocalPlaybackPositionMs: () => number | null;
  isLocalTakeoverAllowed: (nowMs?: number) => boolean;
  localTakeoverCooldownUntilRef: MutableRefObject<number>;
  playbackCurrentTrackId: string | null;
  playbackMediaEpoch: number | null;
  playbackQualityStalledEventsLast30s: number;
  playbackQualityWaitingEventsLast30s: number;
  playbackRecoveryStage: PlaybackRecoveryStage;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  playbackStatus: PlaybackSnapshot["status"] | null | undefined;
  progressiveAheadBufferedMs: number;
  recoverPausedFullLocalPlaybackRef: MutableRefObject<() => void>;
  recordDriftSample: (driftMs: number, timestampMs?: number) => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  sampleDriftRef: MutableRefObject<() => void>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  startupGatePending: boolean;
  syncFullLocalBufferedWarmupRef: MutableRefObject<() => void>;
  syncUpgradeRef: MutableRefObject<() => void>;
  transitionPlaybackSource: TransitionPlaybackSource;
  volume: number;
};

export function useRuntimeTickEffectsController({
  activePlaybackSource,
  attemptPlaybackStart,
  audioRef,
  audioUnlocked,
  canUseFullLocalForPlaybackSession,
  canWarmBufferedFullLocal,
  currentBufferedFullLocalTrackObjectUrl,
  currentBufferedFullLocalTrackRef,
  currentProgressiveEngineType,
  currentTrackFormatKey,
  currentTrackRef,
  fullLocalBlockedReason,
  fullLocalMaxDriftMs,
  fullLocalSwitchDelayMs,
  fullLocalWarmupReadyAtRef,
  getLocalPlaybackPositionMs,
  isLocalTakeoverAllowed,
  localTakeoverCooldownUntilRef,
  playbackCurrentTrackId,
  playbackMediaEpoch,
  playbackQualityStalledEventsLast30s,
  playbackQualityWaitingEventsLast30s,
  playbackRecoveryStage,
  playbackRef,
  playbackStatus,
  progressiveAheadBufferedMs,
  recoverPausedFullLocalPlaybackRef,
  recordDriftSample,
  recordPeerDiagnostic,
  sampleDriftRef,
  setMediaConnectionState,
  startupGatePending,
  syncFullLocalBufferedWarmupRef,
  syncUpgradeRef,
  transitionPlaybackSource,
  volume
}: RuntimeTickEffectsControllerInput) {
  useEffect(() => {
    const playbackState = playbackRef.current;
    const samplingPreflight = resolveDriftSamplingPreflight({
      currentTrackId: playbackCurrentTrackId,
      hasPlaybackState: !!playbackState,
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackState)
    });
    if (!samplingPreflight) {
      recoverPausedFullLocalPlaybackRef.current = noopPlaybackRuntimeTick;
      sampleDriftRef.current = noopPlaybackRuntimeTick;
      syncFullLocalBufferedWarmupRef.current = noopPlaybackRuntimeTick;
      syncUpgradeRef.current = noopPlaybackRuntimeTick;
      return;
    }

    let runtimeTickCancelled = false;
    let fullLocalPausedRecoveryInFlight = false;

    const recoverPausedFullLocalPlayback = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const audio = audioRef.current;
      const recoveryPreflight = resolveFullLocalPausedRecoveryPreflight({
        currentTrackId: latestPlayback?.currentTrackId ?? null,
        hasPlaybackState: !!latestPlayback,
        hasAudio: !!audio,
        activePlaybackSource
      });
      if (!recoveryPreflight || !audio) {
        return;
      }

      const shouldRecover = shouldRecoverPausedFullLocalPlayback({
        activePlaybackSource,
        playbackStatus: latestPlayback?.status ?? "paused",
        currentTrackId: latestPlayback?.currentTrackId ?? null,
        audioUnlocked,
        localAudioPaused: audio.paused,
        localAudioReadyState: audio.readyState,
        localAudioHasSrc: !!audio.currentSrc || !!audio.getAttribute("src"),
        localAudioHasSrcObject: !!audio.srcObject
      });
      const attemptRecovery = resolveFullLocalPausedRecoveryAttemptAction({
        cancelled: runtimeTickCancelled,
        recoveryInFlight: fullLocalPausedRecoveryInFlight,
        shouldRecover
      });
      if (!attemptRecovery) {
        return;
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(latestPlayback, latestTrack?.durationMs ?? 0, Date.now()) /
        1000;
      syncLocalPlaybackWindow(audio, expectedSeconds, true, {
        softDriftMs: 90,
        hardDriftMs: 720,
        correctionMode: "audible-local-follow"
      });
      audio.muted = false;
      audio.volume = getAudibleElementVolume(volume);
      fullLocalPausedRecoveryInFlight = true;
      void attemptPlaybackStart(
        audio,
        "full-local",
        "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
        "full-local-paused-recovery",
        { reportFailure: false }
      )
        .then((ok) => {
          if (runtimeTickCancelled) {
            return;
          }

          const recoveryResult = resolveFullLocalPausedRecoveryResult(ok);
          setMediaConnectionState(recoveryResult.mediaConnectionState);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: recoveryResult.diagnosticEvent,
            summary: recoveryResult.diagnosticSummary,
            recordEvent: recoveryResult.recordEvent
          });
        })
        .finally(() => {
          fullLocalPausedRecoveryInFlight = false;
        });
    };

    const sampleDrift = () => {
      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const latestSamplingPreflight = resolveDriftSamplingPreflight({
        currentTrackId: latestPlayback?.currentTrackId ?? null,
        hasPlaybackState: !!latestPlayback,
        playbackHasActiveIntent: hasActivePlaybackIntent(latestPlayback)
      });
      if (!latestSamplingPreflight) {
        return;
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(
          latestPlayback,
          latestTrack?.durationMs ?? 0,
          Date.now()
        ) / 1000;
      const audio = audioRef.current;
      const observedSeconds = resolveObservedPlaybackSeconds({
        activePlaybackSource,
        localPlaybackPositionMs: getLocalPlaybackPositionMs(),
        audioCurrentTimeSeconds: audio?.currentTime ?? null,
        audioPaused: audio?.paused ?? true
      });

      const sampleAction = resolveDriftSampleAction({
        expectedSeconds,
        observedSeconds
      });
      if (!sampleAction) {
        return;
      }

      recordDriftSample(sampleAction.driftMs);
    };

    const syncUpgrade = () => {
      const playbackState = playbackRef.current;
      const upgradePreflight = resolveFullLocalUpgradePreflight({
        currentTrackId: playbackState?.currentTrackId ?? null,
        hasPlaybackState: !!playbackState,
        hasBufferedFullLocalObjectUrl: !!currentBufferedFullLocalTrackObjectUrl,
        canWarmBufferedFullLocal,
        activePlaybackSource,
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackState)
      });
      if (!upgradePreflight.shouldRun) {
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }

      const comfortBufferMs = getStartupWindowMs(
        currentTrackRef.current ?? {
          mimeType: null,
          codec: null
        }
      );
      const now = Date.now();
      const localTakeoverAllowed = isLocalTakeoverAllowed(now);
      const shouldUpgrade = shouldUpgradeSlidingWindowToFullLocalWithoutNativeWarmup({
        activePlaybackSource,
        progressiveEngineType: currentProgressiveEngineType,
        canUseFullLocalForPlaybackSession,
        fullLocalBlockedReason,
        localTakeoverAllowed,
        aheadBufferedMs: progressiveAheadBufferedMs,
        comfortBufferMs,
        warmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now,
        switchDelayMs: fullLocalSwitchDelayMs
      });

      if (shouldUpgrade) {
        transitionPlaybackSource("full-local");
        return;
      }

      const canArmIdleFullLocalUpgrade = resolveIdleFullLocalUpgradeArmState({
        progressiveEngineType: currentProgressiveEngineType,
        canUseFullLocalForPlaybackSession,
        fullLocalBlockedReason,
        localTakeoverAllowed,
        aheadBufferedMs: progressiveAheadBufferedMs,
        comfortBufferMs
      });
      const upgradeAction = resolveFullLocalUpgradeAction({
        shouldUpgrade,
        canArmIdleFullLocalUpgrade,
        currentWarmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now
      });
      if (upgradeAction.kind === "transition") {
        transitionPlaybackSource(upgradeAction.nextSource);
        return;
      }
      if (upgradeAction.kind === "set-warmup-ready-at") {
        fullLocalWarmupReadyAtRef.current = upgradeAction.nextWarmupReadyAt;
      }
    };

    const syncFullLocalBufferedWarmup = () => {
      const playbackState = playbackRef.current;
      const audio = audioRef.current;
      const warmupPreflight = resolveFullLocalBufferedWarmupPreflight({
        currentTrackId: playbackState?.currentTrackId ?? null,
        hasPlaybackState: !!playbackState,
        hasAudio: !!audio,
        hasBufferedFullLocalObjectUrl: !!currentBufferedFullLocalTrackObjectUrl,
        canWarmBufferedFullLocal
      });
      if (!warmupPreflight.shouldRun) {
        fullLocalWarmupReadyAtRef.current = null;
        return;
      }
      if (!audio) {
        return;
      }

      const latestPlayback = playbackRef.current;
      const latestTrack = currentTrackRef.current;
      const latestBufferedFullLocalTrack = currentBufferedFullLocalTrackRef.current;
      const missingTrackAction = resolveFullLocalWarmupMissingTrackAction({
        hasBufferedFullLocalTrack: !!latestBufferedFullLocalTrack,
        playbackHasActiveIntent: hasActivePlaybackIntent(latestPlayback)
      });
      if (missingTrackAction) {
        if (missingTrackAction.shouldPauseAudio) {
          audio.pause();
          audio.muted = false;
        }
        if (missingTrackAction.shouldResetWarmupReadyAt) {
          fullLocalWarmupReadyAtRef.current = null;
        }
        return;
      }
      if (!latestBufferedFullLocalTrack) {
        return;
      }

      const audioSourceAction = resolveFullLocalAudioSourceAction({
        hasSrcObject: !!audio.srcObject,
        currentSrc: audio.src,
        nextSrc: latestBufferedFullLocalTrack.objectUrl
      });
      if (audioSourceAction.shouldClearSrcObject) {
        audio.srcObject = null;
      }
      if (audioSourceAction.shouldAssignSource) {
        audio.src = latestBufferedFullLocalTrack.objectUrl;
      }
      if (audioSourceAction.shouldLoadSource) {
        audio.load();
      }

      const expectedSeconds =
        getEffectivePlaybackPositionMs(latestPlayback, latestTrack?.durationMs ?? 0, Date.now()) /
        1000;
      syncLocalPlaybackWindow(audio, expectedSeconds, true, {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "shadow-local-catchup"
      });
      audio.muted = true;
      void roomAudioOutput.playElement(audio);

      const localReady = audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
      const now = Date.now();
      const readyForFullLocal = resolveFullLocalWarmupReadiness({
        localReady,
        driftMs,
        maxDriftMs: fullLocalMaxDriftMs,
        fullLocalBlockedReason,
        progressiveEngineType: currentProgressiveEngineType,
        aheadBufferedMs: progressiveAheadBufferedMs,
        requiredAheadMs: getStartupWindowMs(
          latestTrack ?? {
            mimeType: null,
            codec: null
          }
        )
      });

      const shouldAttemptFullLocalHandoff = shouldEnableFullLocalHandoff({
        activePlaybackSource,
        playbackRecoveryStage,
        startupGatePending,
        localReady: readyForFullLocal,
        driftMs,
        cooldownMs: Math.max(0, localTakeoverCooldownUntilRef.current - now)
      });

      const holdState = resolveFullLocalWarmupHoldState({
        localTakeoverAllowed: isLocalTakeoverAllowed(now),
        shouldAttemptFullLocalHandoff,
        readyForFullLocal,
        nowMs: now
      });
      if (holdState.shouldHold) {
        fullLocalWarmupReadyAtRef.current = holdState.nextWarmupReadyAt;
        return;
      }

      const warmupDecision = resolveFullLocalWarmupDecision({
        currentSource: activePlaybackSource,
        localReady: readyForFullLocal,
        driftMs,
        warmupReadyAt: fullLocalWarmupReadyAtRef.current,
        now,
        switchDelayMs: fullLocalSwitchDelayMs,
        maxDriftMs: fullLocalMaxDriftMs
      });
      const transitionAction = resolveFullLocalWarmupTransitionAction({
        currentSource: activePlaybackSource,
        nextSource: warmupDecision.nextSource,
        nextWarmupReadyAt: warmupDecision.nextWarmupReadyAt,
        clearFallbackReason: warmupDecision.clearFallbackReason
      });
      fullLocalWarmupReadyAtRef.current = transitionAction.nextWarmupReadyAt;
      if (transitionAction.transition) {
        transitionPlaybackSource(transitionAction.transition.nextSource, {
          clearFallbackReason: transitionAction.transition.clearFallbackReason
        });
      }
    };

    recoverPausedFullLocalPlaybackRef.current = recoverPausedFullLocalPlayback;
    sampleDriftRef.current = sampleDrift;
    syncFullLocalBufferedWarmupRef.current = syncFullLocalBufferedWarmup;
    syncUpgradeRef.current = syncUpgrade;
    recoverPausedFullLocalPlayback();
    sampleDrift();
    syncFullLocalBufferedWarmup();
    syncUpgrade();
    return () => {
      runtimeTickCancelled = true;
      if (recoverPausedFullLocalPlaybackRef.current === recoverPausedFullLocalPlayback) {
        recoverPausedFullLocalPlaybackRef.current = noopPlaybackRuntimeTick;
      }
      if (sampleDriftRef.current === sampleDrift) {
        sampleDriftRef.current = noopPlaybackRuntimeTick;
      }
      if (syncFullLocalBufferedWarmupRef.current === syncFullLocalBufferedWarmup) {
        syncFullLocalBufferedWarmupRef.current = noopPlaybackRuntimeTick;
      }
      if (syncUpgradeRef.current === syncUpgrade) {
        syncUpgradeRef.current = noopPlaybackRuntimeTick;
      }
    };
  }, [
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    audioUnlocked,
    canUseFullLocalForPlaybackSession,
    canWarmBufferedFullLocal,
    currentBufferedFullLocalTrackObjectUrl,
    currentBufferedFullLocalTrackRef,
    currentProgressiveEngineType,
    currentTrackFormatKey,
    currentTrackRef,
    fullLocalBlockedReason,
    fullLocalMaxDriftMs,
    fullLocalSwitchDelayMs,
    fullLocalWarmupReadyAtRef,
    getLocalPlaybackPositionMs,
    isLocalTakeoverAllowed,
    localTakeoverCooldownUntilRef,
    playbackCurrentTrackId,
    playbackMediaEpoch,
    playbackQualityStalledEventsLast30s,
    playbackQualityWaitingEventsLast30s,
    playbackRecoveryStage,
    playbackRef,
    playbackStatus,
    progressiveAheadBufferedMs,
    recoverPausedFullLocalPlaybackRef,
    recordDriftSample,
    recordPeerDiagnostic,
    sampleDriftRef,
    setMediaConnectionState,
    startupGatePending,
    syncFullLocalBufferedWarmupRef,
    syncUpgradeRef,
    transitionPlaybackSource,
    volume
  ]);
}
