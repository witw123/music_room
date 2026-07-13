import { describe, expect, it } from "vitest";
import {
  assetAvailabilityAnnouncementSchema,
  assetPeerSignalMessageSchema,
  assetStreamMessageSchema
} from "./asset-models";
import { mergeAssetAvailability } from "./asset-availability";

const assetId = "a".repeat(64);

describe("P2P v4 asset contracts", () => {
  it("rejects v3 stream messages", () => {
    expect(assetStreamMessageSchema.safeParse({
      kind: "asset-stream-open",
      protocolVersion: 3,
      streamId: "stream",
      assetId,
      assetKind: "playback",
      generation: 0,
      priority: "critical",
      ranges: [{ start: 0, end: 1 }],
      initialCreditBytes: 256 * 1024
    }).success).toBe(false);
  });

  it("requires complete announcements to cover the full asset", () => {
    expect(assetAvailabilityAnnouncementSchema.safeParse({
      protocolVersion: 4,
      roomId: "room",
      assetId,
      assetKind: "playback",
      ownerPeerId: "peer",
      nickname: "Member",
      totalUnits: 3,
      availableRanges: [{ start: 0, end: 1 }],
      complete: true,
      source: "live_upload",
      announcedAt: new Date().toISOString()
    }).success).toBe(false);
  });

  it("merges availability snapshots monotonically", () => {
    const base = {
      protocolVersion: 4 as const,
      roomId: "room",
      assetId,
      assetKind: "playback" as const,
      ownerPeerId: "peer",
      nickname: "Member",
      totalUnits: 3,
      complete: false,
      source: "live_upload" as const
    };
    const merged = mergeAssetAvailability(
      { ...base, availableRanges: [{ start: 0, end: 0 }], announcedAt: "2026-01-01T00:00:00.000Z" },
      { ...base, availableRanges: [{ start: 1, end: 2 }], announcedAt: "2026-01-01T00:00:01.000Z" }
    );
    expect(merged).toMatchObject({ availableRanges: [{ start: 0, end: 2 }], complete: true });
  });

  it("keeps signaling payloads limited to SDP and ICE fields", () => {
    expect(assetPeerSignalMessageSchema.safeParse({
      protocolVersion: 4,
      capability: "segmented-opus-v1",
      roomId: "room",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data",
      type: "offer",
      payload: { type: "offer", sdp: "v=0", audioPayload: "not-allowed" }
    }).success).toBe(false);
  });
});
