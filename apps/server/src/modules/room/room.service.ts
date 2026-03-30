import { Injectable } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  GuestSession,
  PlaybackSnapshot,
  Playlist,
  QueueItem,
  Room,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";

type RoomRecord = {
  room: Room;
  tracks: TrackMeta[];
  queue: QueueItem[];
};

@Injectable()
export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly roomCacheTtlSeconds = 60 * 60 * 12;
  private readonly sessionRecentRoomTtlSeconds = 60 * 60 * 24 * 7;
  private readonly presenceTtlSeconds = 20;
  private readonly roomRegistryKey = "music-room:rooms";
  private readonly inMemoryPresence = new Map<
    string,
    Map<string, { peerId: string; expiresAt: number }>
  >();

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async createRoom(
    hostSessionId: string,
    visibility: Room["visibility"] = "public"
  ) {
    const hostSession = await this.authService.getSessionOrThrow(hostSessionId);
    const room: Room = {
      id: `room_${randomUUID()}`,
      hostId: hostSession.id,
      joinCode: this.buildJoinCode(),
      visibility,
      members: [this.buildMember(hostSession, "host")],
      playback: {
        status: "paused",
        currentTrackId: null,
        sourceSessionId: hostSession.id,
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        mediaEpoch: 0
      }
    };

    const record: RoomRecord = {
      room,
      tracks: [],
      queue: []
    };

    this.rooms.set(room.id, record);
    await this.persistRecord(record);

    return this.getRoomSnapshot(room.id, []);
  }

  async findRoomByJoinCode(joinCode: string) {
    const code = joinCode.trim().toUpperCase();
    const inMemoryRecord = [...this.rooms.values()].find(({ room }) => room.joinCode === code);

    if (inMemoryRecord) {
      return inMemoryRecord.room;
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomStates.findUnique({
        where: { joinCode: code }
      });

      if (persisted) {
        const record = this.deserializeRecord(persisted);
        this.rooms.set(record.room.id, record);
        return record.room;
      }
    }

    const redisRecord = await this.redis.getJson<RoomRecord>(this.joinCodeCacheKey(code));
    if (redisRecord) {
      this.rooms.set(redisRecord.room.id, redisRecord);
      return redisRecord.room;
    }

    throw new Error(`Room not found for join code: ${joinCode}`);
  }

  async getRoomSnapshot(roomId: string, playlists: Playlist[]): Promise<RoomSnapshot> {
    const record = await this.getRoomRecord(roomId);
    return this.buildSnapshot(record, playlists);
  }

  async getAccessibleRoomSnapshot(
    roomId: string,
    playlists: Playlist[],
    sessionId?: string
  ): Promise<RoomSnapshot> {
    const record = await this.getRoomRecord(roomId);
    const isMember =
      !!sessionId &&
      (record.room.hostId === sessionId ||
        record.room.members.some((member) => member.id === sessionId));

    if (!isMember && record.room.visibility !== "public") {
      throw new Error("Room not found.");
    }

    return this.buildSnapshot(record, playlists);
  }

  async listRoomsForSession(sessionId: string): Promise<RoomSnapshot[]> {
    const records = await this.listRecoverableRecords();

    const accessibleRecords = records.filter(
      (record: RoomRecord) =>
        record.room.hostId === sessionId ||
        record.room.members.some((member: RoomMember) => member.id === sessionId)
    );

    return Promise.all(
      accessibleRecords.map((record: RoomRecord) => this.buildSnapshot(record, []))
    );
  }

  async listPublicRooms(): Promise<RoomSnapshot[]> {
    const records = await this.listRecoverableRecords();
    const publicRecords = records.filter((record) => record.room.visibility === "public");
    const snapshots = await Promise.all(
      publicRecords.map((record) => this.buildSnapshot(record, []))
    );
    return snapshots.filter((snapshot) => snapshot.room.members.length > 0);
  }

  async getRecentRoomSnapshotForSession(sessionId: string): Promise<RoomSnapshot | null> {
    const roomId = await this.redis.getString(this.sessionRecentRoomKey(sessionId));

    if (roomId) {
      try {
        return await this.getRoomSnapshot(roomId, []);
      } catch {
        await this.redis.delete(this.sessionRecentRoomKey(sessionId));
      }
    }

    const rooms = await this.listRoomsForSession(sessionId);
    return rooms[0] ?? null;
  }

  async getRecoverableRoomSnapshot(roomId: string, sessionId: string): Promise<RoomSnapshot | null> {
    const record = await this.getRoomRecord(roomId);

    if (
      record.room.hostId !== sessionId &&
      !record.room.members.some((member) => member.id === sessionId)
    ) {
      return null;
    }

    return this.buildSnapshot(record, []);
  }

  async joinRoom(roomId: string, sessionId: string) {
    const record = await this.getRoomRecord(roomId);
    const session = await this.authService.getSessionOrThrow(sessionId);
    this.assertUniqueNickname(record, session.id, session.nickname);

    if (!record.room.members.some((member) => member.id === session.id)) {
      record.room.members.push(this.buildMember(session, "member"));
      await this.persistRecord(record);
    }

    return record.room;
  }

  async deleteRoom(roomId: string, sessionId: string) {
    const record = await this.getRoomRecord(roomId);

    if (record.room.hostId !== sessionId) {
      throw new Error("Only the host can delete this room.");
    }

    await this.deleteRecord(record);
    await Promise.all(
      record.room.members.map((member) =>
        this.clearRecentRoomForSessionIfMatching(member.id, roomId)
      )
    );

    return { ok: true };
  }

  async updatePeerPresence(roomId: string, sessionId: string, peerId: string | null) {
    const record = await this.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    record.room.members = record.room.members.map((member) =>
      member.id === sessionId ? { ...member, peerId } : member
    );

    await this.persistRecord(record);
    return record.room;
  }

  async touchRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    const record = await this.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    this.setInMemoryPresence(roomId, sessionId, peerId);
    await this.redis.setString(
      this.realtimePresenceKey(roomId, sessionId),
      peerId,
      this.presenceTtlSeconds
    );
  }

  async clearRealtimePresence(roomId: string, sessionId: string) {
    this.deleteInMemoryPresence(roomId, sessionId);
    await this.redis.delete(this.realtimePresenceKey(roomId, sessionId));
  }

  async leaveRoom(roomId: string, sessionId: string) {
    const record = await this.getRoomRecord(roomId);
    record.room.members = record.room.members.filter((member) => member.id !== sessionId);

    if (record.room.hostId === sessionId && record.room.members.length > 0) {
      const [nextHost, ...members] = record.room.members;
      record.room.hostId = nextHost.id;
      record.room.members = [
        { ...nextHost, role: "host" },
        ...members.map((member) => ({ ...member, role: "member" as const }))
      ];
    }

    if (record.room.members.length === 0) {
      await this.deleteRecord(record);
      await this.clearRecentRoomForSessionIfMatching(sessionId, roomId);
      return record.room;
    }

    await this.persistRecord(record);
    await this.clearRecentRoomForSessionIfMatching(sessionId, roomId);
    return record.room;
  }

  async registerTrack(
    roomId: string,
    sessionId: string,
    input: Omit<TrackMeta, "id"> & { id?: string }
  ) {
    await this.authService.getSessionOrThrow(sessionId);
    const record = await this.getRoomRecord(roomId);
    this.assertMember(record, sessionId);

    const track: TrackMeta = {
      ...input,
      ownerSessionId: input.ownerSessionId || sessionId,
      ownerNickname: input.ownerNickname || (await this.authService.getSessionOrThrow(sessionId)).nickname,
      id: input.id ?? `track_${randomUUID()}`
    };

    const existingIndex = record.tracks.findIndex((item) => item.id === track.id);

    if (existingIndex >= 0) {
      record.tracks[existingIndex] = track;
    } else {
      record.tracks.unshift(track);
    }

    await this.persistRecord(record);
    return track;
  }

  async addQueueItem(roomId: string, sessionId: string, trackId: string) {
    const session = await this.authService.getSessionOrThrow(sessionId);
    const record = await this.getRoomRecord(roomId);
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

    if (!record.room.playback.currentTrackId) {
      await this.updatePlayback(roomId, {
        action: "play",
        trackId,
        actorSessionId: sessionId
      });
    } else {
      record.room.playback.queueVersion += 1;
      await this.persistRecord(record);
    }

    return queueItem;
  }

  async importPlaylistToQueue(roomId: string, sessionId: string, trackIds: string[]) {
    const session = await this.authService.getSessionOrThrow(sessionId);
    const record = await this.getRoomRecord(roomId);
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

    if (!record.room.playback.currentTrackId) {
      await this.updatePlayback(roomId, {
        action: "play",
        trackId: nextItems[0]?.trackId,
        actorSessionId: sessionId
      });
      return record.queue;
    }

    record.room.playback.queueVersion += 1;
    await this.persistRecord(record);
    return record.queue;
  }

  async removeQueueItem(roomId: string, queueItemId: string, actorSessionId: string) {
    const record = await this.getRoomRecord(roomId);
    this.assertMember(record, actorSessionId);
    const removed = record.queue.find((item) => item.id === queueItemId);

    if (!removed) {
      return record.queue;
    }

    await this.assertCanManageQueue(record, actorSessionId, removed);

    record.queue = record.queue
      .filter((item) => item.id !== queueItemId)
      .map((item, index) => ({ ...item, position: index }));

    if (removed && record.room.playback.currentTrackId === removed.trackId) {
      const nextItem = record.queue[0];
      if (nextItem) {
        await this.updatePlayback(roomId, {
          action: "play",
          trackId: nextItem.trackId,
          actorSessionId
        });
        return record.queue;
      }
      record.room.playback.currentTrackId = null;
      record.room.playback.sourceSessionId = null;
      record.room.playback.sourcePeerId = null;
      record.room.playback.sourceTrackId = null;
      record.room.playback.positionMs = 0;
      record.room.playback.startedAt = null;
      record.room.playback.status = "paused";
      record.room.playback.mediaEpoch += 1;
    }

    record.room.playback.queueVersion += 1;
    await this.persistRecord(record);
    return record.queue;
  }

  async reorderQueue(roomId: string, actorSessionId: string, queueItemIds: string[]) {
    const record = await this.getRoomRecord(roomId);
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
    record.room.playback.queueVersion += 1;
    await this.persistRecord(record);
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
    }
  ): Promise<PlaybackSnapshot> {
    const record = await this.getRoomRecord(roomId);
    const playback = record.room.playback;

    if (input.actorSessionId) {
      this.assertMember(record, input.actorSessionId);
    }

    if (input.action === "next") {
      const currentIndex = record.queue.findIndex(
        (item) => item.trackId === playback.currentTrackId
      );
      const nextItem = record.queue[currentIndex + 1] ?? record.queue[0];
      if (nextItem) {
        await this.applyTrackPlayback(record, nextItem.trackId, input.positionMs ?? 0);
      } else {
        this.clearPlayback(playback);
      }
    }

    if (input.action === "prev") {
      const currentIndex = record.queue.findIndex(
        (item) => item.trackId === playback.currentTrackId
      );
      const previousItem =
        currentIndex > 0 ? record.queue[currentIndex - 1] : record.queue[0];
      if (previousItem) {
        await this.applyTrackPlayback(record, previousItem.trackId, input.positionMs ?? 0);
      }
    }

    if (input.action === "play") {
      let nextTrackId =
        input.trackId ?? playback.currentTrackId ?? record.queue[0]?.trackId ?? null;

      if (input.queueItemId) {
        const queueItem = record.queue.find((item) => item.id === input.queueItemId);
        if (!queueItem) {
          throw new Error("Queue item not found in this room.");
        }
        nextTrackId = queueItem.trackId;
      }
      if (!nextTrackId) {
        this.clearPlayback(playback);
      } else {
        await this.applyTrackPlayback(record, nextTrackId, input.positionMs ?? playback.positionMs);
      }
    }

    if (input.action === "pause") {
      playback.status = "paused";
      playback.positionMs = input.positionMs ?? playback.positionMs;
    }

    if (input.action === "seek") {
      playback.positionMs = input.positionMs ?? 0;
      if (playback.status === "playing") {
        playback.startedAt = new Date().toISOString();
      }
    }

    playback.queueVersion += 1;
    await this.persistRecord(record);
    return playback;
  }

  async getTracks(roomId: string) {
    return (await this.getRoomRecord(roomId)).tracks;
  }

  async getQueue(roomId: string) {
    return (await this.getRoomRecord(roomId)).queue;
  }

  private buildJoinCode() {
    let joinCode = "";

    while (joinCode.length < 6) {
      joinCode += randomBytes(6).toString("base64url").replace(/[^A-Z0-9]/gi, "");
    }

    return joinCode.slice(0, 6).toUpperCase();
  }

  private buildMember(session: GuestSession, role: RoomMember["role"]): RoomMember {
    return {
      id: session.id,
      nickname: session.nickname,
      role,
      joinedAt: new Date().toISOString(),
      peerId: null
    };
  }

  private async getRoomRecord(roomId: string) {
    const cached = this.rooms.get(roomId);

    if (cached) {
      return cached;
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomStates.findUnique({
        where: { id: roomId }
      });

      if (persisted) {
        const record = this.deserializeRecord(persisted);
        this.rooms.set(roomId, record);
        return record;
      }
    }

    const redisRecord = await this.redis.getJson<RoomRecord>(this.roomCacheKey(roomId));
    if (redisRecord) {
      this.rooms.set(roomId, redisRecord);
      return redisRecord;
    }

    throw new Error(`Room not found: ${roomId}`);
  }

  private async persistRecord(record: RoomRecord) {
    this.rooms.set(record.room.id, record);
    await this.redis.addToSet(this.roomRegistryKey, record.room.id);
    await this.redis.setJson(this.roomCacheKey(record.room.id), record, this.roomCacheTtlSeconds);
    await this.redis.setJson(
      this.joinCodeCacheKey(record.room.joinCode),
      record,
      this.roomCacheTtlSeconds
    );
    await Promise.all(
      record.room.members.map((member) =>
        this.redis.setString(
          this.sessionRecentRoomKey(member.id),
          record.room.id,
          this.sessionRecentRoomTtlSeconds
        )
      )
    );

    if (!this.prisma.isAvailable()) {
      return;
    }

    await this.prisma.roomStates.upsert({
      where: { id: record.room.id },
      update: {
        hostId: record.room.hostId,
        joinCode: record.room.joinCode,
        visibility: record.room.visibility,
        playback: record.room.playback,
        members: record.room.members,
        tracks: record.tracks,
        queue: record.queue
      },
      create: {
        id: record.room.id,
        hostId: record.room.hostId,
        joinCode: record.room.joinCode,
        visibility: record.room.visibility,
        playback: record.room.playback,
        members: record.room.members,
        tracks: record.tracks,
        queue: record.queue
      }
    });
  }

  private async deleteRecord(record: RoomRecord) {
    this.rooms.delete(record.room.id);
    await Promise.all([
      this.redis.removeFromSet(this.roomRegistryKey, record.room.id),
      this.redis.delete(this.roomCacheKey(record.room.id)),
      this.redis.delete(this.joinCodeCacheKey(record.room.joinCode))
    ]);

    if (!this.prisma.isAvailable()) {
      return;
    }

    await this.prisma.roomStates.deleteMany({
      where: { id: record.room.id }
    });
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

  private roomCacheKey(roomId: string) {
    return `music-room:room:${roomId}`;
  }

  private async listRecoverableRecords() {
    const records = new Map<string, RoomRecord>();

    for (const record of this.rooms.values()) {
      records.set(record.room.id, record);
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomStates.findMany({
        orderBy: { updatedAt: "desc" }
      });

      for (const item of persisted) {
        const record = this.deserializeRecord(item);
        this.rooms.set(record.room.id, record);
        records.set(record.room.id, record);
      }
    }

    const redisRoomIds = await this.redis.getSetMembers(this.roomRegistryKey);
    for (const roomId of redisRoomIds) {
      if (records.has(roomId)) {
        continue;
      }

      const record = await this.redis.getJson<RoomRecord>(this.roomCacheKey(roomId));
      if (!record) {
        await this.redis.removeFromSet(this.roomRegistryKey, roomId);
        continue;
      }

      this.rooms.set(roomId, record);
      records.set(roomId, record);
    }

    return [...records.values()].sort(
      (left, right) =>
        new Date(right.room.playback.startedAt ?? 0).getTime() -
        new Date(left.room.playback.startedAt ?? 0).getTime()
    );
  }

  private joinCodeCacheKey(joinCode: string) {
    return `music-room:join-code:${joinCode}`;
  }

  private sessionRecentRoomKey(sessionId: string) {
    return `music-room:session:${sessionId}:recent-room`;
  }

  private async clearRecentRoomForSessionIfMatching(sessionId: string, roomId: string) {
    const key = this.sessionRecentRoomKey(sessionId);
    const currentRoomId = await this.redis.getString(key);

    if (currentRoomId === roomId) {
      await this.redis.delete(key);
    }
  }

  private deserializeRecord(persisted: {
    id: string;
    hostId: string;
    joinCode: string;
    visibility: string;
    playback: unknown;
    members: unknown;
    tracks: unknown;
    queue: unknown;
  }): RoomRecord {
    const persistedPlayback = persisted.playback as Partial<PlaybackSnapshot>;
    return {
      room: {
        id: persisted.id,
        hostId: persisted.hostId,
        joinCode: persisted.joinCode,
        visibility: persisted.visibility as Room["visibility"],
        members: persisted.members as RoomMember[],
        playback: {
          status: persistedPlayback.status ?? "paused",
          currentTrackId: persistedPlayback.currentTrackId ?? null,
          sourceSessionId: persistedPlayback.sourceSessionId ?? persisted.hostId,
          sourcePeerId: persistedPlayback.sourcePeerId ?? null,
          sourceTrackId: persistedPlayback.sourceTrackId ?? persistedPlayback.currentTrackId ?? null,
          positionMs: persistedPlayback.positionMs ?? 0,
          startedAt: persistedPlayback.startedAt ?? null,
          queueVersion: persistedPlayback.queueVersion ?? 1,
          mediaEpoch: persistedPlayback.mediaEpoch ?? 0
        }
      },
      tracks: persisted.tracks as TrackMeta[],
      queue: persisted.queue as QueueItem[]
    };
  }

  private async buildSnapshot(record: RoomRecord, playlists: Playlist[]): Promise<RoomSnapshot> {
    const activePresence = await this.getActivePresence(record.room.id, record.room.members);
    const activeMembers = record.room.members
      .map((member) => ({
        ...member,
        peerId: activePresence.get(member.id) ?? null
      }))
      .filter((member) => !!member.peerId);

    return {
      room: {
        ...record.room,
        playback: {
          ...record.room.playback,
          sourcePeerId: record.room.playback.sourceSessionId
            ? activePresence.get(record.room.playback.sourceSessionId) ?? null
            : null
        },
        members: activeMembers
      },
      tracks: record.tracks,
      queue: record.queue,
      playlists
    };
  }

  private async getActivePresence(roomId: string, members: RoomMember[]) {
    this.pruneExpiredInMemoryPresence(roomId);

    const activePresence = new Map<string, string>();
    const roomPresence = this.inMemoryPresence.get(roomId);

    for (const member of members) {
      const localPresence = roomPresence?.get(member.id);
      if (localPresence && localPresence.expiresAt > Date.now()) {
        activePresence.set(member.id, localPresence.peerId);
      }
    }

    const redisPresence = await Promise.all(
      members.map(async (member) => ({
        memberId: member.id,
        peerId: await this.redis.getString(this.realtimePresenceKey(roomId, member.id))
      }))
    );

    for (const entry of redisPresence) {
      if (!entry.peerId) {
        continue;
      }

      activePresence.set(entry.memberId, entry.peerId);
      this.setInMemoryPresence(roomId, entry.memberId, entry.peerId);
    }

    return activePresence;
  }

  private setInMemoryPresence(roomId: string, sessionId: string, peerId: string) {
    const roomPresence = this.inMemoryPresence.get(roomId) ?? new Map();
    roomPresence.set(sessionId, {
      peerId,
      expiresAt: Date.now() + this.presenceTtlSeconds * 1000
    });
    this.inMemoryPresence.set(roomId, roomPresence);
  }

  private deleteInMemoryPresence(roomId: string, sessionId: string) {
    const roomPresence = this.inMemoryPresence.get(roomId);
    if (!roomPresence) {
      return;
    }

    roomPresence.delete(sessionId);
    if (roomPresence.size === 0) {
      this.inMemoryPresence.delete(roomId);
    }
  }

  private pruneExpiredInMemoryPresence(roomId: string) {
    const roomPresence = this.inMemoryPresence.get(roomId);
    if (!roomPresence) {
      return;
    }

    for (const [sessionId, presence] of roomPresence.entries()) {
      if (presence.expiresAt <= Date.now()) {
        roomPresence.delete(sessionId);
      }
    }

    if (roomPresence.size === 0) {
      this.inMemoryPresence.delete(roomId);
    }
  }

  private realtimePresenceKey(roomId: string, sessionId: string) {
    return `music-room:presence:${roomId}:${sessionId}`;
  }

  private async applyTrackPlayback(record: RoomRecord, trackId: string, positionMs: number) {
    const playback = record.room.playback;
    const track = record.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new Error(`Track not found in room: ${trackId}`);
    }

    const activePresence = await this.getActivePresence(record.room.id, record.room.members);
    const ownerPeerId = activePresence.get(track.ownerSessionId);
    if (!ownerPeerId) {
      throw new Error("Track owner is not online, so this song cannot be played right now.");
    }

    const isSwitchingSource =
      playback.currentTrackId !== trackId || playback.sourceSessionId !== track.ownerSessionId;

    playback.status = "playing";
    playback.currentTrackId = trackId;
    playback.sourceSessionId = track.ownerSessionId;
    playback.sourcePeerId = ownerPeerId;
    playback.sourceTrackId = trackId;
    playback.positionMs = positionMs;
    playback.startedAt = new Date().toISOString();
    if (isSwitchingSource) {
      playback.mediaEpoch += 1;
    }
  }

  private clearPlayback(playback: PlaybackSnapshot) {
    playback.status = "paused";
    playback.currentTrackId = null;
    playback.sourceSessionId = null;
    playback.sourcePeerId = null;
    playback.sourceTrackId = null;
    playback.positionMs = 0;
    playback.startedAt = null;
    playback.mediaEpoch += 1;
  }
}
