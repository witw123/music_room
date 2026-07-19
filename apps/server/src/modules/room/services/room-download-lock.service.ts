import { ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";
import { RedisService } from "../../../infra/redis/redis.service";
import { RoomService } from "../room.service";

type DownloadProvider = "netease" | "qqmusic";

type RoomDownloadLockPayload = {
  leaseId: string;
  roomId: string;
  sessionId: string;
  provider: DownloadProvider;
  trackId: string;
  startedAt: string;
};

export type RoomDownloadLease = {
  key: string;
  payload: RoomDownloadLockPayload;
  ttlMs: number;
  released: boolean;
};

const lockKeyPrefix = "music-room:provider-download:";
const defaultTtlMs = 10 * 60 * 1_000;

@Injectable()
export class RoomDownloadLockService {
  constructor(
    private readonly roomService: RoomService,
    private readonly redis: RedisService
  ) {}

  async acquire(
    roomId: string,
    sessionId: string,
    source: { provider: DownloadProvider; trackId: string }
  ): Promise<RoomDownloadLease> {
    await this.roomService.assertRoomMember(roomId, sessionId);

    const payload: RoomDownloadLockPayload = {
      leaseId: randomUUID(),
      roomId,
      sessionId,
      provider: source.provider,
      trackId: source.trackId,
      startedAt: new Date().toISOString()
    };
    const key = `${lockKeyPrefix}${roomId}`;
    const ttlMs = this.ttlMs();

    try {
      const acquired = await this.redis.setJsonIfAbsent(key, payload, ttlMs);
      if (acquired) {
        return { key, payload, ttlMs, released: false };
      }

      const current = await this.redis.getJson<RoomDownloadLockPayload>(key);
      throw new ConflictException(
        createApiErrorResponse(
          errorCodes.roomDownloadBusy,
          "Another member is downloading audio in this room.",
          current
            ? {
                provider: current.provider,
                trackId: current.trackId,
                startedAt: current.startedAt
              }
            : undefined
        )
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        createApiErrorResponse(
          errorCodes.realtimeUnavailable,
          "Room download lock storage is temporarily unavailable."
        ),
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  startKeepAlive(lease: RoomDownloadLease) {
    const timer = setInterval(() => {
      if (lease.released) {
        return;
      }
      void this.redis.refreshJsonLease(lease.key, lease.payload, lease.ttlMs).catch(() => undefined);
    }, Math.max(5_000, Math.floor(lease.ttlMs / 3)));

    return () => clearInterval(timer);
  }

  async release(lease: RoomDownloadLease) {
    if (lease.released) {
      return;
    }
    lease.released = true;
    try {
      await this.redis.deleteJsonIfValue(lease.key, lease.payload);
    } catch {
      // TTL cleanup is the fallback when Redis is temporarily unavailable.
    }
  }

  private ttlMs() {
    const configured = Number(process.env.ROOM_PROVIDER_DOWNLOAD_LOCK_TTL_MS ?? defaultTtlMs);
    return Number.isFinite(configured)
      ? Math.min(30 * 60 * 1_000, Math.max(60 * 1_000, Math.floor(configured)))
      : defaultTtlMs;
  }
}
