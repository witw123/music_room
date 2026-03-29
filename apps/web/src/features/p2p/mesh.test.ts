import { describe, expect, it } from "vitest";
import { getMissingChunkIndexes, summarizeTrackAvailability } from "./index";

describe("p2p feature helpers", () => {
  it("returns only missing chunk indexes up to the requested limit", () => {
    expect(getMissingChunkIndexes(10, [0, 1, 4, 8], 3)).toEqual([2, 3, 5]);
  });

  it("summarizes local and peer chunk availability for a track", () => {
    const summary = summarizeTrackAvailability(
      "track_42",
      [
        {
          roomId: "room_1",
          trackId: "track_42",
          ownerPeerId: "peer_local",
          nickname: "Host",
          totalChunks: 6,
          availableChunks: [0, 1, 2],
          source: "live_upload",
          announcedAt: new Date().toISOString()
        },
        {
          roomId: "room_1",
          trackId: "track_42",
          ownerPeerId: "peer_remote",
          nickname: "Guest",
          totalChunks: 6,
          availableChunks: [0, 1, 2, 3, 4, 5],
          source: "local_cache",
          announcedAt: new Date().toISOString()
        }
      ],
      "peer_local"
    );

    expect(summary.peerCount).toBe(2);
    expect(summary.localChunkCount).toBe(3);
    expect(summary.totalChunks).toBe(6);
    expect(summary.completionRatio).toBe(0.5);
    expect(summary.sources).toEqual([
      "Host (live_upload)",
      "Guest (local_cache)"
    ]);
  });
});
