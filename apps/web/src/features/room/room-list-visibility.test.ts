import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@music-room/shared";
import { filterOpenPublicRooms, filterRoomsForSession } from "./room-list-visibility";

function createRoomSnapshot(input: {
  id: string;
  visibility: "public" | "private";
  memberPresenceStates: Array<"online" | "offline" | "reconnecting">;
}): RoomSnapshot {
  return {
    room: {
      id: input.id,
      hostId: "host_1",
      joinCode: input.id.slice(0, 6).toUpperCase(),
      visibility: input.visibility,
      presenceRevision: 1,
      roomRevision: 1,
      members: input.memberPresenceStates.map((presenceState, index) => ({
        id: `session_${index}`,
        nickname: `User ${index}`,
        role: index === 0 ? "host" : "member",
        joinedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
        peerId: presenceState === "online" ? `peer_${index}` : null,
        presenceState
      })),
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
        playbackRevision: 1,
        mediaEpoch: 0
      }
    },
    tracks: [],
    queue: [],
    playlists: []
  };
}

describe("filterOpenPublicRooms", () => {
  it("keeps every public room regardless of member presence", () => {
    const rooms = [
      createRoomSnapshot({
        id: "room_public_online",
        visibility: "public",
        memberPresenceStates: ["online", "offline"]
      }),
      createRoomSnapshot({
        id: "room_public_offline",
        visibility: "public",
        memberPresenceStates: ["offline", "reconnecting"]
      }),
      createRoomSnapshot({
        id: "room_private_online",
        visibility: "private",
        memberPresenceStates: ["online"]
      })
    ];

    expect(filterOpenPublicRooms(rooms).map((room) => room.room.id)).toEqual([
      "room_public_online",
      "room_public_offline"
    ]);
  });
});

describe("filterRoomsForSession", () => {
  it("keeps the current user's rooms and every public room", () => {
    const rooms = [
      createRoomSnapshot({
        id: "room_owned_private",
        visibility: "private",
        memberPresenceStates: ["offline"]
      }),
      createRoomSnapshot({
        id: "room_owned_public",
        visibility: "public",
        memberPresenceStates: ["offline"]
      }),
      createRoomSnapshot({
        id: "room_other_public_online",
        visibility: "public",
        memberPresenceStates: ["online"]
      }),
      createRoomSnapshot({
        id: "room_other_public_offline",
        visibility: "public",
        memberPresenceStates: ["offline"]
      })
    ];

    rooms[0].room.members[0].id = "session_current";
    rooms[1].room.members[0].id = "session_current";

    expect(filterRoomsForSession(rooms, "session_current").map((room) => room.room.id)).toEqual([
      "room_owned_private",
      "room_owned_public",
      "room_other_public_online",
      "room_other_public_offline"
    ]);
  });
});
