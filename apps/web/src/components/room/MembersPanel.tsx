"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, RoomMember } from "@music-room/shared";
import { enableTrackCaching } from "@/features/playback/track-cache-policy";

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

type StatusTone = "neutral" | "accent" | "success" | "warning";

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
    default:
      return {
        badge: "border-surface-border bg-background/60 text-foreground-muted",
        progress: "bg-white/30"
      };
  }
}

function formatCurrentTrackSources(sources: string[]) {
  if (!enableTrackCaching) {
    return null;
  }

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

function getCurrentTrackStatus(
  summary: MemberTransferSummary | undefined,
  presenceState: RoomMember["presenceState"]
) {
  if (!enableTrackCaching) {
    return {
      label: "缓存已暂停",
      detail: "当前版本已暂停本地缓存接管与分片同步。",
      progressPercent: 0,
      tone: "neutral" as const
    };
  }

  if (presenceState === "offline") {
    return {
      label: "离线",
      detail: "该成员当前不参与实时播放和分片同步。",
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
      label: summary?.announcedTrackCount ? "未建立当前曲目缓存" : "未建立缓存",
      detail: summary?.announcedTrackCount
        ? "本地已有其他缓存，但当前曲目还没有形成可接管播放的前缀。"
        : "当前正在通过实时音频播放，本地缓存尚未建立。",
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
      label: "已完整缓存",
      detail: "当前曲目已完整落到本地，可直接切到本地播放。",
      progressPercent: 100,
      tone: "success" as const
    };
  }

  if (summary.currentTrackChunkCount > 0) {
    return {
      label: `缓存中 ${progressPercent}%`,
      detail: "当前曲目正在补齐本地连续前缀，准备接管播放。",
      progressPercent,
      tone: progressPercent >= 50 ? ("accent" as const) : ("neutral" as const)
    };
  }

  return {
    label: "未建立缓存",
    detail: "当前正在通过实时音频播放，本地缓存尚未建立。",
    progressPercent: 0,
    tone: "neutral" as const
  };
}

function getPlaybackStatus(
  presenceState: RoomMember["presenceState"],
  peerDiagnostics: PeerDiagnosticsSnapshot | undefined
) {
  const recoveryPhase = peerDiagnostics?.progressivePlaybackStatus?.recoveryPhase ?? null;
  const fullLocalRecoveryActive =
    peerDiagnostics?.progressivePlaybackStatus?.fullLocalRecoveryActive ?? false;
  const mediaTransportState =
    peerDiagnostics?.progressivePlaybackStatus?.mediaTransportState ?? null;
  const publishedTrackKind =
    peerDiagnostics?.progressivePlaybackStatus?.publishedTrackKind ?? null;
  const sourceStartState =
    peerDiagnostics?.progressivePlaybackStatus?.sourceStartState ?? null;
  const hostPublishSource =
    peerDiagnostics?.progressivePlaybackStatus?.hostPublishSource ?? null;
  const hostPublishReadiness =
    peerDiagnostics?.progressivePlaybackStatus?.hostPublishReadiness ?? null;
  const hostPublishFailureReason =
    peerDiagnostics?.progressivePlaybackStatus?.hostPublishFailureReason ?? null;
  const mediaFailureReason =
    peerDiagnostics?.progressivePlaybackStatus?.mediaFailureReason ?? null;

  if (presenceState === "offline") {
    return {
      label: "未接入音频",
      detail: "该成员已离线，不参与实时播放。",
      tone: "warning" as const
    };
  }

  if (presenceState === "reconnecting") {
    return {
      label: "实时音频重连中",
      detail: "成员正在恢复房间实时链路。",
      tone: "warning" as const
    };
  }

  if (fullLocalRecoveryActive && recoveryPhase === "playing-local-fallback") {
    return {
      label: "本地缓存已接管",
      detail: "当前曲目已切到本地缓存播放，实时链路在后台继续恢复。",
      tone: "success" as const
    };
  }

  if (recoveryPhase === "joining" || recoveryPhase === "resyncing") {
    return {
      label: "同步房间状态中",
      detail: "已进入房间，正在同步当前播放状态和成员拓扑。",
      tone: "accent" as const
    };
  }

  if (recoveryPhase === "bootstrapping-data") {
    return {
      label: "同步数据链路中",
      detail: "当前曲目和来源已确认，正在恢复分片数据通道。",
      tone: "accent" as const
    };
  }

  if (recoveryPhase === "bootstrapping-media") {
    if (
      !enableTrackCaching &&
      (mediaTransportState === "connected" || mediaTransportState === "prewarming") &&
      publishedTrackKind !== "host-capture" &&
      publishedTrackKind !== "relay-stream"
    ) {
      return {
        label: "音频链路已接入",
        detail: "实时音频传输已预连，正在等待房主发布当前音轨。",
        tone: "accent" as const
      };
    }
    return {
      label: "连接实时音频中",
      detail: "当前曲目和来源已确认，正在拉起远端实时音频。",
      tone: "accent" as const
    };
  }

  if (sourceStartState === "starting") {
    return {
      label: "正在启动实时分发",
      detail:
        hostPublishReadiness === "awaiting-audio"
          ? `实时链路已预热，等待真实发布源就绪：${hostPublishSource ?? "未知"}`
          : "本机已解锁，正在拉起本地音频并同步给房间。",
      tone: "accent" as const
    };
  }

  if (sourceStartState === "failed") {
    return {
      label: "实时分发启动失败",
      detail: hostPublishFailureReason
        ? `真实发布源异常：${hostPublishFailureReason}`
        : "当前还没有可用于实时分发的真实音频源。",
      tone: "warning" as const
    };
  }

  if (peerDiagnostics?.transportHealth === "degraded") {
    return {
      label: "播放中，链路波动",
      detail: "当前仍在持续播放，检测到短时缓冲或 ICE 检查，暂不升级为硬重连。",
      tone: "accent" as const
    };
  }

  if (peerDiagnostics?.transportHealth === "recovering") {
    return {
      label: "后台恢复实时音频中",
      detail: "当前可听源优先保持，实时链路正在后台恢复。",
      tone: "accent" as const
    };
  }

  if (
    peerDiagnostics?.mediaConnectionState === "connected" ||
    peerDiagnostics?.mediaConnectionState === "live" ||
    peerDiagnostics?.transportHealth === "media-only"
  ) {
    return {
      label: "实时音频中",
      detail:
        peerDiagnostics?.transportHealth === "media-only"
          ? "当前通过远端实时音频播放，分片数据通道尚未就绪。"
          : "当前已接入远端实时音频链路。",
      tone: "success" as const
    };
  }

  if (
    peerDiagnostics?.mediaConnectionState === "buffering" ||
    peerDiagnostics?.mediaConnectionState === "connecting"
  ) {
    return {
      label: "实时音频缓冲中",
      detail: "已接入音频链路，正在等待播放稳定。",
      tone: "accent" as const
    };
  }

  if (peerDiagnostics?.transportHealth === "reconnecting") {
    return {
      label: "实时音频重连中",
      detail: "链路状态正在恢复，音频可能暂时抖动。",
      tone: "warning" as const
    };
  }

  return {
    label: "未接入音频",
    detail: mediaFailureReason
      ? `当前还没有稳定的实时音频链路：${mediaFailureReason}`
      : "当前还没有稳定的实时音频链路。",
    tone: "neutral" as const
  };
}

function getLibraryStatus(summary: MemberTransferSummary | undefined) {
  if (!enableTrackCaching) {
    return {
      label: "缓存已暂停使用",
      detail: "历史本地缓存当前不会参与播放或同步。"
    };
  }

  if (!summary || summary.announcedTrackCount <= 0) {
    return {
      label: "暂无本地缓存",
      detail: "还没有形成可复用的本地歌曲缓存。"
    };
  }

  return {
    label: `${summary.announcedTrackCount} 首歌曲`,
    detail: `共缓存 ${summary.totalChunkCount} 片内容，可继续为房间提供同步。`
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

function formatSampleAge(sampleAgeMs: number | null) {
  if (sampleAgeMs === null) {
    return "暂无样本";
  }

  const seconds = Math.max(0, Math.ceil(sampleAgeMs / 1000));
  return sampleAgeMs > 6_000 ? `stale · ${seconds}s前` : `${seconds}s前`;
}

function getRemoteStreamRate(peer: PeerDiagnosticsSnapshot | undefined) {
  if (!peer) {
    return null;
  }

  if (peer.mediaReceiveBitrateKbps !== null) {
    return peer.mediaReceiveBitrateKbps;
  }

  if (peer.mediaSendBitrateKbps !== null) {
    return peer.mediaSendBitrateKbps;
  }

  return peer.availableOutgoingBitrateKbps;
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

  return (
    <section className="flex w-full flex-col gap-2.5">
      <div className="rounded-xl border border-surface-border bg-background/20 px-3 py-2 text-[10px] leading-4 text-foreground-muted">
        在线状态、角色和缓存分片来自房间共享状态；链路速率、延迟和收发带宽来自当前设备的本端观测，
        不同成员看到的数值不一定相同。
        {!enableTrackCaching ? " 当前版本已暂停缓存接管和分片同步。" : ""}
      </div>

      {members.length > 0 ? (
        members.map((member) => {
          const summary = summaryByMemberId.get(member.id);
          const isLocalMember = localMemberState?.memberId === member.id;
          const peerDiagnosticsSnapshot = member.peerId
            ? diagnosticsByPeerId.get(member.peerId)
            : undefined;
          const playbackStatus = isLocalMember
            ? localMemberState.playbackStatus
            : getPlaybackStatus(member.presenceState, peerDiagnosticsSnapshot);
          const currentTrackStatus = getCurrentTrackStatus(summary, member.presenceState);
          const libraryStatus = getLibraryStatus(summary);
          const sourceSummary = formatCurrentTrackSources(summary?.currentTrackSources ?? []);
          const toneClasses = getToneClasses(currentTrackStatus.tone);
          const playbackToneClasses = getToneClasses(playbackStatus.tone);
          const presenceBadge = getPresenceBadge(member);
          const remoteStreamRateKbps = isLocalMember
            ? localMemberState.transportSummary.totalRateKbps
            : getRemoteStreamRate(peerDiagnosticsSnapshot);
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
                    {isLocalMember ? localMemberState.transportLabel : "远端流链路（本端观测）"}
                  </span>
                  {isLocalMember ? (
                    <>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                        <span>
                          总传输:{" "}
                          {formatPreciseMetric(
                            localMemberState.transportSummary.totalRateKbps,
                            " kbps",
                            localMemberState.transportSummary.sampleAgeMs
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
                          接收:{" "}
                          {formatPreciseMetric(
                            localMemberState.transportSummary.receiveRateKbps,
                            " kbps",
                            localMemberState.transportSummary.sampleAgeMs
                          )}
                        </span>
                        <span>
                          发送:{" "}
                          {formatPreciseMetric(
                            localMemberState.transportSummary.sendRateKbps,
                            " kbps",
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
                      <span>传输速度: {formatMetric(remoteStreamRateKbps, " kbps")}</span>
                      <span>延迟: {formatMetric(latencyMs, "ms")}</span>
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
                        ? formatPreciseMetric(
                            localMemberState.pieceSummary.downloadRateKbps,
                            " kbps",
                            localMemberState.pieceSummary.sampleAgeMs
                          )
                        : formatMetric(pieceDownloadRateKbps, " kbps")}
                    </span>
                    <span>
                      上传:{" "}
                      {isLocalMember
                        ? formatPreciseMetric(
                            localMemberState.pieceSummary.uploadRateKbps,
                            " kbps",
                            localMemberState.pieceSummary.sampleAgeMs
                          )
                        : formatMetric(pieceUploadRateKbps, " kbps")}
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
                        ? localMemberState.playbackStatus.badgeText
                        : peerDiagnosticsSnapshot?.transportHealth ?? "未知"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
                    {playbackStatus.detail}
                  </p>
                </div>

                <div className="rounded-lg border border-surface-border bg-background/40 px-2.5 py-2">
                  <span className="block text-[10px] text-foreground-muted">当前曲目缓存</span>
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
                  <span className="block text-[10px] text-foreground-muted">本地缓存库存</span>
                  <strong className="mt-1.5 block text-[13px] font-semibold text-foreground">
                    {libraryStatus.label}
                  </strong>
                  <p className="mt-1.5 text-[10px] leading-4 text-foreground-muted">
                    {libraryStatus.detail}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-surface-border bg-background/30 px-2.5 py-1.5 text-[10px] leading-4 text-foreground-muted">
                {!enableTrackCaching ? (
                  <span>同步来源：当前只使用实时音频或原上传源，本地缓存已暂停。</span>
                ) : sourceSummary ? (
                  <span>同步来源：{sourceSummary}</span>
                ) : playbackStatus.label === "实时音频中" ? (
                  <span>同步来源：当前通过实时音频持续播放，等待本地缓存建立。</span>
                ) : member.presenceState === "online" ? (
                  <span>同步来源：当前还没有可用于接管播放的本地缓存。</span>
                ) : member.presenceState === "reconnecting" ? (
                  <span>同步来源：连接恢复后会重新评估该成员的缓存能力。</span>
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
