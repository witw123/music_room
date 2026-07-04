import { describe, expect, it } from "vitest";
import {
  filterCachedPiecesByGeometry,
  selectCachedPiecesForTrackDeletion,
  selectTrackPieceManifestIdsForDeletion,
  toCachedLibraryTrackSummaryRecord
} from "./indexeddb";

describe("toCachedLibraryTrackSummaryRecord", () => {
  it("strips the full audio blob from cached-library list records", () => {
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

describe("filterCachedPiecesByGeometry", () => {
  it("keeps pieces for the requested file hash and manifest chunk size, including a short final chunk", () => {
    const pieces = [
      {
        pieceId: "hash_1:262144:__local__:0",
        chunkIndex: 0,
        chunkSize: 262144
      },
      {
        pieceId: "hash_1:262144:__local__:1",
        chunkIndex: 1,
        chunkSize: 1200
      },
      {
        pieceId: "hash_1:65536:__local__:0",
        chunkIndex: 0,
        chunkSize: 65536
      },
      {
        pieceId: "hash_2:262144:__local__:0",
        chunkIndex: 0,
        chunkSize: 262144
      }
    ];

    expect(
      filterCachedPiecesByGeometry(pieces, {
        fileHash: "hash_1",
        chunkSize: 262144
      }).map((piece) => piece.pieceId)
    ).toEqual(["hash_1:262144:__local__:0", "hash_1:262144:__local__:1"]);
  });
});

describe("selectTrackPieceManifestIdsForDeletion", () => {
  it("selects stale manifests by file hash before retrying a cache download", () => {
    const manifests = [
      { trackId: "old_track", fileHash: "hash_1" },
      { trackId: "track_1", fileHash: "hash_1" },
      { trackId: "other_track", fileHash: "hash_2" }
    ];

    expect(
      selectTrackPieceManifestIdsForDeletion(manifests, {
        trackId: "track_1",
        fileHash: "hash_1"
      })
    ).toEqual(["old_track", "track_1"]);
  });
});

describe("selectCachedPiecesForTrackDeletion", () => {
  it("selects pieces by file hash and owner key even when the old track id differs", () => {
    const pieces = [
      {
        pieceId: "hash_1:262144:__local__:0",
        trackId: "old_track",
        fileHash: "hash_1",
        ownerKey: "__local__",
        chunkIndex: 0
      },
      {
        pieceId: "hash_1:262144:__local__:1",
        trackId: "track_1",
        fileHash: "hash_1",
        ownerKey: "__local__",
        chunkIndex: 1
      },
      {
        pieceId: "track_1:262144:__local__:2",
        trackId: "track_1",
        fileHash: "",
        ownerKey: "__local__",
        chunkIndex: 2
      },
      {
        pieceId: "hash_1:262144:peer_other:0",
        trackId: "old_track",
        fileHash: "hash_1",
        ownerKey: "peer_other",
        chunkIndex: 0
      },
      {
        pieceId: "hash_2:262144:__local__:0",
        trackId: "track_1",
        fileHash: "hash_2",
        ownerKey: "__local__",
        chunkIndex: 0
      }
    ];

    expect(
      selectCachedPiecesForTrackDeletion(pieces, {
        trackId: "track_1",
        fileHash: "hash_1",
        ownerKey: "__local__"
      }).map((piece) => piece.pieceId)
    ).toEqual([
      "hash_1:262144:__local__:0",
      "hash_1:262144:__local__:1",
      "track_1:262144:__local__:2"
    ]);
  });
});
