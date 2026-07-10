import { describe, expect, it } from "vitest";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import { getCurrentTrackStatus, getPlaybackStatus } from "./MembersPanel";

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
      label: "正在发声",
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
      label: "正在发声",
      tone: "success"
    });
  });

  it("treats playing full-local playback as audible even if src diagnostics lag", () => {
    const diagnostics = createPeerSnapshot("peer_1", "2026-07-04T00:00:00.000Z");
    diagnostics.progressivePlaybackStatus = {
      ...diagnostics.progressivePlaybackStatus!,
      activeSource: "full-local",
      engineType: "pcm",
      fullLocalReady: true,
      fullLocalPlaybackMode: "none",
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 0,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: false,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmDirectOutputConnected: null
    };

    expect(getPlaybackStatus("online", diagnostics)).toMatchObject({
      label: "正在发声",
      tone: "success"
    });
  });

  it("treats PCM media-stream output as audible without direct output", () => {
    const diagnostics = createPeerSnapshot("peer_1", "2026-07-04T00:00:00.000Z");
    diagnostics.progressivePlaybackStatus = {
      ...diagnostics.progressivePlaybackStatus!,
      activeSource: "lossless-local",
      engineType: "pcm",
      startupReady: true,
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 0,
      localAudioHasSrcObject: true,
      pcmAudioContextState: "running",
      pcmDecodedSegmentCount: 2,
      pcmScheduledSegmentCount: 1,
      pcmDirectOutputConnected: false
    };

    expect(getPlaybackStatus("online", diagnostics)).toMatchObject({
      label: "正在发声",
      tone: "success"
    });
  });

  it("does not report a zero-rate data sample as active piece transfer", () => {
    const now = Date.now();
    const diagnostics = createPeerSnapshot("peer_1", new Date(now).toISOString());
    diagnostics.dataChannelState = "open";
    diagnostics.pieceDownloadRateKbps = 0;
    diagnostics.pieceUploadRateKbps = 0;

    expect(getPlaybackStatus("online", diagnostics, now)).toMatchObject({
      label: "数据通道就绪"
    });
  });

  it("describes complete announcements without claiming PCM readability", () => {
    expect(
      getCurrentTrackStatus(
        {
          memberId: "member_1",
          announcedTrackCount: 1,
          totalChunkCount: 262,
          currentTrackChunkCount: 262,
          currentTrackTotalChunks: 262,
          currentTrackSources: ["local_cache"]
        },
        "online"
      )
    ).toMatchObject({
      label: "已声明完整分片",
      detail: "房间可见全部分片；是否可播放以 PCM 连续读取状态为准。"
    });
  });
});
