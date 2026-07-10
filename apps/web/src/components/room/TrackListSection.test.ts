import { describe, expect, it } from "vitest";
import {
  buildCachedLibraryFileHashSet,
  canDeleteLibraryTrack,
  formatCachedMemberNames
} from "./TrackListSection";

describe("TrackListSection helpers", () => {
  it("formats complete-cache members as human-readable text", () => {
    expect(formatCachedMemberNames(["张三", "李四", "张三"])).toBe("完整缓存：张三、李四");
    expect(formatCachedMemberNames([])).toBe("暂无成员持有完整缓存");
  });

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
