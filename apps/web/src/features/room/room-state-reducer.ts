"use client";

import type { PlaybackSnapshot, RoomMember, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { shouldReplacePlaybackSnapshot } from "@/lib/music-room-ui";

type RoomStateSource = "bootstrap" | "authoritative";

export type RoomStateStore = {
  snapshot: RoomSnapshot | null;
  source: RoomStateSource | null;
};

export type RoomStateEvent =
  | {
      type: "bootstrap-handoff";
      snapshot: RoomSnapshot;
    }
  | {
      type: "recover-snapshot" | "server-snapshot";
      snapshot: RoomSnapshot;
    }
  | {
      type: "server-presence-patch";
      roomId: string;
      members: RoomMember[];
      playback: PlaybackSnapshot;
      presenceRevision: number;
      roomRevision?: number;
    }
  | {
      type: "server-queue-patch";
      roomId: string;
      queue: RoomSnapshot["queue"];
      playback: PlaybackSnapshot;
      roomRevision?: number;
    }
  | {
      type: "server-library-patch";
      roomId: string;
      tracks: TrackMeta[];
      queue: RoomSnapshot["queue"];
      playback: PlaybackSnapshot;
      roomRevision?: number;
    }
  | {
      type: "server-playback-patch";
      roomId: string;
      playback: PlaybackSnapshot;
    }
  | {
      type: "local-reset";
    };

export const initialRoomStateStore: RoomStateStore = {
  snapshot: null,
  source: null
};

function getRoomRevision(snapshot: RoomSnapshot | null | undefined) {
  return snapshot?.room.roomRevision ?? 0;
}

function shouldReplaceAuthoritativeSnapshot(
  current: RoomStateStore,
  incoming: RoomSnapshot,
  source: RoomStateSource
) {
  if (!current.snapshot) {
    return true;
  }

  if (current.snapshot.room.id !== incoming.room.id) {
    return true;
  }

  const currentRevision = getRoomRevision(current.snapshot);
  const incomingRevision = getRoomRevision(incoming);

  if (incomingRevision > currentRevision) {
    return true;
  }

  if (incomingRevision < currentRevision) {
    return false;
  }

  if (current.source !== "authoritative" && source === "authoritative") {
    return true;
  }

  return source === "authoritative" || current.source !== "authoritative";
}

function ensurePlaybackTrackMetadata(
  preferredTracks: RoomSnapshot["tracks"],
  currentTracks: RoomSnapshot["tracks"],
  incomingTracks: RoomSnapshot["tracks"],
  currentTrackId: string | null,
  incomingTrackId: string | null
) {
  const nextTracks = [...preferredTracks];
  const knownTrackIds = new Set(nextTracks.map((track) => track.id));
  const requiredTrackIds = [currentTrackId, incomingTrackId].filter(
    (trackId): trackId is string => !!trackId
  );

  for (const trackId of requiredTrackIds) {
    if (knownTrackIds.has(trackId)) {
      continue;
    }

    const fallbackTrack =
      incomingTracks.find((track) => track.id === trackId) ??
      currentTracks.find((track) => track.id === trackId) ??
      null;
    if (!fallbackTrack) {
      continue;
    }

    nextTracks.unshift(fallbackTrack);
    knownTrackIds.add(trackId);
  }

  return nextTracks;
}

function normalizeSnapshot(
  currentSnapshot: RoomSnapshot | null,
  incomingSnapshot: RoomSnapshot
) {
  if (!currentSnapshot || currentSnapshot.room.id !== incomingSnapshot.room.id) {
    return incomingSnapshot;
  }

  return {
    ...incomingSnapshot,
    tracks: ensurePlaybackTrackMetadata(
      incomingSnapshot.tracks,
      currentSnapshot.tracks,
      incomingSnapshot.tracks,
      currentSnapshot.room.playback.currentTrackId,
      incomingSnapshot.room.playback.currentTrackId
    ),
    room: {
      ...incomingSnapshot.room,
      roomRevision: getRoomRevision(incomingSnapshot)
    }
  } satisfies RoomSnapshot;
}

export function roomStateReducer(
  current: RoomStateStore,
  event: RoomStateEvent
): RoomStateStore {
  switch (event.type) {
    case "local-reset":
      return initialRoomStateStore;

    case "bootstrap-handoff": {
      if (current.source === "authoritative") {
        return current;
      }

      if (!shouldReplaceAuthoritativeSnapshot(current, event.snapshot, "bootstrap")) {
        return current;
      }

      return {
        snapshot: normalizeSnapshot(current.snapshot, event.snapshot),
        source: "bootstrap"
      };
    }

    case "recover-snapshot":
    case "server-snapshot": {
      if (!shouldReplaceAuthoritativeSnapshot(current, event.snapshot, "authoritative")) {
        return current;
      }

      return {
        snapshot: normalizeSnapshot(current.snapshot, event.snapshot),
        source: "authoritative"
      };
    }

    case "server-presence-patch": {
      const snapshot = current.snapshot;
      if (!snapshot || snapshot.room.id !== event.roomId) {
        return current;
      }

      const currentPresenceRevision = snapshot.room.presenceRevision ?? 0;
      if (event.presenceRevision <= currentPresenceRevision) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          room: {
            ...snapshot.room,
            members: event.members,
            presenceRevision: event.presenceRevision,
            roomRevision: Math.max(getRoomRevision(snapshot), event.roomRevision ?? 0),
            playback: shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
              ? event.playback
              : snapshot.room.playback
          }
        }
      };
    }

    case "server-queue-patch": {
      const snapshot = current.snapshot;
      if (!snapshot || snapshot.room.id !== event.roomId) {
        return current;
      }

      const currentRevision = getRoomRevision(snapshot);
      if ((event.roomRevision ?? currentRevision) < currentRevision) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          queue: event.queue,
          room: {
            ...snapshot.room,
            roomRevision: Math.max(currentRevision, event.roomRevision ?? 0),
            playback: shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
              ? event.playback
              : snapshot.room.playback
          }
        }
      };
    }

    case "server-library-patch": {
      const snapshot = current.snapshot;
      if (!snapshot || snapshot.room.id !== event.roomId) {
        return current;
      }

      const currentRevision = getRoomRevision(snapshot);
      if ((event.roomRevision ?? currentRevision) < currentRevision) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          tracks: ensurePlaybackTrackMetadata(
            event.tracks,
            snapshot.tracks,
            event.tracks,
            snapshot.room.playback.currentTrackId,
            event.playback.currentTrackId
          ),
          queue: event.queue,
          room: {
            ...snapshot.room,
            roomRevision: Math.max(currentRevision, event.roomRevision ?? 0),
            playback: shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
              ? event.playback
              : snapshot.room.playback
          }
        }
      };
    }

    case "server-playback-patch": {
      const snapshot = current.snapshot;
      if (!snapshot || snapshot.room.id !== event.roomId) {
        return current;
      }

      if (!shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          room: {
            ...snapshot.room,
            playback: event.playback
          }
        }
      };
    }

    default:
      return current;
  }
}
