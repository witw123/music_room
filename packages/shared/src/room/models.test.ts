import { describe, expect, it } from "vitest";
import {
  defaultRoomMemberPermissions,
  getNewMemberPermissions,
  getRoomMemberPermissions,
  roomSnapshotSchema
} from "./models";

describe("roomSnapshotSchema", () => {
  it("parses a valid room snapshot", () => {
    const result = roomSnapshotSchema.safeParse({
      room: {
        id: "room_1",
        hostId: "guest_1",
        joinCode: "ABC123",
        visibility: "private",
        members: [
          {
            id: "guest_1",
            nickname: "Host",
            role: "host",
            joinedAt: new Date().toISOString(),
            peerId: null
          }
        ],
        playback: {
          status: "paused",
          currentTrackId: null,
          currentQueueItemId: null,
          sourceSessionId: "guest_1",
          sourcePeerId: null,
          sourceTrackId: null,
          positionMs: 0,
          startedAt: null,
          queueVersion: 1,
          mediaEpoch: 0
        },
        roomRevision: 0
      },
      tracks: [],
      queue: [],
      playlists: []
    });

    expect(result.success).toBe(true);
  });

  it("fills permissions for legacy members and keeps the host unrestricted", () => {
    expect(
      getRoomMemberPermissions({ role: "member", permissions: { queue: false } })
    ).toEqual({ ...defaultRoomMemberPermissions, queue: false });
    expect(
      getRoomMemberPermissions({ role: "host", permissions: { library: false } })
    ).toEqual(defaultRoomMemberPermissions);
  });

  it("falls back to enabled permissions for legacy rooms", () => {
    expect(getNewMemberPermissions({})).toEqual(defaultRoomMemberPermissions);
    expect(getNewMemberPermissions({
      newMemberPermissions: { library: false, queue: true, player: false }
    })).toEqual({ library: false, queue: true, player: false });
  });
});
