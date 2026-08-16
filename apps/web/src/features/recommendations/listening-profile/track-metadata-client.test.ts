import { describe, expect, it } from "vitest";
import { toListeningTrack } from "./track-metadata-client";

describe("listening track metadata client", () => {
  it("creates stable keys from provider metadata without requiring local audio", () => {
    expect(toListeningTrack({
      id: "room_track_2",
      title: "平台歌曲",
      artist: "歌手",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      sizeBytes: null,
      codec: null,
      mimeType: "audio/mpeg",
      lyrics: null,
      translatedLyrics: null,
      romanizedLyrics: null,
      fileHash: "",
      artworkUrl: "https://example.com/art.jpg",
      ownerSessionId: "owner",
      ownerNickname: "owner",
      sourceType: "netease",
      sourceRef: { provider: "netease", trackId: "provider_track" }
    })).toMatchObject({
      key: "netease:provider_track",
      providerTrackId: "provider_track",
      artworkUrl: "https://example.com/art.jpg"
    });
  });
});
