"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { PlaybackSnapshot } from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";
import {
  consumePlaybackStartIntent,
  doesPlaybackMatchStartIntent,
  failPlaybackStartIntent,
  isPlaybackStartIntentPending,
  type PlaybackStartIntent
} from "../playback-start-intent";
import {
  hasActivePlaybackIntent,
  type ProgressivePlaybackSource
} from "../progressive-playback";
import { roomAudioOutput } from "../room-audio-output";
import {
  resolvePlaybackStartFailureIntentAction,
  resolvePlaybackStartIntentTimeoutPreflight,
  resolvePlaybackStartIntentTimeoutResult,
  resolvePlaybackStartRetryClearAction,
  resolvePlaybackStartRetryPreflight,
  resolvePlaybackStartRetryResult
} from "./pipeline";

const playbackStartRetryDelayMs = 160;
const maxPlaybackStartRetryAttempts = 18;

type AttemptPlaybackStart = (
  element: HTMLAudioElement | null,
  source: ProgressivePlaybackSource,
  blockedMessage: string,
  failureReason: string,
  options?: {
    reportFailure?: boolean;
  }
) => Promise<boolean>;

type PlaybackStartIntentControllerInput = {
  activePlaybackSource: ProgressivePlaybackSource;
  audioRef: RefObject<HTMLAudioElement | null>;
  playbackCurrentTrackId: string | null;
  playbackStatus: PlaybackSnapshot["status"] | null;
  playbackRef: MutableRefObject<PlaybackSnapshot | null | undefined>;
  playbackStartIntent: PlaybackStartIntent | null;
  setAudioPaused: Dispatch<SetStateAction<boolean | null>>;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
  setStatusMessage: (value: string) => void;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
};

type PlaybackStartIntentControllerResult = {
  attemptPlaybackStart: AttemptPlaybackStart;
  attemptPlaybackStartRef: MutableRefObject<AttemptPlaybackStart>;
  clearPlaybackStartRetry: () => void;
  ensurePlaybackStart: (source: ProgressivePlaybackSource, attempt?: number) => void;
  markPlaybackStartFailure: (failure: string, fallbackMessage: string) => void;
};

export function usePlaybackStartIntentController({
  activePlaybackSource,
  audioRef,
  playbackCurrentTrackId,
  playbackStatus,
  playbackRef,
  playbackStartIntent,
  setAudioPaused,
  setPlaybackStartIntent,
  setStatusMessage,
  recordPeerDiagnostic
}: PlaybackStartIntentControllerInput): PlaybackStartIntentControllerResult {
  const playbackStartRetryRef = useRef<number | null>(null);

  const clearPlaybackStartRetry = useCallback(() => {
    if (playbackStartRetryRef.current !== null) {
      window.clearTimeout(playbackStartRetryRef.current);
      playbackStartRetryRef.current = null;
    }
  }, []);

  const updatePlaybackStartIntent = useCallback(
    (updater: (current: PlaybackStartIntent) => PlaybackStartIntent) => {
      setPlaybackStartIntent((current) => (current ? updater(current) : current));
    },
    [setPlaybackStartIntent]
  );

  const markPlaybackStartFailure = useCallback(
    (failure: string, fallbackMessage: string) => {
      if (!playbackStartIntent || !isPlaybackStartIntentPending(playbackStartIntent)) {
        return;
      }

      updatePlaybackStartIntent((current) => failPlaybackStartIntent(current, failure));
      setStatusMessage(fallbackMessage);
    },
    [playbackStartIntent, setStatusMessage, updatePlaybackStartIntent]
  );

  const attemptPlaybackStart = useCallback<AttemptPlaybackStart>(
    async (element, source, blockedMessage, failureReason, options) => {
      if (!element) {
        return false;
      }

      const playResult = await roomAudioOutput.playElement(element);
      if (!playResult.ok) {
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "local-play-start-failed",
          level: "warning",
          summary: `${failureReason}: ${playResult.error ?? "play() failed"}`,
          recordEvent: false,
          update: (snapshot) => ({
            ...snapshot,
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              lastPlayStartFailure: failureReason
            }
          })
        });
        const matchedIntent = doesPlaybackMatchStartIntent(
          playbackStartIntent,
          playbackRef.current
        );
        const failureIntentAction = resolvePlaybackStartFailureIntentAction({
          reportFailure: options?.reportFailure !== false,
          intentMatchesPlayback: matchedIntent,
          blockedMessage
        });
        if (failureIntentAction.shouldMarkFailure && failureIntentAction.statusMessage) {
          markPlaybackStartFailure(failureReason, failureIntentAction.statusMessage);
        }
        return false;
      }

      if (doesPlaybackMatchStartIntent(playbackStartIntent, playbackRef.current)) {
        updatePlaybackStartIntent((current) => consumePlaybackStartIntent(current, source));
      }
      setAudioPaused(false);

      return true;
    },
    [
      markPlaybackStartFailure,
      playbackRef,
      playbackStartIntent,
      recordPeerDiagnostic,
      setAudioPaused,
      updatePlaybackStartIntent
    ]
  );
  const attemptPlaybackStartRef = useRef<AttemptPlaybackStart>(attemptPlaybackStart);
  attemptPlaybackStartRef.current = attemptPlaybackStart;

  const ensurePlaybackStart = useCallback(
    (source: ProgressivePlaybackSource, attempt = 0) => {
      clearPlaybackStartRetry();

      const pendingIntent =
        !!playbackStartIntent && isPlaybackStartIntentPending(playbackStartIntent);
      const retryPreflight = resolvePlaybackStartRetryPreflight({
        playbackHasActiveIntent: hasActivePlaybackIntent(playbackRef.current),
        activePlaybackSource,
        requestedSource: source,
        pendingIntent,
        attempt,
        maxRetryAttempts: maxPlaybackStartRetryAttempts
      });
      if (!retryPreflight) {
        return;
      }

      const targetElement = audioRef.current;
      const blockedMessage = "浏览器阻止了本地音频自动播放，请手动点击播放恢复。";
      void attemptPlaybackStart(targetElement, source, blockedMessage, retryPreflight.failureReason, {
        reportFailure: retryPreflight.reportFailure
      }).then((ok) => {
        const retryResult = resolvePlaybackStartRetryResult({
          playbackStarted: ok,
          attempt,
          maxRetryAttempts: maxPlaybackStartRetryAttempts
        });
        if (retryResult.shouldClearRetry) {
          clearPlaybackStartRetry();
        }

        if (!retryResult.shouldScheduleRetry) {
          return;
        }

        playbackStartRetryRef.current = window.setTimeout(() => {
          ensurePlaybackStart(source, attempt + 1);
        }, playbackStartRetryDelayMs);
      });
    },
    [
      activePlaybackSource,
      attemptPlaybackStart,
      audioRef,
      clearPlaybackStartRetry,
      playbackRef,
      playbackStartIntent
    ]
  );

  useEffect(() => {
    const timeoutPreflight = resolvePlaybackStartIntentTimeoutPreflight({
      hasIntent: !!playbackStartIntent,
      intentPending: isPlaybackStartIntentPending(playbackStartIntent),
      expiresAtMs: playbackStartIntent?.expiresAt ?? 0,
      nowMs: Date.now()
    });
    if (!timeoutPreflight || !playbackStartIntent) {
      return;
    }

    const timerId = window.setTimeout(() => {
      setPlaybackStartIntent((current) => {
        const timeoutResult = resolvePlaybackStartIntentTimeoutResult({
          hasCurrentIntent: !!current,
          currentIntentId: current?.id ?? null,
          targetIntentId: playbackStartIntent.id,
          currentIntentPending: isPlaybackStartIntentPending(current)
        });
        if (timeoutResult === "keep") {
          return current;
        }

        if (!current) {
          return current;
        }

        return failPlaybackStartIntent(current, "intent-timeout");
      });
      setStatusMessage("当前点击未能激活音频，请再次点击播放");
    }, timeoutPreflight.timeoutMs);

    return () => window.clearTimeout(timerId);
  }, [playbackStartIntent, setPlaybackStartIntent, setStatusMessage]);

  useEffect(() => {
    if (resolvePlaybackStartRetryClearAction(hasActivePlaybackIntent(playbackRef.current))) {
      clearPlaybackStartRetry();
    }
  }, [
    clearPlaybackStartRetry,
    playbackCurrentTrackId,
    playbackRef,
    playbackStatus
  ]);

  return {
    attemptPlaybackStart,
    attemptPlaybackStartRef,
    clearPlaybackStartRetry,
    ensurePlaybackStart,
    markPlaybackStartFailure
  };
}
