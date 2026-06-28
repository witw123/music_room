import { describe, expect, it } from "vitest";
import { buildCachedLibraryFileHashSet } from "./TrackListSection";

describe("TrackListSection helpers", () => {
  it("builds a deduplicated cached file hash lookup for large track lists", () => {
    const cachedHashes = buildCachedLibraryFileHashSet(["hash_a", "hash_b", "hash_a"]);

    expect(cachedHashes.has("hash_a")).toBe(true);
    expect(cachedHashes.has("hash_b")).toBe(true);
    expect(cachedHashes.has("hash_missing")).toBe(false);
    expect([...cachedHashes]).toEqual(["hash_a", "hash_b"]);
  });
});
