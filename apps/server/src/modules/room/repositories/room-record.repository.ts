import { RedisService } from "../../../infra/redis/redis.service";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import {
  deserializeRoomRecord,
  serializePlaybackForPersistence,
  type RoomRecord
} from "../room.types";

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
      return cloneRoomRecord(inMemoryRecord).room;
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findUnique({
        where: { joinCode: code }
      });

      if (persisted) {
        const record = deserializeRoomRecord(persisted);
        this.rooms.set(record.room.id, cloneRoomRecord(record));
        return cloneRoomRecord(record).room;
      }
    }

    const redisRecord = await this.redis.getJson<RoomRecord>(this.joinCodeCacheKey(code));
    if (redisRecord) {
      this.rooms.set(redisRecord.room.id, cloneRoomRecord(redisRecord));
      return cloneRoomRecord(redisRecord).room;
    }

    throw new Error(`Room not found for join code: ${joinCode}`);
  }

  async getRoomRecord(roomId: string) {
    const cached = this.rooms.get(roomId);

    if (cached) {
      return cloneRoomRecord(cached);
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findUnique({
        where: { id: roomId }
      });

      if (persisted) {
        const record = deserializeRoomRecord(persisted);
        this.rooms.set(roomId, cloneRoomRecord(record));
        return cloneRoomRecord(record);
      }
    }

    const redisRecord = await this.redis.getJson<RoomRecord>(this.roomCacheKey(roomId));
    if (redisRecord) {
      this.rooms.set(roomId, cloneRoomRecord(redisRecord));
      return cloneRoomRecord(redisRecord);
    }

    throw new Error(`Room not found: ${roomId}`);
  }

  async persistRecord(record: RoomRecord) {
    if (this.prisma.isAvailable()) {
      await this.persistRecordToDatabase(record);
    }

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
    this.rooms.set(record.room.id, cloneRoomRecord(record));
  }

  async deleteRecord(record: RoomRecord) {
    await Promise.all([
      this.redis.removeFromSet(this.roomRegistryKey, record.room.id),
      this.redis.delete(this.roomCacheKey(record.room.id)),
      this.redis.delete(this.joinCodeCacheKey(record.room.joinCode))
    ]);

    if (this.prisma.isAvailable()) {
      await this.prisma.roomState.deleteMany({
        where: { id: record.room.id }
      });
    }

    this.rooms.delete(record.room.id);
  }

  async listRecoverableRecords() {
    const records = new Map<string, RoomRecord>();

    for (const record of this.rooms.values()) {
      records.set(record.room.id, cloneRoomRecord(record));
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findMany({
        orderBy: { updatedAt: "desc" }
      });

      for (const item of persisted) {
        const record = deserializeRoomRecord(item);
        this.rooms.set(record.room.id, cloneRoomRecord(record));
        records.set(record.room.id, cloneRoomRecord(record));
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

      this.rooms.set(roomId, cloneRoomRecord(record));
      records.set(roomId, cloneRoomRecord(record));
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

  async setRecentRoomForSession(sessionId: string, roomId: string) {
    await this.redis.setString(
      this.sessionRecentRoomKey(sessionId),
      roomId,
      this.sessionRecentRoomTtlSeconds
    );
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

  private async persistRecordToDatabase(record: RoomRecord) {
    const payload = {
      hostId: record.room.hostId,
      joinCode: record.room.joinCode,
      visibility: record.room.visibility,
      roomRevision: record.room.roomRevision ?? 0,
      presenceRevision: record.room.presenceRevision,
      playback: serializePlaybackForPersistence(record.room),
      members: record.room.members,
      tracks: record.tracks,
      queue: record.queue
    };
    const existing = await this.prisma.roomState.findUnique({
      where: { id: record.room.id },
      select: { id: true }
    });

    if (!existing) {
      await this.prisma.roomState.create({
        data: {
          id: record.room.id,
          ...payload
        }
      });
      return;
    }

    const result = await this.prisma.roomState.updateMany({
      where: {
        id: record.room.id,
        roomRevision: {
          lt: record.room.roomRevision ?? 0
        }
      },
      data: payload
    });

    if (result.count === 0) {
      throw new Error("Room state revision conflict.");
    }
  }
}

function cloneRoomRecord(record: RoomRecord): RoomRecord {
  return structuredClone(record);
}
