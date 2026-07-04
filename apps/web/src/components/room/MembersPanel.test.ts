import { describe, expect, it } from "vitest";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import { getPlaybackStatus } from "./MembersPanel";

describe("MembersPanel playback status", () => {
  it("treats native blob full-local playback as audible without PCM output", () => {
    const diagnostics = createPeerSnapshot("peer_1", "2026-07-04T00:00:00.000Z");
    diagnostics.progressivePlaybackStatus = {
      ...diagnostics.progressivePlaybackStatus!,
      activeSource: "full-local",
      engineType: "pcm",
      fullLocalReady: true,
      fullLocalPlaybackMode: "native-blob",
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 4,
      localAudioCurrentSrc: "blob:http://localhost/track",
      localAudioHasSrcObject: false,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmDirectOutputConnected: null
    };

    expect(getPlaybackStatus("online", diagnostics)).toMatchObject({
      label: "完整缓存播放",
      tone: "success"
    });
  });

  it("does not show full-local native blob playback as waiting when the paused flag is stale", () => {
    const diagnostics = createPeerSnapshot("peer_1", "2026-07-04T00:00:00.000Z");
    diagnostics.progressivePlaybackStatus = {
      ...diagnostics.progressivePlaybackStatus!,
      activeSource: "full-local",
      engineType: "pcm",
      fullLocalReady: true,
      fullLocalPlaybackMode: "native-blob",
      localAudioPaused: true,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 4,
      localAudioCurrentSrc: "blob:http://localhost/track",
      localAudioHasSrcObject: false,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmDirectOutputConnected: null
    };

    expect(getPlaybackStatus("online", diagnostics)).toMatchObject({
      label: "完整缓存播放",
      tone: "success"
    });
  });
});
