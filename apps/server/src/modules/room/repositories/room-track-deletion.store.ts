import type { RoomTrackDeletion } from "@music-room/shared";
import type { PrismaService } from "../../../infra/prisma/prisma.service";
import type { RedisService } from "../../../infra/redis/redis.service";

/**
 * 房间曲库删除事件的唯一读写点:记录“哪个房间在哪个 revision 删除了哪首歌”,
 * 供多端 syncRoom 做增量删除;PostgreSQL 表为主、Redis 为兜底。
 */
export class RoomTrackDeletionStore {
  private readonly terminationTtlSeconds = 30 * 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

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


  private trackDeletionsKey(roomId: string) {
    return `music-room:room-track-deletions:${roomId}`;
  }

  private trackDeletionKey(roomId: string, trackId: string) {
    return `music-room:room-track-deletion:${roomId}:${trackId}`;
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

  private isRedisAvailable() {
    return this.redis.isAvailable?.() ?? false;
  }
}
