import { describe, expect, it } from "vitest";
import {
  assembleIncomingPieceFragments,
  buildPieceFrames,
  decodePieceFrame,
  type PendingIncomingPieceFragments
} from "./piece-frame-codec";

const frameHeader = {
  requestId: "request_1",
  trackId: "track_1",
  chunkIndex: 2,
  totalChunks: 8,
  chunkSize: 16,
  mimeType: "audio/mpeg",
  pieceHash: "hash_2"
};

describe("piece frame codec", () => {
  it("encodes and decodes a single piece frame", () => {
    const payload = Uint8Array.from([1, 2, 3, 4]).buffer;
    const [frame] = buildPieceFrames(frameHeader, payload, 1024);

    const decoded = decodePieceFrame(frame!.data);

    expect(decoded?.header).toEqual({
      kind: "send-piece",
      ...frameHeader
    });
    expect([...new Uint8Array(decoded!.payload)]).toEqual([1, 2, 3, 4]);
  });

  it("reassembles complete piece fragments in order", () => {
    const fragmentState: PendingIncomingPieceFragments = {
      peerId: "peer_b",
      requestId: "request_1",
      trackId: "track_1",
      chunkIndex: 2,
      totalChunks: 8,
      chunkSize: 16,
      mimeType: "audio/mpeg",
      pieceHash: "hash_2",
      fragmentCount: 3,
      receivedAtMs: 0,
      fragments: new Map([
        [2, Uint8Array.from([5, 6]).buffer],
        [0, Uint8Array.from([1, 2]).buffer],
        [1, Uint8Array.from([3, 4]).buffer]
      ])
    };

    const payload = assembleIncomingPieceFragments(fragmentState);

    expect([...new Uint8Array(payload!)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
