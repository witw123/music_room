"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, RoomMember } from "@music-room/shared";
import { formatTransferRateMBps } from "@/lib/music-room-ui";
import {
  buildDiagnosticsViewModel,
  type DiagnosticsPlaybackInput
} from "./diagnostics-view-model";

export type MemberTransferSummary = {
  memberId: string;
  announcedTrackCount: number;
  totalChunkCount: number;
  currentTrackChunkCount: number;
  currentTrackTotalChunks: number;
  currentTrackSources: string[];
};

export type LocalMemberPanelState = {
  memberId: string;
  presenceState: RoomMember["presenceState"];
  audioUnlocked: boolean;
  sourceStartState: "idle" | "awaiting-unlock" | "starting" | "live" | "failed";
  lastSourceStartError: string | null;
  transportLabel: string;
  transportSummary: {
    totalRateKbps: number | null;
    receiveRateKbps: number | null;
    sendRateKbps: number | null;
    latencyMs: number | null;
    sampleAgeMs: number | null;
  };
  pieceSummary: {
    downloadRateKbps: number | null;
    uploadRateKbps: number | null;
    sampleAgeMs: number | null;
  };
  cachePlayback: DiagnosticsPlaybackInput | null;
  playbackSampleAgeMs: number | null;
  dataReadyCount: number;
  playbackStatus: {
    label: string;
    detail: string;
    tone: StatusTone;
    badgeText: string;
  };
};

type MembersPanelProps = {
  members: RoomMember[];
  memberTransferSummaries?: MemberTransferSummary[];
  peerDiagnostics?: PeerDiagnosticsSnapshot[];
  localMemberState?: LocalMemberPanelState | null;
};

type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

function getToneClasses(tone: StatusTone) {
  switch (tone) {
    case "success":
      return {
        badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        progress: "bg-emerald-400"
      };
    case "accent":
      return {
        badge: "border-accent/30 bg-accent/10 text-accent",
        progress: "bg-accent"
      };
    case "warning":
      return {
        badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
        progress: "bg-amber-400"
      };
    case "danger":
      return {
        badge: "border-red-500/30 bg-red-500/10 text-red-300",
        progress: "bg-red-400"
      };
    default:
      return {
        badge: "border-surface-border bg-background/60 text-foreground-muted",
        progress: "bg-white/30"
      };
  }
}

function formatCurrentTrackSources(sources: string[]) {
  const labels = [...new Set(sources)]
    .map((source) => {
      if (source === "live_upload") {
        return "原上传源";
      }

      if (source === "local_cache") {
        return "成员缓存";
      }

      return source;
    })
    .filter(Boolean);

  if (labels.length === 0) {
    return null;
  }

  return labels.join(" / ");
}

export function getCurrentTrackStatus(
  summary: MemberTransferSummary | undefined,
  presenceState: RoomMember["presenceState"]
) {
  if (presenceState === "offline") {
    return {
      label: "离线",
      detail: "该成员当前不参与实时播放或房间分片提供。",
      progressPercent: 0,
      tone: "warning" as const
    };
  }

  if (presenceState === "reconnecting") {
    return {
      label: "重连中",
      detail: "连接宽限期内保留成员身份，等待其实时链路恢复。",
      progressPercent: 0,
      tone: "warning" as const
    };
  }

  if (!summary || summary.currentTrackTotalChunks <= 0) {
    return {
      label: summary?.announcedTrackCount ? "未提供当前曲目分片" : "未提供分片",
      detail: summary?.announcedTrackCount
        ? "本地持有其他房间曲目，但当前曲目还没有可供回传的分片。"
        : "当前没有可供回传的当前曲目分片，需要从其他在线缓存源拉取。",
      progressPercent: 0,
      tone: "neutral" as const
    };
  }

  const progressPercent = Math.min(
    100,
    Math.round((summary.currentTrackChunkCount / summary.currentTrackTotalChunks) * 100)
  );

  if (summary.currentTrackChunkCount >= summary.currentTrackTotalChunks) {
    return {
      label: "已声明完整分片",
      detail: "房间可见全部分片；是否可播放以 PCM 连续读取状态为准。",
      progressPercent: 100,
      tone: "success" as const
    };
  }

  if (summary.currentTrackChunkCount > 0) {
    return {
      label: `已提供 ${progressPercent}%`,
      detail: "当前只具备部分分片能力，只用于缓存下载与回传。",
      progressPercent,
      tone: progressPercent >= 50 ? ("accent" as const) : ("neutral" as const)
    };
  }

  return {
    label: "未提供分片",
    detail: "当前没有可供回传的分片内容。",
    progressPercent: 0,
    tone: "neutral" as const
  };
}

export function getPlaybackStatus(
  presenceState: RoomMember["presenceState"],
  peerDiagnostics: PeerDiagnosticsSnapshot | undefined,
  now = Date.now()
) {
  if (presenceState === "offline") {
    return {
      label: "未参与缓存播放",
      detail: "该成员已离线，不参与分片下载或缓存回传。",
      tone: "warning" as const
    };
  }

  if (presenceState === "reconnecting") {
    return {
      label: "数据链路重连中",
      detail: "成员正在恢复房间状态和分片数据通道。",
      tone: "warning" as const
    };
  }

  const playback = peerDiagnostics?.progressivePlaybackStatus ?? null;
  if (
    playback?.activeSource ||
    playback?.fallbackReason ||
    playback?.progressiveLocalBlockedReason ||
    playback?.pendingPlaybackIntent ||
    playback?.lastPlayStartFailure
  ) {
    const updatedAtMs = peerDiagnostics
      ? new Date(peerDiagnostics.updatedAt).getTime()
      : Number.NaN;
    return buildDiagnosticsViewModel({
      presenceState,
      playback,
      playbackSampleAgeMs: Number.isFinite(updatedAtMs)
        ? Math.max(0, now - updatedAtMs)
        : null
    }).audibility;
  }

  if (peerDiagnostics?.dataChannelState === "open") {
    const updatedAtMs = new Date(peerDiagnostics.updatedAt).getTime();
    const transfer = buildDiagnosticsViewModel({
      transfer: {
        downloadRateKbps: peerDiagnostics.pieceDownloadRateKbps,
        uploadRateKbps: peerDiagnostics.pieceUploadRateKbps,
        sampleAgeMs: Number.isFinite(updatedAtMs)
          ? Math.max(0, now - updatedAtMs)
          : null
      }
    }).transfer;
    if (transfer.active) {
      return {
        label: "分片传输中",
        detail: "数据通道已打开，正在为缓存播放交换音频分片。",
        tone: "success" as const
      };
    }
    return {
      label: "数据通道就绪",
      detail: "可用于按需缓存下载和向其他成员回传分片。",
      tone: "accent" as const
    };
  }

  if (
    peerDiagnostics?.dataConnectionState === "connecting" ||
    peerDiagnostics?.dataIceState === "checking"
  ) {
    return {
      label: "连接数据通道",
      detail: "正在建立用于缓存下载的 P2P 数据链路。",
      tone: "accent" as const
    };
  }

  if (peerDiagnostics?.transportHealth === "failed") {
    return {
      label: "数据链路失败",
      detail: peerDiagnostics.lastFailureReason ?? "缓存下载链路不可用，需要等待重连。",
      tone: "warning" as const
    };
  }

  return {
    label: "等待缓存链路",
    detail: "当前还没有可观测的数据通道或本地播放状态。",
    tone: "neutral" as const
  };
}

function getLibraryStatus(summary: MemberTransferSummary | undefined) {
  if (!summary || summary.announcedTrackCount <= 0) {
    return {
      label: "暂无本地分片",
      detail: "当前没有可供房间复用的本地分片。"
    };
  }

  return {
    label: `${summary.announcedTrackCount} 首房间曲目`,
    detail: `共持有 ${summary.totalChunkCount} 片内容，可继续为房间提供分片。`
  };
}

function getPresenceBadge(member: RoomMember) {
  if (member.presenceState === "online") {
    return {
      dot: "animate-pulse bg-green-500",
      text: "text-green-400",
      label: "在线"
    };
  }

  if (member.presenceState === "reconnecting") {
    return {
      dot: "bg-amber-400",
      text: "text-amber-300",
      label: "重连中"
    };
  }

  return {
    dot: "bg-neutral-600",
    text: "text-foreground-muted",
    label: "离线"
  };
}

function formatMetric(value: number | null, unit: string) {
  if (value === null) {
    return "未知";
  }

  return `${value}${unit}`;
}

function formatPreciseMetric(
  value: number | null,
  unit: string,
  sampleAgeMs: number | null = null
) {
  if (value === null) {
    return "未知";
  }

  const rendered = Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value).toString();
  const staleSuffix =
    sampleAgeMs !== null && sampleAgeMs > 6_000 ? " · stale" : "";
  return `${rendered}${unit}${staleSuffix}`;
}

function formatRateM(value: number | null, sampleAgeMs: number | null = null) {
  if (value === null) {
    return "未知";
  }
  const staleSuffix = sampleAgeMs !== null && sampleAgeMs > 6_000 ? " · stale" : "";
  return `${formatTransferRateMBps(value)}${staleSuffix}`;
}

function formatSampleAge(sampleAgeMs: number | null) {
  if (sampleAgeMs === null) {
    return "暂无样本";
  }

  const seconds = Math.max(0, Math.ceil(sampleAgeMs / 1000));
  return sampleAgeMs > 6_000 ? `stale · ${seconds}s前` : `${seconds}s前`;
}

function MembersPanelBase({
  members,
  memberTransferSummaries = [],
  peerDiagnostics = [],
  localMemberState = null
}: MembersPanelProps) {
  const summaryByMemberId = new Map(
    memberTransferSummaries.map((summary) => [summary.memberId, summary])
  );
  const diagnosticsByPeerId = new Map(
    peerDiagnostics.map((snapshot) => [snapshot.peerId, snapshot])
  );
  const localSummary = localMemberState
    ? summaryByMemberId.get(localMemberState.memberId)
    : undefined;
  const localDiagnosticsView = localMemberState
    ? buildDiagnosticsViewModel({
        presenceState: localMemberState.presenceState,
        playback: localMemberState.cachePlayback,
        playbackSampleAgeMs: localMemberState.playbackSampleAgeMs,
        currentTrack: {
          visibleChunks: localSummary?.currentTrackChunkCount ?? 0,
          totalChunks: localSummary?.currentTrackTotalChunks ?? 0
        },
        transfer: localMemberState.pieceSummary,
        dataLink: {
          openCount: localMemberState.dataReadyCount,
          connectedPeerCount: localMemberState.dataReadyCount
        }
      })
    : null;
  const localPlaybackToneClasses = localMemberState
    ? getToneClasses(localDiagnosticsView?.audibility.tone ?? "neutral")
    : null;

  return (
    <section className="flex w-full flex-col gap-2.5">
      <div className="rounded-xl border border-surface-border bg-background/20 px-3 py-2 text-[10px] leading-4 text-foreground-muted">
        在线状态、角色和缓存分片来自房间共享状态；链路速率、延迟和收发带宽来自当前设备的本端观测，
        不同成员看到的数值不一定相同。
      </div>

      {localMemberState && localPlaybackToneClasses ? (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-surface-border bg-surface/30 p-2.5 sm:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-surface-border bg-background/35 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-muted">
                本机可听状态
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${localPlaybackToneClasses.badge}`}
              >
                {localDiagnosticsView?.playbackMode ?? "尚未建立"}
              </span>
            </div>
            <strong className="mt-2 block text-base font-semibold text-foreground">
              {localDiagnosticsView?.audibility.label ?? "尚未建立"}
            </strong>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">
              {localDiagnosticsView?.audibility.detail ?? "尚未建立可听播放链路。"}
            </p>
          </div>

          <div className="rounded-lg border border-surface-border bg-background/35 px-3 py-2 text-xs text-foreground-muted">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground-muted">
              当前链路
            </span>
            <strong className="mt-2 block text-sm font-semibold text-foreground">
              {localMemberState.transportLabel}
            </strong>
            <p className="mt-1 leading-5">
              音频解锁：{localMemberState.audioUnlocked ? "已解锁" : "等待点击播放"}
            </p>
            {localMemberState.lastSourceStartError ? (
              <p className="mt-1 leading-5 text-red-300">
                音源错误：{localMemberState.lastSourceStartError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {members.length > 0 ? (
        members.map((member) => {
          const summary = summaryByMemberId.get(member.id);
          const isLocalMember = localMemberState?.memberId === member.id;
          const peerDiagnosticsSnapshot = member.peerId
            ? diagnosticsByPeerId.get(member.peerId)
            : undefined;
          const playbackStatus = isLocalMember
            ? localDiagnosticsView?.audibility ?? localMemberState.playbackStatus
            : getPlaybackStatus(member.presenceState, peerDiagnosticsSnapshot);
          const diagnosticsView = isLocalMember
            ? localDiagnosticsView
            : buildDiagnosticsViewModel({
                presenceState: member.presenceState,
                playback: peerDiagnosticsSnapshot?.progressivePlaybackStatus ?? null,
                playbackSampleAgeMs: peerDiagnosticsSnapshot
                  ? Math.max(0, Date.now() - new Date(peerDiagnosticsSnapshot.updatedAt).getTime())
                  : null,
                currentTrack: {
                  visibleChunks: summary?.currentTrackChunkCount ?? 0,
                  totalChunks: summary?.currentTrackTotalChunks ?? 0
                },
                transfer: peerDiagnosticsSnapshot
                  ? {
                      downloadRateKbps: peerDiagnosticsSnapshot.pieceDownloadRateKbps,
                      uploadRateKbps: peerDiagnosticsSnapshot.pieceUploadRateKbps,
                      sampleAgeMs: Math.max(
                        0,
                        Date.now() - new Date(peerDiagnosticsSnapshot.updatedAt).getTime()
                      )
                    }
                  : null
              });
          const currentTrackStatus = getCurrentTrackStatus(summary, member.presenceState);
          const libraryStatus = getLibraryStatus(summary);
          const sourceSummary = formatCurrentTrackSources(summary?.currentTrackSources ?? []);
          const toneClasses = getToneClasses(currentTrackStatus.tone);
          const playbackToneClasses = getToneClasses(playbackStatus.tone);
          const presenceBadge = getPresenceBadge(member);
          const latencyMs = isLocalMember
            ? localMemberState.transportSummary.latencyMs
            : peerDiagnosticsSnapshot?.currentRoundTripTimeMs ?? null;
          const pieceDownloadRateKbps = isLocalMember
            ? localMemberState.pieceSummary.downloadRateKbps
            : peerDiagnosticsSnapshot?.pieceDownloadRateKbps ?? null;
          const pieceUploadRateKbps = isLocalMember
            ? localMemberState.pieceSummary.uploadRateKbps
            : peerDiagnosticsSnapshot?.pieceUploadRateKbps ?? null;

          return (
            <div
              key={member.id}
              className="flex flex-col gap-2.5 rounded-xl border border-surface-border bg-surface/30 p-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <strong className="text-[13px] font-semibold leading-none text-foreground">
                    {member.nickname}
                  </strong>
                  <span
                    className={`text-[10px] ${
                      member.role === "host" ? "font-bold text-accent" : "text-foreground-muted"
                    }`}
                  >
                    {member.role === "host" ? "房主" : "成员"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className={`h-1.5 w-1.5 rounded-full ${presenceBadge.dot}`} />
                  <em className={`text-xs not-italic ${presenceBadge.text}`}>
                    {presenceBadge.label}
                  </em>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-surface-border bg-background/30 px-2.5 py-2 text-[10px] leading-4 text-foreground-muted">
                  <span className="block text-foreground-muted">
                    {isLocalMember ? localMemberState.transportLabel : "数据链路（本端观测）"}
                  </span>
                  {isLocalMember ? (
                    <>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                        <span>
                          分片总速:{" "}
                          {formatRateM(
                            localMemberState.pieceSummary.downloadRateKbps === null &&
                              localMemberState.pieceSummary.uploadRateKbps === null
                              ? null
                              : (localMemberState.pieceSummary.downloadRateKbps ?? 0) +
                                (localMemberState.pieceSummary.uploadRateKbps ?? 0),
                            localMemberState.pieceSummary.sampleAgeMs
                          )}
                        </span>
                        <span>
                          延迟:{" "}
                          {formatPreciseMetric(
                            localMemberState.transportSummary.latencyMs,
                            "ms",
                            localMemberState.transportSummary.sampleAgeMs
                          )}
                        </span>
                        <span>
                          Data 接收:{" "}
                          {formatRateM(
                            localMemberState.transportSummary.receiveRateKbps,
                            localMemberState.transportSummary.sampleAgeMs
                          )}
                        </span>
                        <span>
                          Data 发送:{" "}
                          {formatRateM(
                            localMemberState.transportSummary.sendRateKbps,
                            localMemberState.transportSummary.sampleAgeMs
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-foreground-muted/80">
                        最近样本：{formatSampleAge(localMemberState.transportSummary.sampleAgeMs)}
                      </p>
                    </>
                  ) : (
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                      <span>DataChannel: {peerDiagnosticsSnapshot?.dataChannelState ?? "未知"}</span>
                      <span>延迟: {formatMetric(latencyMs, "ms")}</span>
                      <span>
                        buffered:{" "}
                        {formatMetric(peerDiagnosticsSnapshot?.dataBufferedAmountBytes ?? null, " bytes")}
                      </span>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-surface-border bg-background/30 px-2.5 py-2 text-[10px] leading-4 text-foreground-muted">
                  <span className="block text-foreground-muted">
                    {isLocalMember ? "分片同步（本机汇总）" : "分片同步（本端观测）"}
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                    <span>
                      下载:{" "}
                      {isLocalMember
                        ? formatRateM(
                            localMemberState.pieceSummary.downloadRateKbps,
                            localMemberState.pieceSummary.sampleAgeMs
                          )
                        : formatRateM(pieceDownloadRateKbps)}
                    </span>
                    <span>
                      上传:{" "}
                      {isLocalMember
                        ? formatRateM(
                            localMemberState.pieceSummary.uploadRateKbps,
                            localMemberState.pieceSummary.sampleAgeMs
                          )
                        : formatRateM(pieceUploadRateKbps)}
                    </span>
                  </div>
                  {isLocalMember ? (
                    <p className="mt-1 text-[10px] text-foreground-muted/80">
                      最近样本：{formatSampleAge(localMemberState.pieceSummary.sampleAgeMs)}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 xl:grid-cols-[1.05fr_1.05fr_0.9fr]">
                <div className="rounded-lg border border-surface-border bg-background/40 px-2.5 py-2">
                  <span className="block text-[10px] text-foreground-muted">播放状态</span>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <strong className="text-[13px] font-semibold text-foreground">
                      {playbackStatus.label}
                    </strong>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${playbackToneClasses.badge}`}
                    >
                      {isLocalMember
                        ? diagnosticsView?.playbackMode ?? "尚未建立"
                        : peerDiagnosticsSnapshot?.transportHealth ?? "未知"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
                    {playbackStatus.detail}
                  </p>
                  {isLocalMember && localMemberState.cachePlayback ? (
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-foreground-muted">
                      <span>模式：{diagnosticsView?.playbackMode ?? "尚未建立"}</span>
                      <span>缓冲：{diagnosticsView?.cache.healthLabel ?? "暂无有效样本"}</span>
                      <span>前向：{diagnosticsView?.cache.aheadLabel ?? "暂无有效样本"}</span>
                      <span>
                        PCM 连续片：{diagnosticsView?.cache.pcmContiguousChunks ?? "暂无有效样本"}
                      </span>
                      <span className="col-span-2">同步：{diagnosticsView?.sync.label ?? "暂无有效样本"}</span>
                      {diagnosticsView?.activeIssue ? (
                        <span className="col-span-2 text-amber-300">
                          当前问题：{diagnosticsView.activeIssue}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-surface-border bg-background/40 px-2.5 py-2">
                  <span className="block text-[10px] text-foreground-muted">当前曲目分片</span>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <strong className="text-[13px] font-semibold text-foreground">
                      {currentTrackStatus.label}
                    </strong>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneClasses.badge}`}
                    >
                      {summary?.currentTrackTotalChunks
                        ? `${summary.currentTrackChunkCount}/${summary.currentTrackTotalChunks}`
                        : "0/0"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/6">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${toneClasses.progress}`}
                      style={{ width: `${currentTrackStatus.progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
                    {currentTrackStatus.detail}
                  </p>
                </div>

                <div className="rounded-lg border border-surface-border bg-background/40 px-2.5 py-2">
                  <span className="block text-[10px] text-foreground-muted">本地分片库存</span>
                  <strong className="mt-1.5 block text-[13px] font-semibold text-foreground">
                    {libraryStatus.label}
                  </strong>
                  <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
                    {libraryStatus.detail}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-surface-border bg-background/30 px-2.5 py-1.5 text-[10px] leading-4 text-foreground-muted">
                {sourceSummary ? (
                  <span>同步来源：{sourceSummary}</span>
                ) : member.presenceState === "online" ? (
                  <span>同步来源：当前没有可供回传的当前曲目分片，将依赖其他在线缓存源。</span>
                ) : member.presenceState === "reconnecting" ? (
                  <span>同步来源：连接恢复后会重新评估该成员的分片能力。</span>
                ) : (
                  <span>同步来源：离线成员当前不会参与缓存分发。</span>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="rounded-xl border-2 border-dashed border-surface-border px-4 py-6 text-center">
          <p className="text-xs text-foreground-muted/70">当前还没有成员进入房间。</p>
        </div>
      )}
    </section>
  );
}

export const MembersPanel = memo(MembersPanelBase);
