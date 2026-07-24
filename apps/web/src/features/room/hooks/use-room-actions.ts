"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import {
  errorCodes,
  type AuthSession,
  type PlaybackMode,
  type PlaybackSnapshot,
  type QueueItem,
  type RoomMemberPermissions,
  type RoomSnapshot,
  type UpdateRoomRequest
} from "@music-room/shared";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { roomAudioOutput } from "@/features/playback/room-audio-output";
import { getRoomPlaybackClockNowMs } from "@/features/playback/room-playback-clock";

type UseRoomActionsOptions = {
  activeSession: AuthSession | null;
  roomSnapshot: RoomSnapshot | null;
  dispatchRoomStateEvent: Dispatch<RoomStateEvent>;
  setSuppressRoomRecovery: Dispatch<SetStateAction<boolean>>;
  setStatusMessage: (value: string) => void;
  refreshAvailableRooms: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  resetPlayerSurface: () => void;
  resetRealtimePeer: () => void;
  lastRoomStorageKey: string;
  getCurrentPlaybackPositionMs: () => number;
  getCurrentPeerId?: () => string | null;
  onTrackDeleted?: (trackId: string) => Promise<void> | void;
  onRoomDeleted?: (trackIds: string[]) => Promise<void> | void;
};

export async function runBestEffortRoomLeave(input: {
  roomId: string;
  leaveRemote: (roomId: string) => Promise<unknown>;
  completeLocalExit: () => Promise<void> | void;
  remoteWaitMs?: number;
}) {
  const remoteLeave = Promise.resolve()
    .then(() => input.leaveRemote(input.roomId))
    .then(() => ({
      remoteStatus: "confirmed" as const,
      remoteError: null
    }))
    .catch((error) => ({
      remoteStatus: "failed" as const,
      remoteError: error
    }));

  await input.completeLocalExit();

  const remoteWaitMs = input.remoteWaitMs ?? 1_200;
  return Promise.race([
    remoteLeave,
    new Promise<{ remoteStatus: "pending"; remoteError: null }>((resolve) => {
      globalThis.setTimeout(() => {
        resolve({
          remoteStatus: "pending",
          remoteError: null
        });
      }, remoteWaitMs);
    })
  ]);
}

export function shouldResetPlayerAfterQueueRemoval(
  previousPlayback: Pick<PlaybackSnapshot, "currentTrackId">,
  nextPlayback: Pick<PlaybackSnapshot, "currentTrackId">
) {
  return Boolean(previousPlayback.currentTrackId && !nextPlayback.currentTrackId);
}

export function shouldResetPlayerAfterTrackRemoval(
  removedTrackId: string,
  currentTrackId: string | null | undefined
) {
  return removedTrackId === currentTrackId;
}

type PlaybackMutationTarget = Pick<
  PlaybackSnapshot,
  "currentTrackId" | "currentQueueItemId"
>;

type PlaybackMutationOptions = {
  refreshSnapshotOnSuccess?: boolean;
};

export function shouldRetryPlaybackMutationAfterConflict(
  expectedTarget: PlaybackMutationTarget,
  latestPlayback: PlaybackMutationTarget
) {
  return (
    expectedTarget.currentTrackId === latestPlayback.currentTrackId &&
    expectedTarget.currentQueueItemId === latestPlayback.currentQueueItemId
  );
}

export function createOptimisticSeekPlayback(input: {
  playback: PlaybackSnapshot;
  positionMs: number;
  durationMs?: number | null;
  nowMs?: number;
}) {
  const durationMs = input.durationMs ?? 0;
  const positionMs = durationMs > 0
    ? Math.min(Math.max(0, input.positionMs), durationMs)
    : Math.max(0, input.positionMs);
  const timelineStart = input.playback.status === "playing"
    ? new Date(input.nowMs ?? getRoomPlaybackClockNowMs()).toISOString()
    : null;

  return {
    ...input.playback,
    positionMs,
    startAt: timelineStart,
    startedAt: timelineStart,
    playbackRevision: input.playback.playbackRevision + 1
  } satisfies PlaybackSnapshot;
}

export function useRoomActions({
  activeSession,
  roomSnapshot,
  dispatchRoomStateEvent,
  setSuppressRoomRecovery,
  setStatusMessage,
  refreshAvailableRooms,
  refreshPlaylists,
  resetPlayerSurface,
  resetRealtimePeer,
  lastRoomStorageKey,
  getCurrentPlaybackPositionMs,
  getCurrentPeerId,
  onTrackDeleted,
  onRoomDeleted
}: UseRoomActionsOptions) {
  const playbackMutationChainRef = useRef<Promise<void>>(Promise.resolve());
  const latestPlaybackStateRef = useRef<{
    roomId: string | null;
    revision: number | null;
  }>({
    roomId: roomSnapshot?.room.id ?? null,
    revision: roomSnapshot?.room.playback.playbackRevision ?? null
  });
  const renderedRoomId = roomSnapshot?.room.id ?? null;
  const renderedPlaybackRevision = roomSnapshot?.room.playback.playbackRevision ?? null;
  if (latestPlaybackStateRef.current.roomId !== renderedRoomId) {
    latestPlaybackStateRef.current = {
      roomId: renderedRoomId,
      revision: renderedPlaybackRevision
    };
  }
  if (
    renderedPlaybackRevision !== null &&
    latestPlaybackStateRef.current.roomId === renderedRoomId &&
    (latestPlaybackStateRef.current.revision === null ||
      renderedPlaybackRevision >= latestPlaybackStateRef.current.revision)
  ) {
    latestPlaybackStateRef.current.revision = renderedPlaybackRevision;
  }

  const syncRoomSnapshot = useCallback(
    async (roomId: string) => {
      const snapshot = await musicRoomApi.getRoom(roomId);
      dispatchRoomStateEvent({
        type: "recover-snapshot",
        snapshot
      });
      return snapshot;
    },
    [dispatchRoomStateEvent]
  );

  const updateRoom = useCallback(
    async (input: UpdateRoomRequest) => {
      if (!activeSession || !roomSnapshot || roomSnapshot.room.hostId !== activeSession.userId) {
        return false;
      }

      try {
        const snapshot = await musicRoomApi.updateRoom(roomSnapshot.room.id, input);
        dispatchRoomStateEvent({
          type: "recover-snapshot",
          snapshot
        });
        setStatusMessage("房间信息已更新。");
        return true;
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
        return false;
      }
    },
    [activeSession, dispatchRoomStateEvent, roomSnapshot, setStatusMessage]
  );

  const updateMemberPermissions = useCallback(
    async (memberId: string, permissions: RoomMemberPermissions) => {
      if (!activeSession || !roomSnapshot || roomSnapshot.room.hostId !== activeSession.userId) {
        return false;
      }

      try {
        const snapshot = await musicRoomApi.updateRoomMemberPermissions(
          roomSnapshot.room.id,
          memberId,
          permissions
        );
        dispatchRoomStateEvent({ type: "recover-snapshot", snapshot });
        setStatusMessage("成员权限已更新。");
        return true;
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
        return false;
      }
    },
    [activeSession, dispatchRoomStateEvent, roomSnapshot, setStatusMessage]
  );

  const removeMember = useCallback(
    async (memberId: string) => {
      if (!activeSession || !roomSnapshot || roomSnapshot.room.hostId !== activeSession.userId) {
        return false;
      }

      try {
        const snapshot = await musicRoomApi.removeRoomMember(roomSnapshot.room.id, memberId);
        dispatchRoomStateEvent({ type: "recover-snapshot", snapshot });
        setStatusMessage("成员已移出房间。");
        return true;
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
        return false;
      }
    },
    [activeSession, dispatchRoomStateEvent, roomSnapshot, setStatusMessage]
  );

  const runPlaybackMutation = useCallback(
    async (
      roomId: string,
      expectedVersion: number,
      requestPlayback: (nextExpectedVersion: number) => Promise<PlaybackSnapshot>,
      retryTarget?: PlaybackMutationTarget,
      options?: PlaybackMutationOptions
    ) => {
      const execute = async () => {
        if (latestPlaybackStateRef.current.roomId !== roomId) {
          latestPlaybackStateRef.current = {
            roomId,
            revision: null
          };
        }
        let nextExpectedVersion = Math.max(
          expectedVersion,
          latestPlaybackStateRef.current.revision ?? 0
        );

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const playback = await requestPlayback(nextExpectedVersion);
            if (latestPlaybackStateRef.current.roomId === roomId) {
              latestPlaybackStateRef.current.revision = playback.playbackRevision;
            }
            dispatchRoomStateEvent({
              type: "server-playback-patch",
              roomId,
              playback
            });
            if (options?.refreshSnapshotOnSuccess !== false) {
              void syncRoomSnapshot(roomId).catch(() => undefined);
            }
            return playback;
          } catch (error) {
            const isVersionConflict =
              (error instanceof MusicRoomApiError &&
                error.code === errorCodes.playbackVersionConflict) ||
              (error instanceof Error && error.message.includes("Playback state version conflict"));

            if (!isVersionConflict) {
              // A request can commit on the server while its response is lost.
              // Reconcile once before reporting an error so the player does not
              // remain on a stale track after a successful cut.
              try {
                const snapshot = await syncRoomSnapshot(roomId);
                if (
                  snapshot.room.playback.playbackRevision > nextExpectedVersion ||
                  (retryTarget &&
                    shouldRetryPlaybackMutationAfterConflict(
                      retryTarget,
                      snapshot.room.playback
                    ))
                ) {
                  return snapshot.room.playback;
                }
              } catch {
                // Preserve the original request error when reconciliation also fails.
              }
              setStatusMessage(toUserFacingError(error));
              return null;
            }

            if (attempt === 1) {
              setStatusMessage(toUserFacingError(error));
              return null;
            }

            try {
              const snapshot = await syncRoomSnapshot(roomId);
              if (latestPlaybackStateRef.current.roomId === roomId) {
                latestPlaybackStateRef.current.revision = snapshot.room.playback.playbackRevision;
              }
              if (
                retryTarget &&
                !shouldRetryPlaybackMutationAfterConflict(
                  retryTarget,
                  snapshot.room.playback
                )
              ) {
                setStatusMessage("播放曲目已更新，本次操作未重试。");
                return null;
              }
              nextExpectedVersion = snapshot.room.playback.playbackRevision;
            } catch (refreshError) {
              setStatusMessage(toUserFacingError(refreshError));
              return null;
            }
          }
        }

        return null;
      };
      const run = playbackMutationChainRef.current.then(execute, execute);
      playbackMutationChainRef.current = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
    [dispatchRoomStateEvent, setStatusMessage, syncRoomSnapshot]
  );

  const leaveRoom = useCallback(async () => {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      const result = await runBestEffortRoomLeave({
        roomId: roomSnapshot.room.id,
        leaveRemote: musicRoomApi.leaveRoom,
        completeLocalExit: async () => {
          setSuppressRoomRecovery(true);
          dispatchRoomStateEvent({ type: "local-reset" });
          resetPlayerSurface();
          roomAudioOutput.releaseRoomAudioSession();
          resetRealtimePeer();
          window.localStorage.removeItem(lastRoomStorageKey);
          void refreshAvailableRooms().catch(() => undefined);
        }
      });
      setStatusMessage(
        result.remoteStatus === "confirmed"
          ? "已离开房间。"
          : result.remoteStatus === "failed"
            ? "已离开本地房间，服务器离开请求未确认。"
            : "已离开房间，服务器确认仍在后台进行。"
      );
      return true;
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      return false;
    }
  }, [
    activeSession,
    dispatchRoomStateEvent,
    roomSnapshot,
    setSuppressRoomRecovery,
    resetPlayerSurface,
    resetRealtimePeer,
    lastRoomStorageKey,
    refreshAvailableRooms,
    setStatusMessage
  ]);

  const deleteRoom = useCallback(async () => {
    if (!activeSession || !roomSnapshot) {
      return false;
    }

    try {
      const trackIds = roomSnapshot.tracks.map((track) => track.id);
      await musicRoomApi.deleteRoom(roomSnapshot.room.id);
      setSuppressRoomRecovery(true);
      dispatchRoomStateEvent({ type: "local-reset" });
      resetPlayerSurface();
      roomAudioOutput.releaseRoomAudioSession();
      resetRealtimePeer();
      window.localStorage.removeItem(lastRoomStorageKey);
      try {
        await onRoomDeleted?.(trackIds);
      } catch {
        // Room deletion already succeeded on the server. Do not fail the exit flow
        // if optional local cleanup cannot finish.
      }
      await refreshAvailableRooms();
      setStatusMessage("房间已解散。");
      return true;
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
      return false;
    }
  }, [
    activeSession,
    dispatchRoomStateEvent,
    roomSnapshot,
    onRoomDeleted,
    setSuppressRoomRecovery,
    resetPlayerSurface,
    resetRealtimePeer,
    lastRoomStorageKey,
    refreshAvailableRooms,
    setStatusMessage
  ]);

  const addToQueue = useCallback(
    async (trackId: string): Promise<QueueItem | null> => {
      if (!activeSession || !roomSnapshot) {
        return null;
      }

      try {
        const result = await musicRoomApi.addQueueItem(roomSnapshot.room.id, { trackId });
        dispatchRoomStateEvent({
          type: "server-queue-patch",
          roomId: roomSnapshot.room.id,
          queue: result.queue,
          playback: result.playback
        });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌曲已加入共享队列。");
        return [...result.queue]
          .reverse()
          .find((item) => item.trackId === trackId && item.requestedById === activeSession.userId)
          ?? null;
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
        return null;
      }
    },
    [
      activeSession,
      dispatchRoomStateEvent,
      roomSnapshot,
      setStatusMessage,
      syncRoomSnapshot
    ]
  );

  const deleteTrack = useCallback(
    async (trackId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        const shouldResetPlayer = shouldResetPlayerAfterTrackRemoval(
          trackId,
          roomSnapshot.room.playback.currentTrackId
        );
        await musicRoomApi.deleteTrack(roomSnapshot.room.id, trackId);
        if (shouldResetPlayer) {
          resetPlayerSurface();
        }
        await onTrackDeleted?.(trackId);
        await syncRoomSnapshot(roomSnapshot.room.id);
        await refreshPlaylists();
        setStatusMessage("歌曲已从房间曲库中删除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [
      activeSession,
      roomSnapshot,
      onTrackDeleted,
      syncRoomSnapshot,
      refreshPlaylists,
      resetPlayerSurface,
      setStatusMessage
    ]
  );

  const playTrack = useCallback(
    async (trackId?: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.playbackRevision,
        (expectedVersion) => {
          const selectedTrackId = trackId ?? roomSnapshot.room.playback.currentTrackId;
          const playbackAssetId = roomSnapshot.tracks.find(
            (track) => track.id === selectedTrackId
          )?.playbackAsset?.assetId;
          return musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "play",
            trackId,
            ...(playbackAssetId ? { playbackAssetId } : {}),
            actorPeerId: getCurrentPeerId?.() ?? undefined,
            expectedVersion
          });
        }
      );
    },
    [roomSnapshot, activeSession, getCurrentPeerId, runPlaybackMutation]
  );

  const playQueueItem = useCallback(
    async (queueItemId: string, trackId?: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.playbackRevision,
        (expectedVersion) => {
          const queueTrackId = trackId ?? roomSnapshot.queue.find((item) => item.id === queueItemId)?.trackId;
          const playbackAssetId = roomSnapshot.tracks.find(
            (track) => track.id === queueTrackId
          )?.playbackAsset?.assetId;
          return musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "play",
            queueItemId,
            ...(playbackAssetId ? { playbackAssetId } : {}),
            actorPeerId: getCurrentPeerId?.() ?? undefined,
            expectedVersion
          });
        }
      );
    },
    [roomSnapshot, activeSession, getCurrentPeerId, runPlaybackMutation]
  );

  const pauseTrack = useCallback(
    async (positionMs = getCurrentPlaybackPositionMs()) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.playbackRevision,
        (expectedVersion) => {
          const playbackAssetId = roomSnapshot.tracks.find(
            (track) => track.id === roomSnapshot.room.playback.currentTrackId
          )?.playbackAsset?.assetId;
          return musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "pause",
            positionMs,
            ...(playbackAssetId ? { playbackAssetId } : {}),
            actorPeerId: getCurrentPeerId?.() ?? undefined,
            expectedVersion
          });
        },
        roomSnapshot.room.playback
      );
    },
    [
      roomSnapshot,
      activeSession,
      getCurrentPlaybackPositionMs,
      getCurrentPeerId,
      runPlaybackMutation
    ]
  );

  const prevTrack = useCallback(async () => {
    if (!roomSnapshot || !activeSession || !roomSnapshot.room.playback.currentTrackId) {
      return;
    }

    await runPlaybackMutation(
      roomSnapshot.room.id,
      roomSnapshot.room.playback.playbackRevision,
      (expectedVersion) =>
        musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "prev",
          actorPeerId: getCurrentPeerId?.() ?? undefined,
          expectedVersion
        }),
      roomSnapshot.room.playback
    );
  }, [roomSnapshot, activeSession, getCurrentPeerId, runPlaybackMutation]);

  const nextTrack = useCallback(async () => {
    if (!roomSnapshot || !activeSession) {
      return;
    }

    await runPlaybackMutation(
      roomSnapshot.room.id,
      roomSnapshot.room.playback.playbackRevision,
      (expectedVersion) =>
        musicRoomApi.updatePlayback(roomSnapshot.room.id, {
          action: "next",
          actorPeerId: getCurrentPeerId?.() ?? undefined,
          expectedVersion
        }),
      roomSnapshot.room.playback
    );
  }, [roomSnapshot, activeSession, getCurrentPeerId, runPlaybackMutation]);

  const savePlaylistFromQueue = useCallback(
    async (title: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        await musicRoomApi.createPlaylistFromRoom({
          roomId: roomSnapshot.room.id,
          title,
          description: "从当前房间队列保存"
        });
        await refreshPlaylists();
        setStatusMessage(`歌单“${title}”已保存。`);
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, refreshPlaylists, setStatusMessage]
  );

  const updatePlaylistTitle = useCallback(
    async (playlistId: string, title: string) => {
      if (!activeSession) {
        return;
      }

      try {
        await musicRoomApi.updatePlaylist(playlistId, { title });
        await refreshPlaylists();
        setStatusMessage("歌单名称已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, refreshPlaylists, setStatusMessage]
  );

  const updatePlaylistTracks = useCallback(
    async (playlistId: string, trackIds: string[]) => {
      if (!activeSession) {
        return;
      }

      try {
        await musicRoomApi.updatePlaylist(playlistId, { trackIds });
        await refreshPlaylists();
        setStatusMessage("歌单曲目已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, refreshPlaylists, setStatusMessage]
  );

  const deletePlaylist = useCallback(
    async (playlistId: string) => {
      if (!activeSession) {
        return;
      }

      try {
        await musicRoomApi.deletePlaylist(playlistId);
        await refreshPlaylists();
        setStatusMessage("歌单已删除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, refreshPlaylists, setStatusMessage]
  );

  const loadPlaylistIntoRoom = useCallback(
    async (playlistId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        await musicRoomApi.importPlaylistToRoom(playlistId, {
          roomId: roomSnapshot.room.id
        });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌单已加入当前房间队列。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, setStatusMessage, syncRoomSnapshot]
  );

  const removeQueueItem = useCallback(
    async (queueItemId: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        const result = await musicRoomApi.removeQueueItem(roomSnapshot.room.id, queueItemId);
        dispatchRoomStateEvent({
          type: "server-queue-patch",
          roomId: roomSnapshot.room.id,
          queue: result.queue,
          playback: result.playback
        });
        if (shouldResetPlayerAfterQueueRemoval(roomSnapshot.room.playback, result.playback)) {
          resetPlayerSurface();
        }
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌曲已从队列中移除。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [
      roomSnapshot,
      activeSession,
      dispatchRoomStateEvent,
      resetPlayerSurface,
      setStatusMessage,
      syncRoomSnapshot
    ]
  );

  const reorderQueue = useCallback(
    async (queueItemIds: string[]) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      try {
        await musicRoomApi.reorderQueue(roomSnapshot.room.id, {
          queueItemIds
        });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("播放队列顺序已更新。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [roomSnapshot, activeSession, setStatusMessage, syncRoomSnapshot]
  );

  const setPlaybackMode = useCallback(
    async (playbackMode: PlaybackMode) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      const nextPlayback = await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.playbackRevision,
        (expectedVersion) =>
          musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "set-mode",
            playbackMode,
            actorPeerId: getCurrentPeerId?.() ?? undefined,
            expectedVersion
          }),
        undefined,
        { refreshSnapshotOnSuccess: false }
      );

      if (nextPlayback) {
        setStatusMessage("播放顺序已同步到房间");
      }
    },
    [activeSession, getCurrentPeerId, roomSnapshot, runPlaybackMutation, setStatusMessage]
  );

  const seekTrack = useCallback(
    async (positionMs: number) => {
      if (!roomSnapshot || !activeSession) {
        return null;
      }

      const currentPlayback = roomSnapshot.room.playback;
      if (!currentPlayback.currentTrackId) {
        return null;
      }
      const currentTrack = roomSnapshot.tracks.find(
        (track) => track.id === currentPlayback.currentTrackId
      );
      const optimisticPlayback = createOptimisticSeekPlayback({
        playback: currentPlayback,
        positionMs,
        durationMs: currentTrack?.durationMs
      });
      dispatchRoomStateEvent({
        type: "server-playback-patch",
        roomId: roomSnapshot.room.id,
        playback: optimisticPlayback
      });

      return runPlaybackMutation(
        roomSnapshot.room.id,
        currentPlayback.playbackRevision,
        (expectedVersion) => {
          const playbackAssetId = roomSnapshot.tracks.find(
            (track) => track.id === currentPlayback.currentTrackId
          )?.playbackAsset?.assetId;
          return musicRoomApi.updatePlayback(roomSnapshot.room.id, {
            action: "seek",
            positionMs: optimisticPlayback.positionMs,
            ...(playbackAssetId ? { playbackAssetId } : {}),
            actorPeerId: getCurrentPeerId?.() ?? undefined,
            expectedVersion
          });
        },
        currentPlayback
      );
    },
    [
      roomSnapshot,
      activeSession,
      dispatchRoomStateEvent,
      getCurrentPeerId,
      runPlaybackMutation
    ]
  );

  const handleEnded = useCallback(async () => {
    if (!roomSnapshot) {
      return;
    }

    await nextTrack();
  }, [roomSnapshot, nextTrack]);

  return {
    leaveRoom,
    deleteRoom,
    deleteTrack,
    addToQueue,
    playTrack,
    playQueueItem,
    pauseTrack,
    prevTrack,
    nextTrack,
    savePlaylistFromQueue,
    updatePlaylistTitle,
    updatePlaylistTracks,
    updateRoom,
    updateMemberPermissions,
    removeMember,
    deletePlaylist,
    loadPlaylistIntoRoom,
    removeQueueItem,
    reorderQueue,
    setPlaybackMode,
    seekTrack,
    handleEnded
  };
}
