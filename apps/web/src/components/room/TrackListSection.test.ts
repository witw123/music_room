import { describe, expect, it } from "vitest";
import {
  buildCachedLibraryFileHashSet,
  canDeleteLibraryTrack
} from "./TrackListSection";

describe("TrackListSection helpers", () => {
  it("builds a deduplicated cached file hash lookup for large track lists", () => {
    const cachedHashes = buildCachedLibraryFileHashSet(["hash_a", "hash_b", "hash_a"]);

    expect(cachedHashes.has("hash_a")).toBe(true);
    expect(cachedHashes.has("hash_b")).toBe(true);
    expect(cachedHashes.has("hash_missing")).toBe(false);
    expect([...cachedHashes]).toEqual(["hash_a", "hash_b"]);
  });

  it("allows host-level library management while preserving member ownership limits", () => {
    const track = {
      ownerSessionId: "owner_1"
    };

    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "host_1",
        canManageLibraryTracks: true
      })
    ).toBe(true);
    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "owner_1",
        canManageLibraryTracks: false
      })
    ).toBe(true);
    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "member_2",
        canManageLibraryTracks: false
      })
    ).toBe(false);
  });
});
