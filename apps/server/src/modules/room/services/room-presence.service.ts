import type { RoomMember } from "@music-room/shared";
import { RedisService } from "../../../infra/redis/redis.service";

type PresenceState = RoomMember["presenceState"];

type PresenceEntry = {
  peerId: string | null;
  presenceState: PresenceState;
  expiresAt: number;
};

type StoredPresenceEntry = {
  peerId: string | null;
  presenceState: PresenceState;
};

export class RoomPresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly inMemoryPresence: Map<string, Map<string, PresenceEntry>>,
    private readonly presenceTtlSeconds: number
  ) {}

  async touchRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    await this.setPresence(roomId, sessionId, {
      peerId,
      presenceState: "online"
    });
  }

  async markRealtimeReconnecting(roomId: string, sessionId: string) {
    await this.setPresence(roomId, sessionId, {
      peerId: null,
      presenceState: "reconnecting"
    });
  }

  async clearRealtimePresence(roomId: string, sessionId: string) {
    this.deleteInMemoryPresence(roomId, sessionId);
    await this.redis.delete(this.realtimePresenceKey(roomId, sessionId));
  }

  async getPresenceSnapshot(roomId: string, members: RoomMember[]) {
    this.pruneExpiredInMemoryPresence(roomId);

    const presence = new Map<string, StoredPresenceEntry>();
    const roomPresence = this.inMemoryPresence.get(roomId);

    for (const member of members) {
      const localPresence = roomPresence?.get(member.id);
      if (localPresence && localPresence.expiresAt > Date.now()) {
        presence.set(member.id, {
          peerId: localPresence.peerId,
          presenceState: localPresence.presenceState
        });
      }
    }

    // The local cache is the same source used by the realtime gateway on this
    // instance. Keep it when Redis is unavailable instead of turning a
    // transient dependency failure into an empty presence snapshot.
    const redisWithAvailability = this.redis as RedisService & {
      isAvailable?: () => boolean;
    };
    if (typeof redisWithAvailability.isAvailable === "function" && !redisWithAvailability.isAvailable()) {
      return presence;
    }

    const presenceKeys = members.map((member) =>
      this.realtimePresenceKey(roomId, member.id)
    );
    const redisWithBatchRead = this.redis as RedisService & {
      getStrings?: (keys: string[]) => Promise<Array<string | null>>;
    };
    let rawValues: Array<string | null>;
    try {
      rawValues = redisWithBatchRead.getStrings
        ? await redisWithBatchRead.getStrings(presenceKeys)
        : await Promise.all(presenceKeys.map((key) => this.redis.getString(key)));
    } catch {
      return presence;
    }
    const redisPresence = members.map((member, index) => ({
      memberId: member.id,
      rawValue: rawValues[index] ?? null
    }));

    for (const entry of redisPresence) {
      const parsed = this.parseStoredPresence(entry.rawValue);
      if (!parsed) {
        continue;
      }

      presence.set(entry.memberId, parsed);
      this.setInMemoryPresence(roomId, entry.memberId, parsed);
    }

    return presence;
  }

  async getActivePresence(roomId: string, members: RoomMember[]) {
    const presence = await this.getPresenceSnapshot(roomId, members);
    const activePresence = new Map<string, string>();

    for (const [memberId, entry] of presence.entries()) {
      if (entry.presenceState === "online" && entry.peerId) {
        activePresence.set(memberId, entry.peerId);
      }
    }

    return activePresence;
  }

  private async setPresence(
    roomId: string,
    sessionId: string,
    entry: StoredPresenceEntry
  ) {
    this.setInMemoryPresence(roomId, sessionId, entry);
    await this.redis.setString(
      this.realtimePresenceKey(roomId, sessionId),
      JSON.stringify(entry),
      this.presenceTtlSeconds
    );
  }

  private parseStoredPresence(rawValue: string | null): StoredPresenceEntry | null {
    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as Partial<StoredPresenceEntry>;
      return {
        peerId: typeof parsed.peerId === "string" ? parsed.peerId : null,
        presenceState:
          parsed.presenceState === "online" ||
          parsed.presenceState === "reconnecting" ||
          parsed.presenceState === "offline"
            ? parsed.presenceState
            : typeof parsed.peerId === "string"
              ? "online"
              : "offline"
      };
    } catch {
      return {
        peerId: rawValue,
        presenceState: "online"
      };
    }
  }

  private setInMemoryPresence(roomId: string, sessionId: string, entry: StoredPresenceEntry) {
    const roomPresence = this.inMemoryPresence.get(roomId) ?? new Map();
    roomPresence.set(sessionId, {
      peerId: entry.peerId,
      presenceState: entry.presenceState,
      expiresAt: Date.now() + this.presenceTtlSeconds * 1000
    });
    this.inMemoryPresence.set(roomId, roomPresence);
  }

  private deleteInMemoryPresence(roomId: string, sessionId: string) {
    const roomPresence = this.inMemoryPresence.get(roomId);
    if (!roomPresence) {
      return;
    }

    roomPresence.delete(sessionId);
    if (roomPresence.size === 0) {
      this.inMemoryPresence.delete(roomId);
    }
  }

  private pruneExpiredInMemoryPresence(roomId: string) {
    const roomPresence = this.inMemoryPresence.get(roomId);
    if (!roomPresence) {
      return;
    }

    for (const [sessionId, presence] of roomPresence.entries()) {
      if (presence.expiresAt <= Date.now()) {
        roomPresence.delete(sessionId);
      }
    }

    if (roomPresence.size === 0) {
      this.inMemoryPresence.delete(roomId);
    }
  }

  private realtimePresenceKey(roomId: string, sessionId: string) {
    return `music-room:presence:${roomId}:${sessionId}`;
  }
}
