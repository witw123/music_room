import { Injectable } from "@nestjs/common";
import {
  mergeTrackAvailabilityAnnouncement,
  trackAvailabilityAnnouncementSchema,
  type TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { RedisService } from "../../infra/redis/redis.service";

@Injectable()
export class TrackAvailabilityRegistry {
  private readonly availabilitySnapshotTtlSeconds = 15 * 60;
  private readonly availabilityPersistDebounceMs = 500;
  private readonly availabilityByRoom = new Map<
    string,
    Map<string, TrackAvailabilityAnnouncement>
  >();
  private readonly persistenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly persistenceInFlight = new Set<string>();
  private readonly persistenceDirty = new Set<string>();

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
    const key = this.announcementKey(announcement);
    const mergedAnnouncement = mergeTrackAvailabilityAnnouncement(
      roomAvailability.get(key),
      announcement
    );
    roomAvailability.set(key, mergedAnnouncement);
    this.availabilityByRoom.set(roomId, roomAvailability);
    this.schedulePersistSnapshot(roomId);
    return mergedAnnouncement;
  }

  getTrackAvailabilityAnnouncements(roomId: string, trackId: string) {
    return this.getTrackAnnouncements(roomId, trackId);
  }

  removePeer(roomId: string, peerId: string) {
    const roomAvailability = this.availabilityByRoom.get(roomId);
    let removed = false;
    for (const [key, announcement] of roomAvailability?.entries() ?? []) {
      if (announcement.ownerPeerId === peerId) {
        roomAvailability?.delete(key);
        removed = true;
      }
    }

    if (roomAvailability?.size === 0) {
      this.availabilityByRoom.delete(roomId);
    }
    void this.removePeerFromPersistedSnapshot(roomId, peerId);

    // A persisted snapshot may still contain this peer after a server restart,
    // so callers must broadcast the clear even when memory had no entry.
    return removed || !roomAvailability;
  }

  clearRoom(roomId: string) {
    const timer = this.persistenceTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.persistenceTimers.delete(roomId);
    }
    this.persistenceDirty.delete(roomId);
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
      emit(this.setAnnouncement(roomId, announcement));
    }
  }

  private announcementKey(announcement: TrackAvailabilityAnnouncement) {
    return `${announcement.trackId}:${announcement.ownerPeerId}`;
  }

  private availabilitySnapshotKey(roomId: string) {
    return `music-room:availability:${roomId}`;
  }

  private schedulePersistSnapshot(roomId: string) {
    this.persistenceDirty.add(roomId);
    if (this.persistenceTimers.has(roomId) || this.persistenceInFlight.has(roomId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.persistenceTimers.delete(roomId);
      void this.persistSnapshot(roomId);
    }, this.availabilityPersistDebounceMs);
    timer.unref?.();
    this.persistenceTimers.set(roomId, timer);
  }

  private async persistSnapshot(roomId: string) {
    if (this.persistenceInFlight.has(roomId)) {
      this.persistenceDirty.add(roomId);
      return;
    }

    this.persistenceInFlight.add(roomId);
    this.persistenceDirty.delete(roomId);
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
    } finally {
      this.persistenceInFlight.delete(roomId);
      if (this.persistenceDirty.has(roomId)) {
        this.schedulePersistSnapshot(roomId);
      }
    }
  }

  private async loadSnapshot(roomId: string) {
    try {
      const snapshot =
        (await this.redisService.getJson<unknown[]>(this.availabilitySnapshotKey(roomId))) ?? [];
      return snapshot.flatMap((entry) => {
        const parsed = trackAvailabilityAnnouncementSchema.safeParse(entry);
        return parsed.success && parsed.data.roomId === roomId ? [parsed.data] : [];
      });
    } catch {
      return [];
    }
  }

  private async removePeerFromPersistedSnapshot(roomId: string, peerId: string) {
    try {
      const announcements = (await this.loadSnapshot(roomId)).filter(
        (announcement) => announcement.ownerPeerId !== peerId
      );
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
      // Live clear events remain authoritative if persistence is unavailable.
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
