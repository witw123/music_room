import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getPlaybackStatus } from "./MembersPanel";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";

describe("MembersPanel WebRTC media status", () => {
  it("reports the actual current media track", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.mediaConnectionState = "connected";
    diagnostic.mediaReceiveBitrateKbps = 192;
    diagnostic.lastMediaStatsProgressAt = new Date().toISOString();

    expect(getPlaybackStatus("online", diagnostic, {
      playbackActive: true,
      isCurrentSource: true
    })).toMatchObject({
      label: "正常出声",
      tone: "success"
    });
  });

  it("does not claim remote sound output from transport diagnostics", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.dataChannelState = "open";

    diagnostic.mediaReceiveBitrateKbps = 192;
    diagnostic.lastMediaStatsProgressAt = new Date().toISOString();
    expect(getPlaybackStatus("online", diagnostic)).toMatchObject({
      label: "正常出声",
      detail: ""
    });
  });

  it("does not expect a remote non-source member to receive the room track", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.dataChannelState = "open";
    diagnostic.mediaConnectionState = "connected";
    diagnostic.mediaSendBitrateKbps = 184;
    diagnostic.lastMediaStatsProgressAt = new Date().toISOString();

    expect(getPlaybackStatus("online", diagnostic, {
      playbackActive: true,
      isCurrentSource: false
    })).toMatchObject({
      label: "连接正常",
      tone: "accent",
      badgeText: "连接正常"
    });
  });

  it("shows missing media data for the current source connection", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.mediaConnectionState = "connected";

    expect(getPlaybackStatus("online", diagnostic, {
      playbackActive: true,
      isCurrentSource: true
    })).toMatchObject({
      label: "音频准备中",
      tone: "warning"
    });
  });

  it("keeps the member view on the live RTP model", () => {
    const source = readFileSync(new URL("./MembersPanel.tsx", import.meta.url), "utf8");

    expect(source).toContain("mediaSummary");
    expect(source).not.toContain("playbackBitrateKbps");
    expect(source).not.toContain("transportSummary");
    expect(source).not.toContain("PCM");
    expect(source).not.toContain("legacy playback source");
    expect(source).not.toContain("完整本地缓存");
    expect(source).not.toContain("缓存播放链路");
    expect(source).not.toContain("预估满曲");
    expect(source).not.toContain("尚未建立");
  });
});
