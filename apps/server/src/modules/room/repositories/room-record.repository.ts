import { RedisService } from "../../../infra/redis/redis.service";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import { deserializeRoomRecord, type RoomRecord } from "../room.types";

export class RoomRecordRepository {
  constructor(
    private readonly rooms: Map<string, RoomRecord>,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly roomRegistryKey: string,
    private readonly roomCacheTtlSeconds: number,
    private readonly sessionRecentRoomTtlSeconds: number
  ) {}

  async findByJoinCode(joinCode: string) {
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
        const record = deserializeRoomRecord(persisted);
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

  async getRoomRecord(roomId: string) {
    const cached = this.rooms.get(roomId);

    if (cached) {
      return cached;
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomStates.findUnique({
        where: { id: roomId }
      });

      if (persisted) {
        const record = deserializeRoomRecord(persisted);
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

  async persistRecord(record: RoomRecord) {
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

  async deleteRecord(record: RoomRecord) {
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

  async listRecoverableRecords() {
    const records = new Map<string, RoomRecord>();

    for (const record of this.rooms.values()) {
      records.set(record.room.id, record);
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomStates.findMany({
        orderBy: { updatedAt: "desc" }
      });

      for (const item of persisted) {
        const record = deserializeRoomRecord(item);
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

  async clearRecentRoomForSessionIfMatching(sessionId: string, roomId: string) {
    const key = this.sessionRecentRoomKey(sessionId);
    const currentRoomId = await this.redis.getString(key);

    if (currentRoomId === roomId) {
      await this.redis.delete(key);
    }
  }

  sessionRecentRoomKey(sessionId: string) {
    return `music-room:session:${sessionId}:recent-room`;
  }

  private roomCacheKey(roomId: string) {
    return `music-room:room:${roomId}`;
  }

  private joinCodeCacheKey(joinCode: string) {
    return `music-room:join-code:${joinCode}`;
  }
}
