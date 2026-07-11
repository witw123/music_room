import { RedisService } from "../../../infra/redis/redis.service";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import { Logger } from "@nestjs/common";
import {
  deserializeRoomRecord,
  roomRecordSchema,
  serializePlaybackForPersistence,
  type RoomRecord
} from "../room.types";

export class RoomRecordRepository {
  private readonly logger = new Logger(RoomRecordRepository.name);
  private readonly pendingProjectionRetries = new Map<string, number>();
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

      if (persisted && "playback" in persisted) {
        const record = parseRoomRecord(deserializeRoomRecord(persisted));
        if (record) {
          this.rooms.set(record.room.id, cloneRoomRecord(record));
          return cloneRoomRecord(record).room;
        }
      }
    }

    const redisRecord = await this.redis.getJson<unknown>(this.joinCodeCacheKey(code));
    const parsedRedisRecord = parseRoomRecord(redisRecord);
    if (parsedRedisRecord && parsedRedisRecord.room.joinCode === code) {
      this.rooms.set(parsedRedisRecord.room.id, cloneRoomRecord(parsedRedisRecord));
      return cloneRoomRecord(parsedRedisRecord).room;
    }

    throw new Error(`Room not found for join code: ${joinCode}`);
  }

  async getRoomRecord(roomId: string) {
    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findUnique({
        where: { id: roomId }
      });

      if (persisted && "playback" in persisted) {
        const record = parseRoomRecord(deserializeRoomRecord(persisted));
        if (record) {
          this.rooms.set(roomId, cloneRoomRecord(record));
          return cloneRoomRecord(record);
        }
      }
      if (!persisted) {
        this.rooms.delete(roomId);
        throw new Error(`Room not found: ${roomId}`);
      }
    }

    const cached = this.rooms.get(roomId);
    if (cached) {
      return cloneRoomRecord(cached);
    }

    const redisRecord = await this.redis.getJson<unknown>(this.roomCacheKey(roomId));
    const parsedRedisRecord = parseRoomRecord(redisRecord);
    if (parsedRedisRecord && parsedRedisRecord.room.id === roomId) {
      this.rooms.set(roomId, cloneRoomRecord(parsedRedisRecord));
      return cloneRoomRecord(parsedRedisRecord);
    }

    throw new Error(`Room not found: ${roomId}`);
  }

  async persistRecord(record: RoomRecord) {
    const databaseAvailable = this.prisma.isAvailable();
    if (databaseAvailable) {
      await this.persistRecordToDatabase(record);
      this.rooms.set(record.room.id, cloneRoomRecord(record));
      try {
        await this.persistRedisProjection(record);
      } catch (error) {
        this.logger.warn(`Room projection update failed for ${record.room.id}: ${String(error)}`);
        this.scheduleProjectionRetry(record);
      }
      return;
    }

    const supportsRedisRevisionGuard =
      typeof this.redis.setJsonIfRevisionMatches === "function";
    if (!databaseAvailable && supportsRedisRevisionGuard) {
      const didPersist = await this.redis.setJsonIfRevisionMatches(
        this.roomCacheKey(record.room.id),
        record,
        (record.room.roomRevision ?? 0) - 1,
        this.roomCacheTtlSeconds
      );
      if (!didPersist) {
        throw new Error("Room state revision conflict.");
      }
    }

    await this.persistRedisProjection(record, !supportsRedisRevisionGuard);
    this.rooms.set(record.room.id, cloneRoomRecord(record));
  }

  async deleteRecord(record: RoomRecord) {
    if (this.prisma.isAvailable()) {
      await this.prisma.roomState.deleteMany({
        where: { id: record.room.id }
      });
      await this.finalizeDatabaseDelete(record);
      return;
    }

    await this.deleteRedisProjection(record);
    this.rooms.delete(record.room.id);
  }

  async finalizeDatabaseDelete(record: RoomRecord) {
    this.rooms.delete(record.room.id);
    try {
      await this.deleteRedisProjection(record);
    } catch (error) {
      this.logger.warn(`Room projection delete failed for ${record.room.id}: ${String(error)}`);
    }
  }

  private async persistRedisProjection(record: RoomRecord, writeRoom = true) {
    await this.redis.addToSet(this.roomRegistryKey, record.room.id);
    if (writeRoom) {
      await this.redis.setJson(this.roomCacheKey(record.room.id), record, this.roomCacheTtlSeconds);
    }
    await this.redis.setJson(this.joinCodeCacheKey(record.room.joinCode), record, this.roomCacheTtlSeconds);
    await Promise.all(record.room.members.map((member) =>
      this.redis.setString(
        this.sessionRecentRoomKey(member.id),
        record.room.id,
        this.sessionRecentRoomTtlSeconds
      )
    ));
  }

  private async deleteRedisProjection(record: RoomRecord) {
    await Promise.all([
      this.redis.removeFromSet(this.roomRegistryKey, record.room.id),
      this.redis.delete(this.roomCacheKey(record.room.id)),
      this.redis.delete(this.joinCodeCacheKey(record.room.joinCode))
    ]);
  }

  private scheduleProjectionRetry(record: RoomRecord) {
    const attempts = this.pendingProjectionRetries.get(record.room.id) ?? 0;
    if (attempts >= 3) return;
    this.pendingProjectionRetries.set(record.room.id, attempts + 1);
    const timer = setTimeout(() => {
      void this.persistRedisProjection(record)
        .then(() => this.pendingProjectionRetries.delete(record.room.id))
        .catch(() => this.scheduleProjectionRetry(record));
    }, 500 * 2 ** attempts);
    timer.unref?.();
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
        const record = parseRoomRecord(deserializeRoomRecord(item));
        if (!record) {
          continue;
        }
        this.rooms.set(record.room.id, cloneRoomRecord(record));
        records.set(record.room.id, cloneRoomRecord(record));
      }
    }

    const redisRoomIds = await this.redis.getSetMembers(this.roomRegistryKey);
    for (const roomId of redisRoomIds) {
      if (records.has(roomId)) {
        continue;
      }

      const rawRecord = await this.redis.getJson<unknown>(this.roomCacheKey(roomId));
      const record = parseRoomRecord(rawRecord);
      if (!record || record.room.id !== roomId) {
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
      lastActiveAt: new Date(record.room.lastActiveAt ?? Date.now()),
      archivedAt: record.room.archivedAt ? new Date(record.room.archivedAt) : null,
      roomRevision: record.room.roomRevision ?? 0,
      presenceRevision: record.room.presenceRevision,
      playback: serializePlaybackForPersistence(record.room),
      members: record.room.members,
      tracks: record.tracks,
      queue: record.queue
    };

    const updateResult = await this.prisma.roomState.updateMany({
      where: {
        id: record.room.id,
        roomRevision: (record.room.roomRevision ?? 0) - 1
      },
      data: payload
    });

    if (updateResult.count > 0) {
      return;
    }

    // Row either doesn't exist yet or a concurrent write updated it.
    // Check which case we're in to avoid a blind create race.
    const existing = await this.prisma.roomState.findUnique({
      where: { id: record.room.id },
      select: { id: true }
    });

    if (!existing) {
      try {
        await this.prisma.roomState.create({
          data: { id: record.room.id, ...payload }
        });
        return;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          // Another process created the room concurrently; retry the
          // optimistic update once so callers don't see a false conflict.
          const retryResult = await this.prisma.roomState.updateMany({
            where: {
              id: record.room.id,
              roomRevision: (record.room.roomRevision ?? 0) - 1
            },
            data: payload
          });
          if (retryResult.count > 0) {
            return;
          }
          throw new Error("Room state revision conflict.");
        }
        throw error;
      }
    }

    throw new Error("Room state revision conflict.");
  }
}

function cloneRoomRecord(record: RoomRecord): RoomRecord {
  return structuredClone(record);
}

function parseRoomRecord(value: unknown): RoomRecord | null {
  const parsed = roomRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
