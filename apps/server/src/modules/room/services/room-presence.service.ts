import type { RoomMember } from "@music-room/shared";
import { RedisService } from "../../../infra/redis/redis.service";

export class RoomPresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly inMemoryPresence: Map<
      string,
      Map<string, { peerId: string; expiresAt: number }>
    >,
    private readonly presenceTtlSeconds: number
  ) {}

  async touchRealtimePresence(roomId: string, sessionId: string, peerId: string) {
    this.setInMemoryPresence(roomId, sessionId, peerId);
    await this.redis.setString(
      this.realtimePresenceKey(roomId, sessionId),
      peerId,
      this.presenceTtlSeconds
    );
  }

  async clearRealtimePresence(roomId: string, sessionId: string) {
    this.deleteInMemoryPresence(roomId, sessionId);
    await this.redis.delete(this.realtimePresenceKey(roomId, sessionId));
  }

  async getActivePresence(roomId: string, members: RoomMember[]) {
    this.pruneExpiredInMemoryPresence(roomId);

    const activePresence = new Map<string, string>();
    const roomPresence = this.inMemoryPresence.get(roomId);

    for (const member of members) {
      const localPresence = roomPresence?.get(member.id);
      if (localPresence && localPresence.expiresAt > Date.now()) {
        activePresence.set(member.id, localPresence.peerId);
      }
    }

    const redisPresence = await Promise.all(
      members.map(async (member) => ({
        memberId: member.id,
        peerId: await this.redis.getString(this.realtimePresenceKey(roomId, member.id))
      }))
    );

    for (const entry of redisPresence) {
      if (!entry.peerId) {
        continue;
      }

      activePresence.set(entry.memberId, entry.peerId);
      this.setInMemoryPresence(roomId, entry.memberId, entry.peerId);
    }

    return activePresence;
  }

  private setInMemoryPresence(roomId: string, sessionId: string, peerId: string) {
    const roomPresence = this.inMemoryPresence.get(roomId) ?? new Map();
    roomPresence.set(sessionId, {
      peerId,
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
