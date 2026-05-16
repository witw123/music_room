"use client";

import type { PlaybackSnapshot, RoomMember, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { shouldAcceptPresenceSnapshot, shouldReplacePlaybackSnapshot } from "@/lib/music-room-ui";

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
      type: "subscribe-bootstrap";
      roomId: string;
      members: RoomMember[];
      playback: PlaybackSnapshot;
      presenceRevision: number;
      roomRevision: number;
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
  playbackTrackId: string | null
) {
  const nextTracks = [...preferredTracks];
  const knownTrackIds = new Set(nextTracks.map((track) => track.id));

  if (playbackTrackId && !knownTrackIds.has(playbackTrackId)) {
    const fallbackTrack =
      incomingTracks.find((track) => track.id === playbackTrackId) ??
      currentTracks.find((track) => track.id === playbackTrackId) ??
      null;
    if (fallbackTrack) {
      nextTracks.unshift(fallbackTrack);
    }
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

  const playback = shouldReplacePlaybackSnapshot(
    currentSnapshot.room.playback,
    incomingSnapshot.room.playback
  )
    ? incomingSnapshot.room.playback
    : currentSnapshot.room.playback;
  const shouldApplyPresence = shouldAcceptPresenceSnapshot(
    currentSnapshot.room.members,
    currentSnapshot.room.presenceRevision,
    incomingSnapshot.room.members,
    incomingSnapshot.room.presenceRevision
  );

  return {
    ...incomingSnapshot,
    tracks: ensurePlaybackTrackMetadata(
      incomingSnapshot.tracks,
      currentSnapshot.tracks,
      incomingSnapshot.tracks,
      playback.currentTrackId
    ),
    room: {
      ...incomingSnapshot.room,
      roomRevision: getRoomRevision(incomingSnapshot),
      members: shouldApplyPresence ? incomingSnapshot.room.members : currentSnapshot.room.members,
      presenceRevision: shouldApplyPresence
        ? incomingSnapshot.room.presenceRevision
        : currentSnapshot.room.presenceRevision,
      playback
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

    case "subscribe-bootstrap": {
      const snapshot = current.snapshot;
      if (!snapshot || snapshot.room.id !== event.roomId) {
        return current;
      }

      const currentRoomRevision = getRoomRevision(snapshot);
      const currentPresenceRevision = snapshot.room.presenceRevision ?? 0;
      const shouldApplyPresence = event.presenceRevision >= currentPresenceRevision;
      const nextPlayback = shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
        ? event.playback
        : snapshot.room.playback;

      if (
        !shouldApplyPresence &&
        nextPlayback === snapshot.room.playback &&
        event.roomRevision <= currentRoomRevision
      ) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          room: {
            ...snapshot.room,
            members: shouldApplyPresence ? event.members : snapshot.room.members,
            presenceRevision: shouldApplyPresence
              ? Math.max(currentPresenceRevision, event.presenceRevision)
              : currentPresenceRevision,
            roomRevision: Math.max(currentRoomRevision, event.roomRevision),
            playback: nextPlayback
          }
        }
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
      const shouldApplyPresence = event.presenceRevision > currentPresenceRevision;
      const nextPlayback = shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
        ? event.playback
        : snapshot.room.playback;

      if (!shouldApplyPresence && nextPlayback === snapshot.room.playback) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          room: {
            ...snapshot.room,
            members: shouldApplyPresence ? event.members : snapshot.room.members,
            presenceRevision: shouldApplyPresence
              ? event.presenceRevision
              : currentPresenceRevision,
            roomRevision: Math.max(getRoomRevision(snapshot), event.roomRevision ?? 0),
            playback: nextPlayback
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
      const shouldApplyTopology = (event.roomRevision ?? currentRevision) >= currentRevision;
      const nextPlayback = shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
        ? event.playback
        : snapshot.room.playback;

      if (!shouldApplyTopology && nextPlayback === snapshot.room.playback) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          queue: shouldApplyTopology ? event.queue : snapshot.queue,
          room: {
            ...snapshot.room,
            roomRevision: Math.max(currentRevision, event.roomRevision ?? 0),
            playback: nextPlayback
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
      const shouldApplyTopology = (event.roomRevision ?? currentRevision) >= currentRevision;
      const nextPlayback = shouldReplacePlaybackSnapshot(snapshot.room.playback, event.playback)
        ? event.playback
        : snapshot.room.playback;

      if (!shouldApplyTopology && nextPlayback === snapshot.room.playback) {
        return current;
      }

      return {
        ...current,
        snapshot: {
          ...snapshot,
          tracks: shouldApplyTopology ? ensurePlaybackTrackMetadata(
            event.tracks,
            snapshot.tracks,
            event.tracks,
            nextPlayback.currentTrackId
          ) : ensurePlaybackTrackMetadata(
            snapshot.tracks,
            snapshot.tracks,
            event.tracks,
            nextPlayback.currentTrackId
          ),
          queue: shouldApplyTopology ? event.queue : snapshot.queue,
          room: {
            ...snapshot.room,
            roomRevision: Math.max(currentRevision, event.roomRevision ?? 0),
            playback: nextPlayback
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
