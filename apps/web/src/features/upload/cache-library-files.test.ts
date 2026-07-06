import { describe, expect, it } from "vitest";
import {
  buildCachedLibraryFileName,
  createInFlightCachedLibraryTrackFileLoader,
  exportCachedLibraryTrackFile,
  toCachedLibraryFile,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library-files";

describe("cache library file helpers", () => {
  it("converts cached records into UI entries and files", async () => {
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
    expect(
      toCachedLibraryFile({
        file,
        title: "Cached",
        mimeType: "audio/flac",
        fileHash: "hash_1"
      })
    ).toBe(file);
    await expect(
      toCachedLibraryFile({
        file: new Blob(["cached"], { type: "audio/flac" }),
        title: "Cached",
        mimeType: "audio/flac",
        fileHash: "hash_1"
      }).text()
    ).resolves.toBe("cached");
  });

  it("deduplicates in-flight cached file loads and clears settled promises", async () => {
    let loadCount = 0;
    const loader = createInFlightCachedLibraryTrackFileLoader(async (fileHash) => {
      loadCount += 1;
      return {
        fileHash,
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
        file: new File(["cached"], "cached.flac", { type: "audio/flac" })
      };
    });

    const [first, second] = await Promise.all([loader("hash_1"), loader("hash_1")]);
    expect(first).toBe(second);
    expect(loadCount).toBe(1);

    await loader("hash_1");
    expect(loadCount).toBe(2);
  });

  it("exports cached files through injected browser download effects", async () => {
    const clicked: string[] = [];
    const revoked: string[] = [];
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });

    const exported = await exportCachedLibraryTrackFile({
      fileHash: "hash_1",
      loadCachedLibraryTrackFile: async () => ({
        fileHash: "hash_1",
        title: "A/B:Tone?",
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
      }),
      createObjectUrl: () => "blob:cached",
      clickDownload: (href, filename) => {
        clicked.push(`${href}:${filename}`);
      },
      revokeObjectUrl: (href) => {
        revoked.push(href);
      },
      defer: (callback) => callback()
    });

    expect(exported).toBe(true);
    expect(clicked).toEqual(["blob:cached:A B Tone.flac"]);
    expect(revoked).toEqual(["blob:cached"]);
    expect(buildCachedLibraryFileName({ title: "A/B:Tone?", mimeType: "audio/flac", fileHash: "hash_1" })).toBe("A B Tone.flac");
  });
});
