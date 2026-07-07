"use client";

import type { RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";

const fullChunkIndexListCacheLimit = 64;
const fullChunkIndexListCache = new Map<number, number[]>();

export function mergePeerIds(...peerIdGroups: Array<readonly string[]>) {
  const peerIds = new Set<string>();
  for (const group of peerIdGroups) {
    for (const peerId of group) {
      if (peerId) {
        peerIds.add(peerId);
      }
    }
  }
  return [...peerIds].sort();
}

function getStableFullChunkIndexList(totalChunks: number) {
  const normalizedTotalChunks = Math.max(0, Math.floor(totalChunks));
  const cached = fullChunkIndexListCache.get(normalizedTotalChunks);
  if (cached) {
    return cached;
  }

  const availableChunks = Array.from(
    { length: normalizedTotalChunks },
    (_, chunkIndex) => chunkIndex
  );
  fullChunkIndexListCache.set(normalizedTotalChunks, availableChunks);
  if (fullChunkIndexListCache.size > fullChunkIndexListCacheLimit) {
    const oldestKey = fullChunkIndexListCache.keys().next().value;
    if (typeof oldestKey === "number") {
      fullChunkIndexListCache.delete(oldestKey);
    }
  }
  return availableChunks;
}

export function isStableFullChunkIndexList(availableChunks: number[], totalChunks: number) {
  return fullChunkIndexListCache.get(Math.max(0, Math.floor(totalChunks))) === availableChunks;
}

export function resolveManualCacheProviderPeerIds(input: {
  manualCacheTrackIds: string[];
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  localPeerId: string | null | undefined;
  allowedPeerIds?: string[];
}) {
  const allowedPeerSet =
    input.allowedPeerIds && input.allowedPeerIds.length > 0
      ? new Set(input.allowedPeerIds.filter(Boolean))
      : null;
  const providerPeerIds = new Set<string>();

  for (const trackId of input.manualCacheTrackIds) {
    for (const announcement of Object.values(input.availabilityByTrack[trackId] ?? {})) {
      if (!announcement.ownerPeerId || announcement.ownerPeerId === input.localPeerId) {
        continue;
      }
      if (announcement.totalChunks <= 0 || announcement.availableChunks.length === 0) {
        continue;
      }
      if (allowedPeerSet && !allowedPeerSet.has(announcement.ownerPeerId)) {
        continue;
      }
      providerPeerIds.add(announcement.ownerPeerId);
    }
  }

  return [...providerPeerIds].sort();
}

export function resolveManualCacheUploaderPeerIds(input: {
  manualCacheTrackIds: string[];
  roomSnapshot: RoomSnapshot | null | undefined;
  localPeerId: string | null | undefined;
}) {
  if (!input.roomSnapshot || input.manualCacheTrackIds.length === 0) {
    return [] as string[];
  }

  const tracksById = new Map(input.roomSnapshot.tracks.map((track) => [track.id, track] as const));
  const membersBySessionId = new Map(
    input.roomSnapshot.room.members.map((member) => [member.id, member] as const)
  );
  const peerIds = new Set<string>();

  for (const trackId of input.manualCacheTrackIds) {
    const track = tracksById.get(trackId);
    if (!track) {
      continue;
    }

    const owner = membersBySessionId.get(track.ownerSessionId);
    if (
      !owner?.peerId ||
      owner.peerId === input.localPeerId ||
      owner.presenceState === "offline"
    ) {
      continue;
    }
    peerIds.add(owner.peerId);
  }

  return [...peerIds].sort();
}

export function buildManualCacheSchedulerAvailability(input: {
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  manualCacheTrackIds: string[];
  roomSnapshot: RoomSnapshot | null | undefined;
  localPeerId: string | null | undefined;
}) {
  if (!input.roomSnapshot || input.manualCacheTrackIds.length === 0) {
    return input.availabilityByTrack;
  }

  return buildManualCacheSchedulerAvailabilityFromParts({
    availabilityByTrack: input.availabilityByTrack,
    manualCacheTrackIds: input.manualCacheTrackIds,
    roomId: input.roomSnapshot.room.id,
    members: input.roomSnapshot.room.members,
    playback: input.roomSnapshot.room.playback,
    tracks: input.roomSnapshot.tracks,
    localPeerId: input.localPeerId
  });
}

export function buildManualCacheSchedulerAvailabilityFromParts(input: {
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  manualCacheTrackIds: string[];
  roomId: string;
  members: RoomSnapshot["room"]["members"];
  playback?: RoomSnapshot["room"]["playback"] | null;
  tracks: RoomSnapshot["tracks"];
  localPeerId: string | null | undefined;
}) {
  if (input.manualCacheTrackIds.length === 0) {
    return input.availabilityByTrack;
  }

  const activeMemberPeerIds = new Set(
    input.members
      .map((member) => member.peerId)
      .filter((peerId): peerId is string => !!peerId)
  );
  const membersBySessionId = new Map(
    input.members.map((member) => [member.id, member] as const)
  );
  const membersByPeerId = new Map(
    input.members
      .filter((member) => !!member.peerId)
      .map((member) => [member.peerId!, member] as const)
  );
  const tracksById = new Map(input.tracks.map((track) => [track.id, track] as const));
  const nextAvailabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>> = {};

  for (const trackId of input.manualCacheTrackIds) {
    const track = tracksById.get(trackId) ?? null;
    const currentAvailability = input.availabilityByTrack[trackId] ?? {};
    const nextTrackAvailability: Record<string, TrackAvailabilityAnnouncement> = {};

    for (const announcement of Object.values(currentAvailability)) {
      if (
        announcement.roomId === input.roomId &&
        activeMemberPeerIds.has(announcement.ownerPeerId)
      ) {
        nextTrackAvailability[announcement.ownerPeerId] = announcement;
      }
    }

    if (!track) {
      if (Object.keys(nextTrackAvailability).length > 0) {
        nextAvailabilityByTrack[trackId] = nextTrackAvailability;
      }
      continue;
    }

    const manifest = track.relayManifest ?? track.pieceManifest ?? null;
    const owner = membersBySessionId.get(track.ownerSessionId) ?? null;
    const playbackSourcePeerId =
      input.playback?.currentTrackId === track.id
        ? input.playback.sourcePeerId
        : null;
    const playbackSourceMember =
      playbackSourcePeerId ? membersByPeerId.get(playbackSourcePeerId) ?? null : null;
    const implicitProviders = [playbackSourceMember, owner].filter(
      (member, index, members): member is NonNullable<typeof member> =>
        !!member &&
        members.findIndex((candidate) => candidate?.peerId === member.peerId) === index
    );
    for (const provider of implicitProviders) {
      const providerPeerId = provider.peerId ?? null;
      if (
        !providerPeerId ||
        providerPeerId === input.localPeerId ||
        provider.presenceState === "offline" ||
        !manifest ||
        nextTrackAvailability[providerPeerId]
      ) {
        continue;
      }
      nextTrackAvailability[providerPeerId] = {
        roomId: input.roomId,
        trackId: track.id,
        ownerPeerId: providerPeerId,
        nickname: provider.nickname,
        assetKind: "relay",
        assetHash: track.fileHash,
        totalChunks: manifest.totalChunks,
        chunkSize: manifest.chunkSize,
        availableChunks: getStableFullChunkIndexList(manifest.totalChunks),
        source: "live_upload",
        announcedAt: "1970-01-01T00:00:00.000Z"
      };
    }

    if (Object.keys(nextTrackAvailability).length > 0) {
      nextAvailabilityByTrack[trackId] = nextTrackAvailability;
    }
  }

  return nextAvailabilityByTrack;
}
