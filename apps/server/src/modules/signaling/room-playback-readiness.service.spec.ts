import type { RoomPlaybackReadinessInputPayload, RoomPlaybackReadinessPayload } from "@music-room/shared";
import { RoomPlaybackReadinessService } from "./room-playback-readiness.service";

function createRoomService() {
  return {
    getAccessibleRoomSnapshot: jest.fn(),
    getRoomSnapshot: jest.fn()
  };
}

function createBroadcaster() {
  return {
    instanceId: "instance-a",
    emitPlaybackReadiness: jest.fn(),
    setServer: jest.fn()
  };
}

function member(id: string) {
  return {
    id,
    peerId: `peer-${id}`,
    presenceState: "online" as const,
    role: "member" as const
  };
}

function createSnapshot(playback: Record<string, unknown> = {}, members: ReturnType<typeof member>[] = []) {
  return {
    room: {
      id: "room-1",
      hostId: "host-1",
      joinCode: "ABC123",
      visibility: "public" as const,
      members,
      presenceRevision: 1,
      roomRevision: 1,
      playback: {
        status: "playing" as const,
        currentTrackId: "track-1",
        currentQueueItemId: null,
        playbackAssetId: null,
        startAt: "2026-07-31T00:00:00.000Z",
        sourceSessionId: null,
        sourcePeerId: null,
        sourceTrackId: null,
        positionMs: 0,
        startedAt: "2026-07-31T00:00:00.000Z",
        queueVersion: 1,
        playbackRevision: 1,
        mediaEpoch: 2,
        ...playback
      }
    },
    tracks: [],
    queue: [],
    playlists: []
  };
}

function readinessInput(
  sessionId: string,
  peerId: string,
  state: "waiting" | "ready",
  cacheEnabled = true
): RoomPlaybackReadinessInputPayload {
  return {
    roomId: "room-1",
    sessionId,
    peerId,
    trackId: "track-1",
    mediaEpoch: 2,
    cacheEnabled,
    state
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("RoomPlaybackReadinessService", () => {
  it("holds the barrier while a cache participant is still waiting", async () => {
    const roomService = createRoomService();
    roomService.getAccessibleRoomSnapshot.mockResolvedValue(createSnapshot({}, [member("one")]));
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);

    const canonical = await readiness.handleReadiness(readinessInput("one", "peer-one", "waiting"));

    expect(canonical.barrier).toBe("waiting");
    expect(canonical.holdPositionMs).toBe(0);
    expect(broadcaster.emitPlaybackReadiness).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({ barrier: "waiting" })
    );
  });

  it("opens the barrier once every cache participant is ready", async () => {
    const roomService = createRoomService();
    roomService.getAccessibleRoomSnapshot.mockResolvedValue(createSnapshot({}, [member("one")]));
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);

    const canonical = await readiness.handleReadiness(readinessInput("one", "peer-one", "ready"));

    expect(canonical.barrier).toBe("open");
    expect(canonical.resumeAt).toBeNull();
  });

  it("never blocks a paused room regardless of cache state", async () => {
    const roomService = createRoomService();
    roomService.getAccessibleRoomSnapshot.mockResolvedValue(
      createSnapshot({ status: "paused" }, [member("one")])
    );
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);

    const canonical = await readiness.handleReadiness(readinessInput("one", "peer-one", "waiting"));

    expect(canonical.barrier).toBe("open");
  });

  it("schedules a shared resume time when a held barrier opens", async () => {
    const roomService = createRoomService();
    roomService.getAccessibleRoomSnapshot.mockResolvedValue(createSnapshot({}, [member("one")]));
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);

    await readiness.handleReadiness(readinessInput("one", "peer-one", "waiting"));
    const canonical = await readiness.handleReadiness(readinessInput("one", "peer-one", "ready"));

    expect(canonical.barrier).toBe("open");
    expect(canonical.resumeAt).not.toBeNull();
  });

  it("keeps a local copy of foreign readiness and emits it locally without republishing", () => {
    const roomService = createRoomService();
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);
    const emit = jest.fn();
    const server = { to: jest.fn(() => ({ emit })) };
    readiness.setServer(server as never);
    const payload: RoomPlaybackReadinessPayload = {
      roomId: "room-1",
      sessionId: "one",
      peerId: "peer-one",
      trackId: "track-1",
      mediaEpoch: 2,
      cacheEnabled: true,
      state: "waiting",
      barrier: "waiting",
      resumeAt: null,
      holdPositionMs: 0,
      updatedAt: "2026-07-31T00:00:01.000Z"
    };

    readiness.handleRedisReadiness("room-1", payload);

    expect(server.to).toHaveBeenCalledWith("room-1");
    expect(emit).toHaveBeenCalledWith("room.playback.readiness", payload);
    expect(readiness.getReadinessForTimeline("room-1", "track-1:2").map((item) => item.sessionId))
      .toEqual(["one"]);
  });

  it("ignores an out-of-order foreign readiness event", () => {
    const roomService = createRoomService();
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);
    const emit = jest.fn();
    readiness.setServer({ to: jest.fn(() => ({ emit })) } as never);
    const payload: RoomPlaybackReadinessPayload = {
      roomId: "room-1",
      sessionId: "one",
      peerId: "peer-one",
      trackId: "track-1",
      mediaEpoch: 2,
      cacheEnabled: true,
      state: "waiting",
      barrier: "waiting",
      resumeAt: null,
      holdPositionMs: 0,
      updatedAt: "2026-07-31T00:00:01.000Z"
    };
    const newer = { ...payload, state: "ready" as const, barrier: "open" as const, updatedAt: "2026-07-31T00:00:02.000Z" };

    readiness.handleRedisReadiness("room-1", newer);
    readiness.handleRedisReadiness("room-1", payload);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(readiness.getReadinessForTimeline("room-1", "track-1:2")[0]).toMatchObject(newer);
  });

  it("reopens the barrier when the last waiting member departs", async () => {
    const roomService = createRoomService();
    const members = [member("one"), member("two")];
    roomService.getAccessibleRoomSnapshot.mockResolvedValue(createSnapshot({}, members));
    roomService.getRoomSnapshot.mockResolvedValue(createSnapshot({}, members));
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);

    await readiness.handleReadiness(readinessInput("one", "peer-one", "waiting"));
    await readiness.handleReadiness(readinessInput("two", "peer-two", "ready"));

    readiness.clearForSession("room-1", "one");
    await settle();

    expect(broadcaster.emitPlaybackReadiness).toHaveBeenLastCalledWith(
      "room-1",
      expect.objectContaining({ barrier: "open" })
    );
  });

  it("does not clear a newer readiness report from a reconnected peer", async () => {
    const roomService = createRoomService();
    const members = [member("one")];
    roomService.getAccessibleRoomSnapshot.mockResolvedValue(createSnapshot({}, members));
    roomService.getRoomSnapshot.mockResolvedValue(createSnapshot({}, members));
    const broadcaster = createBroadcaster();
    const readiness = new RoomPlaybackReadinessService(roomService as never, broadcaster as never);

    await readiness.handleReadiness(readinessInput("one", "peer-one", "ready"));
    readiness.clearForSession("room-1", "one", "peer-one");
    await readiness.handleReadiness(readinessInput("one", "peer-one", "waiting"));
    await settle();

    expect(readiness.getReadinessForTimeline("room-1", "track-1:2")[0]).toEqual(
      expect.objectContaining({ sessionId: "one", state: "waiting" })
    );
  });
});
