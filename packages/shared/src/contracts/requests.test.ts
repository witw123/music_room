import { describe, expect, it } from "vitest";
import {
  createRoomRequestSchema,
  joinRoomByCodeRequestSchema,
  registerRequestSchema,
  registerTrackRequestSchema,
  updatePlaybackRequestSchema
} from "./requests";

describe("request contracts", () => {
  it("trims auth input and rejects unknown fields", () => {
    expect(
      registerRequestSchema.parse({
        username: " Alice_1 ",
        password: "secret1",
        nickname: " Alice "
      })
    ).toEqual({
      username: "Alice_1",
      password: "secret1",
      nickname: "Alice"
    });

    expect(() =>
      registerRequestSchema.parse({
        username: "alice",
        password: "secret1",
        nickname: "Alice",
        role: "admin"
      })
    ).toThrow();
  });

  it("validates room creation and join code payloads", () => {
    expect(createRoomRequestSchema.parse({ visibility: "private" })).toEqual({
      visibility: "private"
    });
    expect(joinRoomByCodeRequestSchema.parse({ joinCode: "abc123" })).toEqual({
      joinCode: "ABC123"
    });
    expect(() => createRoomRequestSchema.parse({ visibility: "friends" })).toThrow();
  });

  it("validates track registration numeric bounds", () => {
    const validTrack = {
      title: "Song",
      artist: "Artist",
      album: null,
      durationMs: 120_000,
      bitrate: 320_000,
      sizeBytes: 5_000_000,
      fileHash: "hash",
      artworkUrl: null,
      sourceType: "local_upload" as const,
      pieceManifest: {
        totalChunks: 4,
        chunkSize: 1024,
        pieceMimeType: "audio/mpeg"
      }
    };

    expect(registerTrackRequestSchema.parse(validTrack)).toMatchObject(validTrack);
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        durationMs: -1
      })
    ).toThrow();
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        pieceManifest: {
          totalChunks: 0,
          chunkSize: 1024,
          pieceMimeType: "audio/mpeg"
        }
      })
    ).toThrow();
  });

  it("requires positive playback expectedVersion", () => {
    expect(
      updatePlaybackRequestSchema.parse({
        action: "seek",
        positionMs: 1000,
        actorPeerId: "peer_1",
        expectedVersion: 1
      })
    ).toEqual({
      action: "seek",
      positionMs: 1000,
      actorPeerId: "peer_1",
      expectedVersion: 1
    });

    expect(() =>
      updatePlaybackRequestSchema.parse({
        action: "seek",
        positionMs: -1,
        expectedVersion: 1
      })
    ).toThrow();
  });
});
