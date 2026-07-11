import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../../infra/prisma/prisma.service";
import { PlaylistService } from "../../playlist/playlist.service";
import { RoomService } from "../room.service";
import { RoomRealtimePublisher } from "./room-realtime.publisher";

const lifecycleIntervalMs = 10 * 60 * 1000;
const archiveAfterMs = 24 * 60 * 60 * 1000;
const deleteAfterMs = 30 * 24 * 60 * 60 * 1000;
const advisoryLockId = 1_648_071_123;

@Injectable()
export class RoomLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomLifecycleService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roomService: RoomService,
    private readonly playlistService: PlaylistService,
    private readonly publisher: RoomRealtimePublisher
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runOnce(), lifecycleIntervalMs);
    this.timer.unref?.();
    const initial = setTimeout(() => void this.runOnce(), 30_000);
    initial.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(now = new Date()) {
    if (!this.prisma.isAvailable()) return;
    const lock = await this.prisma.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `SELECT pg_try_advisory_lock(${advisoryLockId}) AS locked`
    );
    if (!lock[0]?.locked) return;
    try {
      await this.archiveInactiveRooms(now);
      await this.deleteExpiredRooms(now);
    } catch (error) {
      this.logger.error(`Room lifecycle pass failed: ${String(error)}`);
    } finally {
      await this.prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${advisoryLockId})`);
    }
  }

  private async archiveInactiveRooms(now: Date) {
    const candidates = await this.prisma.roomState.findMany({
      where: {
        visibility: "public",
        archivedAt: null,
        lastActiveAt: { lte: new Date(now.getTime() - archiveAfterMs) }
      },
      select: { id: true }
    });
    for (const candidate of candidates) {
      const snapshot = await this.roomService.getRoomSnapshot(candidate.id, []).catch(() => null);
      if (snapshot?.room.members.some((member) => member.presenceState === "online")) continue;
      await this.prisma.roomState.updateMany({
        where: { id: candidate.id, archivedAt: null },
        data: { archivedAt: now }
      });
    }
  }

  private async deleteExpiredRooms(now: Date) {
    const candidates = await this.prisma.roomState.findMany({
      where: { archivedAt: { lte: new Date(now.getTime() - deleteAfterMs) } },
      select: { id: true }
    });
    for (const candidate of candidates) {
      const snapshot = await this.roomService.getRoomSnapshot(candidate.id, []).catch(() => null);
      if (!snapshot || snapshot.room.members.some((member) => member.presenceState === "online")) continue;
      const trackIds = await this.roomService.deleteArchivedRoom(candidate.id);
      this.playlistService.clearCachedPlaylistsForRoom(candidate.id);
      this.publisher.emitRoomDeleted(candidate.id, trackIds);
      this.publisher.emitRoomMissing(candidate.id);
    }
  }
}
