"use client";

import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import {
  errorCodes,
  type AuthSession,
  type PlaybackSnapshot,
  type RoomSnapshot
} from "@music-room/shared";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";
import type { RoomStateEvent } from "@/features/room/room-state-reducer";
import { roomAudioOutput } from "@/features/playback/room-audio-output";

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
  removedQueueItemId: string,
  currentQueueItemId: string | null | undefined
) {
  return removedQueueItemId === currentQueueItemId;
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

export function shouldRetryPlaybackMutationAfterConflict(
  expectedTarget: PlaybackMutationTarget,
  latestPlayback: PlaybackMutationTarget
) {
  return (
    expectedTarget.currentTrackId === latestPlayback.currentTrackId &&
    expectedTarget.currentQueueItemId === latestPlayback.currentQueueItemId
  );
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

  const runPlaybackMutation = useCallback(
    async (
      roomId: string,
      expectedVersion: number,
      requestPlayback: (nextExpectedVersion: number) => Promise<PlaybackSnapshot>,
      retryTarget?: PlaybackMutationTarget
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
            void syncRoomSnapshot(roomId).catch(() => undefined);
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
    async (trackId: string) => {
      if (!activeSession || !roomSnapshot) {
        return;
      }

      try {
        await musicRoomApi.addQueueItem(roomSnapshot.room.id, { trackId });
        void syncRoomSnapshot(roomSnapshot.room.id).catch(() => undefined);
        setStatusMessage("歌曲已加入共享队列。");
      } catch (error) {
        setStatusMessage(toUserFacingError(error));
      }
    },
    [activeSession, roomSnapshot, setStatusMessage, syncRoomSnapshot]
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
    async (queueItemId: string) => {
      if (!roomSnapshot || !activeSession) {
        return;
      }

      await runPlaybackMutation(
        roomSnapshot.room.id,
        roomSnapshot.room.playback.playbackRevision,
        (expectedVersion) => {
          const queueTrackId = roomSnapshot.queue.find((item) => item.id === queueItemId)?.trackId;
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
        })
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
        })
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
        const shouldResetPlayer = shouldResetPlayerAfterQueueRemoval(
          queueItemId,
          roomSnapshot.room.playback.currentQueueItemId
        );
        const result = await musicRoomApi.removeQueueItem(roomSnapshot.room.id, queueItemId);
        if (shouldResetPlayer) {
          resetPlayerSurface();
        }
        dispatchRoomStateEvent({
          type: "server-queue-patch",
          roomId: roomSnapshot.room.id,
          queue: result.queue,
          playback: result.playback
        });
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

  const seekTrack = useCallback(
    async (positionMs: number) => {
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
            action: "seek",
            positionMs,
            ...(playbackAssetId ? { playbackAssetId } : {}),
            actorPeerId: getCurrentPeerId?.() ?? undefined,
            expectedVersion
          });
        },
        roomSnapshot.room.playback
      );
    },
    [roomSnapshot, activeSession, getCurrentPeerId, runPlaybackMutation]
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
    deletePlaylist,
    loadPlaylistIntoRoom,
    removeQueueItem,
    reorderQueue,
    seekTrack,
    handleEnded
  };
}
