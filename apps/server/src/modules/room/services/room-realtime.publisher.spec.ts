import { RoomRealtimePublisher } from "./room-realtime.publisher";

function createSnapshot() {
  return {
    room: {
      id: "room_1",
      hostId: "host_1",
      joinCode: "ABC123",
      visibility: "public" as const,
      members: [],
      presenceRevision: 3,
      roomRevision: 7,
      playback: {
        status: "paused" as const,
        currentTrackId: null,
        currentQueueItemId: null,
        playbackAssetId: null,
        startAt: null,
        sourceSessionId: null,
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 0
      }
    },
    tracks: [],
    queue: [],
    playlists: []
  };
}

describe("RoomRealtimePublisher", () => {
  it("emits targeted patches without duplicating a full room snapshot", async () => {
    const snapshot = createSnapshot();
    const roomService = {
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const broadcaster = {
      emitRoomSnapshot: jest.fn(),
      emitPresencePatch: jest.fn(),
      emitQueuePatch: jest.fn(),
      emitLibraryPatch: jest.fn()
    };
    const publisher = new RoomRealtimePublisher(
      roomService as never,
      broadcaster as never
    );

    await publisher.emitTopologySnapshot("room_1");
    await publisher.emitQueueSnapshot("room_1");
    await publisher.emitLibrarySnapshot("room_1");

    expect(roomService.getRoomSnapshot).toHaveBeenCalledTimes(3);
    expect(broadcaster.emitRoomSnapshot).not.toHaveBeenCalled();
    expect(broadcaster.emitPresencePatch).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitQueuePatch).toHaveBeenCalledTimes(1);
    expect(broadcaster.emitLibraryPatch).toHaveBeenCalledTimes(1);
  });
});
