"use client";

import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type { PlaybackSnapshot, RoomMediaConnectionState } from "@music-room/shared";
import { syncLocalPlaybackWindow } from "../playback-sync";
import {
  getEffectivePlaybackPositionMs,
  hasActivePlaybackIntent,
  type ProgressiveEngineType,
  type ProgressivePlaybackSource,
  type ProgressiveTrackManifest
} from "../progressive-playback";
import type { ProgressiveMseEngine } from "../progressive-mse-engine";
import type { ProgressivePcmEngine } from "../progressive-pcm-engine";
import { roomAudioOutput } from "../room-audio-output";
import { resolvePcmRuntimeFailureReason } from "../pcm-runtime-failure";
import {
  consumePlaybackStartIntent,
  doesPlaybackMatchStartIntent,
  type PlaybackStartIntent
} from "../playback-start-intent";
import { resolveProgressiveWarmupDecision } from "../progressive-source-controller";
import { noopPlaybackRuntimeTick } from "./use-runtime-tick-orchestrator";
import {
  getSlidingWindowPlayBlockedReason,
  isSlidingWindowPlaybackSource,
  resolvePlaybackTimelineIdentity,
  resolveWarmupHoldState,
  resolveWarmupInactivePlaybackAction,
  resolveWarmupMseCatchupAction,
  resolveWarmupPcmAudioStartAction,
  resolveWarmupPcmAudioStartResultAction,
  resolveWarmupPcmSyncMode,
  resolveWarmupPreflight,
  resolveWarmupTakeoverBlockedReason,
  resolveWarmupUnavailableAction,
  shouldAttemptProgressiveLocalPlayback,
  shouldStartPcmSlidingWindowAudioElement,
  type PlaybackRecoveryStage
} from "./pipeline";

type AttemptPlaybackStart = (
  audio: HTMLAudioElement,
  source: ProgressivePlaybackSource,
  blockedMessage: string,
  blockedReason: string,
  options: { reportFailure: boolean }
) => Promise<boolean>;

type ProgressiveWarmupRuntimeState = {
  activePlaybackSource: ProgressivePlaybackSource;
  canUseFullLocalForPlaybackSession: boolean;
  currentProgressiveEngineType: ProgressiveEngineType;
  progressiveStartupReady: boolean;
  startupBufferMs: number;
  progressiveLocalBlockedReason: string | null;
  isCurrentSourceOwner: boolean;
  playbackRecoveryStage: PlaybackRecoveryStage;
  progressiveFallbackReason: string | null;
};

type ProgressiveWarmupControllerInput = {
  attemptPlaybackStartRef: MutableRefObject<AttemptPlaybackStart>;
  audioRef: RefObject<HTMLAudioElement | null>;
  directProgressiveTakeoverEnabled: boolean;
  isLocalTakeoverAllowedRef: MutableRefObject<(nowMs?: number) => boolean>;
  lastPcmSlidingWindowPlayAttemptAtRef: MutableRefObject<number | null>;
  markPcmRuntimeFailureRef: MutableRefObject<(reason: string | null | undefined) => void>;
  pcmLastBlockedReasonRef: MutableRefObject<string | null>;
  pcmSlidingWindowPlayRetryIntervalMs: number;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  playbackStartIntent: PlaybackStartIntent | null;
  progressiveEngineRef: MutableRefObject<ProgressiveMseEngine | null>;
  progressivePcmEngineRef: MutableRefObject<ProgressivePcmEngine | null>;
  progressiveSwitchDelayMs: number;
  progressiveWarmupReadyAtRef: MutableRefObject<number | null>;
  progressiveWarmupRuntimeRef: MutableRefObject<ProgressiveWarmupRuntimeState>;
  progressiveWarmupTimerKey: string;
  currentProgressiveManifestRef: MutableRefObject<{
    key: string;
    manifest: ProgressiveTrackManifest | null;
  }>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  syncProgressiveWarmupRef: MutableRefObject<() => void>;
};

export function useProgressiveWarmupController({
  attemptPlaybackStartRef,
  audioRef,
  directProgressiveTakeoverEnabled,
  isLocalTakeoverAllowedRef,
  lastPcmSlidingWindowPlayAttemptAtRef,
  markPcmRuntimeFailureRef,
  pcmLastBlockedReasonRef,
  pcmSlidingWindowPlayRetryIntervalMs,
  playbackRef,
  playbackStartIntent,
  progressiveEngineRef,
  progressivePcmEngineRef,
  progressiveSwitchDelayMs,
  progressiveWarmupReadyAtRef,
  progressiveWarmupRuntimeRef,
  progressiveWarmupTimerKey,
  currentProgressiveManifestRef,
  setMediaConnectionState,
  setPlaybackStartIntent,
  setProgressiveFallbackReason,
  syncProgressiveWarmupRef
}: ProgressiveWarmupControllerInput) {
  useEffect(() => {
    const playbackState = playbackRef.current;
    const audio = audioRef.current;
    const manifestState = currentProgressiveManifestRef.current.manifest;
    const warmupState = progressiveWarmupRuntimeRef.current;

    const warmupPreflight = resolveWarmupPreflight({
      currentTrackId: playbackState?.currentTrackId ?? null,
      hasAudio: !!audio,
      hasProgressiveEngine: !!progressiveEngineRef.current || !!progressivePcmEngineRef.current,
      hasManifest: !!manifestState,
      activePlaybackSource: warmupState.activePlaybackSource
    });
    if (!warmupPreflight.shouldRun || !audio || !manifestState || !playbackState?.currentTrackId) {
      progressiveWarmupReadyAtRef.current = null;
      return;
    }

    let cancelled = false;

    const syncWarmup = async () => {
      const mseEngine = progressiveEngineRef.current;
      const pcmEngine = progressivePcmEngineRef.current;
      if (cancelled || (!mseEngine && !pcmEngine)) {
        return;
      }

      const latestPlayback = playbackRef.current;
      if (!latestPlayback?.currentTrackId) {
        return;
      }
      const latestManifest = currentProgressiveManifestRef.current.manifest;
      if (!latestManifest) {
        progressiveWarmupReadyAtRef.current = null;
        return;
      }
      const latestWarmupState = progressiveWarmupRuntimeRef.current;

      const expectedSeconds =
        getEffectivePlaybackPositionMs(
          latestPlayback,
          latestManifest.durationMs,
          Date.now()
        ) / 1000;
      const playbackTimeline = resolvePlaybackTimelineIdentity(latestPlayback);
      const now = Date.now();
      const shadowWarmupReady = true;
      let engineReady = false;
      let localReady = false;
      let driftMs = Number.POSITIVE_INFINITY;

      if (pcmEngine) {
        // Sliding-window playback needs the warmup tick to keep PCM decode and
        // catch-up moving until the local audio element is audibly running.
        const pcmSyncMode = resolveWarmupPcmSyncMode(latestWarmupState.activePlaybackSource);
        const syncResult =
          pcmSyncMode === "snapshot-only"
            ? null
            : await pcmEngine.syncPlayback({
                expectedSeconds,
                isPlaying: true,
                playbackTimeline
              });
        if (syncResult) {
          pcmLastBlockedReasonRef.current = syncResult.blockedReason;
          markPcmRuntimeFailureRef.current(
            resolvePcmRuntimeFailureReason({
              blockedReason: syncResult.blockedReason,
              lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
            })
          );
        }
        if (cancelled) {
          return;
        }

        engineReady = pcmEngine.engineStatus === "ready";
        localReady = syncResult
          ? syncResult.localReady
          : pcmEngine.getSnapshot().bufferedAheadMs > 0;
        driftMs = syncResult ? syncResult.driftMs : 0;
        audio.muted = !isSlidingWindowPlaybackSource(latestWarmupState.activePlaybackSource);
        const pcmAudioStartAction = resolveWarmupPcmAudioStartAction({
          hasSyncResult: !!syncResult,
          shouldStartAudioElement: shouldStartPcmSlidingWindowAudioElement({
            activePlaybackSource: latestWarmupState.activePlaybackSource,
            playbackStatus: latestPlayback.status,
            localReady,
            audioPaused: audio.paused,
            lastAttemptAtMs: lastPcmSlidingWindowPlayAttemptAtRef.current,
            nowMs: now,
            retryIntervalMs: pcmSlidingWindowPlayRetryIntervalMs
          }),
          nowMs: now
        });
        if (pcmAudioStartAction) {
          lastPcmSlidingWindowPlayAttemptAtRef.current = pcmAudioStartAction.lastAttemptAtMs;
          void attemptPlaybackStartRef.current(
            audio,
            latestWarmupState.activePlaybackSource,
            "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
            getSlidingWindowPlayBlockedReason(latestWarmupState.activePlaybackSource),
            { reportFailure: false }
          ).then((ok) => {
            const pcmSnapshot = pcmEngine.getSnapshot();
            const pcmOutputAudible =
              pcmSnapshot.audioContextState === "running" &&
              pcmSnapshot.directOutputConnected !== false &&
              pcmSnapshot.decodedSegmentCount > 0 &&
              pcmSnapshot.scheduledSegmentCount > 0;
            const startResultAction = resolveWarmupPcmAudioStartResultAction({
              cancelled,
              playbackStarted: ok,
              pcmOutputAudible
            });
            if (!startResultAction) {
              return;
            }
            if (startResultAction.shouldClearFallbackReason) {
              setProgressiveFallbackReason(null);
            }
            if (startResultAction.shouldConsumePlaybackStartIntent) {
              setPlaybackStartIntent((current) =>
                current && doesPlaybackMatchStartIntent(current, playbackRef.current)
                  ? consumePlaybackStartIntent(current, latestWarmupState.activePlaybackSource)
                  : current
              );
            }
            setMediaConnectionState(startResultAction.mediaConnectionState);
          });
        }
      } else if (mseEngine) {
        await mseEngine.sync();
        engineReady = mseEngine.engineStatus === "ready";
        localReady = mseEngine.isPlaybackReady(expectedSeconds, latestWarmupState.startupBufferMs);

        const mseCatchupAction = resolveWarmupMseCatchupAction({
          localReady,
          activePlaybackSource: latestWarmupState.activePlaybackSource,
          shadowWarmupReady
        });
        if (mseCatchupAction.shouldCatchup) {
          syncLocalPlaybackWindow(audio, expectedSeconds, true, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "shadow-local-catchup"
          });
          if (mseCatchupAction.shouldMuteAudio !== null) {
            audio.muted = mseCatchupAction.shouldMuteAudio;
          }
          if (mseCatchupAction.shouldPlayElement) {
            void roomAudioOutput.playElement(audio);
          }
          driftMs = Math.abs(expectedSeconds * 1000 - audio.currentTime * 1000);
        }
      }

      const shouldAttemptTakeover = shouldAttemptProgressiveLocalPlayback({
        isCurrentSourceOwner: latestWarmupState.isCurrentSourceOwner,
        activePlaybackSource: latestWarmupState.activePlaybackSource,
        playbackStatus: latestPlayback.status,
        engineType: latestWarmupState.currentProgressiveEngineType,
        startupReady: latestWarmupState.progressiveStartupReady,
        hasFullLocalTrack: latestWarmupState.canUseFullLocalForPlaybackSession,
        progressiveFallbackReason: latestWarmupState.progressiveFallbackReason
      });
      const takeoverBlockedReason = resolveWarmupTakeoverBlockedReason({
        shouldAttemptTakeover,
        progressiveLocalBlockedReason: latestWarmupState.progressiveLocalBlockedReason
      });

      const unavailableAction = resolveWarmupUnavailableAction({
        engineType: latestWarmupState.currentProgressiveEngineType,
        engineReady,
        localReady,
        hasPcmEngine: !!pcmEngine
      });
      if (unavailableAction) {
        if (pcmEngine && unavailableAction.shouldRunSecondaryPcmSync) {
          const syncResult = await pcmEngine
            .syncPlayback({
              expectedSeconds,
              isPlaying: false,
              playbackTimeline
            })
            .catch(() => null);
          pcmLastBlockedReasonRef.current = syncResult?.blockedReason ?? null;
          markPcmRuntimeFailureRef.current(
            resolvePcmRuntimeFailureReason({
              blockedReason: syncResult?.blockedReason,
              lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
            })
          );
          if (cancelled) {
            return;
          }
        } else if (unavailableAction.shouldPauseAudio) {
          audio.pause();
        }
        audio.muted = false;
        progressiveWarmupReadyAtRef.current = null;
        return;
      }

      const localTakeoverAllowed = isLocalTakeoverAllowedRef.current(now);
      const holdState = resolveWarmupHoldState({
        directProgressiveTakeoverEnabled,
        localTakeoverAllowed,
        shouldAttemptTakeover,
        shadowWarmupReady,
        localReady,
        progressiveFallbackReason: latestWarmupState.progressiveFallbackReason,
        playbackRecoveryStage: latestWarmupState.playbackRecoveryStage,
        nowMs: now
      });
      if (holdState.shouldHold) {
        progressiveWarmupReadyAtRef.current = holdState.nextWarmupReadyAt;
        if (holdState.shouldClearFallbackReason) {
          setProgressiveFallbackReason(null);
        }
        return;
      }

      const warmupDecision = resolveProgressiveWarmupDecision({
        currentSource: latestWarmupState.activePlaybackSource,
        engineReady: localReady,
        activationReady: takeoverBlockedReason === null && shadowWarmupReady,
        fallbackReason: takeoverBlockedReason,
        driftMs,
        warmupReadyAt: progressiveWarmupReadyAtRef.current,
        now,
        switchDelayMs: progressiveSwitchDelayMs
      });
      progressiveWarmupReadyAtRef.current = warmupDecision.nextWarmupReadyAt;
      if (warmupDecision.clearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
    };

    const inactiveAction = resolveWarmupInactivePlaybackAction({
      playbackHasActiveIntent: hasActivePlaybackIntent(playbackState),
      hasPcmEngine: !!progressivePcmEngineRef.current
    });
    if (inactiveAction) {
      if (inactiveAction.shouldSyncPcmPlayback && progressivePcmEngineRef.current) {
        const expectedSeconds =
          getEffectivePlaybackPositionMs(
            playbackState,
            manifestState.durationMs,
            Date.now()
          ) / 1000;
        const playbackTimeline = resolvePlaybackTimelineIdentity(playbackState);
        void progressivePcmEngineRef.current
          .syncPlayback({
            expectedSeconds,
            isPlaying: false,
            playbackTimeline
          })
          .then((result) => {
            pcmLastBlockedReasonRef.current = result.blockedReason;
            markPcmRuntimeFailureRef.current(
              resolvePcmRuntimeFailureReason({
                blockedReason: result.blockedReason,
                lastDecodeError: progressivePcmEngineRef.current?.getSnapshot().lastDecodeError
              })
            );
          });
      }
      if (inactiveAction.shouldPauseAudio) {
        audio.pause();
        audio.muted = false;
      }
      if (inactiveAction.shouldResetWarmupReadyAt) {
        progressiveWarmupReadyAtRef.current = null;
      }
      return;
    }

    syncProgressiveWarmupRef.current = () => {
      void syncWarmup();
    };
    syncProgressiveWarmupRef.current();

    return () => {
      cancelled = true;
      if (syncProgressiveWarmupRef.current) {
        syncProgressiveWarmupRef.current = noopPlaybackRuntimeTick;
      }
    };
  }, [
    attemptPlaybackStartRef,
    audioRef,
    currentProgressiveManifestRef,
    directProgressiveTakeoverEnabled,
    isLocalTakeoverAllowedRef,
    lastPcmSlidingWindowPlayAttemptAtRef,
    markPcmRuntimeFailureRef,
    pcmLastBlockedReasonRef,
    pcmSlidingWindowPlayRetryIntervalMs,
    playbackRef,
    playbackStartIntent,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveSwitchDelayMs,
    progressiveWarmupReadyAtRef,
    progressiveWarmupRuntimeRef,
    progressiveWarmupTimerKey,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setProgressiveFallbackReason,
    syncProgressiveWarmupRef
  ]);
}
