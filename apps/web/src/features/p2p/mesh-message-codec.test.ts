import { describe, expect, it } from "vitest";
import { buildPieceFrames } from "./piece-frame-codec";
import {
  isBinaryPieceFragmentMessage,
  isBinaryPieceMessage,
  parseIncomingMeshMessage
} from "./mesh-message-codec";

describe("mesh message codec", () => {
  it("parses text data messages including batched piece requests", async () => {
    await expect(
      parseIncomingMeshMessage(
        JSON.stringify({
          kind: "request-piece",
          trackId: "track_1",
          chunkIndex: 0
        })
      )
    ).resolves.toEqual({
      kind: "request-piece",
      trackId: "track_1",
      chunkIndex: 0
    });

    await expect(
      parseIncomingMeshMessage(
        JSON.stringify({
          kind: "request-pieces",
          requestId: "request-1",
          trackId: "track_1",
          chunkIndexes: [0, 2, 1]
        })
      )
    ).resolves.toEqual({
      kind: "request-pieces",
      requestId: "request-1",
      trackId: "track_1",
      chunkIndexes: [0, 2, 1]
    });

    await expect(
      parseIncomingMeshMessage(
        JSON.stringify({
          kind: "piece-unavailable",
          requestId: "request-1",
          trackId: "track_1",
          chunkIndex: 0,
          reason: "piece-missing"
        })
      )
    ).resolves.toEqual({
      kind: "piece-unavailable",
      requestId: "request-1",
      trackId: "track_1",
      chunkIndex: 0,
      reason: "piece-missing"
    });
  });

  it("parses binary piece frames and narrows them with guards", async () => {
    const payload = new TextEncoder().encode("piece-1").buffer;
    const [frame] = buildPieceFrames(
      {
        requestId: "request-1",
        trackId: "track_1",
        chunkIndex: 0,
        totalChunks: 1,
        chunkSize: payload.byteLength,
        mimeType: "audio/flac",
        pieceHash: "hash-1"
      },
      payload,
      48 * 1024
    );

    const message = await parseIncomingMeshMessage(frame!.data);

    expect(isBinaryPieceMessage(message!)).toBe(true);
    expect(isBinaryPieceFragmentMessage(message!)).toBe(false);
    expect(message).toMatchObject({
      kind: "send-piece",
      trackId: "track_1",
      chunkIndex: 0,
      header: {
        kind: "send-piece",
        requestId: "request-1",
        trackId: "track_1"
      },
      payload
    });
  });

  it("rejects malformed payloads", async () => {
    await expect(parseIncomingMeshMessage("{")).resolves.toBe(null);
    await expect(parseIncomingMeshMessage(JSON.stringify({ kind: "request-pieces" }))).resolves.toBe(
      null
    );
    await expect(parseIncomingMeshMessage(new Uint8Array([1, 2, 3]))).resolves.toBe(null);
  });
});
