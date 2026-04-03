import type { RoomSnapshot } from "@music-room/shared";
import { QueueController } from "./queue.controller";

function buildSnapshot(): RoomSnapshot {
  return {
    room: {
      id: "room_1",
      hostId: "guest_host",
      joinCode: "ABC123",
      visibility: "public",
      members: [
        {
          id: "guest_host",
          nickname: "Host",
          role: "host",
          joinedAt: new Date().toISOString(),
          peerId: "peer_host"
        }
      ],
      playback: {
        status: "paused",
        currentTrackId: null,
        currentQueueItemId: null,
        sourceSessionId: "guest_host",
        sourcePeerId: "peer_host",
        sourceTrackId: null,
        positionMs: 0,
        startedAt: null,
        queueVersion: 2,
        mediaEpoch: 0
      }
    },
    tracks: [],
    queue: [
      {
        id: "queue_1",
        trackId: "track_1",
        requestedBy: "Host",
        requestedById: "guest_host",
        position: 0,
        createdAt: new Date().toISOString()
      }
    ],
    playlists: []
  };
}

describe("QueueController", () => {
  function createAuthServiceMock() {
    return {
      getAuthSessionByTokenOrThrow: jest.fn().mockResolvedValue({
        id: "guest_host",
        userId: "guest_host",
        username: "host",
        nickname: "Host",
        token: "token",
        createdAt: new Date().toISOString()
      })
    };
  }

  it("returns queue and playback after adding an item", async () => {
    const snapshot = buildSnapshot();
    const roomService = {
      addQueueItem: jest.fn().mockResolvedValue(snapshot.queue[0]),
      getRoomSnapshot: jest.fn().mockResolvedValue(snapshot)
    };
    const signalingGateway = {
      emitQueuePatch: jest.fn()
    };
    const controller = new QueueController(
      roomService as never,
      signalingGateway as never,
      createAuthServiceMock() as never
    );

    await expect(
      controller.addQueueItem("room_1", "token", {
        trackId: "track_1"
      })
    ).resolves.toEqual({
      queue: snapshot.queue,
      playback: snapshot.room.playback
    });

    expect(roomService.addQueueItem).toHaveBeenCalledWith("room_1", "guest_host", "track_1");
    expect(signalingGateway.emitQueuePatch).toHaveBeenCalledWith("room_1", {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    });
  });
});
