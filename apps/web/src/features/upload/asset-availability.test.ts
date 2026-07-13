import { describe, expect, it } from "vitest";
import { buildCompleteAssetAnnouncements } from "./asset-availability";

const hash = (character: string) => character.repeat(64);

describe("asset availability", () => {
  it("publishes playback before original so listeners can bootstrap first", () => {
    const announcements = buildCompleteAssetAnnouncements({
      roomId: "room",
      peerId: "peer",
      nickname: "Member",
      source: "live_upload",
      announcedAt: "2026-07-13T00:00:00.000Z",
      originalAsset: {
        kind: "original",
        assetId: hash("a"),
        fileHash: hash("b"),
        mimeType: "audio/flac",
        sizeBytes: 10,
        unitSize: 1024 * 1024,
        unitCount: 1,
        merkleRoot: hash("c")
      },
      playbackAsset: {
        kind: "playback",
        assetId: hash("d"),
        sourceFileHash: hash("b"),
        profileId: "opus-music-v2",
        codec: "opus",
        container: "audio/ogg",
        sampleRate: 48_000,
        channels: 2,
        bitrate: 192_000,
        durationMs: 4_000,
        segmentDurationMs: 2_000,
        seekPrerollMs: 80,
        unitCount: 2,
        merkleRoot: hash("e"),
        encoder: { name: "@audio/opus-encode", version: "2.0.0" }
      }
    });
    expect(announcements.map((announcement) => announcement.assetKind)).toEqual([
      "playback",
      "original"
    ]);
    expect(announcements[0]).toMatchObject({
      protocolVersion: 4,
      complete: true,
      availableRanges: [{ start: 0, end: 1 }]
    });
  });
});
