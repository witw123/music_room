import { Injectable } from "@nestjs/common";
import type { TrackAvailabilityAnnouncement } from "@music-room/shared";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class TrackAvailabilityRegistry {
  private readonly availabilitySnapshotTtlSeconds = 15 * 60;
  private readonly availabilityByRoom = new Map<
    string,
    Map<string, TrackAvailabilityAnnouncement>
  >();

  constructor(private readonly redisService: RedisService) {}

  getTrackAnnouncements(roomId: string, trackId: string) {
    const roomAvailability = this.availabilityByRoom.get(roomId);
    if (!roomAvailability) {
      return [];
    }

    return [...roomAvailability.values()].filter((announcement) => announcement.trackId === trackId);
  }

  setAnnouncement(roomId: string, announcement: TrackAvailabilityAnnouncement) {
    const roomAvailability = this.availabilityByRoom.get(roomId) ?? new Map();
    roomAvailability.set(this.announcementKey(announcement), announcement);
    this.availabilityByRoom.set(roomId, roomAvailability);
    void this.persistSnapshot(roomId);
  }

  removePeer(roomId: string, peerId: string) {
    const roomAvailability = this.availabilityByRoom.get(roomId);
    if (!roomAvailability) {
      return false;
    }

    let removed = false;
    for (const [key, announcement] of roomAvailability.entries()) {
      if (announcement.ownerPeerId === peerId) {
        roomAvailability.delete(key);
        removed = true;
      }
    }

    if (roomAvailability.size === 0) {
      this.availabilityByRoom.delete(roomId);
    }
    void this.persistSnapshot(roomId);

    return removed;
  }

  clearRoom(roomId: string) {
    this.availabilityByRoom.delete(roomId);
    void this.deleteSnapshot(roomId);
  }

  async emitSnapshot(roomId: string, emit: (announcement: TrackAvailabilityAnnouncement) => void) {
    const roomAvailability = this.availabilityByRoom.get(roomId);
    const emittedKeys = new Set<string>();
    if (roomAvailability) {
      for (const announcement of roomAvailability.values()) {
        emittedKeys.add(this.announcementKey(announcement));
        emit(announcement);
      }
    }

    const persisted = await this.loadSnapshot(roomId);
    for (const announcement of persisted) {
      const key = this.announcementKey(announcement);
      if (emittedKeys.has(key)) {
        continue;
      }
      this.setAnnouncement(roomId, announcement);
      emit(announcement);
    }
  }

  private announcementKey(announcement: TrackAvailabilityAnnouncement) {
    return `${announcement.trackId}:${announcement.ownerPeerId}`;
  }

  private availabilitySnapshotKey(roomId: string) {
    return `music-room:availability:${roomId}`;
  }

  private async persistSnapshot(roomId: string) {
    try {
      const announcements = [...(this.availabilityByRoom.get(roomId)?.values() ?? [])];
      if (announcements.length === 0) {
        await this.deleteSnapshot(roomId);
        return;
      }
      await this.redisService.setJson(
        this.availabilitySnapshotKey(roomId),
        announcements,
        this.availabilitySnapshotTtlSeconds
      );
    } catch {
      // Availability snapshots are an optimization; live announcements remain authoritative.
    }
  }

  private async loadSnapshot(roomId: string) {
    try {
      return (
        (await this.redisService.getJson<TrackAvailabilityAnnouncement[]>(
          this.availabilitySnapshotKey(roomId)
        )) ?? []
      );
    } catch {
      return [];
    }
  }

  private async deleteSnapshot(roomId: string) {
    try {
      await this.redisService.delete(this.availabilitySnapshotKey(roomId));
    } catch {
      // Ignore cleanup failures.
    }
  }
}
