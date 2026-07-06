import { describe, expect, it } from "vitest";
import {
  buildCachedLibraryTrackUpsertRecord,
  buildCachedLibraryFileName,
  loadCacheLibrarySnapshot,
  toCachedLibraryFile,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library";

describe("cache-library adapters", () => {
  it("builds stable file names from cached track metadata", () => {
    expect(
      buildCachedLibraryFileName({
        title: "A/B:Tone?",
        mimeType: "audio/flac",
        fileHash: "hash_1"
      })
    ).toBe("A B Tone.flac");
  });

  it("converts cached records into UI library entries and files", async () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });
    const record = {
      fileHash: "hash_1",
      title: "Cached",
      artist: "Artist",
      mimeType: "audio/flac",
      durationMs: 120_000,
      sizeBytes: 4096,
      cachedAt: "2026-07-04T00:00:00.000Z",
      sourceTrackIds: ["track_1"],
      sourceRoomIds: ["room_1"],
      lastSourceTrackId: "track_1",
      lastSourceRoomId: "room_1",
      lastOwnerNickname: "Host",
      file
    };

    expect(toCachedLibraryTrack(record)).toMatchObject({
      fileHash: "hash_1",
      title: "Cached",
      sourceTrackIds: ["track_1"]
    });
    expect(toCachedLibraryTrackFile(record).file).toBe(file);
    expect(toCachedLibraryFile({ file, title: "Cached", mimeType: "audio/flac", fileHash: "hash_1" })).toBe(file);
    await expect(
      toCachedLibraryFile({
        file: new Blob(["cached"], { type: "audio/flac" }),
        title: "Cached",
        mimeType: "audio/flac",
        fileHash: "hash_1"
      }).text()
    ).resolves.toBe("cached");
  });

  it("loads cache library snapshots with track list, count, and lookup map", async () => {
    const snapshot = await loadCacheLibrarySnapshot({
      listCachedLibraryTrackSummaries: async () => [
        {
          fileHash: "hash_1",
          title: "Cached",
          artist: "Artist",
          mimeType: "audio/flac",
          durationMs: 120_000,
          sizeBytes: 4096,
          cachedAt: "2026-07-04T00:00:00.000Z",
          sourceTrackIds: ["track_1"],
          sourceRoomIds: ["room_1"],
          lastSourceTrackId: "track_1",
          lastSourceRoomId: "room_1",
          lastOwnerNickname: "Host"
        }
      ],
      getCachedLibraryTrackCount: async () => 1
    });

    expect(snapshot.count).toBe(1);
    expect(snapshot.tracks).toHaveLength(1);
    expect(snapshot.tracksByHash.get("hash_1")?.title).toBe("Cached");
  });

  it("builds cache library upsert records for room tracks", () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });

    expect(
      buildCachedLibraryTrackUpsertRecord({
        track: {
          id: "track_1",
          title: "Cached",
          artist: "Artist",
          mimeType: null,
          durationMs: 120_000,
          sizeBytes: null,
          fileHash: "hash_1",
          ownerNickname: "Host"
        },
        roomId: "room_1",
        file
      })
    ).toMatchObject({
      fileHash: "hash_1",
      artist: "Artist",
      mimeType: "audio/flac",
      sizeBytes: file.size,
      sourceTrackIds: ["track_1"],
      sourceRoomIds: ["room_1"]
    });
  });
});
