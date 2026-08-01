import { Injectable, Logger } from "@nestjs/common";
import type { RoomMember } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { assertMember, incrementPresenceRevision, incrementRoomRevision } from "../room-mutation";
import { RoomActivityService } from "./room-activity.service";
import { RoomPlaybackService } from "./room-playback.service";
import { RoomPresenceService } from "./room-presence.service";
import { RoomRecordRepository } from "../repositories/room-record.repository";
import { RedisService } from "../../../infra/redis/redis.service";

/**
 * Serializes room-wide presence transitions. Presence writes share one
 * persisted room revision, so all transitions for a room run through a single
 * promise chain to prevent concurrent members from conflicting in storage and
 * an older disconnect finishing after a newer online update.
 */
@Injectable()
export class RoomPresenceOrchestratorService {
  private readonly logger = new Logger(RoomPresenceOrchestratorService.name);
  private readonly roomLockTtlMs = 30_000;
  private readonly roomLockWaitMs = 3_000;
  private readonly presenceOperationAttempts = 3;
  private readonly presenceUpdateChains = new Map<string, Promise<void>>();

  constructor(
    private readonly roomRecordRepository: RoomRecordRepository,
    private readonly roomPresenceService: RoomPresenceService,
    private readonly roomPlaybackService: RoomPlaybackService,
    private readonly roomActivityService: RoomActivityService,
    private readonly redis: RedisService
  ) {}

  updatePeerPresence(
    roomId: string,
    sessionId: string,
    peerId: string | null,
    presenceState: RoomMember["presenceState"] = peerId ? "online" : "offline"
  ) {
    return this.enqueuePresenceUpdate(roomId, sessionId, async () => {
      const record = await this.roomRecordRepository.getRoomRecord(roomId);
      assertMember(record, sessionId);
      return this.applyPeerPresenceUpdate(record, roomId, sessionId, peerId, presenceState);
    });
  }

  refreshRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    return this.enqueuePresenceUpdate(roomId, sessionId, async () => {
      const record = await this.roomRecordRepository.getRoomRecord(roomId);
      assertMember(record, sessionId);
      const presenceSnapshot = await this.roomPresenceService.getPresenceSnapshot(
        roomId,
        record.room.members
      );
      const currentPresence = presenceSnapshot.get(sessionId) ?? {
        peerId: null,
        presenceState: "offline" as const
      };

      if (
        currentPresence.peerId === peerId &&
        currentPresence.presenceState === "online"
      ) {
        await this.roomPresenceService.setOnline(roomId, sessionId, peerId);
        await this.roomActivityService.startOrTouch(
          sessionId,
          record.room
        );
        return {
          room: record.room,
          changed: false
        };
      }

      return {
        room: await this.applyPeerPresenceUpdate(
          record,
          roomId,
          sessionId,
          peerId,
          "online",
          currentPresence
        ),
        changed: true
      };
    });
  }

  refreshPresenceLease(roomId: string, sessionId: string, peerId: string) {
    return this.enqueuePresenceUpdate(roomId, sessionId, async () => {
      const record = await this.roomRecordRepository.getRoomRecord(roomId);
      assertMember(record, sessionId);
      await this.roomPresenceService.setOnline(roomId, sessionId, peerId);
    });
  }

  enqueuePresenceUpdate<T>(
    roomId: string,
    sessionId: string,
    operation: () => Promise<T>
  ) {
    const key = roomId;
    const previous = this.presenceUpdateChains.get(key) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(() => this.withRoomLock(roomId, () => this.runWithRetry(roomId, operation)));
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    this.presenceUpdateChains.set(key, settled);
    void settled.finally(() => {
      if (this.presenceUpdateChains.get(key) === settled) {
        this.presenceUpdateChains.delete(key);
      }
    });
    return result;
  }

  private async runWithRetry<T>(roomId: string, operation: () => Promise<T>) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.presenceOperationAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRevisionConflict(error) || attempt === this.presenceOperationAttempts) {
          throw error;
        }
        this.logger.warn(
          `Retrying presence mutation for room ${roomId} after revision conflict (attempt ${attempt}).`
        );
        await delay(25 * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Presence mutation failed.");
  }

  private async withRoomLock<T>(roomId: string, operation: () => Promise<T>) {
    const redis = this.redis as RedisService & {
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
        throw new Error("Realtime coordination is unavailable.");
      }
      return operation();
    }
    if (!redis.isAvailable()) {
      if (isStrictRealtimeCoordination()) {
        throw new Error("Realtime coordination is unavailable.");
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
      throw new Error("Room state is busy; retry presence update.");
    }

    try {
      return await operation();
    } finally {
      await redis.releaseLock(lockKey, token).catch((error) => {
        this.logger.warn(`Unable to release room presence lock ${roomId}: ${String(error)}`);
      });
    }
  }

  private async applyPeerPresenceUpdate(
    record: RoomRecord,
    roomId: string,
    sessionId: string,
    peerId: string | null,
    presenceState: RoomMember["presenceState"],
    knownPresence?: { peerId: string | null; presenceState: RoomMember["presenceState"] }
  ) {
    const currentPresence = knownPresence ??
      (await this.roomPresenceService.getPresenceSnapshot(roomId, record.room.members)).get(sessionId) ?? {
        peerId: null,
        presenceState: "offline" as const
      };

    if (
      currentPresence.peerId === peerId &&
      currentPresence.presenceState === presenceState
    ) {
      if (presenceState === "online" && peerId) {
        await this.roomPresenceService.setOnline(roomId, sessionId, peerId);
        await this.roomActivityService.startOrTouch(
          sessionId,
          record.room
        );
      } else if (presenceState === "reconnecting") {
        await this.roomPresenceService.setReconnecting(roomId, sessionId);
      } else {
        await this.roomPresenceService.clear(roomId, sessionId);
        await this.roomActivityService.stop(sessionId, roomId, record.room);
      }
      return record.room;
    }

    if (presenceState === "online" && peerId) {
      await this.roomPresenceService.setOnline(roomId, sessionId, peerId);
      this.roomPlaybackService.handleSourcePeerOnline(record, sessionId, peerId);
      await this.roomActivityService.startOrTouch(
        sessionId,
        record.room
      );
    } else if (presenceState === "reconnecting") {
      await this.roomPresenceService.setReconnecting(roomId, sessionId);
    } else {
      await this.roomPresenceService.clear(roomId, sessionId);
    }

    if (presenceState === "offline") {
      await this.roomPlaybackService.handleSourceDeparture(record, sessionId);
      await this.roomActivityService.stop(sessionId, roomId, record.room);
    }

    incrementPresenceRevision(record.room);
    incrementRoomRevision(record.room);
    await this.roomRecordRepository.persistRecord(record);
    return record.room;
  }
}

function isRevisionConflict(error: unknown) {
  return error instanceof Error && error.message === "Room state revision conflict.";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isStrictRealtimeCoordination() {
  return process.env.NODE_ENV === "production";
}
