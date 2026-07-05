"use client";

import { useEffect, type MutableRefObject, type RefObject, type Dispatch, type SetStateAction } from "react";
import type { PlaybackSnapshot, RoomMediaConnectionState } from "@music-room/shared";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  hasActivePlaybackIntent,
  type ProgressivePlaybackSource
} from "../progressive-playback";
import {
  getAudibleElementVolume,
  resolveFullLocalReadyPlaybackResult,
  resolveListenerMediaConnectionState,
  resolveLocalPlaybackReady,
  resolveLocalReadyPlaybackAction
} from "./pipeline";

type AttemptPlaybackStart = (
  audio: HTMLAudioElement,
  source: ProgressivePlaybackSource,
  blockedMessage: string,
  blockedReason: string,
  options: { reportFailure: boolean }
) => Promise<boolean>;

type LocalPlaybackReadinessControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  attemptPlaybackStart: AttemptPlaybackStart;
  audioRef: RefObject<HTMLAudioElement | null>;
  ensurePlaybackStart: (source: ProgressivePlaybackSource) => void;
  isCurrentSourceOwner: boolean;
  mediaConnectedPeersCount: number;
  playbackCurrentTrackId: string | null;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  playbackStatus: PlaybackSnapshot["status"] | null;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  setMediaConnectionState: Dispatch<SetStateAction<RoomMediaConnectionState>>;
  volume: number;
};

export function useLocalPlaybackReadinessController({
  activePlaybackSource,
  attemptPlaybackStart,
  audioRef,
  ensurePlaybackStart,
  isCurrentSourceOwner,
  mediaConnectedPeersCount,
  playbackCurrentTrackId,
  playbackRef,
  playbackStatus,
  recordPeerDiagnostic,
  setMediaConnectionState,
  volume
}: LocalPlaybackReadinessControllerInput) {
  useEffect(() => {
    const localAudio = audioRef.current;
    const localReadyEvents: Array<keyof HTMLMediaElementEventMap> = [
      "loadedmetadata",
      "canplay",
      "playing"
    ];
    const handleLocalReady = () => {
      const localReadyAction = resolveLocalReadyPlaybackAction({
        activePlaybackSource,
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
        localAudioPaused: !!localAudio?.paused
      });
      if (localReadyAction.shouldEnsurePlaybackStart) {
        ensurePlaybackStart(activePlaybackSource);
      }
      if (localReadyAction.shouldAttemptFullLocalPlayback && localAudio) {
        localAudio.muted = false;
        localAudio.volume = getAudibleElementVolume(volume);
        void attemptPlaybackStart(
          localAudio,
          "full-local",
          "浏览器阻止了本地音频自动播放，请手动点击播放恢复。",
          "full-local-play-blocked",
          { reportFailure: true }
        ).then((ok) => {
          const readyPlaybackResult = resolveFullLocalReadyPlaybackResult(ok);
          setMediaConnectionState(readyPlaybackResult.mediaConnectionState);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: readyPlaybackResult.diagnosticEvent,
            summary: readyPlaybackResult.diagnosticSummary,
            recordEvent: readyPlaybackResult.recordEvent
          });
        });
      }
    };
    for (const eventName of localReadyEvents) {
      localAudio?.addEventListener(eventName, handleLocalReady);
    }

    return () => {
      for (const eventName of localReadyEvents) {
        localAudio?.removeEventListener(eventName, handleLocalReady);
      }
    };
  }, [
    activePlaybackSource,
    attemptPlaybackStart,
    audioRef,
    ensurePlaybackStart,
    playbackRef,
    recordPeerDiagnostic,
    setMediaConnectionState,
    volume
  ]);

  useEffect(() => {
    const nextPlayback = playbackRef.current;

    const localAudio = audioRef.current;
    const localPlaybackReady = resolveLocalPlaybackReady({
      hasAudio: !!localAudio,
      localAudioPaused: localAudio?.paused ?? true,
      localAudioReadyState: localAudio?.readyState ?? 0,
      localAudioHasSrcObject: !!localAudio?.srcObject,
      localAudioHasCurrentSrc: !!localAudio?.currentSrc
    });
    const nextMediaConnectionState = resolveListenerMediaConnectionState({
      currentTrackId: nextPlayback?.currentTrackId ?? null,
      isCurrentSourceOwner,
      playbackHasActiveIntent: hasActivePlaybackIntent(nextPlayback),
      localPlaybackReady
    });
    if (nextMediaConnectionState !== null) {
      setMediaConnectionState(nextMediaConnectionState);
    }
    void mediaConnectedPeersCount;
  }, [
    activePlaybackSource,
    audioRef,
    isCurrentSourceOwner,
    mediaConnectedPeersCount,
    playbackCurrentTrackId,
    playbackRef,
    playbackStatus,
    setMediaConnectionState
  ]);
}
