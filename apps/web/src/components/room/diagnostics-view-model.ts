import type { PeerDiagnosticsSnapshot, RoomMember } from "@music-room/shared";
import { formatTransferRateMBps } from "@/lib/music-room-ui";

type ProgressiveStatus = NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

export type DiagnosticsPlaybackInput = Pick<
  ProgressiveStatus,
  | "activeSource"
  | "engineType"
  | "aheadBufferedMs"
  | "fallbackReason"
  | "fullLocalReady"
  | "progressiveLocalBlockedReason"
  | "localAudioPaused"
  | "localAudioMuted"
  | "localAudioVolume"
  | "localAudioReadyState"
  | "localAudioCurrentSrc"
  | "localAudioHasSrcObject"
  | "fullLocalPlaybackMode"
  | "pcmEngineStatus"
  | "pcmAudioContextState"
  | "pcmDirectOutputConnected"
  | "pcmContiguousChunkCount"
  | "pcmBufferedAheadMs"
  | "pcmDecodedSegmentCount"
  | "pcmScheduledSegmentCount"
  | "pcmLastDecodeError"
  | "pcmLastBlockedReason"
  | "serverClockOffsetMs"
  | "serverClockRoundTripMs"
  | "averageDriftMs"
  | "maxDriftMs"
  | "lastPlayStartFailure"
  | "lastSourceStartError"
  | "pendingPlaybackIntent"
>;

export type DiagnosticTone = "neutral" | "success" | "warning" | "danger";

export type DiagnosticsViewModelInput = {
  presenceState?: RoomMember["presenceState"];
  playback?: DiagnosticsPlaybackInput | null;
  playbackSampleAgeMs?: number | null;
  currentTrack?: {
    visibleChunks: number;
    totalChunks: number;
  } | null;
  transfer?: {
    downloadRateKbps: number | null;
    uploadRateKbps: number | null;
    sampleAgeMs: number | null;
  } | null;
  dataLink?: {
    openCount: number;
    connectedPeerCount: number;
  } | null;
};

export type DiagnosticsViewModel = {
  audibility: { label: string; detail: string; tone: DiagnosticTone };
  playbackMode: string;
  cache: {
    visibleChunks: number;
    totalChunks: number;
    pcmContiguousChunks: number | null;
    progressLabel: string;
    aheadLabel: string;
    healthLabel: string;
    tone: DiagnosticTone;
  };
  sync: { label: string; detail: string; tone: DiagnosticTone };
  transfer: {
    active: boolean;
    downloadLabel: string;
    uploadLabel: string;
    sampleLabel: string;
  };
  dataLink: {
    openCount: number;
    label: string;
    detail: string;
    tone: DiagnosticTone;
  };
  activeIssue: string | null;
};

const diagnosticFreshnessMs = 6_000;
const audibleSyncToleranceMs = 40;
const audibleHardSyncMs = 450;

function isFresh(sampleAgeMs: number | null | undefined) {
  return typeof sampleAgeMs === "number" && sampleAgeMs <= diagnosticFreshnessMs;
}

function formatDurationMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "暂无有效样本";
  }
  return Math.abs(value) < 1_000
    ? `${Math.round(value)}ms`
    : `${(value / 1_000).toFixed(1)}s`;
}

function formatRate(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "暂无有效样本";
  }
  return formatTransferRateMBps(value, "暂无有效样本");
}

function hasAudiblePcmOutput(playback: DiagnosticsPlaybackInput) {
  const hasPcm =
    playback.engineType === "pcm" &&
    playback.pcmAudioContextState === "running" &&
    (playback.pcmDecodedSegmentCount ?? 0) > 0 &&
    (playback.pcmScheduledSegmentCount ?? 0) > 0;
  const hasElementOutput =
    playback.localAudioHasSrcObject === true &&
    playback.localAudioPaused === false &&
    playback.localAudioMuted !== true &&
    playback.localAudioVolume !== 0;
  return hasPcm && (playback.pcmDirectOutputConnected === true || hasElementOutput);
}

function hasAudibleFullLocalOutput(playback: DiagnosticsPlaybackInput) {
  const nativeBlobReady =
    playback.fullLocalPlaybackMode === "native-blob" &&
    !!playback.localAudioCurrentSrc &&
    (playback.localAudioReadyState ?? 0) >= 2;
  const elementAudible =
    playback.localAudioPaused === false &&
    playback.localAudioMuted !== true &&
    playback.localAudioVolume !== 0;
  return (
    (nativeBlobReady && elementAudible) ||
    (playback.fullLocalReady === true &&
      (nativeBlobReady || playback.localAudioPaused === false))
  );
}

function getPlaybackMode(playback: DiagnosticsPlaybackInput | null) {
  switch (playback?.activeSource) {
    case "lossless-local":
      return "边缓存无损";
    case "full-local":
      return "完整本地缓存";
    case "progressive-local":
      return "渐进缓存";
    default:
      return "尚未建立";
  }
}

function getActiveIssue(playback: DiagnosticsPlaybackInput | null, hasAudibleOutput: boolean) {
  if (!playback || hasAudibleOutput) {
    return null;
  }
  if (playback.lastPlayStartFailure) {
    return `音频启动失败：${playback.lastPlayStartFailure}`;
  }
  if (playback.lastSourceStartError) {
    return `音源启动失败：${playback.lastSourceStartError}`;
  }
  if (playback.pendingPlaybackIntent) {
    return "浏览器尚未允许音频输出，请再次点击播放。";
  }
  if (playback.pcmLastDecodeError) {
    return `PCM 解码失败：${playback.pcmLastDecodeError}`;
  }
  if (playback.pcmLastBlockedReason) {
    return `PCM 等待：${playback.pcmLastBlockedReason}`;
  }
  return playback.fallbackReason ?? playback.progressiveLocalBlockedReason ?? null;
}

function buildAudibility(
  presenceState: RoomMember["presenceState"] | undefined,
  playback: DiagnosticsPlaybackInput | null,
  hasAudibleOutput: boolean,
  activeIssue: string | null
) {
  if (presenceState === "offline") {
    return { label: "已离线", detail: "当前不参与播放。", tone: "neutral" as const };
  }
  if (presenceState === "reconnecting") {
    return { label: "链路重连中", detail: "正在恢复房间数据链路。", tone: "warning" as const };
  }
  if (hasAudibleOutput) {
    return { label: "正在发声", detail: "当前输出链路已有可调度音频。", tone: "success" as const };
  }
  if (playback?.pendingPlaybackIntent) {
    return { label: "等待音频授权", detail: activeIssue ?? "等待浏览器允许音频输出。", tone: "warning" as const };
  }
  if (playback?.lastPlayStartFailure || playback?.lastSourceStartError || playback?.pcmLastDecodeError) {
    return { label: "播放失败", detail: activeIssue ?? "音频输出失败。", tone: "danger" as const };
  }
  if (playback?.activeSource === "lossless-local" || playback?.engineType === "pcm") {
    return { label: "等待 PCM 数据", detail: activeIssue ?? "尚未形成可调度的连续 PCM。", tone: "warning" as const };
  }
  if (playback?.localAudioPaused === true) {
    return { label: "已暂停", detail: "当前播放已暂停。", tone: "neutral" as const };
  }
  return { label: "尚未建立", detail: activeIssue ?? "尚未建立可听播放链路。", tone: "neutral" as const };
}

function buildCache(
  playback: DiagnosticsPlaybackInput | null,
  currentTrack: DiagnosticsViewModelInput["currentTrack"]
) {
  const visibleChunks = Math.max(0, currentTrack?.visibleChunks ?? 0);
  const totalChunks = Math.max(0, currentTrack?.totalChunks ?? 0);
  const pcmContiguousChunks = playback?.pcmContiguousChunkCount ?? null;
  const complete = totalChunks > 0 && visibleChunks >= totalChunks;
  const progressLabel = complete
    ? pcmContiguousChunks === 0
      ? "已声明完整分片 · PCM 尚未读取"
      : "已声明完整分片"
    : totalChunks > 0
      ? `可见分片 ${visibleChunks}/${totalChunks}`
      : "暂无分片声明";
  const aheadMs = playback?.pcmBufferedAheadMs ?? playback?.aheadBufferedMs ?? null;
  const health =
    typeof aheadMs !== "number" || aheadMs <= 0
      ? { label: "等待可播放缓冲", tone: "warning" as const }
      : aheadMs < 3_000
        ? { label: "缓冲偏低", tone: "warning" as const }
        : { label: "缓冲稳定", tone: "success" as const };

  return {
    visibleChunks,
    totalChunks,
    pcmContiguousChunks,
    progressLabel,
    aheadLabel: formatDurationMs(aheadMs),
    healthLabel: health.label,
    tone: health.tone
  };
}

function buildSync(
  playback: DiagnosticsPlaybackInput | null,
  sampleAgeMs: number | null | undefined
) {
  const averageDriftMs = playback?.averageDriftMs;
  const maxDriftMs = playback?.maxDriftMs;
  if (
    !playback?.activeSource ||
    !isFresh(sampleAgeMs) ||
    typeof averageDriftMs !== "number" ||
    typeof maxDriftMs !== "number"
  ) {
    return {
      label: "暂无有效样本",
      detail: "尚无新鲜的播放漂移样本。",
      tone: "neutral" as const
    };
  }

  const observedDriftMs = Math.max(Math.abs(averageDriftMs), Math.abs(maxDriftMs));
  if (observedDriftMs <= audibleSyncToleranceMs) {
    return {
      label: "同步正常",
      detail: `最大漂移 ${Math.round(observedDriftMs)}ms`,
      tone: "success" as const
    };
  }
  if (observedDriftMs < audibleHardSyncMs) {
    return {
      label: "同步偏差较大",
      detail: `最大漂移 ${Math.round(observedDriftMs)}ms`,
      tone: "warning" as const
    };
  }
  return {
    label: "同步严重偏差",
    detail: `最大漂移 ${Math.round(observedDriftMs)}ms`,
    tone: "danger" as const
  };
}

function buildTransfer(transfer: DiagnosticsViewModelInput["transfer"]) {
  const fresh = isFresh(transfer?.sampleAgeMs);
  const download = fresh ? transfer?.downloadRateKbps : null;
  const upload = fresh ? transfer?.uploadRateKbps : null;
  const active = (download ?? 0) > 0 || (upload ?? 0) > 0;
  return {
    active,
    downloadLabel: formatRate(download),
    uploadLabel: formatRate(upload),
    sampleLabel: fresh ? "实时" : "暂无有效样本"
  };
}

function buildDataLink(dataLink: DiagnosticsViewModelInput["dataLink"]) {
  const openCount = Math.max(0, dataLink?.openCount ?? 0);
  if (openCount > 0) {
    return {
      openCount,
      label: `${openCount} 条数据通道已就绪`,
      detail: "可进行分片收发。",
      tone: "success" as const
    };
  }
  return {
    openCount,
    label: "数据通道未就绪",
    detail: dataLink?.connectedPeerCount
      ? `已有 ${dataLink.connectedPeerCount} 个连接，但没有打开的 DataChannel。`
      : "当前没有可用的数据通道。",
    tone: "warning" as const
  };
}

export function buildDiagnosticsViewModel(
  input: DiagnosticsViewModelInput
): DiagnosticsViewModel {
  const playback = input.playback ?? null;
  const hasAudibleOutput = playback
    ? playback.activeSource === "full-local"
      ? hasAudibleFullLocalOutput(playback)
      : hasAudiblePcmOutput(playback)
    : false;
  const activeIssue = getActiveIssue(playback, hasAudibleOutput);

  return {
    audibility: buildAudibility(
      input.presenceState,
      playback,
      hasAudibleOutput,
      activeIssue
    ),
    playbackMode: getPlaybackMode(playback),
    cache: buildCache(playback, input.currentTrack),
    sync: buildSync(playback, input.playbackSampleAgeMs),
    transfer: buildTransfer(input.transfer),
    dataLink: buildDataLink(input.dataLink),
    activeIssue
  };
}
