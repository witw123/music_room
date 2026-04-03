import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@music-room/shared";
import { consumeRoomSnapshotHandoff, storeRoomSnapshotHandoff } from "./room-snapshot-handoff";

function buildSnapshot(roomId = "room_1"): RoomSnapshot {
  return {
    room: {
      id: roomId,
      hostId: "user_host",
      joinCode: "ABC123",
      visibility: "public",
      members: [],
      playback: {
        status: "paused",
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId: null,
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        mediaEpoch: 0
      }
    },
    tracks: [],
    queue: [],
    playlists: []
  };
}

describe("room snapshot handoff", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storage.set(key, value);
          },
          removeItem: (key: string) => {
            storage.delete(key);
          },
          clear: () => {
            storage.clear();
          }
        }
      }
    });
  });

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("stores and consumes a matching room snapshot", () => {
    const snapshot = buildSnapshot();
    storeRoomSnapshotHandoff(snapshot);

    expect(consumeRoomSnapshotHandoff(snapshot.room.id)).toEqual(snapshot);
    expect(consumeRoomSnapshotHandoff(snapshot.room.id)).toBeNull();
  });

  it("ignores a handoff for another room", () => {
    storeRoomSnapshotHandoff(buildSnapshot("room_a"));
    expect(consumeRoomSnapshotHandoff("room_b")).toBeNull();
  });

  it("drops expired handoff snapshots", () => {
    vi.useFakeTimers();
    const snapshot = buildSnapshot();
    storeRoomSnapshotHandoff(snapshot);
    vi.advanceTimersByTime(60_001);

    expect(consumeRoomSnapshotHandoff(snapshot.room.id)).toBeNull();
  });
});
