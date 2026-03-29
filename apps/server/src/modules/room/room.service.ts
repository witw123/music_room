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
  private readonly roomRegistryKey = "music-room:rooms";

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async createRoom(
    hostSessionId: string,
    visibility: Room["visibility"] = "private"
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
        positionMs: 0,
        startedAt: null,
        queueVersion: 1
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

    return {
      room: record.room,
      tracks: record.tracks,
      queue: record.queue,
      playlists
    };
  }

  async listRoomsForSession(sessionId: string): Promise<RoomSnapshot[]> {
    const records = await this.listRecoverableRecords();

    return records
      .filter(
        (record: RoomRecord) =>
          record.room.hostId === sessionId ||
          record.room.members.some((member: RoomMember) => member.id === sessionId)
      )
      .map((record: RoomRecord) => ({
        room: record.room,
        tracks: record.tracks,
        queue: record.queue,
        playlists: []
      }));
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

    return {
      room: record.room,
      tracks: record.tracks,
      queue: record.queue,
      playlists: []
    };
  }

  async joinRoom(roomId: string, sessionId: string) {
    const record = await this.getRoomRecord(roomId);
    const session = await this.authService.getSessionOrThrow(sessionId);

    if (!record.room.members.some((member) => member.id === session.id)) {
      record.room.members.push(this.buildMember(session, "member"));
      await this.persistRecord(record);
    }

    return record.room;
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
        trackId
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
      record.room.playback.currentTrackId = nextItems[0]?.trackId ?? null;
      record.room.playback.positionMs = 0;
      record.room.playback.startedAt = nextItems.length > 0 ? new Date().toISOString() : null;
      record.room.playback.status = nextItems.length > 0 ? "playing" : "paused";
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
      record.room.playback.currentTrackId = nextItem?.trackId ?? null;
      record.room.playback.positionMs = 0;
      record.room.playback.startedAt = nextItem ? new Date().toISOString() : null;
      record.room.playback.status = nextItem ? "playing" : "paused";
    }

    record.room.playback.queueVersion += 1;
    await this.persistRecord(record);
    return record.queue;
  }

  async updatePlayback(
    roomId: string,
    input: {
      action: "play" | "pause" | "seek" | "next";
      trackId?: string;
      positionMs?: number;
      actorSessionId?: string;
    }
  ): Promise<PlaybackSnapshot> {
    const record = await this.getRoomRecord(roomId);
    const playback = record.room.playback;

    if (input.actorSessionId) {
      this.assertMember(record, input.actorSessionId);
      await this.assertHost(record, input.actorSessionId);
    }

    if (input.action === "next") {
      const currentIndex = record.queue.findIndex(
        (item) => item.trackId === playback.currentTrackId
      );
      const nextItem = record.queue[currentIndex + 1] ?? record.queue[0];

      playback.currentTrackId = nextItem?.trackId ?? null;
      playback.positionMs = 0;
      playback.status = nextItem ? "playing" : "paused";
      playback.startedAt = nextItem ? new Date().toISOString() : null;
    }

    if (input.action === "play") {
      playback.status = "playing";
      playback.currentTrackId =
        input.trackId ?? playback.currentTrackId ?? record.queue[0]?.trackId ?? null;
      playback.positionMs = input.positionMs ?? playback.positionMs;
      playback.startedAt = new Date().toISOString();
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
    return {
      room: {
        id: persisted.id,
        hostId: persisted.hostId,
        joinCode: persisted.joinCode,
        visibility: persisted.visibility as Room["visibility"],
        members: persisted.members as RoomMember[],
        playback: persisted.playback as PlaybackSnapshot
      },
      tracks: persisted.tracks as TrackMeta[],
      queue: persisted.queue as QueueItem[]
    };
  }
}
