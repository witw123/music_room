import { describe, expect, it } from "vitest";
import { buildPieceFrames } from "./piece-frame-codec";
import {
  isBinaryPieceFragmentMessage,
  isBinaryPieceMessage,
  parseIncomingMeshMessage
} from "./mesh-message-codec";

describe("mesh message codec", () => {
  it("parses versioned cache stream control messages", async () => {
    await expect(
      parseIncomingMeshMessage(
        JSON.stringify({
          kind: "cache-stream-credit",
          streamId: "stream-1",
          generation: 1,
          creditBytes: 1024
        })
      )
    ).resolves.toEqual({
      kind: "cache-stream-credit",
      streamId: "stream-1",
      generation: 1,
      creditBytes: 1024
    });

    await expect(
      parseIncomingMeshMessage(
        JSON.stringify({
          kind: "request-piece",
          trackId: "track_1",
          chunkIndex: 0
        })
      )
    ).resolves.toBe(null);
  });

  it("parses stream-scoped binary piece frames", async () => {
    const payload = new TextEncoder().encode("piece-1").buffer;
    const [frame] = buildPieceFrames(
      {
        streamId: "stream-1",
        generation: 1,
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
        streamId: "stream-1",
        generation: 1,
        trackId: "track_1"
      },
      payload
    });
  });

  it("rejects malformed and unscoped payloads", async () => {
    await expect(parseIncomingMeshMessage("{")).resolves.toBe(null);
    await expect(
      parseIncomingMeshMessage(
        JSON.stringify({
          kind: "cache-stream-credit",
          streamId: "stream-1",
          generation: 1
        })
      )
    ).resolves.toBe(null);
    await expect(parseIncomingMeshMessage(new Uint8Array([1, 2, 3]))).resolves.toBe(null);
  });
});
