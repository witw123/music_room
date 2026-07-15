import { describe, expect, it } from "vitest";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import {
  dedupePeerDiagnostics,
  dedupeRoomMembers,
  getMediaSampleAgeMs,
  hasFreshMediaObservation,
  hasRecentMediaSample
} from "./member-data";

describe("member data normalization", () => {
  it("keeps one authoritative member record per member id", () => {
    const members = dedupeRoomMembers([
      {
        id: "member_1",
        nickname: "Member",
        role: "member",
        joinedAt: "2026-07-15T09:00:00.000Z",
        peerId: null,
        presenceState: "offline"
      },
      {
        id: "member_1",
        nickname: "Member",
        role: "member",
        joinedAt: "2026-07-15T09:00:00.000Z",
        peerId: "peer_1",
        presenceState: "online"
      }
    ]);

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ peerId: "peer_1", presenceState: "online" });
  });

  it("keeps the newest diagnostic record per peer", () => {
    const older = createPeerSnapshot("peer_1", "2026-07-15T10:00:00.000Z");
    const newer = createPeerSnapshot("peer_1", "2026-07-15T10:00:01.000Z");

    expect(dedupePeerDiagnostics([older, newer])).toEqual([newer]);
  });

  it("only treats recent positive RTP progress as live media", () => {
    const now = Date.parse("2026-07-15T10:00:10.000Z");
    const diagnostic = createPeerSnapshot("peer_1", "2026-07-15T10:00:10.000Z");
    diagnostic.mediaReceiveBitrateKbps = 192;
    diagnostic.lastMediaStatsProgressAt = "2026-07-15T10:00:08.000Z";

    expect(getMediaSampleAgeMs(diagnostic, now)).toBe(2_000);
    expect(hasRecentMediaSample(diagnostic, now)).toBe(true);
    expect(hasFreshMediaObservation(diagnostic, now)).toBe(true);

    diagnostic.lastMediaStatsProgressAt = "2026-07-15T10:00:00.000Z";
    expect(hasRecentMediaSample(diagnostic, now)).toBe(false);
    expect(hasFreshMediaObservation(diagnostic, now)).toBe(false);
  });
});
