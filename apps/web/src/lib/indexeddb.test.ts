import { describe, expect, it } from "vitest";
import { filterCachedPiecesByGeometry } from "./indexeddb";

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
