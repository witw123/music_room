import { describe, expect, it } from "vitest";
import { rehydrateOwnedUploadedTracksFromCache } from "./upload-rehydration";

describe("rehydrateOwnedUploadedTracksFromCache", () => {
  const roomTrack = {
    id: "track_1",
    title: "Cached",
    artist: "Artist",
    album: null,
    durationMs: 120_000,
    bitrate: null,
    sizeBytes: 6,
    codec: "flac",
    mimeType: "audio/flac",
    fileHash: "hash_1",
    artworkUrl: null,
    ownerSessionId: "user_1",
    ownerNickname: "Host",
    sourceType: "local_upload" as const,
    relayManifest: null,
    pieceManifest: {
      totalChunks: 1,
      chunkSize: 1024,
      pieceMimeType: "audio/flac"
    }
  };

  it("rehydrates missing owned room tracks from usable cached files", async () => {
    const objectUrlFiles: string[] = [];
    const result = await rehydrateOwnedUploadedTracksFromCache({
      missingOwnedTracks: [roomTrack],
      cachedLibraryTracksByHash: new Map(),
      getCachedLibraryTrackSummary: async () => ({
        fileHash: "hash_1",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 6,
        cachedAt: "2026-07-06T00:00:00.000Z",
        sourceTrackIds: ["track_1"],
        sourceRoomIds: ["room_1"],
        lastSourceTrackId: "track_1",
        lastSourceRoomId: "room_1",
        lastOwnerNickname: "Host"
      }),
      getCachedLibraryTrack: async () => ({
        fileHash: "hash_1",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 6,
        cachedAt: "2026-07-06T00:00:00.000Z",
        sourceTrackIds: ["track_1"],
        sourceRoomIds: ["room_1"],
        lastSourceTrackId: "track_1",
        lastSourceRoomId: "room_1",
        lastOwnerNickname: "Host",
        file: new Blob(["cached"], { type: "audio/flac" })
      }),
      createObjectUrl: (file) => {
        objectUrlFiles.push(file.name);
        return "blob:cached";
      }
    });

    expect(Object.keys(result.uploads)).toEqual(["track_1"]);
    expect(result.uploads.track_1).toMatchObject({
      objectUrl: "blob:cached",
      origin: "live-upload"
    });
    expect(result.createdObjectUrls).toEqual(["blob:cached"]);
    expect(objectUrlFiles).toEqual(["Cached.flac"]);
  });

  it("skips cached files that do not match room track metadata", async () => {
    const result = await rehydrateOwnedUploadedTracksFromCache({
      missingOwnedTracks: [roomTrack],
      cachedLibraryTracksByHash: new Map(),
      getCachedLibraryTrackSummary: async () => ({
        fileHash: "hash_other",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 6,
        cachedAt: "2026-07-06T00:00:00.000Z",
        sourceTrackIds: ["track_1"],
        sourceRoomIds: ["room_1"],
        lastSourceTrackId: "track_1",
        lastSourceRoomId: "room_1",
        lastOwnerNickname: "Host"
      }),
      getCachedLibraryTrack: async () => {
        throw new Error("should not load unusable cache records");
      },
      createObjectUrl: () => {
        throw new Error("should not create urls for unusable records");
      }
    });

    expect(result.uploads).toEqual({});
    expect(result.createdObjectUrls).toEqual([]);
  });
});
