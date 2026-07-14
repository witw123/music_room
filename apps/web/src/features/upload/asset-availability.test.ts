import { describe, expect, it } from "vitest";
import { buildCompleteAssetAnnouncements } from "./asset-availability";

const hash = (character: string) => character.repeat(64);

describe("asset availability", () => {
  it("publishes only the original asset for manual cache transfers", () => {
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
      }
    });
    expect(announcements.map((announcement) => announcement.assetKind)).toEqual(["original"]);
    expect(announcements[0]).toMatchObject({
      protocolVersion: 4,
      complete: true,
      availableRanges: [{ start: 0, end: 0 }]
    });
  });
});
