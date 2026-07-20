"use client";

import { useMemo, useRef } from "react";
import type { RoomSnapshot } from "@music-room/shared";
import { isCurrentPlaybackSourceDevice } from "@/features/playback/playback-source-identity";
import {
  resolvePlaybackSurfaceKey,
  resolvePlaybackTimelineKey
} from "@/features/room/hooks/room-playback-topology";

type StableTrackMeta = Pick<
  RoomSnapshot["tracks"][number],
  | "id"
  | "title"
  | "artist"
  | "album"
  | "durationMs"
  | "bitrate"
  | "sizeBytes"
  | "codec"
  | "mimeType"
  | "fileHash"
  | "artworkUrl"
  | "ownerSessionId"
  | "ownerNickname"
  | "sourceType"
>;

type UseRoomPageDerivedInput = {
  activeSessionId: string | null | undefined;
  peerId: string;
  roomSnapshot: RoomSnapshot | null;
};

function areTrackMetasEqual(previous: StableTrackMeta, next: StableTrackMeta) {
  return (
    previous.id === next.id &&
    previous.title === next.title &&
    previous.artist === next.artist &&
    previous.album === next.album &&
    previous.durationMs === next.durationMs &&
    previous.bitrate === next.bitrate &&
    previous.sizeBytes === next.sizeBytes &&
    previous.codec === next.codec &&
    previous.mimeType === next.mimeType &&
    previous.fileHash === next.fileHash &&
    previous.artworkUrl === next.artworkUrl &&
    previous.ownerSessionId === next.ownerSessionId &&
    previous.ownerNickname === next.ownerNickname &&
    previous.sourceType === next.sourceType
  );
}

export function resolveStableCurrentTrack<TTrack extends StableTrackMeta>(
  previousTrack: TTrack | null,
  currentPlaybackTrackId: string | null | undefined,
  tracks: TTrack[] | null | undefined
) {
  const nextTrack = currentPlaybackTrackId
    ? tracks?.find((track) => track.id === currentPlaybackTrackId) ?? null
    : null;
  if (previousTrack && nextTrack && areTrackMetasEqual(previousTrack, nextTrack)) {
    return previousTrack;
  }

  return nextTrack;
}

export function resolveRoomPagePlaybackState(input: UseRoomPageDerivedInput) {
  const roomPlayback = input.roomSnapshot?.room.playback ?? null;
  const currentPlaybackTrackId = roomPlayback?.currentTrackId ?? null;
  const playbackMediaEpoch = roomPlayback?.mediaEpoch ?? null;
  const playbackQueueVersion = roomPlayback?.queueVersion ?? null;
  const playbackRevision = roomPlayback?.playbackRevision ?? null;
  const playbackSourcePeerId = roomPlayback?.sourcePeerId ?? null;
  const playbackSourceSessionId = roomPlayback?.sourceSessionId ?? null;
  const playbackStatus = roomPlayback?.status ?? null;
  const currentSourcePeerId = resolveCurrentSourcePeerId(input.roomSnapshot, roomPlayback);

  return {
    roomPlayback,
    currentPlaybackTrackId,
    playbackMediaEpoch,
    playbackQueueVersion,
    playbackRevision,
    playbackSourcePeerId,
    playbackSourceSessionId,
    playbackStatus,
    isCurrentSourceOwner: isCurrentPlaybackSourceDevice({
      playback: roomPlayback,
      peerId: input.peerId,
      activeSessionId: input.activeSessionId,
      sourcePeerId: currentSourcePeerId
    }),
    playbackSurfaceKey: resolvePlaybackSurfaceKey(roomPlayback),
    playbackTimelineKey: resolvePlaybackTimelineKey(roomPlayback),
    playbackTopologySnapshot: currentPlaybackTrackId
      ? {
          currentTrackId: currentPlaybackTrackId,
          mediaEpoch: playbackMediaEpoch,
          sourcePeerId: playbackSourcePeerId,
          sourceSessionId: playbackSourceSessionId
        }
      : null
  };
}

export function useRoomPageDerived({
  activeSessionId,
  peerId,
  roomSnapshot
}: UseRoomPageDerivedInput) {
  const roomPlayback = roomSnapshot?.room.playback ?? null;
  const currentPlaybackTrackId = roomPlayback?.currentTrackId ?? null;
  const playbackMediaEpoch = roomPlayback?.mediaEpoch ?? null;
  const playbackQueueVersion = roomPlayback?.queueVersion ?? null;
  const playbackRevision = roomPlayback?.playbackRevision ?? null;
  const playbackSourcePeerId = roomPlayback?.sourcePeerId ?? null;
  const playbackSourceSessionId = roomPlayback?.sourceSessionId ?? null;
  const playbackStatus = roomPlayback?.status ?? null;
  const currentSourcePeerId = resolveCurrentSourcePeerId(roomSnapshot, roomPlayback);

  const isCurrentSourceOwner = useMemo(
    () => {
      if (!currentPlaybackTrackId) {
        return false;
      }

      // Session identity is stable during a room visit. The presence peerId
      // may be refreshed while a browser reconnects, and must not unload the
      // local source engine for that short transition.
      if (activeSessionId && playbackSourceSessionId) {
        return activeSessionId === playbackSourceSessionId;
      }

      if (peerId && currentSourcePeerId) {
        return currentSourcePeerId === peerId;
      }

      return Boolean(activeSessionId && playbackSourceSessionId === activeSessionId);
    },
    [
      activeSessionId,
      currentPlaybackTrackId,
      currentSourcePeerId,
      peerId,
      playbackSourceSessionId
    ]
  );
  const playbackSurfaceKey = useMemo(
    () => {
      if (!currentPlaybackTrackId) {
        return null;
      }

      const sourceIdentity = playbackSourceSessionId ?? playbackSourcePeerId ?? "none";
      const mediaEpoch = typeof playbackMediaEpoch === "number" ? playbackMediaEpoch : "none";
      return [currentPlaybackTrackId, sourceIdentity, mediaEpoch].join("|");
    },
    [currentPlaybackTrackId, playbackMediaEpoch, playbackSourcePeerId, playbackSourceSessionId]
  );
  const playbackTimelineKey = useMemo(
    () => {
      if (!currentPlaybackTrackId) {
        return null;
      }

      const mediaEpoch = typeof playbackMediaEpoch === "number" ? playbackMediaEpoch : "none";
      return [
        currentPlaybackTrackId,
        mediaEpoch,
        roomPlayback?.startAt ?? roomPlayback?.startedAt ?? "stopped",
        playbackStatus
      ].join("|");
    },
    [currentPlaybackTrackId, playbackMediaEpoch, playbackStatus, roomPlayback?.startAt, roomPlayback?.startedAt]
  );
  const playbackTopologySnapshot = useMemo(
    () =>
      currentPlaybackTrackId
        ? {
            currentTrackId: currentPlaybackTrackId,
            mediaEpoch: playbackMediaEpoch,
            sourcePeerId: playbackSourcePeerId,
            sourceSessionId: playbackSourceSessionId
          }
        : null,
    [currentPlaybackTrackId, playbackMediaEpoch, playbackSourcePeerId, playbackSourceSessionId]
  );
  const currentTrackRef = useRef<RoomSnapshot["tracks"][number] | null>(null);
  const currentTrack = useMemo(
    () => resolveStableCurrentTrack(currentTrackRef.current, currentPlaybackTrackId, roomSnapshot?.tracks),
    [currentPlaybackTrackId, roomSnapshot?.tracks]
  );
  currentTrackRef.current = currentTrack;

  return {
    roomPlayback,
    currentPlaybackTrackId,
    playbackMediaEpoch,
    playbackQueueVersion,
    playbackRevision,
    playbackSourcePeerId,
    playbackSourceSessionId,
    playbackStatus,
    isCurrentSourceOwner,
    playbackSurfaceKey,
    playbackTimelineKey,
    playbackTopologySnapshot,
    currentTrack
  };
}

export function resolveCurrentSourcePeerId(
  roomSnapshot: RoomSnapshot | null | undefined,
  playback: RoomSnapshot["room"]["playback"] | null | undefined
) {
  const presencePeerId = playback?.sourceSessionId
    ? roomSnapshot?.room.members.find((member) => member.id === playback.sourceSessionId)?.peerId ?? null
    : null;
  return presencePeerId ?? playback?.sourcePeerId ?? null;
}
