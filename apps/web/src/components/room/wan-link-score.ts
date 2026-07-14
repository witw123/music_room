import type { PeerDiagnosticsSnapshot } from "@music-room/shared";
import {
  resolvePeerLinkProfile,
  type PeerLinkProfile,
  type PeerLinkProfileInput
} from "@/features/p2p/peer-link-profile";
import { formatTransferRateMBps } from "@/lib/music-room-ui";

export type WanLinkTone = "neutral" | "success" | "warning" | "danger" | "accent";

export type WanProviderSummary = {
  peerId: string;
  nickname?: string | null;
  availableUnits: number;
  totalUnits: number;
  isPreferredSource?: boolean;
};

export type WanLinkScoreInput = {
  candidateType?: string | null;
  protocol?: string | null;
  relayProtocol?: string | null;
  rttMs?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  playbackBitrateKbps?: number | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  dataChannelState?: string | null;
  bufferedAmountBytes?: number | null;
  providers?: WanProviderSummary[];
};

export type WanLinkScore = {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  tone: WanLinkTone;
  profile: PeerLinkProfile;
  pathLabel: string;
  summary: string;
  metrics: {
    rttLabel: string;
    downloadLabel: string;
    uploadLabel: string;
    providerLabel: string;
    audioBitrateLabel: string;
    headroomLabel: string;
  };
  tips: string[];
};

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resolveWanPathLabel(input: {
  candidateType?: string | null;
  protocol?: string | null;
  relayProtocol?: string | null;
  profile: PeerLinkProfile;
}) {
  const candidate = input.candidateType?.trim() || "unknown";
  const protocol =
    input.relayProtocol?.trim() ||
    input.protocol?.trim() ||
    (input.profile === "relay-udp" ? "udp" : "unknown");
  const kind =
    input.profile === "relay-udp" || candidate === "relay"
      ? "中继"
      : candidate === "host"
        ? "直连·host"
        : candidate === "srflx"
          ? "直连·srflx"
          : candidate === "prflx"
            ? "直连·prflx"
            : "直连";
  return `${kind} (${candidate}/${protocol})`;
}

function scoreFromProfile(profile: PeerLinkProfile) {
  switch (profile) {
    case "fast-direct": return 34;
    case "standard-direct": return 28;
    case "relay-udp": return 18;
    case "constrained": return 8;
    case "severe": return 0;
  }
}

function scoreFromRtt(rttMs: number | null) {
  if (rttMs === null) return 8;
  if (rttMs <= 40) return 22;
  if (rttMs <= 80) return 20;
  if (rttMs <= 120) return 16;
  if (rttMs <= 200) return 12;
  if (rttMs <= 320) return 8;
  if (rttMs <= 500) return 4;
  return 0;
}

function scoreFromThroughput(downloadRateKbps: number | null, playbackBitrateKbps: number | null) {
  if (downloadRateKbps === null || playbackBitrateKbps === null) return 8;
  const ratio = downloadRateKbps / playbackBitrateKbps;
  if (ratio >= 8) return 28;
  if (ratio >= 4) return 24;
  if (ratio >= 2) return 20;
  if (ratio >= 1.25) return 15;
  if (ratio >= 1) return 10;
  if (ratio >= 0.75) return 6;
  return 2;
}

function scoreFromProviders(providerCount: number) {
  return Math.min(18, Math.max(0, providerCount) * 6);
}

function gradeFromScore(score: number): WanLinkScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function toneFromGrade(grade: WanLinkScore["grade"]): WanLinkTone {
  if (grade === "A") return "success";
  if (grade === "B") return "accent";
  if (grade === "C" || grade === "D") return "warning";
  return "danger";
}

export function buildWanLinkScore(input: WanLinkScoreInput): WanLinkScore {
  const playbackBitrateKbps = finitePositive(input.playbackBitrateKbps);
  const profileInput: PeerLinkProfileInput = {
    candidateType: input.candidateType,
    protocol: input.protocol,
    relayProtocol: input.relayProtocol,
    currentRoundTripTimeMs: input.rttMs,
    downloadRateKbps: input.downloadRateKbps,
    uploadRateKbps: input.uploadRateKbps,
    transportScore: input.transportScore,
    bufferedAmountBytes: input.bufferedAmountBytes
  };
  const profile = resolvePeerLinkProfile(profileInput);
  const rttMs = finitePositive(input.rttMs);
  const downloadRateKbps = finitePositive(input.downloadRateKbps);
  const uploadRateKbps = finitePositive(input.uploadRateKbps);
  const providers = input.providers ?? [];
  const providerCount = providers.length;
  const throughputRatio =
    downloadRateKbps === null || playbackBitrateKbps === null
      ? null
      : downloadRateKbps / playbackBitrateKbps;

  let score =
    scoreFromProfile(profile) +
    scoreFromRtt(rttMs) +
    scoreFromThroughput(downloadRateKbps, playbackBitrateKbps) +
    scoreFromProviders(providerCount);
  if (input.dataChannelState && input.dataChannelState !== "open") score -= 25;
  if (input.transportScore === "failed") score -= 30;
  else if (input.transportScore === "unstable") score -= 18;
  else if (input.transportScore === "degraded") score -= 10;
  if ((input.bufferedAmountBytes ?? 0) >= 4 * 1024 * 1024) score -= 8;

  score = clamp(Math.round(score), 0, 100);
  const grade = gradeFromScore(score);
  const pathLabel = resolveWanPathLabel({
    candidateType: input.candidateType,
    protocol: input.protocol,
    relayProtocol: input.relayProtocol,
    profile
  });
  const tips: string[] = [];
  if (profile === "relay-udp") {
    tips.push("当前走 TURN UDP 中继；播放音频使用单向 RTP Opus 媒体轨道。");
  }
  if (profile === "constrained" || profile === "severe") {
    tips.push("链路被判为受限，RTP Opus 可能出现抖动或短暂重连。");
  }
  if (rttMs !== null && rttMs >= 250) {
    tips.push(`RTT ${Math.round(rttMs)}ms 偏高，拖动进度后的媒体恢复会更慢。`);
  }
  if (throughputRatio !== null && throughputRatio < 1.25) {
    tips.push(`当前媒体接收带宽只有音频码率的 ${throughputRatio.toFixed(1)} 倍，余量偏低。`);
  }
  if (providerCount === 0) {
    tips.push("当前没有收到有效的 RTP Opus 媒体轨道。");
  } else if (providerCount === 1) {
    tips.push("当前只有一个媒体源，源端离线时会中断播放。");
  }
  if (tips.length === 0) {
    tips.push("当前带宽高于音频码率，单向 RTP Opus 媒体轨道可稳定播放。");
  }

  const summary =
    grade === "A" || grade === "B"
      ? `外网评分 ${score}（${grade}）：可稳定承载当前 RTP Opus 音频。`
      : grade === "C"
        ? `外网评分 ${score}（${grade}）：可播放，但跳转后的媒体恢复可能波动。`
        : `外网评分 ${score}（${grade}）：实时音频余量不足或链路状态受限。`;

  return {
    score,
    grade,
    tone: toneFromGrade(grade),
    profile,
    pathLabel,
    summary,
    metrics: {
      rttLabel: rttMs === null ? "未知" : `${Math.round(rttMs)}ms`,
      downloadLabel: downloadRateKbps === null ? "未知" : formatTransferRateMBps(downloadRateKbps),
      uploadLabel: uploadRateKbps === null ? "未知" : formatTransferRateMBps(uploadRateKbps),
      providerLabel: providerCount <= 0 ? "0 个来源" : `${providerCount} 个来源`,
      audioBitrateLabel: playbackBitrateKbps === null ? "未知" : `${Math.round(playbackBitrateKbps)} kbps`,
      headroomLabel: throughputRatio === null ? "未知" : `${throughputRatio.toFixed(1)}x`
    },
    tips
  };
}

export function buildWanLinkScoreFromPeerDiagnostic(input: {
  diagnostic?: PeerDiagnosticsSnapshot | null;
  providers?: WanProviderSummary[];
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  playbackBitrateKbps?: number | null;
  rttMs?: number | null;
}): WanLinkScore {
  const diagnostic = input.diagnostic ?? null;
  return buildWanLinkScore({
    candidateType: diagnostic?.mediaCandidateType ?? diagnostic?.dataCandidateType ?? diagnostic?.dataRemoteCandidateType ?? null,
    protocol: diagnostic?.mediaProtocol ?? diagnostic?.dataProtocol ?? null,
    relayProtocol: diagnostic?.mediaProtocol ?? diagnostic?.dataRelayProtocol ?? null,
    rttMs: input.rttMs ?? diagnostic?.currentRoundTripTimeMs ?? null,
    downloadRateKbps: input.downloadRateKbps ?? diagnostic?.mediaReceiveBitrateKbps ?? null,
    uploadRateKbps: input.uploadRateKbps ?? diagnostic?.mediaSendBitrateKbps ?? null,
    playbackBitrateKbps: input.playbackBitrateKbps,
    transportScore: diagnostic?.transportScore ?? null,
    dataChannelState: diagnostic?.mediaConnectionState === "connected"
      ? "open"
      : diagnostic?.mediaConnectionState ?? null,
    bufferedAmountBytes: diagnostic?.dataBufferedAmountBytes ?? null,
    providers: input.providers
  });
}
