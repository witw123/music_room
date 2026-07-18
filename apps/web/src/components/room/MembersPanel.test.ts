import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMemberAudibleStatus, getPlaybackStatus, resolveMemberMediaRates } from "./MembersPanel";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";

describe("MembersPanel WebRTC media status", () => {
  it("shows the local member as speaking only while local playback is audible", () => {
    const audible = getMemberAudibleStatus({
      presenceState: "online",
      playbackActive: true,
      isLocal: true,
      localMemberState: {
        memberId: "member_1",
        audible: true,
        playbackStatus: { label: "正常出声", detail: "", tone: "success", badgeText: "RTP Opus" }
      },
      diagnostic: undefined
    });
    expect(audible).toMatchObject({ label: "正在发声", active: true });
  });

  it("uses a fresh remote self-report for the speaking indicator", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.reportedAudible = true;
    diagnostic.reportedAudibleAt = new Date().toISOString();

    expect(getMemberAudibleStatus({
      presenceState: "online",
      playbackActive: true,
      isLocal: false,
      localMemberState: null,
      diagnostic,
      now: Date.now()
    })).toMatchObject({ label: "正在发声", active: true });
  });

  it("does not claim a stale remote member is speaking", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.reportedAudible = true;
    diagnostic.reportedAudibleAt = new Date(Date.now() - 7_000).toISOString();

    expect(getMemberAudibleStatus({
      presenceState: "online",
      playbackActive: true,
      isLocal: false,
      localMemberState: null,
      diagnostic,
      now: Date.now()
    })).toMatchObject({ label: "等待音频", active: false });
  });

  it("keeps an unknown remote audio state from being reported as silent", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.reportedAudible = null;
    diagnostic.reportedAudibleAt = new Date().toISOString();

    expect(getMemberAudibleStatus({
      presenceState: "online",
      playbackActive: true,
      isLocal: false,
      localMemberState: null,
      diagnostic,
      now: Date.now()
    })).toMatchObject({ label: "等待音频", active: false });
  });

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

  it("prefers self-reported rates for remote members", () => {
    const source = readFileSync(new URL("./MembersPanel.tsx", import.meta.url), "utf8");
    expect(source).toContain("reportedSendRateKbps");
    expect(source).toContain("reportedReceiveRateKbps");
    expect(source).toContain("resolveMemberMediaRates");
  });

  it("uses only remote self-reported aggregates for member rates", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.mediaSendBitrateKbps = 999;
    diagnostic.mediaReceiveBitrateKbps = 888;
    diagnostic.reportedSendRateKbps = 192;
    diagnostic.reportedReceiveRateKbps = 12;
    diagnostic.reportedTelemetryAt = new Date().toISOString();

    const rates = resolveMemberMediaRates({
      diagnostic,
      isLocal: false,
      localMemberState: null
    });
    expect(rates).toMatchObject({
      sendRateKbps: 192,
      receiveRateKbps: 12
    });
  });

  it("hides stale remote reported rates", () => {
    const diagnostic = createPeerSnapshot("peer_1", new Date().toISOString());
    diagnostic.reportedSendRateKbps = 192;
    diagnostic.reportedReceiveRateKbps = 12;
    diagnostic.reportedTelemetryAt = new Date(Date.now() - 10_000).toISOString();

    const rates = resolveMemberMediaRates({
      diagnostic,
      isLocal: false,
      localMemberState: null,
      now: Date.now()
    });
    expect(rates).toMatchObject({
      sendRateKbps: null,
      receiveRateKbps: null
    });
  });
});
