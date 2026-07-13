import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCurrentTrackStatus, getPlaybackStatus } from "./MembersPanel";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";

describe("MembersPanel v4 playback status", () => {
  it("reports the actual current-track playback units", () => {
    expect(getCurrentTrackStatus({
      memberId: "member_1",
      playbackAssetCount: 1,
      totalPlaybackUnitCount: 8,
      currentTrackOwnedUnitCount: 8,
      currentTrackTotalUnitCount: 160,
      currentTrackSources: ["local_cache"]
    }, "online")).toMatchObject({
      label: "持有 8/160 个单元",
      tone: "accent"
    });
  });

  it("does not claim remote sound output from transport diagnostics", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.dataChannelState = "open";

    expect(getPlaybackStatus("online", diagnostic)).toMatchObject({
      label: "DataChannel 就绪",
      detail: "声音是否正在输出只在该成员本机可确认。"
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
