import type { PrismaService } from "../../../infra/prisma/prisma.service";
import type { RedisService } from "../../../infra/redis/redis.service";

/**
 * 房间终止(tombstone)状态的唯一读写点:
 * PostgreSQL tombstone 表为主、Redis 标记为兜底,并持有“未删除”负缓存
 * (短 TTL 内免于读路径上的重复 tombstone 查询;删除入口必须调用 invalidate)。
 */
export class RoomTerminationStore {
  private readonly terminationTtlSeconds = 30 * 24 * 60 * 60;
  private readonly tombstoneNotTerminatedUntil = new Map<string, number>();
  private static readonly TOMBSTONE_NEGATIVE_CACHE_TTL_MS = 2000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  /** 删除/终止入口调用,保证负缓存立即失效。 */
  invalidateNotTerminated(roomId: string) {
    this.tombstoneNotTerminatedUntil.delete(roomId);
  }

  async isRoomTerminated(roomId: string) {
    const notTerminatedUntil = this.tombstoneNotTerminatedUntil.get(roomId);
    if (notTerminatedUntil !== undefined && notTerminatedUntil > Date.now()) {
      return false;
    }
    this.tombstoneNotTerminatedUntil.delete(roomId);

    const tombstoneModel = this.getTombstoneModel();
    if (this.prisma.isAvailable() && tombstoneModel) {
      const tombstone = await tombstoneModel.findUnique({ where: { roomId } });
      if (tombstone?.status === "PENDING" || tombstone?.status === "SUCCEEDED") {
        return true;
      }
    }

    if (this.isRedisAvailable()) {
      const marker = await this.redis.getJson<{ status?: string }>(this.terminationKey(roomId)).catch(() => null);
      if (marker?.status === "PENDING" || marker?.status === "SUCCEEDED") {
        return true;
      }
    }

    if (this.tombstoneNotTerminatedUntil.size > 10_000) {
      const now = Date.now();
      for (const [id, until] of this.tombstoneNotTerminatedUntil) {
        if (until <= now) this.tombstoneNotTerminatedUntil.delete(id);
      }
    }
    this.tombstoneNotTerminatedUntil.set(
      roomId,
      Date.now() + RoomTerminationStore.TOMBSTONE_NEGATIVE_CACHE_TTL_MS
    );
    return false;
  }


  async markRoomTerminated(roomId: string, trackIds: string[], reason?: string) {
    this.invalidateNotTerminated(roomId);
    const tombstoneModel = this.getTombstoneModel();
    if (this.prisma.isAvailable() && tombstoneModel) {
      await tombstoneModel.upsert({
        where: { roomId: roomId },
        create: {
          id: `tombstone_${roomId}`,
          roomId: roomId,
          trackIds,
          reason: reason ?? null,
          status: "PENDING",
          expiresAt: new Date(Date.now() + this.terminationTtlSeconds * 1000)
        },
        update: {
          status: "PENDING",
          trackIds,
          ...(reason !== undefined ? { reason } : {})
        }
      });
      return;
    }

    if (this.isRedisAvailable()) {
      await this.redis.setJson(
        this.terminationKey(roomId),
        { roomId: roomId, status: "PENDING", trackIds },
        this.terminationTtlSeconds
      );
    }
  }


  async completeRoomTermination(roomId: string) {
    this.tombstoneNotTerminatedUntil.delete(roomId);
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


  async listTerminatedRoomIds(): Promise<Set<string>> {
    const terminatedRoomIds = new Set<string>();
    const tombstoneModel = this.getTombstoneModel();
    if (tombstoneModel) {
      const tombstones = await tombstoneModel.findMany({
        where: { status: { in: ["PENDING", "SUCCEEDED"] } },
        select: { roomId: true }
      });
      tombstones.forEach((tombstone) => terminatedRoomIds.add(tombstone.roomId));
    }
    return terminatedRoomIds;
  }


  private terminationKey(roomId: string) {
    return `music-room:room-terminated:${roomId}`;
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

  private isRedisAvailable() {
    return this.redis.isAvailable?.() ?? false;
  }
}
