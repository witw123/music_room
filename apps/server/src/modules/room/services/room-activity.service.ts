import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Room } from "@music-room/shared";
import { PrismaService } from "../../../infra/prisma/prisma.service";

const presenceStaleAfterMs = 45_000;
const presenceWriteIntervalMs = 20_000;

type RoomActivityRoom = Pick<Room, "id" | "name" | "joinCode">;

@Injectable()
export class RoomActivityService {
  private readonly logger = new Logger(RoomActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async startOrTouch(
    userId: string,
    room: RoomActivityRoom
  ) {
    if (!this.prisma.isAvailable()) {
      return;
    }

    const now = new Date();
    try {
      const current = await this.prisma.userRoomActivity.findUnique({
        where: { userId_roomId: { userId, roomId: room.id } }
      });

      if (!current) {
        await this.prisma.userRoomActivity.create({
          data: {
            id: `room_activity_${randomUUID()}`,
            userId,
            roomId: room.id,
            roomName: room.name ?? "未命名房间",
            joinCode: room.joinCode,
            totalDurationMs: 0n,
            // The persisted room member timestamp can describe an old
            // membership, not this online session. Activity starts at the
            // first confirmed presence heartbeat instead.
            activeStartedAt: now,
            lastPresenceAt: now,
            lastJoinedAt: now
          }
        });
        return;
      }

      const stale = current.activeStartedAt && (
        !current.lastPresenceAt ||
        now.getTime() - current.lastPresenceAt.getTime() > presenceStaleAfterMs
      );
      if (stale) {
        const closedDurationMs = closeActiveInterval(
          current.activeStartedAt!,
          current.lastPresenceAt,
          now
        );
        await this.prisma.userRoomActivity.update({
          where: { id: current.id },
          data: {
            roomName: room.name ?? "未命名房间",
            joinCode: room.joinCode,
            totalDurationMs: { increment: BigInt(closedDurationMs) },
            activeStartedAt: now,
            lastPresenceAt: now,
            lastJoinedAt: now
          }
        });
        return;
      }

      if (!current.activeStartedAt) {
        await this.prisma.userRoomActivity.update({
          where: { id: current.id },
          data: {
            roomName: room.name ?? "未命名房间",
            joinCode: room.joinCode,
            activeStartedAt: now,
            lastPresenceAt: now,
            lastJoinedAt: now
          }
        });
        return;
      }

      if (
        !current.lastPresenceAt ||
        now.getTime() - current.lastPresenceAt.getTime() >= presenceWriteIntervalMs
      ) {
        await this.prisma.userRoomActivity.update({
          where: { id: current.id },
          data: {
            roomName: room.name ?? "未命名房间",
            joinCode: room.joinCode,
            lastPresenceAt: now
          }
        });
      }
    } catch (error) {
      this.logger.warn(`Unable to record room presence start: ${String(error)}`);
    }
  }

  async stop(userId: string, roomId: string, room?: RoomActivityRoom) {
    if (!this.prisma.isAvailable()) {
      return;
    }

    try {
      const current = await this.prisma.userRoomActivity.findUnique({
        where: { userId_roomId: { userId, roomId } }
      });
      if (!current?.activeStartedAt) {
        return;
      }

      const now = new Date();
      const durationMs = closeActiveInterval(current.activeStartedAt, current.lastPresenceAt, now);
      await this.prisma.userRoomActivity.update({
        where: { id: current.id },
        data: {
          ...(room
            ? { roomName: room.name ?? "未命名房间", joinCode: room.joinCode }
            : {}),
          totalDurationMs: { increment: BigInt(durationMs) },
          activeStartedAt: null,
          lastPresenceAt: now
        }
      });
    } catch (error) {
      this.logger.warn(`Unable to record room presence stop: ${String(error)}`);
    }
  }

  async listRecent(userId: string) {
    if (!this.prisma.isAvailable()) {
      return [];
    }

    try {
      const records = await this.prisma.userRoomActivity.findMany({
        where: { userId },
        orderBy: { lastJoinedAt: "desc" },
        take: 20
      });
      const now = Date.now();
      return records.map((record) => {
        const isActive = !!record.activeStartedAt && !!record.lastPresenceAt &&
          now - record.lastPresenceAt.getTime() <= presenceStaleAfterMs;
        const activeDurationMs = isActive
          ? Math.max(0, now - record.activeStartedAt!.getTime())
          : record.lastPresenceAt && record.activeStartedAt
            ? Math.max(0, record.lastPresenceAt.getTime() - record.activeStartedAt.getTime())
            : 0;
        return {
          roomId: record.roomId,
          roomName: record.roomName,
          joinCode: record.joinCode,
          durationMs: Number(record.totalDurationMs) + activeDurationMs,
          lastJoinedAt: record.lastJoinedAt.toISOString(),
          isActive
        };
      });
    } catch (error) {
      this.logger.warn(`Unable to load recent room activity: ${String(error)}`);
      return [];
    }
  }
}

function closeActiveInterval(
  activeStartedAt: Date,
  lastPresenceAt: Date | null,
  now: Date
) {
  const hasStalePresence =
    !!lastPresenceAt && now.getTime() - lastPresenceAt.getTime() > presenceStaleAfterMs;
  const closedAt = !lastPresenceAt
    ? activeStartedAt
    : hasStalePresence
      ? lastPresenceAt
      : now;
  return Math.max(0, closedAt.getTime() - activeStartedAt.getTime());
}
