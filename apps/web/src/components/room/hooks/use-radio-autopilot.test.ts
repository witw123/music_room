import { describe, expect, it } from "vitest";
import type { NeteaseTrackCandidate, RoomSnapshot } from "@music-room/shared";
import {
  isRadioPlaybackAtQueueEnd,
  selectRadioAutopilotCandidates
} from "./use-radio-autopilot";

function buildSnapshot(
  status: "playing" | "paused",
  currentQueueItemId: string | null,
  queueItemIds: string[]
) {
  return {
    room: {
      playback: {
        status,
        currentQueueItemId
      }
    },
    queue: queueItemIds.map((id) => ({ id }))
  } as RoomSnapshot;
}

describe("radio autopilot queue trigger", () => {
  it("triggers only while the last queue item is playing", () => {
    expect(isRadioPlaybackAtQueueEnd(buildSnapshot("playing", "queue_2", ["queue_1", "queue_2"]))).toBe(true);
    expect(isRadioPlaybackAtQueueEnd(buildSnapshot("playing", "queue_1", ["queue_1", "queue_2"]))).toBe(false);
    expect(isRadioPlaybackAtQueueEnd(buildSnapshot("paused", "queue_2", ["queue_1", "queue_2"]))).toBe(false);
    expect(isRadioPlaybackAtQueueEnd(buildSnapshot("playing", null, ["queue_1"]))).toBe(false);
  });

  it("reuses an unqueued library track and allows the current artist", () => {
    const snapshot = {
      room: { playback: { status: "playing", currentQueueItemId: "queue_current" } },
      tracks: [
        { id: "track_current", artist: "Same Artist", sourceRef: { provider: "netease", trackId: "1" } },
        { id: "track_library", artist: "Same Artist", sourceRef: { provider: "netease", trackId: "2" } },
        { id: "track_queued", artist: "Other Artist", sourceRef: { provider: "netease", trackId: "3" } }
      ],
      queue: [
        { id: "queue_current", trackId: "track_current" },
        { id: "queue_next", trackId: "track_queued" }
      ]
    } as RoomSnapshot;
    const candidates = [
      buildCandidate("2", "Same Artist"),
      buildCandidate("3", "Other Artist")
    ];

    expect(selectRadioAutopilotCandidates(snapshot, candidates, 1)).toEqual([candidates[0]]);
  });
});

function buildCandidate(providerTrackId: string, artist: string): NeteaseTrackCandidate {
  return {
    provider: "netease",
    providerTrackId,
    access: "free",
    quality: "exhigh",
    title: `Song ${providerTrackId}`,
    artist,
    album: "Album",
    durationMs: 180_000,
    artworkUrl: null
  };
}
