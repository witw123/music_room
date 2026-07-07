"use client";

import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import type { PlaybackSnapshot, RoomMediaConnectionState } from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { syncLocalPlaybackWindow } from "../playback-sync";
import {
  getEffectivePlaybackPositionMs,
  hasActivePlaybackIntent,
  type ProgressiveEngineType,
  type ProgressivePlaybackSource
} from "../progressive-playback";
import type { PlaybackStartIntent } from "../playback-start-intent";
import type { ProgressiveMseEngine } from "../progressive-mse-engine";
import type { ProgressivePcmEngine } from "../progressive-pcm-engine";
import {
  resolvePcmRuntimeFailureReason,
  shouldLatchPcmRuntimeFailure
} from "../pcm-runtime-failure";
import type { FullLocalPlaybackTrack } from "./runtime-types";
import {
  getAudibleElementVolume,
  isSlidingWindowPlaybackSource,
  resolveFullLocalAudioSourceAction,
  resolveFullLocalPausedPlaybackAction,
  resolveFullLocalPlaybackActivationAction,
  resolveFullLocalPlaybackSelection,
  resolveMainPausedPlaybackAction,
  resolveMainPlaybackPreflight,
  resolveMainPlaybackResetIdleAction,
  resolvePlaybackStartMediaConnectionState,
  resolvePcmSyncPlaybackOutcome,
  resolveSlidingWindowFallbackPlaybackAction,
  resolveSlidingWindowNativeSyncOutcome,
  resolveSlidingWindowNoEngineHoldAction
} from "./pipeline";

type AttemptPlaybackStart = (
  audio: HTMLAudioElement,
  source: ProgressivePlaybackSource,
  blockedMessage: string,
  blockedReason: string,
  options: { reportFailure: boolean }
) => Promise<boolean>;

type MainPlaybackControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  attemptPlaybackStart: AttemptPlaybackStart;
  audioRef: RefObject<HTMLAudioElement | null>;
  currentProgressiveEngineType: ProgressiveEngineType;
  currentTrackDurationMs: number | null;
  destroyProgressiveRuntime: () => void;
  ensurePlaybackStart: (source: ProgressivePlaybackSource) => void;
  forceSourceOwnerLocalPlayback: boolean;
  fullLocalPlaybackTracks: Record<string, FullLocalPlaybackTrack>;
  isCurrentSourceOwner: boolean;
  markPlaybackStartFailure: (kind: string, message: string) => void;
  markPcmRuntimeFailure: (reason: string | null | undefined) => void;
  pcmLastBlockedReasonRef: MutableRefObject<string | null>;
  playbackPositionKey: string;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  progressiveEngineRef: MutableRefObject<ProgressiveMseEngine | null>;
  progressivePcmEngineRef: MutableRefObject<ProgressivePcmEngine | null>;
  progressiveStartupReady: boolean;
  setActivePlaybackSource: Dispatch<SetStateAction<ProgressivePlaybackSource>>;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
  setProgressiveFallbackReason: Dispatch<SetStateAction<string | null>>;
  setStatusMessage: (value: string) => void;
  startupBufferMs: number;
  uploadedTracks: Record<string, UploadedTrack>;
  volume: number;
};

export function useMainPlaybackController({
  activePlaybackSource,
  attemptPlaybackStart,
  audioRef,
  currentProgressiveEngineType,
  currentTrackDurationMs,
  destroyProgressiveRuntime,
  ensurePlaybackStart,
  forceSourceOwnerLocalPlayback,
  fullLocalPlaybackTracks,
  isCurrentSourceOwner,
  markPlaybackStartFailure,
  markPcmRuntimeFailure,
  pcmLastBlockedReasonRef,
  playbackPositionKey,
  playbackRef,
  progressiveEngineRef,
  progressivePcmEngineRef,
  progressiveStartupReady,
  setActivePlaybackSource,
  setMediaConnectionState,
  setPlaybackStartIntent,
  setProgressiveFallbackReason,
  setStatusMessage,
  startupBufferMs,
  uploadedTracks,
  volume
}: MainPlaybackControllerInput) {
  useEffect(() => {
    const audio = audioRef.current;
    const playbackState = playbackRef.current;
    const currentTrackId = playbackState?.currentTrackId ?? null;
    const mainPlaybackPreflight = resolveMainPlaybackPreflight({
      hasAudio: !!audio,
      currentTrackId
    });
    if (mainPlaybackPreflight === "skip") {
      return;
    }

    if (!audio) {
      return;
    }

    const resetIdleAction = resolveMainPlaybackResetIdleAction(mainPlaybackPreflight);
    if (resetIdleAction) {
      if (resetIdleAction.shouldDestroyRuntime) {
        destroyProgressiveRuntime();
      }
      if (resetIdleAction.shouldPauseAudio) {
        audio.pause();
      }
      if (resetIdleAction.shouldClearAudioSource) {
        audio.srcObject = null;
        audio.removeAttribute("src");
        audio.load();
      }
      if (resetIdleAction.shouldClearPlaybackStartIntent) {
        setPlaybackStartIntent(null);
      }
      setMediaConnectionState(resetIdleAction.mediaConnectionState);
      return;
    }

    if (!playbackState || !currentTrackId) {
      return;
    }

    const uploaded =
      fullLocalPlaybackTracks[currentTrackId] ??
      uploadedTracks[currentTrackId] ??
      null;
    const sourceOwnerHasLocalTrack = isCurrentSourceOwner && !!uploaded;
    const expectedSeconds =
      getEffectivePlaybackPositionMs(playbackState, currentTrackDurationMs ?? 0, Date.now()) /
      1000;
    const shouldPlayPlayback = hasActivePlaybackIntent(playbackState);
    const wantsFullLocalPlayback = resolveFullLocalPlaybackSelection({
      activePlaybackSource,
      forceSourceOwnerLocalPlayback,
      sourceOwnerHasLocalTrack,
      hasUploadedTrack: !!uploaded
    });
    if (wantsFullLocalPlayback && uploaded) {
      const audioSourceAction = resolveFullLocalAudioSourceAction({
        hasSrcObject: !!audio.srcObject,
        currentSrc: audio.src,
        nextSrc: uploaded.objectUrl
      });
      if (audioSourceAction.shouldClearSrcObject) {
        audio.srcObject = null;
      }
      if (audioSourceAction.shouldAssignSource) {
        audio.src = uploaded.objectUrl;
      }
      if (audioSourceAction.shouldLoadSource) {
        audio.load();
      }
      audio.muted = false;
      audio.volume = getAudibleElementVolume(volume);

      syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
        softDriftMs: 90,
        hardDriftMs: 720,
        correctionMode: "audible-local-follow"
      });

      const activationAction = resolveFullLocalPlaybackActivationAction({
        shouldPlayPlayback,
        activePlaybackSource
      });
      if (activationAction) {
        if (activationAction.shouldSetSourceToFullLocal) {
          setActivePlaybackSource("full-local");
        }
        if (activationAction.shouldClearFallbackReason) {
          setProgressiveFallbackReason(null);
        }
        if (activationAction.shouldAttemptPlaybackStart) {
          void attemptPlaybackStart(
            audio,
            "full-local",
            "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
            "full-local-play-blocked",
            { reportFailure: true }
          ).then((ok) => {
            setMediaConnectionState(resolvePlaybackStartMediaConnectionState(ok));
          });
        }
      }

      const pausedPlaybackAction = resolveFullLocalPausedPlaybackAction(playbackState.status);
      if (pausedPlaybackAction) {
        audio.pause();
        if (pausedPlaybackAction.shouldResetPlaybackRate) {
          audio.playbackRate = 1;
        }
        setMediaConnectionState(pausedPlaybackAction.mediaConnectionState);
      }
      return;
    }

    if (isSlidingWindowPlaybackSource(activePlaybackSource)) {
      const pcmEngine = progressivePcmEngineRef.current;
      if (pcmEngine) {
        audio.muted = false;
        void pcmEngine
          .syncPlayback(expectedSeconds, shouldPlayPlayback)
          .then((result) => {
            pcmLastBlockedReasonRef.current = result.blockedReason;
            const pcmFailureReason = resolvePcmRuntimeFailureReason({
              blockedReason: result.blockedReason,
              lastDecodeError: pcmEngine.getSnapshot().lastDecodeError
            });
            markPcmRuntimeFailure(pcmFailureReason);
            const playbackOutcome = resolvePcmSyncPlaybackOutcome({
              shouldPlayPlayback,
              localReady: result.localReady,
              shouldLatchFailure: shouldLatchPcmRuntimeFailure(pcmFailureReason)
            });
            if (!playbackOutcome) {
              return;
            }
            if (playbackOutcome.mediaConnectionState) {
              setMediaConnectionState(playbackOutcome.mediaConnectionState);
            }
            const fallbackReason = playbackOutcome.progressiveFallbackReason;
            if (fallbackReason !== undefined) {
              setProgressiveFallbackReason(fallbackReason);
            }
            if (playbackOutcome.playbackStartFailureKind) {
              // Permanent failures (init-failed) should mark the intent as
              // failed. Transient buffer-underrun should publish a status
              // message but keep the intent pending — data may arrive in a
              // subsequent tick and the retry loop will pick it up.
              if (playbackOutcome.playbackStartFailureKind === "init-failed") {
                markPlaybackStartFailure(
                  `${activePlaybackSource}-init-failed`,
                  "本地解码初始化失败，请等待完整缓存后播放。"
                );
              } else {
                setStatusMessage("本地缓冲不足，正在缓存播放所需片段。");
              }
              return;
            }
            if (playbackOutcome.shouldEnsurePlaybackStart) {
              ensurePlaybackStart(activePlaybackSource);
            }
          })
          .catch(() => {
            setProgressiveFallbackReason("progressive-init-failed");
            setMediaConnectionState("buffering");
            markPlaybackStartFailure(
              `${activePlaybackSource}-init-failed`,
              "本地解码初始化失败，请等待完整缓存后播放。"
            );
          });
        return;
      }

      audio.muted = false;
      const mseEngine = progressiveEngineRef.current;
      if (mseEngine) {
        void mseEngine.sync().then(() => {
          const localReady = mseEngine.isPlaybackReady(expectedSeconds, startupBufferMs);
          const playbackOutcome = resolveSlidingWindowNativeSyncOutcome({
            shouldPlayPlayback,
            localReady
          });
          if (playbackOutcome.mediaConnectionState) {
            setMediaConnectionState(playbackOutcome.mediaConnectionState);
          }
          const fallbackReason = playbackOutcome.progressiveFallbackReason;
          if (fallbackReason !== undefined) {
            setProgressiveFallbackReason(fallbackReason);
          }
          if (playbackOutcome.playbackStartFailureKind) {
            // Same reasoning as PCM path: transient buffer-underrun should
            // keep the intent pending, not permanently fail it.
            setStatusMessage("本地缓冲不足，正在缓存播放所需片段。");
            return;
          }

          syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
            softDriftMs: 120,
            hardDriftMs: 900,
            correctionMode: "audible-local-follow"
          });

          if (playbackOutcome.shouldEnsurePlaybackStart) {
            ensurePlaybackStart(activePlaybackSource);
          } else if (playbackOutcome.shouldPausePlayback) {
            audio.pause();
            audio.playbackRate = 1;
          }
        });
        return;
      }

      const noEngineHoldAction = resolveSlidingWindowNoEngineHoldAction({
        activePlaybackSource,
        playbackStatus: playbackState.status,
        hasPcmEngine: false,
        hasMseEngine: false,
        localAudioHasSource: !!(audio.srcObject || audio.src || audio.getAttribute("src"))
      });
      if (noEngineHoldAction.shouldHold) {
        if (noEngineHoldAction.shouldPauseAudio) {
          audio.pause();
          audio.muted = false;
          audio.playbackRate = 1;
        }
        if (noEngineHoldAction.shouldClearAudioSource) {
          audio.srcObject = null;
          audio.removeAttribute("src");
          audio.load();
        }
        if (noEngineHoldAction.mediaConnectionState) {
          setMediaConnectionState(noEngineHoldAction.mediaConnectionState);
        }
        return;
      }

      syncLocalPlaybackWindow(audio, expectedSeconds, shouldPlayPlayback, {
        softDriftMs: 120,
        hardDriftMs: 900,
        correctionMode: "audible-local-follow"
      });

      const fallbackPlaybackAction = resolveSlidingWindowFallbackPlaybackAction({
        shouldPlayPlayback,
        startupReady: progressiveStartupReady
      });
      if (fallbackPlaybackAction.shouldClearFallbackReason) {
        setProgressiveFallbackReason(null);
      }
      if (fallbackPlaybackAction.shouldEnsurePlaybackStart) {
        ensurePlaybackStart(activePlaybackSource);
      } else if (fallbackPlaybackAction.shouldPausePlayback) {
        audio.pause();
        audio.playbackRate = 1;
      }

      return;
    }

    const pausedPlaybackAction = resolveMainPausedPlaybackAction(playbackState.status);
    if (pausedPlaybackAction) {
      if (pausedPlaybackAction.shouldPausePlayback) {
        audio.pause();
      }
      if (pausedPlaybackAction.shouldResetPlaybackRate) {
        audio.playbackRate = 1;
      }
    }

    void currentProgressiveEngineType;
    void setStatusMessage;
  }, [
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    currentProgressiveEngineType,
    currentTrackDurationMs,
    destroyProgressiveRuntime,
    ensurePlaybackStart,
    forceSourceOwnerLocalPlayback,
    fullLocalPlaybackTracks,
    isCurrentSourceOwner,
    markPlaybackStartFailure,
    markPcmRuntimeFailure,
    pcmLastBlockedReasonRef,
    playbackPositionKey,
    playbackRef,
    progressiveEngineRef,
    progressivePcmEngineRef,
    progressiveStartupReady,
    setActivePlaybackSource,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setProgressiveFallbackReason,
    setStatusMessage,
    startupBufferMs,
    uploadedTracks,
    volume
  ]);
}
