"use client";

import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import { toUserFacingError } from "@/lib/music-room-ui";
import {
  createPlaybackStartIntent,
  type PlaybackStartIntent
} from "@/features/playback/playback-start-intent";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import type { PeerDiagnosticRecorder } from "@/features/p2p/use-peer-diagnostics";

type UseRoomPlaybackActionsInput = {
  currentPlaybackPositionRef: MutableRefObject<number>;
  roomSnapshot: RoomSnapshot | null;
  currentPlaybackTrackId: string | null;
  playbackMediaEpoch: number | null;
  playbackQueueVersion: number | null;
  playbackRevision: number | null;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"] | null;
  isCurrentSourceOwner: boolean;
  audioUnlocked: boolean;
  handleTrackFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  playTrack: (trackId?: string) => Promise<unknown>;
  playQueueItem: (queueItemId: string) => Promise<unknown>;
  prevTrack: () => Promise<unknown>;
  nextTrack: () => Promise<unknown>;
  recordPeerDiagnostic: PeerDiagnosticRecorder;
  setAudioBlockedOverlay: Dispatch<SetStateAction<boolean>>;
  setAudioUnlocked: Dispatch<SetStateAction<boolean>>;
  setLastSourceStartError: Dispatch<SetStateAction<string | null>>;
  setPlaybackStartIntent: Dispatch<SetStateAction<PlaybackStartIntent | null>>;
  setSchedulerPlaybackBucketMs: Dispatch<SetStateAction<number>>;
  setStatusMessage: (value: string) => void;
};

export function startBestEffortPlaybackAudioUnlock(input: {
  unlockAudio: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}) {
  void input.unlockAudio().catch((error) => {
    input.onError?.(error);
  });
}

export function useRoomPlaybackActions({
  currentPlaybackPositionRef,
  roomSnapshot,
  currentPlaybackTrackId,
  playbackMediaEpoch,
  playbackQueueVersion,
  playbackRevision,
  playbackStatus,
  isCurrentSourceOwner,
  audioUnlocked,
  handleTrackFilesSelected,
  playTrack,
  playQueueItem,
  prevTrack,
  nextTrack,
  recordPeerDiagnostic,
  setAudioBlockedOverlay,
  setAudioUnlocked,
  setLastSourceStartError,
  setPlaybackStartIntent,
  setSchedulerPlaybackBucketMs,
  setStatusMessage
}: UseRoomPlaybackActionsInput) {
  const ensureRoomAudioUnlocked = useCallback(
    async (reason: string) => {
      if (roomAudioOutput.isActivated()) {
        setAudioUnlocked(true);
        setLastSourceStartError(null);
        return true;
      }

      try {
        const primeResult = await roomAudioOutput.primeOutputs({});
        setAudioUnlocked(primeResult.ok);
        if (!primeResult.ok) {
          const message = "浏览器仍未允许房间音频输出";
          setLastSourceStartError(message);
          setStatusMessage(message);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "audio-unlock-failed",
            level: "warning",
            summary: message,
            update: (snapshot) => ({
              ...snapshot,
              lastError: message,
              progressivePlaybackStatus: {
                ...(
                  snapshot.progressivePlaybackStatus ??
                  createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
                ),
                audioUnlocked: false,
                lastSourceStartError: message
              }
            })
          });
          return false;
        }
        setLastSourceStartError(null);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "audio-unlocked",
          summary: `房间音频已解锁：${reason}`,
          recordEvent: false,
          update: (snapshot) => ({
            ...snapshot,
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              audioUnlocked: true,
              lastSourceStartError: null
            }
          })
        });
        return true;
      } catch (error) {
        const message = toUserFacingError(error);
        setAudioUnlocked(roomAudioOutput.isActivated());
        setLastSourceStartError(message);
        recordPeerDiagnostic({
          peerId: "system",
          channelKind: "system",
          direction: "local",
          event: "audio-unlock-failed",
          level: "error",
          summary: `房间音频解锁失败：${message}`,
          update: (snapshot) => ({
            ...snapshot,
            lastError: `房间音频解锁失败：${message}`,
            progressivePlaybackStatus: {
              ...(
                snapshot.progressivePlaybackStatus ??
                createPeerSnapshot(snapshot.peerId, snapshot.updatedAt).progressivePlaybackStatus!
              ),
              audioUnlocked: roomAudioOutput.isActivated(),
              lastSourceStartError: message
            }
          })
        });
        return false;
      }
    },
    [
      recordPeerDiagnostic,
      setAudioUnlocked,
      setLastSourceStartError,
      setStatusMessage
    ]
  );

  const handlePlaybackPositionChange = useCallback((positionMs: number) => {
    currentPlaybackPositionRef.current = positionMs;
  }, [currentPlaybackPositionRef]);

  const handlePlaybackBucketChange = useCallback((bucketMs: number) => {
    setSchedulerPlaybackBucketMs((current) => (current === bucketMs ? current : bucketMs));
  }, [setSchedulerPlaybackBucketMs]);

  const handleFilesSelected = useCallback(
    async (files: FileList | File[] | null) => {
      try {
        if (files && Array.from(files).length > 0) {
          await ensureRoomAudioUnlocked("track-upload");
        }
        await handleTrackFilesSelected(files);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [ensureRoomAudioUnlocked, handleTrackFilesSelected, setStatusMessage]
  );

  const armPlaybackStart = useCallback(
    async (input: {
      reason: PlaybackStartIntent["reason"];
      trackId?: string | null;
      queueItemId?: string | null;
      previousTrackId?: string | null;
    }) => {
      setPlaybackStartIntent(
        createPlaybackStartIntent({
          reason: input.reason,
          trackId: input.trackId,
          queueItemId: input.queueItemId,
          previousTrackId: input.previousTrackId,
          targetPlaybackRevision:
            (playbackRevision ??
              playbackQueueVersion ??
              0) + 1,
          previousQueueVersion: playbackQueueVersion,
          previousMediaEpoch: playbackMediaEpoch
        })
      );
      setStatusMessage("正在准备音源...");
      startBestEffortPlaybackAudioUnlock({
        unlockAudio: () => ensureRoomAudioUnlocked(`playback-intent:${input.reason}`),
        onError: (error) => {
          const message = toUserFacingError(error);
          recordPeerDiagnostic({
            peerId: "system",
            channelKind: "system",
            direction: "local",
            event: "audio-prime-failed",
            level: "error",
            summary: `音频输出预激活失败：${message}`,
            update: (snapshot) => ({
              ...snapshot,
              lastError: `音频输出预激活失败：${message}`
            })
          });
          setStatusMessage("音频输出初始化失败，已跳过预激活并继续尝试播放。");
        }
      });
    },
    [
      ensureRoomAudioUnlocked,
      recordPeerDiagnostic,
      playbackMediaEpoch,
      playbackQueueVersion,
      playbackRevision,
      setPlaybackStartIntent,
      setStatusMessage
    ]
  );

  useEffect(() => {
    if (!roomSnapshot?.room.id || audioUnlocked) {
      return;
    }

    const handleFirstInteraction = () => {
      void ensureRoomAudioUnlocked("natural-room-interaction");
    };

    window.addEventListener("pointerdown", handleFirstInteraction, {
      capture: true,
      passive: true
    });
    window.addEventListener("touchstart", handleFirstInteraction, {
      capture: true,
      passive: true
    });
    window.addEventListener("keydown", handleFirstInteraction, true);

    return () => {
      window.removeEventListener("pointerdown", handleFirstInteraction, true);
      window.removeEventListener("touchstart", handleFirstInteraction, true);
      window.removeEventListener("keydown", handleFirstInteraction, true);
    };
  }, [audioUnlocked, ensureRoomAudioUnlocked, roomSnapshot?.room.id]);

  const handlePlayTrack = useCallback(
    async (trackId?: string) => {
      const targetTrackId = trackId ?? currentPlaybackTrackId ?? null;
      await armPlaybackStart({
        reason: trackId ? "track" : "resume-current",
        trackId: targetTrackId
      });
      await playTrack(trackId);
    },
    [armPlaybackStart, currentPlaybackTrackId, playTrack]
  );

  const handlePlayQueueItem = useCallback(
    async (queueItemId: string) => {
      const queueTrackId =
        roomSnapshot?.queue.find((item) => item.id === queueItemId)?.trackId ?? null;
      await armPlaybackStart({
        reason: "queue-item",
        queueItemId,
        trackId: queueTrackId,
        previousTrackId: currentPlaybackTrackId
      });
      await playQueueItem(queueItemId);
    },
    [
      armPlaybackStart,
      currentPlaybackTrackId,
      playQueueItem,
      roomSnapshot?.queue
    ]
  );

  const handlePrevTrack = useCallback(async () => {
    await armPlaybackStart({
      reason: "prev",
      previousTrackId: currentPlaybackTrackId
    });
    await prevTrack();
  }, [armPlaybackStart, currentPlaybackTrackId, prevTrack]);

  const handleNextTrack = useCallback(async () => {
    await armPlaybackStart({
      reason: "next",
      previousTrackId: currentPlaybackTrackId
    });
    await nextTrack();
  }, [armPlaybackStart, currentPlaybackTrackId, nextTrack]);

  useEffect(() => {
    if (
      !audioUnlocked &&
      !isCurrentSourceOwner &&
      playbackStatus === "playing" &&
      currentPlaybackTrackId
    ) {
      const timer = window.setTimeout(() => {
        if (!roomAudioOutput.isActivated()) {
          setAudioBlockedOverlay(true);
        }
      }, 1500);
      return () => window.clearTimeout(timer);
    }

    setAudioBlockedOverlay(false);
  }, [
    audioUnlocked,
    currentPlaybackTrackId,
    isCurrentSourceOwner,
    playbackStatus,
    setAudioBlockedOverlay
  ]);

  const handleAudioUnlock = useCallback(async () => {
    setAudioBlockedOverlay(false);
    const primeResult = await roomAudioOutput.primeOutputs({});
    setAudioUnlocked(primeResult.ok);
    if (primeResult.ok) {
      setStatusMessage("");
      return;
    }
    setStatusMessage("浏览器仍未允许音频输出，请再次点击播放或检查系统媒体权限。");
    setAudioBlockedOverlay(true);
  }, [setAudioBlockedOverlay, setAudioUnlocked, setStatusMessage]);

  return {
    handleAudioUnlock,
    handleFilesSelected,
    handleNextTrack,
    handlePlayQueueItem,
    handlePlaybackBucketChange,
    handlePlaybackPositionChange,
    handlePlayTrack,
    handlePrevTrack
  };
}
