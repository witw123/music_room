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
      originalAsset: {
        assetId: "a".repeat(64),
        kind: "original" as const,
        fileHash: "b".repeat(64),
        mimeType: "audio/flac",
        sizeBytes: 5_000_000,
        unitSize: 1_048_576 as const,
        unitCount: 5,
        merkleRoot: "c".repeat(64)
      },
      playbackAsset: {
        assetId: "d".repeat(64),
        kind: "playback" as const,
        sourceFileHash: "b".repeat(64),
        profileId: "opus-music-v2" as const,
        codec: "opus" as const,
        container: "audio/ogg" as const,
        sampleRate: 48_000 as const,
        channels: 2 as const,
        bitrate: 192_000 as const,
        durationMs: 120_000,
        segmentDurationMs: 2_000 as const,
        seekPrerollMs: 80 as const,
        unitCount: 60,
        merkleRoot: "e".repeat(64),
        encoder: { name: "@audio/opus-encode" as const, version: "2.0.0" as const }
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
        relayManifest: { totalChunks: 1, chunkSize: 1024, pieceMimeType: "audio/mpeg" }
      })
    ).toThrow();
    expect(() => registerTrackRequestSchema.parse({ ...validTrack, audioPayload: "base64" })).toThrow();
    expect(() => registerTrackRequestSchema.parse({
      ...validTrack,
      playbackAsset: { ...validTrack.playbackAsset, payload: "base64" }
    })).toThrow();
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

    expect(() =>
      updatePlaybackRequestSchema.parse({
        action: "play",
        playbackAssetId: "not-an-asset-id",
        expectedVersion: 1
      })
    ).toThrow();
  });
});
