import { describe, expect, it } from "vitest";
import type { PeerDiagnosticsSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  countPeersWithinActiveMembers,
  filterAvailabilityAnnouncementsByActivePeers,
  filterAvailabilityAnnouncementsByCurrentRoomPeers,
  filterVisiblePeerDiagnostics,
  getActiveMemberPeerIds
} from "./use-room-derived-state";

describe("use-room-derived-state helpers", () => {
  it("drops stale availability announcements from peers that are no longer active room members", () => {
    const activePeerIds = getActiveMemberPeerIds([
      {
        id: "host",
        nickname: "Host",
        role: "host",
        joinedAt: "2026-04-04T00:00:00.000Z",
        peerId: "peer_host_new",
        presenceState: "online"
      },
      {
        id: "member",
        nickname: "Member",
        role: "member",
        joinedAt: "2026-04-04T00:01:00.000Z",
        peerId: "peer_member",
        presenceState: "online"
      }
    ]);
    const trackAvailability: Record<string, TrackAvailabilityAnnouncement> = {
      peer_host_old: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host_old",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1, 2],
        source: "local_cache",
        announcedAt: "2026-04-04T00:00:00.000Z"
      },
      peer_host_new: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host_new",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1],
        source: "local_cache",
        announcedAt: "2026-04-04T00:02:00.000Z"
      }
    };

    expect(filterAvailabilityAnnouncementsByActivePeers(trackAvailability, activePeerIds)).toEqual([
      trackAvailability.peer_host_new
    ]);
  });

  it("counts only currently active peer connections in member diagnostics", () => {
    const activePeerIds = new Set(["peer_host", "peer_member"]);

    expect(countPeersWithinActiveMembers(["peer_host", "peer_departed"], activePeerIds)).toBe(1);
    expect(
      countPeersWithinActiveMembers(["peer_member", "peer_departed", "peer_host"], activePeerIds)
    ).toBe(2);
  });

  it("drops availability announcements from other rooms even when the peer id still matches", () => {
    const activePeerIds = new Set(["peer_host"]);
    const trackAvailability: Record<string, TrackAvailabilityAnnouncement> = {
      peer_host_room_1: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1, 2],
        source: "local_cache",
        announcedAt: "2026-04-04T00:00:00.000Z"
      },
      peer_host_room_2: {
        roomId: "room_2",
        trackId: "track_1",
        ownerPeerId: "peer_host",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1, 2, 3],
        source: "local_cache",
        announcedAt: "2026-04-04T00:00:05.000Z"
      }
    };

    expect(
      filterAvailabilityAnnouncementsByCurrentRoomPeers(trackAvailability, "room_1", activePeerIds)
    ).toEqual([trackAvailability.peer_host_room_1]);
  });

  it("hides diagnostics from peers that have already left the room", () => {
    const diagnostics = [
      { peerId: "system", updatedAt: "2026-04-04T00:00:00.000Z" },
      { peerId: "peer_host", updatedAt: "2026-04-04T00:00:00.000Z" },
      { peerId: "peer_departed", updatedAt: "2026-04-04T00:00:30.000Z", lastError: "timed out" }
    ] satisfies Array<
      Partial<PeerDiagnosticsSnapshot> & Pick<PeerDiagnosticsSnapshot, "peerId" | "updatedAt">
    >;

    expect(
      filterVisiblePeerDiagnostics(
        diagnostics as PeerDiagnosticsSnapshot[],
        new Set(["peer_host"]),
        null
      )
    ).toEqual([diagnostics[0], diagnostics[1]]);
  });
});
