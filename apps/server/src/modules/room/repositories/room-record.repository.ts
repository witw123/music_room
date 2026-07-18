import { RedisService } from "../../../infra/redis/redis.service";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import {
  deserializeRoomRecord,
  roomRecordSchema,
  serializePlaybackForPersistence,
  type RoomRecord
} from "../room.types";

export class RoomRecordRepository {
  private readonly terminationTtlSeconds = 30 * 24 * 60 * 60;

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

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findUnique({
        where: { joinCode: code }
      });

      if (persisted) {
        if (await this.isRoomTerminated(persisted.id)) {
          throw new Error(`Room not found for join code: ${joinCode}`);
        }
        let record: RoomRecord | null = null;
        try {
          record = parseRoomRecord(deserializeRoomRecord(persisted));
        } catch {
          record = null;
        }
        if (record) {
          this.rooms.set(record.room.id, cloneRoomRecord(record));
          return cloneRoomRecord(record).room;
        }
      }

      // PostgreSQL is authoritative when it is available. Never resurrect a
      // deleted room (a missing row) from an old process-local or Redis cache entry.
      if (!persisted) {
        throw new Error(`Room not found for join code: ${joinCode}`);
      }
    }

    if (this.isRedisAvailable()) {
      const redisRecord = await this.redis.getJson<unknown>(this.joinCodeCacheKey(code));
      const parsedRedisRecord = parseRoomRecord(redisRecord);
      if (parsedRedisRecord && parsedRedisRecord.room.joinCode === code) {
        if (await this.isRoomTerminated(parsedRedisRecord.room.id)) {
          throw new Error(`Room not found for join code: ${joinCode}`);
        }
        this.rooms.set(parsedRedisRecord.room.id, cloneRoomRecord(parsedRedisRecord));
        return cloneRoomRecord(parsedRedisRecord).room;
      }
    } else if (inMemoryRecord) {
      return cloneRoomRecord(inMemoryRecord).room;
    }

    throw new Error(`Room not found for join code: ${joinCode}`);
  }

  async getRoomRecord(roomId: string, options?: { allowTerminated?: boolean }) {
    const cached = this.rooms.get(roomId);

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findUnique({
        where: { id: roomId }
      });

      if (persisted) {
        if (!options?.allowTerminated && await this.isRoomTerminated(roomId)) {
          throw new Error(`Room not found: ${roomId}`);
        }
        let record: RoomRecord | null = null;
        try {
          record = parseRoomRecord(deserializeRoomRecord(persisted));
        } catch {
          record = null;
        }
        if (record) {
          this.rooms.set(roomId, cloneRoomRecord(record));
          return cloneRoomRecord(record);
        }
      }

      // Do not fall back to a stale in-memory record after a database delete.
      if (!persisted) {
        throw new Error(`Room not found: ${roomId}`);
      }
    }

    if (this.isRedisAvailable()) {
      const redisRecord = await this.redis.getJson<unknown>(this.roomCacheKey(roomId));
      const parsedRedisRecord = parseRoomRecord(redisRecord);
      if (parsedRedisRecord && parsedRedisRecord.room.id === roomId) {
        if (!options?.allowTerminated && await this.isRoomTerminated(roomId)) {
          throw new Error(`Room not found: ${roomId}`);
        }
        this.rooms.set(roomId, cloneRoomRecord(parsedRedisRecord));
        return cloneRoomRecord(parsedRedisRecord);
      }
    } else if (cached) {
      return cloneRoomRecord(cached);
    }

    throw new Error(`Room not found: ${roomId}`);
  }

  async persistRecord(record: RoomRecord) {
    if (await this.isRoomTerminated(record.room.id)) {
      throw new Error(`Room has been terminated: ${record.room.id}`);
    }

    const databaseAvailable = this.prisma.isAvailable();
    if (databaseAvailable) {
      await this.persistRecordToDatabase(record);
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

    await Promise.all([
      this.redis.addToSet(this.roomRegistryKey, record.room.id),
      ...(databaseAvailable || !supportsRedisRevisionGuard
        ? [
            this.redis.setJson(
              this.roomCacheKey(record.room.id),
              record,
              this.roomCacheTtlSeconds
            )
          ]
        : []),
      this.redis.setJson(
        this.joinCodeCacheKey(record.room.joinCode),
        record,
        this.roomCacheTtlSeconds
      )
    ]);
    this.rooms.set(record.room.id, cloneRoomRecord(record));
  }

  async deleteRecord(record: RoomRecord) {
    const databaseAvailable = this.prisma.isAvailable();
    let redisCleanupFailed = false;

    try {
      await Promise.all([
        this.redis.removeFromSet(this.roomRegistryKey, record.room.id),
        this.redis.delete(this.roomCacheKey(record.room.id)),
        this.redis.delete(this.joinCodeCacheKey(record.room.joinCode))
      ]);
    } catch {
      redisCleanupFailed = true;
      // PostgreSQL remains authoritative. A Redis outage must not leave the
      // durable room row alive, while Redis-only deployments still fail closed.
      if (!databaseAvailable) {
        throw new Error("Redis unavailable while deleting room.");
      }
    }

    if (databaseAvailable) {
      await this.prisma.roomState.deleteMany({
        where: { id: record.room.id }
      });
    }

    this.rooms.delete(record.room.id);

    // The stale Redis entry is ignored while PostgreSQL is healthy and will be
    // removed on the next Redis maintenance pass.
    void redisCleanupFailed;
  }

  async markRoomTerminated(record: RoomRecord, reason?: string) {
    const tombstoneModel = this.getTombstoneModel();
    if (this.prisma.isAvailable() && tombstoneModel) {
      await tombstoneModel.upsert({
        where: { roomId: record.room.id },
        create: {
          id: `tombstone_${record.room.id}`,
          roomId: record.room.id,
          trackIds: record.tracks.map((track) => track.id),
          reason: reason ?? null,
          status: "PENDING",
          expiresAt: new Date(Date.now() + this.terminationTtlSeconds * 1000)
        },
        update: {
          status: "PENDING",
          trackIds: record.tracks.map((track) => track.id),
          ...(reason !== undefined ? { reason } : {})
        }
      });
      return;
    }

    if (this.isRedisAvailable()) {
      await this.redis.setJson(
        this.terminationKey(record.room.id),
        { roomId: record.room.id, status: "PENDING" },
        this.terminationTtlSeconds
      );
    }
  }

  async completeRoomTermination(roomId: string) {
    const tombstoneModel = this.getTombstoneModel();
    if (this.prisma.isAvailable() && tombstoneModel) {
      await tombstoneModel.updateMany({
        where: { roomId },
        data: { status: "SUCCEEDED" }
      });
    }

    if (this.isRedisAvailable()) {
      await this.redis.setJson(
        this.terminationKey(roomId),
        { roomId, status: "SUCCEEDED" },
        this.terminationTtlSeconds
      ).catch(() => undefined);
    }
  }

  async listRecoverableRecords() {
    const records = new Map<string, RoomRecord>();

    if (this.prisma.isAvailable()) {
      const tombstoneModel = this.getTombstoneModel();
      const terminatedRoomIds = new Set<string>();
      if (tombstoneModel) {
        const tombstones = await tombstoneModel.findMany({
          where: { status: { in: ["PENDING", "SUCCEEDED"] } },
          select: { roomId: true }
        });
        tombstones.forEach((tombstone) => terminatedRoomIds.add(tombstone.roomId));
      }
      const persisted = await this.prisma.roomState.findMany({
        orderBy: { updatedAt: "desc" }
      });

      for (const item of persisted) {
        if (terminatedRoomIds.has(item.id)) {
          continue;
        }
        const record = parseRoomRecord(deserializeRoomRecord(item));
        if (!record) {
          continue;
        }
        this.rooms.set(record.room.id, cloneRoomRecord(record));
        records.set(record.room.id, cloneRoomRecord(record));
      }

      // The database result is complete while available. Process-local cache
      // entries not present above represent rooms deleted by another instance.
      return [...records.values()].sort(
        (left, right) =>
          new Date(right.room.playback.startedAt ?? 0).getTime() -
          new Date(left.room.playback.startedAt ?? 0).getTime()
      );
    }

    for (const record of this.rooms.values()) {
      if (await this.isRoomTerminated(record.room.id)) {
        continue;
      }
      records.set(record.room.id, cloneRoomRecord(record));
    }

    const redisAvailabilityKnown = typeof (this.redis as RedisService & { isAvailable?: () => boolean }).isAvailable === "function";
    const redisRoomIds = (!redisAvailabilityKnown || this.isRedisAvailable())
      ? await this.redis.getSetMembers(this.roomRegistryKey)
      : [];
    for (const roomId of redisRoomIds) {
      if (records.has(roomId)) {
        continue;
      }

      const rawRecord = await this.redis.getJson<unknown>(this.roomCacheKey(roomId));
      const record = parseRoomRecord(rawRecord);
      if (!record || record.room.id !== roomId || await this.isRoomTerminated(roomId)) {
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
    let currentRoomId: string | null;
    try {
      currentRoomId = await this.redis.getString(key);
    } catch {
      // Recent-room cleanup is auxiliary. Room deletion must remain complete
      // even when Redis is temporarily unavailable.
      return;
    }

    if (currentRoomId === roomId) {
      await this.redis.delete(key).catch(() => undefined);
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

  private terminationKey(roomId: string) {
    return `music-room:room-terminated:${roomId}`;
  }

  private getTombstoneModel() {
    return (this.prisma as PrismaService & {
      roomTombstone?: {
        findMany: (args: unknown) => Promise<Array<{ roomId: string }>>;
        findUnique: (args: unknown) => Promise<{ status?: string } | null>;
        upsert: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<unknown>;
      };
    }).roomTombstone;
  }

  private async isRoomTerminated(roomId: string) {
    const tombstoneModel = this.getTombstoneModel();
    if (this.prisma.isAvailable() && tombstoneModel) {
      const tombstone = await tombstoneModel.findUnique({ where: { roomId } });
      if (tombstone?.status === "PENDING" || tombstone?.status === "SUCCEEDED") {
        return true;
      }
    }

    if (this.isRedisAvailable()) {
      const marker = await this.redis.getJson<{ status?: string }>(this.terminationKey(roomId)).catch(() => null);
      return marker?.status === "PENDING" || marker?.status === "SUCCEEDED";
    }

    return false;
  }

  private isRedisAvailable() {
    const redisService = this.redis as RedisService & {
      isAvailable?: () => boolean;
    };
    return redisService.isAvailable?.() ?? false;
  }

  private async persistRecordToDatabase(record: RoomRecord) {
    const payload = {
      hostId: record.room.hostId,
      joinCode: record.room.joinCode,
      name: record.room.name ?? "未命名房间",
      description: record.room.description ?? null,
      passwordHash: record.passwordHash ?? null,
      visibility: record.room.visibility,
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
