import { describe, expect, it } from "vitest";
import { toListeningTrack } from "./audio-feature-client";

describe("listening audio feature client", () => {
  it("creates stable provider and local track keys without exposing local artwork", () => {
    expect(toListeningTrack({
      id: "room_track_1",
      title: "本地歌曲",
      artist: "歌手",
      album: "专辑",
      durationMs: 210_000,
      bitrate: null,
      sizeBytes: 1,
      codec: null,
      mimeType: "audio/mpeg",
      lyrics: null,
      translatedLyrics: null,
      romanizedLyrics: null,
      fileHash: "file_hash",
      artworkUrl: "data:image/png;base64,hidden",
      ownerSessionId: "owner",
      ownerNickname: "owner",
      sourceType: "local_upload"
    })).toMatchObject({
      key: "local_upload:file_hash",
      providerTrackId: "file_hash",
      artworkUrl: null
    });

    expect(toListeningTrack({
      id: "room_track_2",
      title: "平台歌曲",
      artist: "歌手",
      album: null,
      durationMs: 180_000,
      bitrate: null,
      sizeBytes: 1,
      codec: null,
      mimeType: "audio/mpeg",
      lyrics: null,
      translatedLyrics: null,
      romanizedLyrics: null,
      fileHash: "file_hash",
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
