import type { RoomMember, RoomMemberPermissions } from "@music-room/shared";
import type { RoomRecord } from "./room.types";
import {
  assertHost,
  assertMember,
  assertPermission,
  assertUniqueNickname,
  buildJoinCode,
  hashRoomPassword,
  incrementPlaybackRevision,
  incrementPresenceRevision,
  incrementQueueVersion,
  incrementRoomRevision,
  verifyRoomPassword
} from "./room-mutation";

type TestMember = {
  id: string;
  nickname: string;
  role: "host" | "member";
  permissions: RoomMemberPermissions;
};

function createRecord(overrides: {
  hostId?: string;
  members?: TestMember[];
} = {}): RoomRecord {
  const members: RoomMember[] = (overrides.members ?? [
    {
      id: "host-1",
      nickname: "Host",
      role: "host",
      permissions: { library: true, queue: true, player: true }
    }
  ]).map((member) => ({
    id: member.id,
    nickname: member.nickname,
    role: member.role,
    joinedAt: "2026-07-31T00:00:00.000Z",
    peerId: null,
    presenceState: "offline" as const,
    permissions: member.permissions
  }));
  return {
    room: {
      id: "room-1",
      hostId: overrides.hostId ?? "host-1",
      joinCode: "ABC123",
      name: "test",
      description: null,
      hasPassword: false,
      visibility: "public",
      roomType: "interactive",
      radioAutopilot: { enabled: false },
      members,
      presenceRevision: 0,
      roomRevision: 0,
      playback: {
        status: "paused",
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
    passwordHash: null,
    tracks: [],
    queue: [],
    memberPermissionProfiles: {}
  };
}

describe("room mutation guards", () => {
  it("allows a room member and rejects a stranger", () => {
    const record = createRecord({
      members: [
        {
          id: "host-1",
          nickname: "Host",
          role: "host",
          permissions: { library: true, queue: true, player: true }
        },
        {
          id: "member-1",
          nickname: "Member",
          role: "member",
          permissions: { library: true, queue: false, player: false }
        }
      ]
    });

    expect(() => assertMember(record, "member-1")).not.toThrow();
    expect(() => assertMember(record, "outsider")).toThrow("Only room members can perform this action.");
  });

  it("reserves room management to the host", () => {
    const record = createRecord();
    expect(() => assertHost(record, "host-1")).not.toThrow();
    expect(() => assertHost(record, "member-1")).toThrow("Only the host can manage room members.");
  });

  it("checks a member's permission flags", () => {
    const record = createRecord({
      members: [
        {
          id: "host-1",
          nickname: "Host",
          role: "host",
          permissions: { library: true, queue: true, player: true }
        },
        {
          id: "member-1",
          nickname: "Member",
          role: "member",
          permissions: { library: true, queue: false, player: false }
        }
      ]
    });

    expect(() => assertPermission(record, "member-1", "library")).not.toThrow();
    expect(() => assertPermission(record, "member-1", "queue")).toThrow(
      "Member does not have the queue permission."
    );
    expect(() => assertPermission(record, "outsider", "library")).toThrow(
      "Only room members can perform this action."
    );
  });

  it("rejects a duplicate nickname for another member", () => {
    const record = createRecord({
      members: [
        {
          id: "host-1",
          nickname: "Host",
          role: "host",
          permissions: { library: true, queue: true, player: true }
        },
        {
          id: "member-1",
          nickname: "Alice",
          role: "member",
          permissions: { library: true, queue: false, player: false }
        }
      ]
    });

    expect(() => assertUniqueNickname(record, "member-2", "alice")).toThrow("Nickname already exists in this room.");
    expect(() => assertUniqueNickname(record, "member-1", "Alice")).not.toThrow();
  });
});

describe("room revision helpers", () => {
  it("increments the room revision from a missing base", () => {
    const record = createRecord();
    const room = record.room as unknown as { roomRevision: number };
    incrementRoomRevision(record.room);
    expect(room.roomRevision).toBe(1);
  });

  it("increments the presence revision", () => {
    const record = createRecord();
    incrementPresenceRevision(record.room);
    expect(record.room.presenceRevision).toBe(1);
  });

  it("increments the queue and playback revisions on the playback snapshot", () => {
    const record = createRecord();
    incrementQueueVersion(record.room.playback);
    incrementPlaybackRevision(record.room.playback);
    expect(record.room.playback.queueVersion).toBe(2);
    expect(record.room.playback.playbackRevision).toBe(2);
  });

  it("builds a 6-char uppercase join code", () => {
    expect(buildJoinCode()).toMatch(/^[A-Z0-9]{6}$/);
  });
});

describe("room password hashing", () => {
  it("round-trips a correct password and rejects a wrong one", () => {
    const encoded = hashRoomPassword("secret-pass");
    expect(encoded.startsWith("v1:")).toBe(true);
    expect(verifyRoomPassword("secret-pass", encoded)).toBe(true);
    expect(verifyRoomPassword("wrong-pass", encoded)).toBe(false);
  });

  it("rejects malformed encodings", () => {
    expect(verifyRoomPassword("anything", "not-a-hash")).toBe(false);
  });
});
