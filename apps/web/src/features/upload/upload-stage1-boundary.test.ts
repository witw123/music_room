import { describe, expect, it } from "vitest";
import { buildRegisterTrackPayload } from "./upload-pipeline";
import { createInFlightCachedLibraryTrackFileLoader } from "./cache-library";
import {
  buildManualCachePieceAvailabilityAnnouncement,
  shouldAnnounceTrackAvailability
} from "./track-availability";
import {
  resolveAutomaticPlaybackCacheTaskMode,
  shouldIgnoreManualCachePieceTaskUpdate
} from "./upload-ui-state";

describe("upload stage 1 module boundaries", () => {
  it("hosts registration payload helpers in upload-pipeline", () => {
    expect(
      buildRegisterTrackPayload({
        id: "track_1",
        title: "Tone",
        artist: "Artist",
        album: null,
        durationMs: 1_000,
        bitrate: null,
        sizeBytes: 1024,
        codec: "wav",
        mimeType: "audio/wav",
        fileHash: "hash_1",
        artworkUrl: null,
        ownerSessionId: "session_1",
        ownerNickname: "Host",
        sourceType: "local_upload"
      })
    ).toMatchObject({
      id: "track_1",
      fileHash: "hash_1",
      ownerSessionId: "session_1"
    });
  });

  it("hosts cache-library file loading helpers outside the hook", async () => {
    let calls = 0;
    const loader = createInFlightCachedLibraryTrackFileLoader(async () => {
      calls += 1;
      return null;
    });

    await Promise.all([loader("hash_1"), loader("hash_1")]);

    expect(calls).toBe(1);
  });

  it("hosts availability helpers outside the hook", () => {
    expect(shouldAnnounceTrackAvailability({ peerId: "peer_1" })).toBe(true);
    expect(
      buildManualCachePieceAvailabilityAnnouncement({
        roomId: "room_1",
        trackId: "track_1",
        fileHash: "hash_1",
        peerId: "peer_1",
        nickname: "Host",
        chunkIndex: 1,
        totalChunks: 3,
        chunkSize: 256
      }).availableChunks
    ).toEqual([1]);
  });

  it("hosts manual cache UI-state helpers outside the hook", () => {
    expect(resolveAutomaticPlaybackCacheTaskMode()).toBe("playback-demand");
    expect(shouldIgnoreManualCachePieceTaskUpdate("ready")).toBe(true);
  });
});
