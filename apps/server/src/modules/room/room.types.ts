import {
  defaultRoomMemberPermissions,
  queueItemSchema,
  roomMemberPermissionsSchema,
  roomSchema,
  trackMetaSchema
} from "@music-room/shared";
import type {
  PlaybackSnapshot,
  QueueItem,
  Room,
  RoomMember,
  RoomMemberPermissions,
  TrackMeta
} from "@music-room/shared";
import { z } from "zod";

export type RoomRecord = {
  room: Room;
  passwordHash?: string | null;
  tracks: TrackMeta[];
  queue: QueueItem[];
  /** Permission profiles survive member leave/rejoin while the room exists. */
  memberPermissionProfiles?: Record<string, RoomMemberPermissions>;
};

export const roomRecordSchema = z.object({
  room: roomSchema,
  passwordHash: z.string().nullable().optional(),
  tracks: z.array(trackMetaSchema),
  queue: z.array(queueItemSchema),
  memberPermissionProfiles: z.record(roomMemberPermissionsSchema).default({})
});

export type PersistedRoomRecord = {
  id: string;
  hostId: string;
  joinCode: string;
  name?: string;
  description?: string | null;
  passwordHash?: string | null;
  visibility: string;
  presenceRevision?: number;
  roomRevision?: number;
  playback: unknown;
  members: unknown;
  newMemberPermissions?: unknown;
  memberPermissionProfiles?: unknown;
  tracks: unknown;
  queue: unknown;
};

type PersistedPlayback = Partial<PlaybackSnapshot> & {
  presenceRevision?: number;
  roomRevision?: number;
  newMemberPermissions?: unknown;
  memberPermissionProfiles?: unknown;
};

export function serializePlaybackForPersistence(
  room: Pick<Room, "playback" | "presenceRevision" | "roomRevision">
) {
  return {
    ...room.playback,
    presenceRevision: room.presenceRevision,
    roomRevision: room.roomRevision ?? 0
  };
}

export function deserializeRoomRecord(persisted: PersistedRoomRecord): RoomRecord {
  const persistedPlayback = isRecord(persisted.playback)
    ? (persisted.playback as PersistedPlayback)
    : {};
  const persistedMembers = Array.isArray(persisted.members)
    ? (persisted.members as Partial<RoomMember>[])
    : [];
  const memberPermissionProfiles = normalizeMemberPermissionProfiles(
    persisted.memberPermissionProfiles ?? persistedPlayback.memberPermissionProfiles,
    persistedMembers
  );
  const parsedNewMemberPermissions = roomMemberPermissionsSchema.safeParse(
    persisted.newMemberPermissions ?? persistedPlayback.newMemberPermissions
  );
  const record = {
    room: {
      id: persisted.id,
      hostId: persisted.hostId,
      joinCode: persisted.joinCode,
      name: persisted.name?.trim() || "未命名房间",
      description: persisted.description ?? null,
      hasPassword: Boolean(persisted.passwordHash),
      visibility: persisted.visibility as Room["visibility"],
      ...(parsedNewMemberPermissions.success
        ? { newMemberPermissions: parsedNewMemberPermissions.data }
        : {}),
      members: persistedMembers.map((member) => {
        const role = member.role === "host" ? "host" : "member";
        return {
          id: member.id ?? "",
          nickname: member.nickname ?? "",
          role,
          joinedAt: member.joinedAt ?? new Date(0).toISOString(),
          peerId: null,
          presenceState: member.presenceState ?? "offline",
          permissions: memberPermissionProfiles[member.id ?? ""] ?? {
            ...defaultRoomMemberPermissions,
            ...member.permissions
          }
        };
      }),
      playback: {
        status: persistedPlayback.status ?? "paused",
        currentTrackId: persistedPlayback.currentTrackId ?? null,
        currentQueueItemId: persistedPlayback.currentQueueItemId ?? null,
        playbackAssetId: persistedPlayback.playbackAssetId ?? null,
        startAt: persistedPlayback.startAt ?? null,
        sourceSessionId: persistedPlayback.sourceSessionId ?? persisted.hostId,
        sourcePeerId: persistedPlayback.sourcePeerId ?? null,
        sourceTrackId: persistedPlayback.sourceTrackId ?? persistedPlayback.currentTrackId ?? null,
        positionMs: persistedPlayback.positionMs ?? 0,
        startedAt: persistedPlayback.startedAt ?? null,
        queueVersion: persistedPlayback.queueVersion ?? 1,
        playbackRevision: persistedPlayback.playbackRevision ?? 1,
        mediaEpoch: persistedPlayback.mediaEpoch ?? 0,
        playbackMode: persistedPlayback.playbackMode ?? "sequence"
      },
      presenceRevision: resolvePresenceRevision(persisted, persistedPlayback),
      roomRevision: resolveRoomRevision(persisted, persistedPlayback)
    },
    passwordHash: persisted.passwordHash ?? null,
    tracks: persisted.tracks,
    queue: persisted.queue,
    memberPermissionProfiles
  };

  const normalized = normalizeRoomRecord(record);
  if (!normalized) {
    throw new Error(`Invalid persisted room record: ${persisted.id}`);
  }
  return normalized;
}

/**
 * Room records outlive the playback/provider implementation that created them.
 * Keep the room discoverable when a legacy track contains an obsolete asset
 * manifest, while ensuring that incompatible assets are never selected by the
 * current playback runtime.
 */
export function normalizeRoomRecord(value: unknown): RoomRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const roomResult = roomSchema.safeParse(value.room);
  if (!roomResult.success) {
    return null;
  }

  const tracks = normalizeTracks(value.tracks);
  if (!tracks) {
    return null;
  }
  const trackIds = new Set(tracks.map((track) => track.id));
  const queue = normalizeQueue(value.queue, trackIds);
  const members = normalizeRoomMembers(roomResult.data.members);
  const candidate = {
    room: {
      ...roomResult.data,
      members
    },
    ...(value.passwordHash === undefined || value.passwordHash === null || typeof value.passwordHash === "string"
      ? (value.passwordHash === undefined ? {} : { passwordHash: value.passwordHash })
      : {}),
    tracks,
    queue,
    memberPermissionProfiles: normalizeMemberPermissionProfiles(
      value.memberPermissionProfiles,
      members
    )
  };
  const recordResult = roomRecordSchema.safeParse(candidate);
  return recordResult.success ? recordResult.data : null;
}

function normalizeMemberPermissionProfiles(
  value: unknown,
  members: Array<{
    id?: string;
    role?: RoomMember["role"];
    permissions?: RoomMember["permissions"];
  }>
) {
  const profiles: Record<string, RoomMemberPermissions> = {};
  if (isRecord(value)) {
    for (const [memberId, permissions] of Object.entries(value)) {
      const parsed = roomMemberPermissionsSchema.safeParse(permissions);
      if (parsed.success) {
        profiles[memberId] = parsed.data;
      }
    }
  }

  for (const member of members) {
    if (!member.id) {
      continue;
    }
    if (!profiles[member.id]) {
      profiles[member.id] = member.role === "host"
        ? { ...defaultRoomMemberPermissions }
        : { ...defaultRoomMemberPermissions, ...member.permissions };
    }
  }

  return profiles;
}

function resolvePresenceRevision(
  persisted: PersistedRoomRecord,
  persistedPlayback: PersistedPlayback
) {
  const rawPresenceRevision =
    typeof persisted.presenceRevision === "number"
      ? persisted.presenceRevision
      : persistedPlayback.presenceRevision;

  return typeof rawPresenceRevision === "number"
    ? Math.max(0, Math.floor(rawPresenceRevision))
    : 0;
}

function resolveRoomRevision(
  persisted: PersistedRoomRecord,
  persistedPlayback: PersistedPlayback
) {
  const rawRoomRevision =
    typeof persisted.roomRevision === "number"
      ? persisted.roomRevision
      : persistedPlayback.roomRevision;

  return typeof rawRoomRevision === "number"
    ? Math.max(0, Math.floor(rawRoomRevision))
    : 0;
}

function normalizeTracks(value: unknown): TrackMeta[] | null {
  if (!Array.isArray(value)) {
    return [];
  }

  const tracks: TrackMeta[] = [];
  for (const track of value) {
    const current = trackMetaSchema.safeParse(track);
    if (current.success) {
      tracks.push(current.data);
      continue;
    }

    // Playback profiles and provider adapters are versioned independently of
    // the room. A track with an obsolete asset can still be shown and replaced
    // later, but its old asset must not be offered to the new decoder.
    if (!isRecord(track)) {
      return null;
    }
    const { originalAsset: _originalAsset, playbackAsset: _playbackAsset, ...metadata } = track;
    const legacyCompatible = trackMetaSchema.safeParse(metadata);
    if (legacyCompatible.success) {
      tracks.push(legacyCompatible.data);
      continue;
    }

    // These providers were removed from the current server, but their room
    // metadata is still safe to keep around for directory discovery.
    if (typeof track.sourceType === "string" && legacyProviderTypes.has(track.sourceType)) {
      continue;
    }

    return null;
  }
  return tracks;
}

const legacyProviderTypes = new Set(["spotify", "kugou", "kuwo", "taihe", "migu", "baidu"]);

function normalizeQueue(value: unknown, trackIds: Set<string>): QueueItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const parsed = queueItemSchema.safeParse(item);
    return parsed.success && trackIds.has(parsed.data.trackId) ? [parsed.data] : [];
  });
}

function normalizeRoomMembers(members: RoomMember[]) {
  const presencePriority: Record<RoomMember["presenceState"], number> = {
    online: 3,
    reconnecting: 2,
    offline: 1
  };
  const byMemberId = new Map<string, RoomMember>();

  for (const member of members) {
    const current = byMemberId.get(member.id);
    if (!current) {
      byMemberId.set(member.id, member);
      continue;
    }

    const currentScore = presencePriority[current.presenceState] + (current.peerId ? 1 : 0);
    const candidateScore = presencePriority[member.presenceState] + (member.peerId ? 1 : 0);
    if (candidateScore >= currentScore) {
      byMemberId.set(member.id, member);
    }
  }

  return [...byMemberId.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
