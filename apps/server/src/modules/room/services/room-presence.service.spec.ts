import { RoomPresenceService } from "./room-presence.service";

describe("RoomPresenceService", () => {
  it("loads all member presence entries with one Redis batch read", async () => {
    const redis = {
      getStrings: jest.fn().mockResolvedValue([
        JSON.stringify({ peerId: "peer_host", presenceState: "online" }),
        null
      ]),
      getString: jest.fn()
    };
    const service = new RoomPresenceService(redis as never, new Map(), 60);

    const presence = await service.getPresenceSnapshot("room_1", [
      {
        id: "host_1",
        nickname: "Host",
        role: "host",
        joinedAt: "2026-07-13T00:00:00.000Z",
        peerId: null,
        presenceState: "offline"
      },
      {
        id: "member_1",
        nickname: "Member",
        role: "member",
        joinedAt: "2026-07-13T00:00:00.000Z",
        peerId: null,
        presenceState: "offline"
      }
    ]);

    expect(redis.getStrings).toHaveBeenCalledWith([
      "music-room:presence:room_1:host_1",
      "music-room:presence:room_1:member_1"
    ]);
    expect(redis.getString).not.toHaveBeenCalled();
    expect(presence.get("host_1")).toEqual({
      peerId: "peer_host",
      presenceState: "online"
    });
    expect(presence.has("member_1")).toBe(false);
  });

  it("keeps local presence when a Redis key is temporarily missing", async () => {
    const localPresence = new Map([
      [
        "host_1",
        {
          peerId: "peer_host",
          presenceState: "online" as const,
          expiresAt: Date.now() + 60_000
        }
      ]
    ]);
    const redis = {
      isAvailable: jest.fn().mockReturnValue(true),
      getStrings: jest.fn().mockResolvedValue([null])
    };
    const service = new RoomPresenceService(redis as never, new Map([["room_1", localPresence]]), 60);

    const presence = await service.getPresenceSnapshot("room_1", [
      {
        id: "host_1",
        nickname: "Host",
        role: "host",
        joinedAt: "2026-07-13T00:00:00.000Z",
        peerId: null,
        presenceState: "offline"
      }
    ]);

    expect(presence.get("host_1")).toEqual({ peerId: "peer_host", presenceState: "online" });
  });

  it("returns local presence while Redis is unavailable", async () => {
    const localPresence = new Map([
      [
        "host_1",
        {
          peerId: "peer_host",
          presenceState: "online" as const,
          expiresAt: Date.now() + 60_000
        }
      ]
    ]);
    const redis = {
      isAvailable: jest.fn().mockReturnValue(false),
      getStrings: jest.fn()
    };
    const service = new RoomPresenceService(redis as never, new Map([["room_1", localPresence]]), 60);

    const presence = await service.getPresenceSnapshot("room_1", [
      {
        id: "host_1",
        nickname: "Host",
        role: "host",
        joinedAt: "2026-07-13T00:00:00.000Z",
        peerId: null,
        presenceState: "offline"
      }
    ]);

    expect(presence.get("host_1")).toEqual({ peerId: "peer_host", presenceState: "online" });
    expect(redis.getStrings).not.toHaveBeenCalled();
  });
});
