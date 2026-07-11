import { Injectable, Optional } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  PlaybackSnapshot,
  Playlist,
  QueueItem,
  Room,
  RoomMember,
  RoomSnapshot,
  RoomListResponse,
  TrackMeta,
  UserProfile
} from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { TrackAvailabilityRegistry } from "../signaling/track-availability.registry";
import { type RoomRecord } from "./room.types";
import { RoomRecordRepository } from "./repositories/room-record.repository";
import { RoomPresenceService } from "./services/room-presence.service";
import { RoomPlaybackService } from "./services/room-playback.service";
import { RoomSnapshotService } from "./services/room-snapshot.service";

@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly roomCacheTtlSeconds = 0;
  private readonly sessionRecentRoomTtlSeconds = 60 * 60 * 24 * 7;
  private readonly presenceTtlSeconds = 60;
  private readonly roomRegistryKey = "music-room:rooms";
  private readonly inMemoryPresence = new Map<
    string,
    Map<
      string,
      {
        peerId: string | null;
        presenceState: RoomMember["presenceState"];
        expiresAt: number;
      }
    >
  >();
  private readonly roomRecordRepository: RoomRecordRepository;
  private readonly roomPresenceService: RoomPresenceService;
  private readonly roomPlaybackService: RoomPlaybackService;
  private readonly roomSnapshotService: RoomSnapshotService;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional()
    availabilityReader?: TrackAvailabilityRegistry,
    @Optional()
    roomRecordRepository?: RoomRecordRepository,
    @Optional()
    roomPresenceService?: RoomPresenceService,
    @Optional()
    roomPlaybackService?: RoomPlaybackService,
    @Optional()
    roomSnapshotService?: RoomSnapshotService
  ) {
    this.roomRecordRepository =
      roomRecordRepository ??
      new RoomRecordRepository(
        this.rooms,
        prisma,
        redis,
        this.roomRegistryKey,
        this.roomCacheTtlSeconds,
        this.sessionRecentRoomTtlSeconds
      );
    this.roomPresenceService =
      roomPresenceService ??
      new RoomPresenceService(redis, this.inMemoryPresence, this.presenceTtlSeconds);
    this.roomPlaybackService =
      roomPlaybackService ?? new RoomPlaybackService(this.roomPresenceService, availabilityReader);
    this.roomSnapshotService =
      roomSnapshotService ??
      new RoomSnapshotService(this.roomPresenceService, this.roomPlaybackService);
  }

  async createRoom(
    hostSessionId: string,
    visibility: Room["visibility"] = "public"
  ) {
    const hostSession = await this.authService.getUserOrThrow(hostSessionId);
    const room: Room = {
      id: `room_${randomUUID()}`,
      hostId: hostSession.id,
      joinCode: this.buildJoinCode(),
      visibility,
      lastActiveAt: new Date().toISOString(),
      archivedAt: null,
      members: [this.buildMember(hostSession, "host")],
      presenceRevision: 0,
      roomRevision: 0,
      playback: {
        status: "paused",
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId: hostSession.id,
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 0
      }
    };

    const record: RoomRecord = {
      room,
      tracks: [],
      queue: []
    };

    await this.roomRecordRepository.persistRecord(record);
    await this.roomRecordRepository.setRecentRoomForSession(hostSession.id, room.id);

    return this.getRoomSnapshot(room.id, []);
  }

  async findRoomByJoinCode(joinCode: string) {
    return this.roomRecordRepository.findByJoinCode(joinCode);
  }

  async getRoomSnapshot(roomId: string, playlists: Playlist[]): Promise<RoomSnapshot> {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    return this.roomSnapshotService.buildSnapshot(record, playlists);
  }

  async getAccessibleRoomSnapshot(
    roomId: string,
    playlists: Playlist[],
    sessionId?: string
  ): Promise<RoomSnapshot> {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    const isMember =
      !!sessionId &&
      (record.room.hostId === sessionId ||
        record.room.members.some((member) => member.id === sessionId));

    if (!isMember && record.room.visibility !== "public") {
      throw new Error("Room not found.");
    }

    if (isMember && sessionId) {
      await this.roomRecordRepository.setRecentRoomForSession(sessionId, roomId);
    }

    return this.roomSnapshotService.buildSnapshot(record, playlists);
  }

  async listRoomsForSession(sessionId: string): Promise<RoomSnapshot[]> {
    const records = await this.roomRecordRepository.listRecoverableRecords();

    const accessibleRecords = records.filter(
      (record: RoomRecord) =>
        record.room.hostId === sessionId ||
        record.room.members.some((member: RoomMember) => member.id === sessionId)
    );

    return Promise.all(
      accessibleRecords.map((record: RoomRecord) => this.roomSnapshotService.buildSnapshot(record, []))
    );
  }

  async listPublicRooms(): Promise<RoomSnapshot[]> {
    const records = await this.roomRecordRepository.listRecoverableRecords();
    const publicRecords = records.filter((record) => record.room.visibility === "public");
    return Promise.all(
      publicRecords.map((record) => this.roomSnapshotService.buildSnapshot(record, []))
    );
  }

  async listRoomSummariesForSession(
    sessionId: string,
    options?: { cursor?: string; limit?: number }
  ): Promise<RoomListResponse> {
    const records = await this.roomRecordRepository.listRecoverableRecords();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const accessible = records.filter((record) => {
      const isMember =
        record.room.hostId === sessionId ||
        record.room.members.some((member) => member.id === sessionId);
      if (isMember) return record.room.archivedAt === null;
      return record.room.visibility === "public" && record.room.archivedAt === null;
    });
    const allSnapshots = await Promise.all(
      accessible.map((record) => this.roomSnapshotService.buildSnapshot(record, []))
    );
    const snapshots = allSnapshots.filter((snapshot) => {
      const isMember =
        snapshot.room.hostId === sessionId ||
        snapshot.room.members.some((member) => member.id === sessionId);
      return isMember ||
        new Date(snapshot.room.lastActiveAt ?? 0).getTime() >= cutoff ||
        snapshot.room.members.some((member) => member.presenceState === "online");
    });
    snapshots.sort((left, right) =>
      (right.room.lastActiveAt ?? "").localeCompare(left.room.lastActiveAt ?? "") ||
      right.room.id.localeCompare(left.room.id)
    );

    const cursor = decodeRoomCursor(options?.cursor);
    const afterCursor = cursor
      ? snapshots.filter((snapshot) =>
          (snapshot.room.lastActiveAt ?? "") < cursor.lastActiveAt ||
          ((snapshot.room.lastActiveAt ?? "") === cursor.lastActiveAt && snapshot.room.id < cursor.id)
        )
      : snapshots;
    const limit = Math.min(100, Math.max(1, options?.limit ?? 30));
    const page = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > page.length;

    return {
      items: page.map((snapshot) => ({
        id: snapshot.room.id,
        joinCode: snapshot.room.joinCode,
        visibility: snapshot.room.visibility,
        hostNickname:
          snapshot.room.members.find((member) => member.role === "host")?.nickname ?? "Unknown",
        memberCount: snapshot.room.members.length,
        onlineMemberCount: snapshot.room.members.filter((member) => member.presenceState === "online").length,
        lastActiveAt: snapshot.room.lastActiveAt ?? new Date(0).toISOString()
      })),
      nextCursor: hasMore && page.length
        ? encodeRoomCursor(page[page.length - 1].room.lastActiveAt ?? new Date(0).toISOString(), page[page.length - 1].room.id)
        : null
    };
  }

  async getRecentRoomSnapshotForSession(sessionId: string): Promise<RoomSnapshot | null> {
    const roomId = await this.redis.getString(this.roomRecordRepository.sessionRecentRoomKey(sessionId));

    if (roomId) {
      const snapshot = await this.getRecoverableRoomSnapshot(roomId, sessionId).catch(() => null);
      if (snapshot) {
        return snapshot;
      }

      try {
        await this.redis.delete(this.roomRecordRepository.sessionRecentRoomKey(sessionId));
      } catch {
        // Ignore cache cleanup failures and continue with the accessible-room fallback.
      }
    }

    const rooms = await this.listRoomsForSession(sessionId);
    return rooms[0] ?? null;
  }

  async getRecoverableRoomSnapshot(roomId: string, sessionId: string): Promise<RoomSnapshot | null> {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);

    if (
      record.room.hostId !== sessionId &&
      !record.room.members.some((member) => member.id === sessionId)
    ) {
      return null;
    }

    if (record.room.archivedAt) {
      this.incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
    }

    await this.roomRecordRepository.setRecentRoomForSession(sessionId, roomId);
    return this.roomSnapshotService.buildSnapshot(record, []);
  }

  async joinRoom(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    const session = await this.authService.getUserOrThrow(sessionId);
    this.assertUniqueNickname(record, session.id, session.nickname);

    if (!record.room.members.some((member) => member.id === session.id)) {
      record.room.members.push(this.buildMember(session, "member"));
      this.incrementPresenceRevision(record.room);
      this.incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
    } else if (record.room.archivedAt) {
      this.incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
    }

    await this.roomRecordRepository.setRecentRoomForSession(session.id, roomId);

    return record.room;
  }

  async deleteRoom(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    await this.assertCanDeleteRoomRecord(record, sessionId);

    await this.roomRecordRepository.deleteRecord(record);
    await Promise.all(
      record.room.members.map((member) =>
        this.roomRecordRepository.clearRecentRoomForSessionIfMatching(member.id, roomId)
      )
    );

    return { ok: true };
  }

  async assertCanDeleteRoom(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    await this.assertCanDeleteRoomRecord(record, sessionId);
  }

  private async assertCanDeleteRoomRecord(record: RoomRecord, sessionId: string) {
    if (record.room.hostId !== sessionId) {
      throw new Error("Only the host can delete this room.");
    }

    const uploaderIds = new Set(record.tracks.map((t) => t.ownerSessionId));
    const activePresence = await this.roomPresenceService.getActivePresence(
      record.room.id,
      record.room.members
    );
    if (
      record.room.members.some(
        (member) => uploaderIds.has(member.id) && !activePresence.has(member.id)
      )
    ) {
      throw new Error("All track uploaders must be online before deleting the room.");
    }
  }

  async updatePeerPresence(
    roomId: string,
    sessionId: string,
    peerId: string | null,
    presenceState: RoomMember["presenceState"] = peerId ? "online" : "offline"
  ) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);
    const presenceSnapshot = await this.roomPresenceService.getPresenceSnapshot(
      roomId,
      record.room.members
    );
    const currentPresence = presenceSnapshot.get(sessionId) ?? {
      peerId: null,
      presenceState: "offline" as const
    };

    if (
      currentPresence.peerId === peerId &&
      currentPresence.presenceState === presenceState
    ) {
      if (presenceState === "online" && peerId) {
        await this.roomPresenceService.touchRealtimePresence(roomId, sessionId, peerId);
      } else if (presenceState === "reconnecting") {
        await this.roomPresenceService.markRealtimeReconnecting(roomId, sessionId);
      } else {
        await this.roomPresenceService.clearRealtimePresence(roomId, sessionId);
      }
      return record.room;
    }

    if (presenceState === "online" && peerId) {
      await this.roomPresenceService.touchRealtimePresence(roomId, sessionId, peerId);
      this.roomPlaybackService.handleSourcePeerOnline(record, sessionId, peerId);
    } else if (presenceState === "reconnecting") {
      await this.roomPresenceService.markRealtimeReconnecting(roomId, sessionId);
    } else {
      await this.roomPresenceService.clearRealtimePresence(roomId, sessionId);
    }

    if (presenceState === "offline") {
      await this.roomPlaybackService.handleSourceAvailabilityLoss(record, sessionId);
    }

    this.incrementPresenceRevision(record.room);
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.room;
  }

  async touchRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);
    await this.roomPresenceService.touchRealtimePresence(roomId, sessionId, peerId);
  }

  async refreshRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);
    const presenceSnapshot = await this.roomPresenceService.getPresenceSnapshot(
      roomId,
      record.room.members
    );
    const currentPresence = presenceSnapshot.get(sessionId) ?? {
      peerId: null,
      presenceState: "offline" as const
    };

    if (
      currentPresence.peerId === peerId &&
      currentPresence.presenceState === "online"
    ) {
      await this.roomPresenceService.touchRealtimePresence(roomId, sessionId, peerId);
      return {
        room: record.room,
        changed: false
      };
    }

    return {
      room: await this.updatePeerPresence(roomId, sessionId, peerId, "online"),
      changed: true
    };
  }

  async clearRealtimePresence(roomId: string, sessionId: string) {
    await this.roomPresenceService.clearRealtimePresence(roomId, sessionId);
  }

  async leaveRoom(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);
    const leavingHost = record.room.hostId === sessionId;
    await this.roomPresenceService.clearRealtimePresence(roomId, sessionId);

    if (!leavingHost) {
      record.room.members = record.room.members.filter((member) => member.id !== sessionId);
    }

    await this.roomPlaybackService.handleSourceDeparture(record, sessionId);
    if (!leavingHost) {
      this.removeTracksOwnedBySession(record, sessionId);
    }
    this.incrementPresenceRevision(record.room);
    this.incrementRoomRevision(record.room);

    await this.roomRecordRepository.persistRecord(record);
    await this.roomRecordRepository.clearRecentRoomForSessionIfMatching(sessionId, roomId);
    return record.room;
  }

  async rememberRecentRoom(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);
    await this.roomRecordRepository.setRecentRoomForSession(sessionId, roomId);
  }

  async registerTrack(
    roomId: string,
    sessionId: string,
    input: Omit<TrackMeta, "id"> & { id?: string }
  ) {
    await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    const track: TrackMeta = {
      ...input,
      ownerSessionId: sessionId,
      ownerNickname: (await this.authService.getUserOrThrow(sessionId)).nickname,
      id: input.id ?? `track_${randomUUID()}`
    };

    const duplicateByFileHashIndex = record.tracks.findIndex(
      (item) =>
        item.fileHash === track.fileHash &&
        item.ownerSessionId === track.ownerSessionId
    );
    const existingIndex = record.tracks.findIndex((item) => item.id === track.id);

    if (duplicateByFileHashIndex >= 0) {
      const existingTrack = record.tracks[duplicateByFileHashIndex];
      record.tracks[duplicateByFileHashIndex] = {
        ...existingTrack,
        ...track,
        id: existingTrack.id
      };
      this.incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
      return record.tracks[duplicateByFileHashIndex];
    }

    if (existingIndex >= 0) {
      record.tracks[existingIndex] = track;
    } else {
      record.tracks.unshift(track);
    }

    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return track;
  }

  async removeTrack(roomId: string, sessionId: string, trackId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    const track = record.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    if (record.room.hostId !== sessionId && track.ownerSessionId !== sessionId) {
      throw new Error("Only the host or original uploader can delete this track.");
    }

    this.removeTracksById(record, new Set([trackId]));
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return { ok: true };
  }

  async deleteArchivedRoom(roomId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    if (!record.room.archivedAt) {
      throw new Error("Room is not archived.");
    }
    if (this.prisma.isAvailable()) {
      await this.prisma.$transaction([
        this.prisma.playlist.deleteMany({ where: { roomId } }),
        this.prisma.roomState.deleteMany({ where: { id: roomId, archivedAt: { not: null } } })
      ]);
      await this.roomRecordRepository.finalizeDatabaseDelete(record);
    } else {
      await this.roomRecordRepository.deleteRecord(record);
    }
    return record.tracks.map((track) => track.id);
  }

  async addQueueItem(roomId: string, sessionId: string, trackId: string) {
    const session = await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    if (!record.tracks.some((track) => track.id === trackId)) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    const queueItem: QueueItem = {
      id: `queue_${randomUUID()}`,
      trackId,
      requestedBy: session.nickname,
      requestedById: session.id,
      position: record.queue.length,
      createdAt: new Date().toISOString()
    };

    record.queue.push(queueItem);
    this.incrementQueueVersion(record.room.playback);
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);

    return queueItem;
  }

  async handleDuplicateSessionReplacement(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    if (!this.roomPlaybackService.pausePlaybackForSessionReplacement(record, sessionId)) {
      return record.room.playback;
    }

    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.room.playback;
  }

  async importPlaylistToQueue(roomId: string, sessionId: string, trackIds: string[]) {
    const session = await this.authService.getUserOrThrow(sessionId);
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    const validTrackIds = trackIds.filter((trackId) =>
      record.tracks.some((track) => track.id === trackId)
    );

    if (validTrackIds.length === 0) {
      throw new Error("No tracks from this playlist are available in the current room.");
    }

    const nextItems = validTrackIds.map(
      (trackId, offset): QueueItem => ({
        id: `queue_${randomUUID()}`,
        trackId,
        requestedBy: session.nickname,
        requestedById: session.id,
        position: record.queue.length + offset,
        createdAt: new Date().toISOString()
      })
    );

    record.queue.push(...nextItems);
    this.incrementQueueVersion(record.room.playback);
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.queue;
  }

  async removeQueueItem(roomId: string, queueItemId: string, actorSessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, actorSessionId);
    const removed = record.queue.find((item) => item.id === queueItemId);

    if (!removed) {
      return record.queue;
    }

    await this.assertCanManageQueue(record, actorSessionId, removed);

    const nextQueue = record.queue
      .filter((item) => item.id !== queueItemId)
      .map((item, index) => ({ ...item, position: index }));

    if (removed && record.room.playback.currentQueueItemId === removed.id) {
      const nextItem = nextQueue[removed.position] ?? nextQueue[removed.position - 1] ?? null;
      if (nextItem) {
        await this.roomPlaybackService.applyTrackPlayback(record, nextItem.trackId, 0, nextItem.id);
        this.incrementPlaybackRevision(record.room.playback);
        record.queue = nextQueue;
        this.incrementQueueVersion(record.room.playback);
        this.incrementRoomRevision(record.room);
        await this.roomRecordRepository.persistRecord(record);
        return record.queue;
      }
      record.queue = nextQueue;
      this.roomPlaybackService.clearPlayback(record.room.playback);
      this.incrementQueueVersion(record.room.playback);
      this.incrementRoomRevision(record.room);
      await this.roomRecordRepository.persistRecord(record);
      return record.queue;
    }

    record.queue = nextQueue;
    this.incrementQueueVersion(record.room.playback);
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.queue;
  }

  async reorderQueue(roomId: string, actorSessionId: string, queueItemIds: string[]) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, actorSessionId);
    await this.assertHost(record, actorSessionId);

    const existingIds = record.queue.map((item) => item.id);
    if (
      queueItemIds.length !== existingIds.length ||
      queueItemIds.some((id) => !existingIds.includes(id))
    ) {
      throw new Error("Queue reorder payload does not match the current room queue.");
    }

    const nextQueue = queueItemIds
      .map((queueItemId) => record.queue.find((item) => item.id === queueItemId))
      .filter((item): item is QueueItem => !!item)
      .map((item, index) => ({
        ...item,
        position: index
      }));

    record.queue = nextQueue;
    this.incrementQueueVersion(record.room.playback);
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.queue;
  }

  async updatePlayback(
    roomId: string,
    input: {
      action: "play" | "pause" | "seek" | "next" | "prev";
      trackId?: string;
      queueItemId?: string;
      positionMs?: number;
      actorSessionId?: string;
      actorPeerId?: string;
      expectedVersion?: number;
    }
  ): Promise<PlaybackSnapshot> {
    if (!this.isRealtimeAvailable()) {
      throw new Error("Realtime sync unavailable.");
    }

    const record = await this.roomRecordRepository.getRoomRecord(roomId);

    if (input.actorSessionId) {
      this.assertMember(record, input.actorSessionId);
      if (input.actorPeerId) {
        await this.roomPresenceService.touchRealtimePresence(
          roomId,
          input.actorSessionId,
          input.actorPeerId
        );
      }
    }
    const expectedVersion = input.expectedVersion ?? record.room.playback.playbackRevision;
    if (record.room.playback.playbackRevision !== expectedVersion) {
      throw new Error("Playback state version conflict.");
    }
    const playback = await this.roomPlaybackService.updatePlayback(record, input);
    this.incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return playback;
  }

  isRealtimeAvailable() {
    return typeof this.redis.isAvailable === "function" ? this.redis.isAvailable() : true;
  }

  async getTracks(roomId: string) {
    return (await this.roomRecordRepository.getRoomRecord(roomId)).tracks;
  }

  async getQueue(roomId: string) {
    return (await this.roomRecordRepository.getRoomRecord(roomId)).queue;
  }

  async getAccessibleQueue(roomId: string, sessionId: string) {
    const record = await this.roomRecordRepository.getRoomRecord(roomId);
    this.assertMember(record, sessionId);
    return record.queue;
  }

  private buildJoinCode() {
    let joinCode = "";

    while (joinCode.length < 6) {
      joinCode += randomBytes(6).toString("base64url").replace(/[^A-Z0-9]/gi, "");
    }

    return joinCode.slice(0, 6).toUpperCase();
  }

  private buildMember(session: UserProfile, role: RoomMember["role"]): RoomMember {
    return {
      id: session.id,
      nickname: session.nickname,
      role,
      joinedAt: new Date().toISOString(),
      peerId: null,
      presenceState: "offline"
    };
  }

  private async assertHost(record: RoomRecord, sessionId: string) {
    if (record.room.hostId !== sessionId) {
      throw new Error("Only the host can control playback.");
    }
  }

  private assertMember(record: RoomRecord, sessionId: string) {
    if (!record.room.members.some((member) => member.id === sessionId)) {
      throw new Error("Only room members can perform this action.");
    }
  }

  private assertUniqueNickname(record: RoomRecord, sessionId: string, nickname: string) {
    const normalizedNickname = nickname.trim().toLowerCase();

    if (
      record.room.members.some(
        (member) =>
          member.id !== sessionId && member.nickname.trim().toLowerCase() === normalizedNickname
      )
    ) {
      throw new Error("Nickname already exists in this room.");
    }
  }

  private async assertCanManageQueue(
    record: RoomRecord,
    actorSessionId: string,
    queueItem: QueueItem
  ) {
    if (
      record.room.hostId !== actorSessionId &&
      queueItem.requestedById !== actorSessionId
    ) {
      throw new Error("Only the host or the requester can remove this queue item.");
    }
  }

  private incrementQueueVersion(playback: PlaybackSnapshot) {
    playback.queueVersion += 1;
  }

  private incrementPlaybackRevision(playback: PlaybackSnapshot) {
    playback.playbackRevision += 1;
  }

  private removeTracksOwnedBySession(record: RoomRecord, sessionId: string) {
    const removedTrackIds = new Set(
      record.tracks
        .filter((track) => track.ownerSessionId === sessionId)
        .map((track) => track.id)
    );
    this.removeTracksById(record, removedTrackIds);
  }

  private removeTracksById(record: RoomRecord, trackIds: Set<string>) {
    if (trackIds.size === 0) {
      return;
    }

    const previousQueueLength = record.queue.length;
    record.tracks = record.tracks.filter((item) => !trackIds.has(item.id));
    record.queue = record.queue
      .filter((item) => !trackIds.has(item.trackId))
      .map((item, index) => ({ ...item, position: index }));

    if (
      record.room.playback.currentTrackId &&
      trackIds.has(record.room.playback.currentTrackId)
    ) {
      this.roomPlaybackService.clearPlayback(record.room.playback);
    }

    if (record.queue.length !== previousQueueLength) {
      this.incrementQueueVersion(record.room.playback);
    }
  }

  private incrementPresenceRevision(room: Room) {
    room.presenceRevision += 1;
  }

  private incrementRoomRevision(room: Room) {
    room.roomRevision = (room.roomRevision ?? 0) + 1;
    room.lastActiveAt = new Date().toISOString();
    room.archivedAt = null;
  }
}

function encodeRoomCursor(lastActiveAt: string, id: string) {
  return Buffer.from(JSON.stringify({ lastActiveAt, id }), "utf8").toString("base64url");
}

function decodeRoomCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      lastActiveAt?: unknown;
      id?: unknown;
    };
    return typeof value.lastActiveAt === "string" && typeof value.id === "string"
      ? { lastActiveAt: value.lastActiveAt, id: value.id }
      : null;
  } catch {
    return null;
  }
}
