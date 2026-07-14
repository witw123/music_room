import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCurrentTrackStatus, getPlaybackStatus } from "./MembersPanel";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";

describe("MembersPanel WebRTC media status", () => {
  it("reports the actual current media track", () => {
    expect(getCurrentTrackStatus({
      memberId: "member_1",
      mediaTrackState: "live",
      mediaReceiveBitrateKbps: 192,
      mediaSendBitrateKbps: null,
      mediaJitterMs: 3,
      mediaPacketLossRate: 0
    }, "online")).toMatchObject({
      label: "Media track 实时",
      tone: "success"
    });
  });

  it("does not claim remote sound output from transport diagnostics", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.dataChannelState = "open";

    diagnostic.mediaReceiveBitrateKbps = 192;
    expect(getPlaybackStatus("online", diagnostic)).toMatchObject({
      label: "Media track 实时",
      detail: "本端已观测到 WebRTC RTP Opus 音频流。"
    });
  });

  it("renders bitrate and excludes removed playback models", () => {
    const source = readFileSync(new URL("./MembersPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("playbackBitrateKbps");
    expect(source).not.toContain("PCM");
    expect(source).not.toContain("full-local");
    expect(source).not.toContain("完整本地缓存");
    expect(source).not.toContain("缓存播放链路");
    expect(source).not.toContain("预估满曲");
    expect(source).not.toContain("尚未建立");
  });
});
