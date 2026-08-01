import { Injectable, Logger } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import type { Socket } from "socket.io";
import { RedisService } from "../../infra/redis/redis.service";
import { RoomRealtimeBroadcaster } from "../realtime/room-realtime.broadcaster";

type SessionLease = {
  instanceId?: string;
  roomId?: string;
  sessionId?: string;
  peerId?: string;
  socketId?: string;
  fenceToken?: string;
};

/**
 * Single-active-socket ownership of a room session, stored in Redis. The
 * lease lets a reconnecting client reclaim its session from a stale socket
 * that never fired a disconnect event, while a crashed client's lease can
 * still expire without an explicit disconnect.
 */
@Injectable()
export class RoomSessionLeaseService {
  private readonly logger = new Logger(RoomSessionLeaseService.name);
  private readonly roomLockTtlMs = 30_000;
  private readonly roomLockWaitMs = 3_000;
  readonly sessionLeaseTtlMs = 180_000;

  constructor(
    private readonly redisService: RedisService,
    private readonly roomRealtimeBroadcaster: RoomRealtimeBroadcaster
  ) {}

  key(roomId: string, sessionId: string) {
    return `music-room:realtime-session:${roomId}:${sessionId}`;
  }

  async claim(
    roomId: string,
    sessionId: string,
    peerId: string,
    socketId: string,
    fenceToken: string
  ) {
    return this.withRoomLock(roomId, async () => {
      try {
        const previous = await this.redisService.claimJsonLease(
          this.key(roomId, sessionId),
          {
            instanceId: this.roomRealtimeBroadcaster.instanceId,
            roomId,
            sessionId,
            peerId,
            socketId,
            fenceToken
          },
          this.sessionLeaseTtlMs
        );
        if (!previous || typeof previous !== "object") {
          return null;
        }
        return previous as SessionLease;
      } catch (error) {
        if (isStrictRealtimeCoordination()) {
          throw error;
        }
        // Local signaling remains available in development when Redis is down.
        return null;
      }
    });
  }

  async assert(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    const fenceToken = client.data.sessionFenceToken as string | undefined;
    if (!roomId || !sessionId || !fenceToken) {
      return;
    }

    try {
      const lease = await this.redisService.getJson<{
        socketId?: string;
        fenceToken?: string;
      }>(this.key(roomId, sessionId));
      if (!lease && isStrictRealtimeCoordination()) {
        throw new WsException("Realtime session lease is missing.");
      }
      if (
        lease &&
        (lease.socketId !== client.id || lease.fenceToken !== fenceToken)
      ) {
        throw new WsException("Realtime session was replaced.");
      }
    } catch (error) {
      if (error instanceof WsException) {
        throw error;
      }
      if (isStrictRealtimeCoordination()) {
        throw new WsException("Realtime session coordination is unavailable.");
      }
      // Local signaling remains available in development when Redis is down.
    }
  }

  async renew(client: Socket) {
    const roomId = client.data.roomId as string;
    const sessionId = client.data.sessionId as string;
    const peerId = client.data.peerId as string;
    const fenceToken = client.data.sessionFenceToken as string;
    try {
      return await this.redisService.renewJsonLeaseIfValue(
        this.key(roomId, sessionId),
        {
          instanceId: this.roomRealtimeBroadcaster.instanceId,
          roomId,
          sessionId,
          peerId,
          socketId: client.id,
          fenceToken
        },
        this.sessionLeaseTtlMs
      );
    } catch {
      return !isStrictRealtimeCoordination();
    }
  }

  async release(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    const fenceToken = client.data.sessionFenceToken as string | undefined;
    if (!roomId || !sessionId || !fenceToken) {
      return;
    }
    try {
      await this.redisService.deleteJsonIfValue(this.key(roomId, sessionId), {
        instanceId: this.roomRealtimeBroadcaster.instanceId,
        roomId,
        sessionId,
        peerId: client.data.peerId as string,
        socketId: client.id,
        fenceToken
      });
    } catch {
      // Lease expiry is the fallback cleanup path.
    }
  }

  async belongsTo(
    roomId: string,
    sessionId: string,
    expected?: { peerId?: string; socketId?: string; fenceToken?: string }
  ) {
    try {
      const lease = await this.redisService.getJson<{
        peerId?: string;
        socketId?: string;
        fenceToken?: string;
      }>(this.key(roomId, sessionId));
      if (!lease) {
        return !isStrictRealtimeCoordination();
      }
      return (
        ((!expected?.peerId || lease.peerId === expected.peerId) &&
          (!expected?.socketId || lease.socketId === expected.socketId) &&
          (!expected?.fenceToken || lease.fenceToken === expected.fenceToken))
      );
    } catch {
      return !isStrictRealtimeCoordination();
    }
  }

  async delete(
    roomId: string,
    sessionId: string,
    expected?: { peerId?: string; socketId?: string; fenceToken?: string }
  ) {
    if (!expected?.peerId || !expected.socketId || !expected.fenceToken) {
      return false;
    }

    try {
      // The old socket may be racing a replacement. Compare and delete in one
      // Redis operation so a lease claimed after this cleanup starts cannot
      // be removed by the stale disconnect timer.
      return await this.redisService.deleteJsonIfValue(this.key(roomId, sessionId), {
        instanceId: this.roomRealtimeBroadcaster.instanceId,
        roomId,
        sessionId,
        peerId: expected.peerId,
        socketId: expected.socketId,
        fenceToken: expected.fenceToken
      });
    } catch {
      // Ignore lease cleanup failures; the TTL limits stale ownership.
      return false;
    }
  }

  async socketOwnsLease(socket: Socket) {
    const roomId = socket.data.roomId as string | undefined;
    const sessionId = socket.data.sessionId as string | undefined;
    const fenceToken = socket.data.sessionFenceToken as string | undefined;
    if (!roomId || !sessionId || !fenceToken) {
      return true;
    }

    try {
      const lease = await this.redisService.getJson<{
        socketId?: string;
        fenceToken?: string;
      }>(this.key(roomId, sessionId));
      if (!lease) {
        return !isStrictRealtimeCoordination();
      }
      return (
        (lease.socketId === socket.id && lease.fenceToken === fenceToken)
      );
    } catch {
      return !isStrictRealtimeCoordination();
    }
  }

  private async withRoomLock<T>(roomId: string, operation: () => Promise<T>) {
    const redis = this.redisService as RedisService & {
      acquireLock?: (key: string, ttlMs: number) => Promise<string | null>;
      releaseLock?: (key: string, token: string) => Promise<boolean>;
      isAvailable?: () => boolean;
    };
    if (
      typeof redis.acquireLock !== "function" ||
      typeof redis.releaseLock !== "function" ||
      typeof redis.isAvailable !== "function"
    ) {
      if (isStrictRealtimeCoordination()) {
        throw new WsException("Realtime session coordination is unavailable.");
      }
      return operation();
    }
    if (!redis.isAvailable()) {
      if (isStrictRealtimeCoordination()) {
        throw new WsException("Realtime session coordination is unavailable.");
      }
      return operation();
    }

    const lockKey = `music-room:lock:room:${roomId}`;
    const deadline = Date.now() + this.roomLockWaitMs;
    let token: string | null = null;
    while (!token && Date.now() < deadline) {
      token = await redis.acquireLock(lockKey, this.roomLockTtlMs);
      if (!token) {
        await delay(20);
      }
    }
    if (!token) {
      throw new WsException("Realtime session coordination is busy.");
    }

    try {
      return await operation();
    } finally {
      await redis.releaseLock(lockKey, token).catch((error) => {
        this.logger.warn(`Unable to release session lease lock ${roomId}: ${String(error)}`);
      });
    }
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isStrictRealtimeCoordination() {
  return process.env.NODE_ENV === "production";
}
