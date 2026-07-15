import { describe, expect, it } from "vitest";
import { assetUnitId, toCachedLibraryTrackSummaryRecord } from "./indexeddb";

describe("assetUnitId", () => {
  it("uses content asset identity and rejects invalid indexes", () => {
    expect(assetUnitId("a".repeat(64), 7)).toBe(`${"a".repeat(64)}:7`);
    expect(() => assetUnitId("", 0)).toThrow();
    expect(() => assetUnitId("a".repeat(64), -1)).toThrow();
  });
});

describe("toCachedLibraryTrackSummaryRecord", () => {
  it("strips the audio blob from cached-library list records", () => {
    const summary = toCachedLibraryTrackSummaryRecord({
      fileHash: "hash_1",
      title: "Track",
      artist: "Artist",
      mimeType: "audio/flac",
      durationMs: 120_000,
      sizeBytes: 48_000_000,
      file: new Blob(["audio"], { type: "audio/flac" }),
      cachedAt: "2026-07-04T00:00:00.000Z",
      sourceTrackIds: ["track_1"],
      sourceRoomIds: ["room_1"],
      lastSourceTrackId: "track_1",
      lastSourceRoomId: "room_1",
      lastOwnerNickname: "Host"
    });

    expect(summary).not.toHaveProperty("file");
    expect(summary).toMatchObject({
      fileHash: "hash_1",
      title: "Track",
      sizeBytes: 48_000_000,
      sourceTrackIds: ["track_1"]
    });
  });
});
