import { describe, expect, it } from "vitest";
import { createPlaybackMediaSessionKey } from "./playback-media-session";

describe("playback media session key", () => {
  it("ignores ordinary room snapshot fields", () => {
    const base = {
      trackId: "track_1",
      playbackAssetId: "asset_1",
      mediaEpoch: 4,
      playbackRevision: 9,
      startAt: "2026-07-15T00:00:00.000Z",
      sourcePeerId: "peer_a",
      remoteTrackId: "remote_1"
    };

    expect(createPlaybackMediaSessionKey(base)).toBe(
      "track_1|asset_1|4|2026-07-15T00:00:00.000Z|peer_a|remote_1"
    );
    expect(createPlaybackMediaSessionKey({ ...base })).toBe(createPlaybackMediaSessionKey(base));
  });

  it("changes only when a media identity field changes", () => {
    const base = {
      trackId: "track_1",
      playbackAssetId: "asset_1",
      mediaEpoch: 4,
      playbackRevision: 9,
      startAt: "start",
      sourcePeerId: "peer_a",
      remoteTrackId: null
    };
    expect(createPlaybackMediaSessionKey({ ...base, remoteTrackId: "remote_2" })).not.toBe(
      createPlaybackMediaSessionKey(base)
    );
    expect(createPlaybackMediaSessionKey({ ...base, playbackRevision: 10 })).toBe(
      createPlaybackMediaSessionKey(base)
    );
  });
});
