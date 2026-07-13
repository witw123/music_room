"use client";

import type { PeerSignalMessage, PlaybackSnapshot, RoomSnapshot } from "@music-room/shared";
import { shouldReplacePlaybackSnapshot } from "@/lib/music-room-ui";

export function createRoomRealtimeEventGate(initialSnapshot?: RoomSnapshot | null) {
  let latestRoomRevision = initialSnapshot?.room.roomRevision ?? 0;
  let latestPresenceRevision = initialSnapshot?.room.presenceRevision ?? 0;
  let latestPlayback: PlaybackSnapshot | null = initialSnapshot?.room.playback ?? null;

  const syncCurrentSnapshot = (snapshot: RoomSnapshot | null | undefined) => {
    if (!snapshot) {
      return;
    }
    latestRoomRevision = Math.max(latestRoomRevision, snapshot.room.roomRevision ?? 0);
    latestPresenceRevision = Math.max(
      latestPresenceRevision,
      snapshot.room.presenceRevision ?? 0
    );
    if (shouldReplacePlaybackSnapshot(latestPlayback, snapshot.room.playback)) {
      latestPlayback = snapshot.room.playback;
    }
  };

  return {
    acceptRoomRevision(
      incomingRevision: number | null | undefined,
      currentSnapshot?: RoomSnapshot | null
    ) {
      syncCurrentSnapshot(currentSnapshot);
      if (incomingRevision === null || incomingRevision === undefined) {
        return true;
      }
      if (incomingRevision < latestRoomRevision) {
        return false;
      }
      latestRoomRevision = incomingRevision;
      return true;
    },
    acceptPresenceRevision(
      incomingRevision: number,
      currentSnapshot?: RoomSnapshot | null,
      allowEqual = false
    ) {
      syncCurrentSnapshot(currentSnapshot);
      const accepted = allowEqual
        ? incomingRevision >= latestPresenceRevision
        : incomingRevision > latestPresenceRevision;
      if (accepted) {
        latestPresenceRevision = incomingRevision;
      }
      return accepted;
    },
    acceptPlayback(
      incomingPlayback: PlaybackSnapshot,
      currentSnapshot?: RoomSnapshot | null
    ) {
      syncCurrentSnapshot(currentSnapshot);
      const previousPlayback = latestPlayback;
      if (!shouldReplacePlaybackSnapshot(previousPlayback, incomingPlayback)) {
        return { accepted: false as const, previousPlayback };
      }
      latestPlayback = incomingPlayback;
      return { accepted: true as const, previousPlayback };
    }
  };
}

export function isSocketDisconnectGraceActive(disconnectGraceUntilMs: number | null, now = Date.now()) {
  return typeof disconnectGraceUntilMs === "number" && disconnectGraceUntilMs > now;
}

export function shouldSuppressPlaybackWatchdogEscalation(input: {
  recoverySuppressedReason: string | null;
  socketDisconnectGraceActive: boolean;
}) {
  return input.recoverySuppressedReason !== null || input.socketDisconnectGraceActive;
}

export function shouldResyncSnapshotForPlaybackPatch(input: {
  currentSnapshot: RoomSnapshot | null | undefined;
  playback: RoomSnapshot["room"]["playback"];
}) {
  const trackId = input.playback.currentTrackId;
  if (!trackId) {
    return false;
  }

  return !input.currentSnapshot?.tracks.some((track) => track.id === trackId);
}

export function shouldQueueIncomingAvailability(input: {
  announcementRoomId: string;
  runtimeRoomId: string;
  activeRouteRoomId: string | null | undefined;
}) {
  return (
    input.announcementRoomId === input.runtimeRoomId &&
    input.activeRouteRoomId === input.runtimeRoomId
  );
}

export function shouldReannounceManualCacheAvailability(input: {
  enableManualTrackCaching: boolean;
  roomId: string | null | undefined;
  roomListenerSetHash: string;
  uploadedTrackIds: string[];
  sourceReadyTrackIds?: string[];
  lastBroadcastKey: string | null;
}) {
  if (!input.roomId || !input.roomListenerSetHash) {
    return null;
  }

  const sortedTrackIds = [...input.uploadedTrackIds].filter(Boolean).sort();
  if (sortedTrackIds.length === 0) {
    return null;
  }

  const sortedSourceReadyTrackIds = [...(input.sourceReadyTrackIds ?? [])]
    .filter(Boolean)
    .sort();
  const nextKey = [
    input.roomId,
    input.roomListenerSetHash,
    sortedTrackIds.join(","),
    sortedSourceReadyTrackIds.join(",")
  ].join("|");
  return nextKey === input.lastBroadcastKey ? null : nextKey;
}

export function resolveSourceAvailabilityReannounceTrackId(input: {
  activeSessionId: string | null | undefined;
  playback: Pick<RoomSnapshot["room"]["playback"], "currentTrackId" | "sourceSessionId">;
}) {
  return input.activeSessionId &&
    input.playback.sourceSessionId === input.activeSessionId &&
    input.playback.currentTrackId
    ? input.playback.currentTrackId
    : null;
}

export function resolveRemoteAvailabilityRequestTrackId(input: {
  activeSessionId: string | null | undefined;
  previousPlayback: Pick<
    RoomSnapshot["room"]["playback"],
    "currentTrackId" | "sourceSessionId" | "sourcePeerId" | "mediaEpoch"
  > | null | undefined;
  nextPlayback: Pick<
    RoomSnapshot["room"]["playback"],
    "currentTrackId" | "sourceSessionId" | "sourcePeerId" | "mediaEpoch"
  >;
}) {
  const next = input.nextPlayback;
  if (
    !input.activeSessionId ||
    !next.currentTrackId ||
    !next.sourcePeerId ||
    next.sourceSessionId === input.activeSessionId
  ) {
    return null;
  }
  const previous = input.previousPlayback;
  return !previous ||
    previous.currentTrackId !== next.currentTrackId ||
    previous.sourcePeerId !== next.sourcePeerId ||
    previous.mediaEpoch !== next.mediaEpoch
    ? next.currentTrackId
    : null;
}

export function shouldAcceptIncomingPeerSignal(input: {
  payload: PeerSignalMessage;
}) {
  return input.payload.channelKind === "data";
}

export function buildRoomSubscribePayload(input: {
  roomId: string;
  peerId: string;
  sessionId: string;
}) {
  return {
    roomId: input.roomId,
    sessionId: input.sessionId,
    peerId: input.peerId,
    protocolVersion: 4 as const,
    capabilities: ["segmented-opus-v1" as const],
    buildId: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.3.0"
  };
}

export function hasSubscribeBootstrapFullLocalTrack(input: {
  enableTrackCaching: boolean;
  currentTrackId: string | null | undefined;
  uploadedTracks: Record<string, unknown>;
  fullLocalPlaybackTracks: Record<string, unknown>;
}) {
  return !!(
    input.enableTrackCaching &&
    input.currentTrackId &&
    (input.uploadedTracks[input.currentTrackId] ||
      input.fullLocalPlaybackTracks[input.currentTrackId])
  );
}

export function shouldExitRoomOnSnapshotMissing(input: {
  currentRoomId: string;
  missingRoomId?: string | null;
}) {
  return !input.missingRoomId || input.missingRoomId === input.currentRoomId;
}

export function resolveRoomRealtimeSnapshotInputs(input: {
  roomSnapshot: RoomSnapshot | null;
  activeSessionId: string | null | undefined;
  fallbackUploadedTrackIds: string[];
}) {
  const localMemberPresence =
    input.roomSnapshot?.room.members.find((member) => member.id === input.activeSessionId) ??
    null;
  const snapshotTrackIds =
    input.roomSnapshot?.tracks.map((track) => track.id) ?? input.fallbackUploadedTrackIds;

  return {
    snapshotRoomId: input.roomSnapshot?.room.id ?? null,
    snapshotMembersCount: input.roomSnapshot?.room.members.length ?? 0,
    snapshotPresenceRevision: input.roomSnapshot?.room.presenceRevision ?? null,
    hasLocalMemberPresence: !!localMemberPresence,
    localMemberPeerId: localMemberPresence?.peerId ?? null,
    localMemberPresenceState: localMemberPresence?.presenceState ?? null,
    snapshotTrackIds,
    snapshotTrackIdsKey: snapshotTrackIds.join("|")
  };
}

export function resolvePresenceRepairAction(input: {
  snapshotRoomId: string | null;
  activeSessionId: string | null | undefined;
  peerId: string;
  hasLocalMemberPresence: boolean;
  localMemberPeerId: string | null;
  localMemberPresenceState: string | null;
  snapshotPresenceRevision: number | null;
  previousRepairKey: string | null;
  socketConnected: boolean;
}) {
  const idleAction = {
    nextRepairKey: null,
    shouldEmitPresence: false,
    shouldRequestResync: false,
    shouldStartHeartbeat: false
  };

  if (
    !input.snapshotRoomId ||
    !input.activeSessionId ||
    !input.peerId ||
    !input.hasLocalMemberPresence
  ) {
    return idleAction;
  }
  if (input.localMemberPresenceState === "online" && input.localMemberPeerId === input.peerId) {
    return idleAction;
  }

  const nextRepairKey = [
    input.snapshotRoomId,
    input.snapshotPresenceRevision,
    input.localMemberPeerId ?? "none",
    input.localMemberPresenceState,
    input.peerId
  ].join("|");
  if (input.previousRepairKey === nextRepairKey || !input.socketConnected) {
    return {
      ...idleAction,
      nextRepairKey
    };
  }

  return {
    nextRepairKey,
    shouldEmitPresence: true,
    shouldRequestResync: true,
    shouldStartHeartbeat: true
  };
}

export function resolveRoomSnapshotWatchdogAction(input: {
  activeRouteRoomId: string | null;
  socketConnected: boolean;
  snapshotRoomId: string | null;
  lastRealtimeRoomEventAtMs: number;
  nowMs: number;
  staleAfterMs: number;
}) {
  const idleAction = {
    nextLastRealtimeRoomEventAtMs: input.lastRealtimeRoomEventAtMs,
    resyncRoomId: null,
    shouldRequestResync: false
  };

  if (
    !input.activeRouteRoomId ||
    input.activeRouteRoomId !== input.snapshotRoomId ||
    !input.socketConnected
  ) {
    return idleAction;
  }
  if (input.nowMs - input.lastRealtimeRoomEventAtMs < input.staleAfterMs) {
    return idleAction;
  }

  return {
    nextLastRealtimeRoomEventAtMs: input.nowMs,
    resyncRoomId: input.snapshotRoomId,
    shouldRequestResync: true
  };
}

export function resolveRecoveryWatchdogAction(input: {
  snapshotRoomId: string | null;
  enableTrackCaching: boolean;
  connectedPeersCount: number;
  snapshotMembersCount: number;
  playbackConnectionKey: string | null;
  sourcePeerId?: string | null;
}) {
  if (
    !input.snapshotRoomId ||
    !input.enableTrackCaching ||
    input.connectedPeersCount > 0 ||
    input.snapshotMembersCount <= 1
  ) {
    return { recommendation: null };
  }

  return {
    recommendation: {
      playbackConnectionKey: input.playbackConnectionKey,
      peerId: input.sourcePeerId ?? null,
      scope: "data" as const,
      level: input.sourcePeerId ? ("hard-recreate" as const) : ("soft" as const),
      reason: "watchdog-data-stalled" as const,
      observedNoProgressMs: null
    }
  };
}
