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
  availableChunks: number;
  totalChunks: number;
  isPreferredSource?: boolean;
};

export type WanLinkScoreInput = {
  /** Local observation of the peer path (or aggregate for local member). */
  candidateType?: string | null;
  protocol?: string | null;
  relayProtocol?: string | null;
  rttMs?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  dataChannelState?: string | null;
  bufferedAmountBytes?: number | null;
  /** Current-track cache providers visible to this client. */
  providers?: WanProviderSummary[];
  /** Remaining bytes for the active track fill estimate. */
  remainingBytes?: number | null;
  /** Owned contiguous / visible chunk progress for the active track. */
  ownedChunks?: number | null;
  totalChunks?: number | null;
  chunkSizeBytes?: number | null;
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
    fillEtaLabel: string;
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

export function estimateTrackFillEtaSeconds(input: {
  remainingBytes?: number | null;
  downloadRateKbps?: number | null;
}) {
  const remainingBytes = finitePositive(input.remainingBytes);
  const downloadRateKbps = finitePositive(input.downloadRateKbps);
  if (!remainingBytes || !downloadRateKbps) {
    return null;
  }
  const bytesPerSecond = (downloadRateKbps * 1000) / 8;
  if (bytesPerSecond <= 0) {
    return null;
  }
  return remainingBytes / bytesPerSecond;
}

export function formatEtaSeconds(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "无法估计";
  }
  if (seconds < 5) {
    return "即将完成";
  }
  if (seconds < 60) {
    return `约 ${Math.ceil(seconds)} 秒`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.ceil(seconds % 60);
    return rest > 0 ? `约 ${minutes} 分 ${rest} 秒` : `约 ${minutes} 分钟`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes > 0 ? `约 ${hours} 小时 ${minutes} 分` : `约 ${hours} 小时`;
}

function scoreFromProfile(profile: PeerLinkProfile) {
  switch (profile) {
    case "fast-direct":
      return 34;
    case "standard-direct":
      return 28;
    case "relay-udp":
      return 18;
    case "constrained":
      return 8;
    case "severe":
      return 0;
    default:
      return 12;
  }
}

function scoreFromRtt(rttMs: number | null) {
  if (rttMs === null) {
    return 8;
  }
  if (rttMs <= 40) return 22;
  if (rttMs <= 80) return 20;
  if (rttMs <= 120) return 16;
  if (rttMs <= 200) return 12;
  if (rttMs <= 320) return 8;
  if (rttMs <= 500) return 4;
  return 0;
}

function scoreFromThroughput(downloadRateKbps: number | null) {
  if (downloadRateKbps === null) {
    return 8;
  }
  // 24 Mbps (~3 MB/s) is the documented comfort target for large tracks.
  if (downloadRateKbps >= 24_000) return 28;
  if (downloadRateKbps >= 12_000) return 24;
  if (downloadRateKbps >= 6_000) return 20;
  if (downloadRateKbps >= 3_000) return 15;
  if (downloadRateKbps >= 1_500) return 10;
  if (downloadRateKbps >= 800) return 6;
  return 2;
}

function scoreFromProviders(providerCount: number, fullProviderCount: number) {
  if (providerCount <= 0) {
    return 0;
  }
  let score = Math.min(12, providerCount * 4);
  if (fullProviderCount >= 2) {
    score += 6;
  } else if (fullProviderCount === 1) {
    score += 3;
  }
  return Math.min(18, score);
}

function gradeFromScore(score: number): WanLinkScore["grade"] {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

function toneFromGrade(grade: WanLinkScore["grade"]): WanLinkTone {
  switch (grade) {
    case "A":
      return "success";
    case "B":
      return "accent";
    case "C":
      return "warning";
    case "D":
      return "warning";
    case "F":
      return "danger";
  }
}

export function buildWanLinkScore(input: WanLinkScoreInput): WanLinkScore {
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
  const fullProviderCount = providers.filter(
    (provider) =>
      provider.totalChunks > 0 && provider.availableChunks >= provider.totalChunks
  ).length;

  const totalChunks = finitePositive(input.totalChunks);
  const ownedChunks = Math.max(0, input.ownedChunks ?? 0);
  const chunkSizeBytes = finitePositive(input.chunkSizeBytes) ?? 256 * 1024;
  const remainingChunks =
    totalChunks !== null ? Math.max(0, totalChunks - ownedChunks) : null;
  const remainingBytes =
    finitePositive(input.remainingBytes) ??
    (remainingChunks !== null ? remainingChunks * chunkSizeBytes : null);
  const etaSeconds = estimateTrackFillEtaSeconds({
    remainingBytes,
    downloadRateKbps
  });

  let score =
    scoreFromProfile(profile) +
    scoreFromRtt(rttMs) +
    scoreFromThroughput(downloadRateKbps) +
    scoreFromProviders(providerCount, fullProviderCount);

  if (input.dataChannelState && input.dataChannelState !== "open") {
    score -= 25;
  }
  if (input.transportScore === "failed") {
    score -= 30;
  } else if (input.transportScore === "unstable") {
    score -= 18;
  } else if (input.transportScore === "degraded") {
    score -= 10;
  }
  if ((input.bufferedAmountBytes ?? 0) >= 4 * 1024 * 1024) {
    score -= 8;
  }

  score = clamp(Math.round(score), 0, 100);
  const grade = gradeFromScore(score);
  const tone = toneFromGrade(grade);
  const pathLabel = resolveWanPathLabel({
    candidateType: input.candidateType,
    protocol: input.protocol,
    relayProtocol: input.relayProtocol,
    profile
  });

  const tips: string[] = [];
  if (profile === "relay-udp") {
    tips.push("当前走 TURN UDP 中继，吞吐通常低于直连；优先保证源端上行与 TURN 端口开放。");
  }
  if (profile === "constrained" || profile === "severe") {
    tips.push("链路被判为受限/严重降级，调度会保守限流以保护当前播放。");
  }
  if (rttMs !== null && rttMs >= 250) {
    tips.push(`RTT ${Math.round(rttMs)}ms 偏高，分片管道效率会下降。`);
  }
  if (downloadRateKbps !== null && downloadRateKbps < 3_000) {
    tips.push("分片下载低于约 0.4MB/s，大体积 FLAC 容易出现 pcm-buffer-missing。");
  }
  if (providerCount <= 1) {
    tips.push("当前曲目几乎只有单一供片源，建议让更多成员完成缓存后再分流。");
  } else if (fullProviderCount >= 2) {
    tips.push(`已有 ${fullProviderCount} 个完整缓存源，调度会优先更快的多 provider。`);
  }
  if (etaSeconds !== null && etaSeconds > 180) {
    tips.push("按当前速率估算满曲缓存仍需数分钟，听感上会长时间边缓冲边追进度。");
  }
  if (tips.length === 0) {
    tips.push("链路指标健康，可支撑当前曲目的边缓存播放与补齐。");
  }

  const summary =
    grade === "A" || grade === "B"
      ? `外网评分 ${score}（${grade}）：${pathLabel}，适合稳定缓存播放。`
      : grade === "C"
        ? `外网评分 ${score}（${grade}）：${pathLabel}，可连通但吞吐一般。`
        : `外网评分 ${score}（${grade}）：${pathLabel}，稳定性/速度受限。`;

  return {
    score,
    grade,
    tone,
    profile,
    pathLabel,
    summary,
    metrics: {
      rttLabel: rttMs === null ? "未知" : `${Math.round(rttMs)}ms`,
      downloadLabel:
        downloadRateKbps === null ? "未知" : formatTransferRateMBps(downloadRateKbps),
      uploadLabel:
        uploadRateKbps === null ? "未知" : formatTransferRateMBps(uploadRateKbps),
      providerLabel:
        providerCount <= 0
          ? "0 个供片源"
          : `${providerCount} 个供片源 · ${fullProviderCount} 个完整`,
      fillEtaLabel: formatEtaSeconds(etaSeconds)
    },
    tips
  };
}

export function buildWanLinkScoreFromPeerDiagnostic(input: {
  diagnostic?: PeerDiagnosticsSnapshot | null;
  providers?: WanProviderSummary[];
  ownedChunks?: number | null;
  totalChunks?: number | null;
  chunkSizeBytes?: number | null;
  remainingBytes?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  rttMs?: number | null;
}): WanLinkScore {
  const diagnostic = input.diagnostic ?? null;
  return buildWanLinkScore({
    candidateType: diagnostic?.dataCandidateType ?? diagnostic?.dataRemoteCandidateType ?? null,
    protocol: diagnostic?.dataProtocol ?? null,
    relayProtocol: diagnostic?.dataRelayProtocol ?? null,
    rttMs: input.rttMs ?? diagnostic?.currentRoundTripTimeMs ?? null,
    downloadRateKbps:
      input.downloadRateKbps ?? diagnostic?.pieceDownloadRateKbps ?? null,
    uploadRateKbps: input.uploadRateKbps ?? diagnostic?.pieceUploadRateKbps ?? null,
    transportScore: diagnostic?.transportScore ?? null,
    dataChannelState: diagnostic?.dataChannelState ?? null,
    bufferedAmountBytes: diagnostic?.dataBufferedAmountBytes ?? null,
    providers: input.providers,
    remainingBytes: input.remainingBytes,
    ownedChunks: input.ownedChunks,
    totalChunks: input.totalChunks,
    chunkSizeBytes: input.chunkSizeBytes
  });
}
