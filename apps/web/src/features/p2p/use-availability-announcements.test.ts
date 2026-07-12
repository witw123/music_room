import { describe, expect, it, vi } from "vitest";
import {
  compactTrackAvailabilityAnnouncement,
  type TrackAvailabilityAnnouncement
} from "@music-room/shared";
import {
  flushAvailabilityEmitQueue,
  queueAvailabilityEmit
} from "./use-availability-announcements";

describe("availability announcement emits", () => {
  it("coalesces repeated emits for the same track and owner before flushing", () => {
    const pendingEmit = new Map<string, TrackAvailabilityAnnouncement>();
    const pendingDisconnected = new Map<string, TrackAvailabilityAnnouncement>();
    const socket = {
      connected: true,
      emit: vi.fn()
    };

    const first = buildAnnouncement([0]);
    const latest = buildAnnouncement([0, 1, 2]);

    queueAvailabilityEmit(pendingEmit, first);
    queueAvailabilityEmit(pendingEmit, latest);
    flushAvailabilityEmitQueue({
      pendingEmit,
      pendingDisconnected,
      socket
    });

    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith(
      "piece.availability",
      compactTrackAvailabilityAnnouncement(latest)
    );
    expect(pendingEmit.size).toBe(0);
    expect(pendingDisconnected.size).toBe(0);
  });

  it("keeps the latest queued emit pending when the socket is disconnected", () => {
    const pendingEmit = new Map<string, TrackAvailabilityAnnouncement>();
    const pendingDisconnected = new Map<string, TrackAvailabilityAnnouncement>();
    const socket = {
      connected: false,
      emit: vi.fn()
    };
    const latest = buildAnnouncement([0, 1]);

    queueAvailabilityEmit(pendingEmit, buildAnnouncement([0]));
    queueAvailabilityEmit(pendingEmit, latest);
    flushAvailabilityEmitQueue({
      pendingEmit,
      pendingDisconnected,
      socket
    });

    expect(socket.emit).not.toHaveBeenCalled();
    expect(pendingEmit.size).toBe(0);
    expect([...pendingDisconnected.values()]).toEqual([latest]);
  });
});

function buildAnnouncement(availableChunks: number[]): TrackAvailabilityAnnouncement {
  return {
    roomId: "room_1",
    trackId: "track_1",
    ownerPeerId: "peer_local",
    nickname: "listener",
    assetKind: "relay",
    assetHash: "hash_1",
    totalChunks: 4,
    chunkSize: 128 * 1024,
    availableChunks,
    source: "local_cache",
    announcedAt: new Date(0).toISOString()
  };
}
