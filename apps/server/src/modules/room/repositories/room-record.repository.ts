import { RedisService } from "../../../infra/redis/redis.service";
import type { RoomTrackDeletion } from "@music-room/shared";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import {
  deserializeRoomRecord,
  normalizeRoomRecord,
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

      // A room created while PostgreSQL was unavailable can still exist in the
      // Redis registry. listRecoverableRecords() migrates those records; keep
      // join-by-code compatible during the migration window as well.
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
    } else if (!this.prisma.isAvailable() && inMemoryRecord) {
      return cloneRoomRecord(inMemoryRecord).room;
    }

    throw new Error(`Room not found for join code: ${joinCode}`);
  }

  async getRoomRecord(roomId: string, options?: { allowTerminated?: boolean }) {
    const cached = this.rooms.get(roomId);
    let persistedFound = false;

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.roomState.findUnique({
        where: { id: roomId }
      });

      if (persisted) {
        persistedFound = true;
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

      // A room created while PostgreSQL was unavailable can still exist in the
      // Redis registry. Do not use the process-local cache here, but allow the
      // durable Redis mirror to be recovered and migrated.
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
    } else if ((!this.prisma.isAvailable() || persistedFound) && cached) {
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
        { roomId: record.room.id, status: "PENDING", trackIds: record.tracks.map((track) => track.id) },
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
      const previous = await this.redis
        .getJson<{ trackIds?: unknown }>(this.terminationKey(roomId))
        .catch(() => null);
      await this.redis.setJson(
        this.terminationKey(roomId),
        {
          roomId,
          status: "SUCCEEDED",
          trackIds: Array.isArray(previous?.trackIds)
            ? previous.trackIds.filter((value): value is string => typeof value === "string")
            : []
        },
        this.terminationTtlSeconds
      ).catch(() => undefined);
    }
  }

  async recordTrackDeletion(deletion: RoomTrackDeletion) {
    const model = this.getTrackDeletionModel();
    if (this.prisma.isAvailable() && model) {
      try {
        await model.upsert({
          where: { roomId_trackId: { roomId: deletion.roomId, trackId: deletion.trackId } },
          create: {
            id: `track-deletion_${deletion.roomId}_${deletion.trackId}`,
            roomId: deletion.roomId,
            trackId: deletion.trackId,
            fileHash: deletion.fileHash ?? null,
            originalAssetId: deletion.originalAssetId ?? null,
            playbackAssetId: deletion.playbackAssetId ?? null,
            roomRevision: deletion.roomRevision,
            deletedAt: new Date(deletion.deletedAt),
            expiresAt: new Date(Date.now() + this.terminationTtlSeconds * 1000)
          },
          update: {
            fileHash: deletion.fileHash ?? null,
            originalAssetId: deletion.originalAssetId ?? null,
            playbackAssetId: deletion.playbackAssetId ?? null,
            roomRevision: deletion.roomRevision,
            deletedAt: new Date(deletion.deletedAt),
            expiresAt: new Date(Date.now() + this.terminationTtlSeconds * 1000)
          }
        });
        return;
      } catch {
        // Fall back to Redis during a rolling deployment before the new table
        // is migrated on every database replica.
      }
    }

    if (this.isRedisAvailable()) {
      await Promise.all([
        this.redis.setJson(
          this.trackDeletionKey(deletion.roomId, deletion.trackId),
          deletion,
          this.terminationTtlSeconds
        ),
        this.redis.addToSet(this.trackDeletionsKey(deletion.roomId), deletion.trackId)
      ]);
    }
  }

  async listTrackDeletions(roomId: string, sinceRevision = 0): Promise<RoomTrackDeletion[]> {
    const model = this.getTrackDeletionModel();
    if (this.prisma.isAvailable() && model) {
      try {
        await model.deleteMany?.({
          where: {
            roomId,
            expiresAt: { lte: new Date() }
          }
        });
        const rows = await model.findMany({
          where: { roomId, roomRevision: { gt: Math.max(0, Math.floor(sinceRevision)) } },
          orderBy: { roomRevision: "asc" }
        });
        return rows.map((row) => ({
          roomId: row.roomId,
          trackId: row.trackId,
          fileHash: row.fileHash ?? null,
          originalAssetId: row.originalAssetId ?? null,
          playbackAssetId: row.playbackAssetId ?? null,
          roomRevision: row.roomRevision,
          deletedAt: new Date(row.deletedAt).toISOString()
        }));
      } catch {
        // Read the Redis mirror until the database migration is available.
      }
    }

    if (this.isRedisAvailable()) {
      const trackIds = await this.redis.getSetMembers(this.trackDeletionsKey(roomId));
      const rows = await Promise.all(
        trackIds.map((trackId) =>
          this.redis
            .getJson<RoomTrackDeletion>(this.trackDeletionKey(roomId, trackId))
            .catch(() => null)
        )
      );
      const staleTrackIds = trackIds.filter((_, index) => !rows[index]);
      if (staleTrackIds.length > 0) {
        await Promise.all(
          staleTrackIds.map((trackId) =>
            this.redis.removeFromSet(this.trackDeletionsKey(roomId), trackId).catch(() => undefined)
          )
        );
      }
      return rows
        .filter((item): item is RoomTrackDeletion => !!item && item.roomRevision > sinceRevision)
        .sort((left, right) => left.roomRevision - right.roomRevision);
    }

    return [];
  }

  async getRoomTermination(roomId: string) {
    const model = this.getTombstoneModel();
    if (this.prisma.isAvailable() && model) {
      try {
        const tombstone = await model.findUnique({
          where: { roomId },
          select: { roomId: true, status: true, trackIds: true }
        });
        if (tombstone) {
          return {
            roomId,
            status: tombstone.status ?? "PENDING",
            trackIds: Array.isArray(tombstone.trackIds)
              ? tombstone.trackIds.filter((value): value is string => typeof value === "string")
              : []
          };
        }
      } catch {
        // Fall back to the Redis termination marker during a database outage.
      }
    }

    if (this.isRedisAvailable()) {
      const marker = await this.redis
        .getJson<{ roomId?: string; status?: string; trackIds?: unknown }>(this.terminationKey(roomId))
        .catch(() => null);
      if (marker?.status === "PENDING" || marker?.status === "SUCCEEDED") {
        return {
          roomId,
          status: marker.status,
          trackIds: Array.isArray(marker.trackIds)
            ? marker.trackIds.filter((value): value is string => typeof value === "string")
            : []
        };
      }
    }

    return null;
  }

  async listRecoverableRecords() {
    const records = new Map<string, RoomRecord>();
    const databaseAvailable = this.prisma.isAvailable();

    if (databaseAvailable) {
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
        let record: RoomRecord | null = null;
        try {
          record = parseRoomRecord(deserializeRoomRecord(item));
        } catch {
          // One legacy row must not hide every other room from the directory.
          record = null;
        }
        if (!record) {
          continue;
        }
        this.rooms.set(record.room.id, cloneRoomRecord(record));
        records.set(record.room.id, cloneRoomRecord(record));
      }

    }

    if (!databaseAvailable) {
      for (const record of this.rooms.values()) {
        if (await this.isRoomTerminated(record.room.id)) {
          continue;
        }
        records.set(record.room.id, cloneRoomRecord(record));
      }
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

      if (databaseAvailable) {
        // This is the compatibility path for rooms written by the previous
        // Redis-only fallback. Persist before returning so they survive the
        // Redis room-cache TTL and are visible on every future instance.
        await this.persistRecord(record).catch(() => undefined);
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

  private trackDeletionsKey(roomId: string) {
    return `music-room:room-track-deletions:${roomId}`;
  }

  private trackDeletionKey(roomId: string, trackId: string) {
    return `music-room:room-track-deletion:${roomId}:${trackId}`;
  }

  private getTombstoneModel() {
    return (this.prisma as PrismaService & {
      roomTombstone?: {
        findMany: (args: unknown) => Promise<Array<{ roomId: string }>>;
        findUnique: (args: unknown) => Promise<{
          roomId?: string;
          status?: string;
          trackIds?: unknown;
        } | null>;
        upsert: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<unknown>;
      };
    }).roomTombstone;
  }

  private getTrackDeletionModel() {
    return (this.prisma as PrismaService & {
      roomTrackDeletion?: {
        findMany: (args: unknown) => Promise<Array<{
          roomId: string;
          trackId: string;
          fileHash?: string | null;
          originalAssetId?: string | null;
          playbackAssetId?: string | null;
          roomRevision: number;
          deletedAt: Date | string;
        }>>;
        upsert: (args: unknown) => Promise<unknown>;
        deleteMany?: (args: unknown) => Promise<unknown>;
      };
    }).roomTrackDeletion;
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
  return normalizeRoomRecord(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
