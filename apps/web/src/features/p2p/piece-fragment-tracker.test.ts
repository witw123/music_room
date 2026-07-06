import { describe, expect, it } from "vitest";
import { PieceFragmentTracker } from "./piece-fragment-tracker";
import type { BinaryPieceFragmentMessage } from "./piece-frame-codec";

function bufferFromText(value: string) {
  return new TextEncoder().encode(value).buffer;
}

function buildFragment(input: {
  fragmentIndex: number;
  fragmentCount: number;
  payload: ArrayBuffer;
  requestId?: string;
  pieceHash?: string;
}): BinaryPieceFragmentMessage {
  const message = {
    kind: "send-piece-fragment" as const,
    requestId: input.requestId,
    trackId: "track_1",
    chunkIndex: 2,
    totalChunks: 5,
    chunkSize: 8,
    mimeType: "audio/flac",
    pieceHash: input.pieceHash ?? "hash_1",
    fragmentIndex: input.fragmentIndex,
    fragmentCount: input.fragmentCount,
    payload: input.payload
  };

  return {
    ...message,
    header: message
  };
}

describe("PieceFragmentTracker", () => {
  it("returns an assembled piece once all fragments arrive", () => {
    const tracker = new PieceFragmentTracker({ ttlMs: 15_000 });

    expect(
      tracker.addFragment("peer_b", buildFragment({
        fragmentIndex: 1,
        fragmentCount: 2,
        payload: bufferFromText("bar")
      }))
    ).toBeNull();

    const assembled = tracker.addFragment(
      "peer_b",
      buildFragment({
        fragmentIndex: 0,
        fragmentCount: 2,
        payload: bufferFromText("foo")
      })
    );

    expect(assembled).toMatchObject({
      kind: "send-piece",
      trackId: "track_1",
      chunkIndex: 2,
      totalChunks: 5,
      chunkSize: 8,
      mimeType: "audio/flac",
      pieceHash: "hash_1"
    });
    expect(new TextDecoder().decode(assembled?.payload)).toBe("foobar");
  });

  it("expires stale fragment groups before accepting a new fragment", () => {
    const tracker = new PieceFragmentTracker({ ttlMs: 100 });

    expect(
      tracker.addFragment(
        "peer_b",
        buildFragment({
          fragmentIndex: 0,
          fragmentCount: 2,
          payload: bufferFromText("old")
        }),
        1_000
      )
    ).toBeNull();

    expect(
      tracker.addFragment(
        "peer_b",
        buildFragment({
          fragmentIndex: 1,
          fragmentCount: 2,
          payload: bufferFromText("new")
        }),
        1_200
      )
    ).toBeNull();
  });
});
