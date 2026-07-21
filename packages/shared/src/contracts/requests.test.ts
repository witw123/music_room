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
    expect(createRoomRequestSchema.parse({
      visibility: "private",
      name: "  Study Room ",
      description: "  For late night listening  ",
      password: "secret"
    })).toEqual({
      visibility: "private",
      name: "Study Room",
      description: "For late night listening",
      password: "secret"
    });
    expect(joinRoomByCodeRequestSchema.parse({ joinCode: "abc123", password: "secret" })).toEqual({
      joinCode: "ABC123",
      password: "secret"
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
        profileId: "opus-music-v3" as const,
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
        encoder: { name: "@audio/opus-encode" as const, version: "3.3.0" as const }
      }
    };

    expect(registerTrackRequestSchema.parse(validTrack)).toMatchObject(validTrack);
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        durationMs: -1
      })
    ).toThrow();
    expect(() => registerTrackRequestSchema.parse({ ...validTrack, audioPayload: "base64" })).toThrow();
    expect(() => registerTrackRequestSchema.parse({
      ...validTrack,
      playbackAsset: { ...validTrack.playbackAsset, payload: "base64" }
    })).toThrow();

    expect(
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceType: "netease",
        sourceRef: { provider: "netease", trackId: "123456" }
      })
    ).toMatchObject({
      sourceType: "netease",
      sourceRef: { provider: "netease", trackId: "123456" }
    });
    expect(
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceType: "qqmusic",
        sourceRef: { provider: "qqmusic", trackId: "003abc" }
      })
    ).toMatchObject({
      sourceType: "qqmusic",
      sourceRef: { provider: "qqmusic", trackId: "003abc" }
    });
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceType: "netease"
      })
    ).toThrow();
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceRef: { provider: "netease", trackId: "not-numeric" }
      })
    ).toThrow();
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceRef: null
      })
    ).toThrow();
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceType: "qqmusic",
        sourceRef: { provider: "netease", trackId: "123" }
      })
    ).toThrow();
    expect(() =>
      registerTrackRequestSchema.parse({
        ...validTrack,
        sourceType: "local_upload",
        sourceRef: { provider: "qqmusic", trackId: "123" }
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

    expect(() =>
      updatePlaybackRequestSchema.parse({
        action: "play",
        playbackAssetId: "not-an-asset-id",
        expectedVersion: 1
      })
    ).toThrow();
  });
});
