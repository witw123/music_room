import { describe, expect, it } from "vitest";
import { registerTrackRequestSchema } from "@music-room/shared";
import {
  buildCachedLibraryTrackRegisterPayload,
  buildRegisterTrackPayload,
  isManualCachePieceCompatible,
  resolveReusableCachedPieceManifest,
  resolveMissingOwnedUploadedTracks,
  shouldAnnounceTrackAvailability
} from "./use-track-uploads";

describe("buildRegisterTrackPayload", () => {
  it("does not include client-only session fields rejected by the strict server schema", () => {
    const payload = buildRegisterTrackPayload({
      id: "track_1",
      title: "Tone",
      artist: "本地上传",
      album: null,
      durationMs: 500,
      bitrate: null,
      sizeBytes: 44144,
      codec: "wav",
      mimeType: "audio/wav",
      fileHash: "hash_1",
      artworkUrl: null,
      ownerSessionId: "user_1",
      ownerNickname: "Host",
      sourceType: "local_upload"
    });

    expect(payload).not.toHaveProperty("sessionId");
    expect(payload).toMatchObject({
      ownerSessionId: "user_1",
      ownerNickname: "Host"
    });
  });
});

describe("buildCachedLibraryTrackRegisterPayload", () => {
  it("produces a strict server registration payload without client-only session fields", () => {
    const payload = buildCachedLibraryTrackRegisterPayload({
      id: "track_cached",
      title: "Cached Tone",
      artist: "本地缓存",
      album: null,
      durationMs: 500,
      bitrate: null,
      sizeBytes: 44144,
      codec: "wav",
      mimeType: "audio/wav",
      fileHash: "hash_cached",
      artworkUrl: null,
      ownerSessionId: "user_1",
      ownerNickname: "Host",
      sourceType: "local_upload",
      pieceManifest: {
        totalChunks: 1,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/wav"
      },
      relayManifest: {
        totalChunks: 1,
        chunkSize: 128 * 1024,
        pieceMimeType: "audio/wav"
      }
    });

    expect(payload).not.toHaveProperty("sessionId");
    expect(registerTrackRequestSchema.parse(payload)).toMatchObject({
      title: "Cached Tone",
      fileHash: "hash_cached",
      ownerSessionId: "user_1",
      ownerNickname: "Host"
    });
  });
});

describe("shouldAnnounceTrackAvailability", () => {
  it("depends on peer identity rather than the manual cache feature flag", () => {
    expect(
      shouldAnnounceTrackAvailability({
        peerId: "peer_1"
      })
    ).toBe(true);

    expect(
      shouldAnnounceTrackAvailability({
        peerId: null
      })
    ).toBe(false);
  });
});

describe("resolveReusableCachedPieceManifest", () => {
  it("discards a cached manifest whose geometry does not match the current room track", () => {
    expect(
      resolveReusableCachedPieceManifest({
        cachedManifest: {
          totalChunks: 673,
          chunkSize: 64 * 1024
        },
        expectedManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024
        }
      })
    ).toEqual(null);
  });

  it("keeps a cached manifest when it matches the current room track geometry", () => {
    const cachedManifest = {
      totalChunks: 169,
      chunkSize: 256 * 1024
    };

    expect(
      resolveReusableCachedPieceManifest({
        cachedManifest,
        expectedManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024
        }
      })
    ).toBe(cachedManifest);
  });
});

describe("isManualCachePieceCompatible", () => {
  it("rejects received cache pieces whose geometry does not match the current room track", () => {
    expect(
      isManualCachePieceCompatible({
        piece: {
          totalChunks: 673,
          chunkSize: 64 * 1024
        },
        expectedManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024
        }
      })
    ).toBe(false);
  });

  it("accepts received cache pieces when there is no current manifest to compare", () => {
    expect(
      isManualCachePieceCompatible({
        piece: {
          totalChunks: 2,
          chunkSize: 128 * 1024
        },
        expectedManifest: null
      })
    ).toBe(true);
  });
});

describe("resolveMissingOwnedUploadedTracks", () => {
  it("returns only the current user's room tracks that lost their playable upload binding", () => {
    expect(
      resolveMissingOwnedUploadedTracks({
        activeSessionId: "user_a",
        roomTracks: [
          {
            id: "track_owned_missing",
            fileHash: "hash-a",
            ownerSessionId: "user_a"
          },
          {
            id: "track_owned_ready",
            fileHash: "hash-b",
            ownerSessionId: "user_a"
          },
          {
            id: "track_other_user",
            fileHash: "hash-c",
            ownerSessionId: "user_b"
          }
        ],
        uploadedTracks: {
          track_owned_ready: {
            file: new File(["ready"], "ready.mp3", { type: "audio/mpeg" }),
            objectUrl: "blob:ready",
            origin: "live-upload"
          }
        }
      })
    ).toEqual([
      {
        id: "track_owned_missing",
        fileHash: "hash-a",
        ownerSessionId: "user_a"
      }
    ]);
  });

  it("returns an empty plan when there is no active room owner session", () => {
    expect(
      resolveMissingOwnedUploadedTracks({
        activeSessionId: null,
        roomTracks: [
          {
            id: "track_owned_missing",
            fileHash: "hash-a",
            ownerSessionId: "user_a"
          }
        ],
        uploadedTracks: {}
      })
    ).toEqual([]);
  });
});
