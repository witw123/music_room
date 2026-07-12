"use client";

import {
  getFullLocalStableWindowMs
} from "./progressive-playback";
import {
  usePlaybackRuntimeTickOrchestrator
} from "./playback-orchestrator/use-runtime-tick-orchestrator";
import { usePlaybackRuntimeControllerStack } from "./playback-orchestrator/playback-runtime-controller-stack";
import { usePlaybackRuntimeInputState } from "./playback-orchestrator/playback-runtime-input-state";
import { usePlaybackRuntimeRefs } from "./playback-orchestrator/playback-runtime-refs";
import type {
  UseProgressiveRuntimeInput,
  UseProgressiveRuntimeResult
} from "./playback-orchestrator/runtime-types";

// Re-exported for backward compatibility with existing import sites/tests.
export * from "./playback-orchestrator/playback-runtime-compat-exports";
export type {
  FullLocalPlaybackTrack,
  UseProgressiveRuntimeInput,
  UseProgressiveRuntimeResult
} from "./playback-orchestrator/runtime-types";

const progressiveSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalSwitchDelayMs = getFullLocalStableWindowMs();
const fullLocalMaxDriftMs = 180;
const enableTrackCaching = true;
const enableDirectProgressiveTakeover = enableTrackCaching;
const enableListenerLocalTakeover = enableTrackCaching;
const adaptiveStartupBufferMs = 8_000;
const pcmSlidingWindowPlayRetryIntervalMs = 1_000;

export function useProgressiveRuntime({
  audioRef,
  roomSnapshot,
  currentTrack,
  peerId,
  availabilityByTrack,
  uploadedTracks,
  fullLocalPlaybackTracks,
  isCurrentSourceOwner,
  activePlaybackSource,
  setActivePlaybackSource,
  progressiveFallbackReason,
  setProgressiveFallbackReason,
  playbackStartIntent,
  setPlaybackStartIntent,
  audioUnlocked,
  setAudioUnlocked,
  roomRecoveryState,
  isPageVisible,
  volume,
  connectedPeersCount,
  mediaConnectedPeersCount,
  peerDiagnostics,
  recordPeerDiagnostic,
  setStatusMessage,
  setSchedulerMode,
  setBufferHealth,
  setMediaConnectionState
}: UseProgressiveRuntimeInput): UseProgressiveRuntimeResult {
  const refs = usePlaybackRuntimeRefs();
  const tickRefs = usePlaybackRuntimeTickOrchestrator();
  const inputState = usePlaybackRuntimeInputState({
    activePlaybackSource,
    availabilityByTrack,
    currentTrack,
    fullLocalPlaybackTracks,
    isCurrentSourceOwner,
    pcmRuntimeFailureRef: refs.pcmRuntimeFailureRef,
    peerDiagnostics,
    peerId,
    playbackStartIntent,
    progressiveFallbackReason,
    roomSnapshot,
    trackCachingEnabled: enableTrackCaching,
    uploadedTracks
  });
  return usePlaybackRuntimeControllerStack({
    activePlaybackSource,
    audioRef,
    audioUnlocked,
    availabilityByTrack,
    connectedPeersCount,
    currentTrack,
    directProgressiveTakeoverEnabled: enableDirectProgressiveTakeover,
    fullLocalMaxDriftMs,
    fullLocalPlaybackTracks,
    fullLocalSwitchDelayMs,
    inputState,
    isCurrentSourceOwner,
    isPageVisible,
    listenerLocalTakeoverEnabled: enableListenerLocalTakeover,
    mediaConnectedPeersCount,
    pcmSlidingWindowPlayRetryIntervalMs,
    peerId,
    playbackStartIntent,
    progressiveFallbackReason,
    progressiveSwitchDelayMs,
    recordPeerDiagnostic,
    refs,
    roomRecoveryState,
    roomSnapshot,
    setActivePlaybackSource,
    setAudioUnlocked,
    setBufferHealth,
    setMediaConnectionState,
    setPlaybackStartIntent,
    setProgressiveFallbackReason,
    setSchedulerMode,
    setStatusMessage,
    startupBufferMs: adaptiveStartupBufferMs,
    tickRefs,
    uploadedTracks,
    volume
  });
}
