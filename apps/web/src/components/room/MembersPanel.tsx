"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, RoomMember } from "@music-room/shared";

export type MemberTransferSummary = {
  memberId: string;
  announcedTrackCount: number;
  totalChunkCount: number;
  currentTrackChunkCount: number;
  currentTrackTotalChunks: number;
  currentTrackSources: string[];
};

type MembersPanelProps = {
  members: RoomMember[];
  memberTransferSummaries?: MemberTransferSummary[];
  peerDiagnostics?: PeerDiagnosticsSnapshot[];
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
    detail: "当前还没有稳定的实时音频链路。",
    tone: "neutral" as const
  };
}

function getLibraryStatus(summary: MemberTransferSummary | undefined) {
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
  peerDiagnostics = []
}: MembersPanelProps) {
  const summaryByMemberId = new Map(
    memberTransferSummaries.map((summary) => [summary.memberId, summary])
  );
  const diagnosticsByPeerId = new Map(
    peerDiagnostics.map((snapshot) => [snapshot.peerId, snapshot])
  );

  return (
    <section className="flex w-full flex-col gap-3">
      <div className="rounded-xl border border-surface-border bg-background/20 px-3 py-2 text-[10px] leading-5 text-foreground-muted">
        在线状态、角色和缓存分片来自房间共享状态；链路速率、延迟和收发带宽来自当前设备的本端观测，
        不同成员看到的数值不一定相同。
      </div>

      {members.length > 0 ? (
        members.map((member) => {
          const summary = summaryByMemberId.get(member.id);
          const peerDiagnosticsSnapshot = member.peerId
            ? diagnosticsByPeerId.get(member.peerId)
            : undefined;
          const playbackStatus = getPlaybackStatus(member.presenceState, peerDiagnosticsSnapshot);
          const currentTrackStatus = getCurrentTrackStatus(summary, member.presenceState);
          const libraryStatus = getLibraryStatus(summary);
          const sourceSummary = formatCurrentTrackSources(summary?.currentTrackSources ?? []);
          const toneClasses = getToneClasses(currentTrackStatus.tone);
          const playbackToneClasses = getToneClasses(playbackStatus.tone);
          const presenceBadge = getPresenceBadge(member);
          const remoteStreamRateKbps = getRemoteStreamRate(peerDiagnosticsSnapshot);

          return (
            <div
              key={member.id}
              className="flex flex-col gap-3 rounded-xl border border-surface-border bg-surface/30 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <strong className="text-sm font-semibold text-foreground">{member.nickname}</strong>
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
                <div className="rounded-lg border border-surface-border bg-background/30 px-3 py-2 text-[10px] text-foreground-muted">
                  <span className="block text-foreground-muted">远端流链路（本端观测）</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <span>传输速度: {formatMetric(remoteStreamRateKbps, " kbps")}</span>
                    <span>延迟: {formatMetric(peerDiagnosticsSnapshot?.currentRoundTripTimeMs ?? null, "ms")}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-surface-border bg-background/30 px-3 py-2 text-[10px] text-foreground-muted">
                  <span className="block text-foreground-muted">分片同步（本端观测）</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <span>
                      下载: {formatMetric(peerDiagnosticsSnapshot?.pieceDownloadRateKbps ?? null, " kbps")}
                    </span>
                    <span>
                      上传: {formatMetric(peerDiagnosticsSnapshot?.pieceUploadRateKbps ?? null, " kbps")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-surface-border bg-background/40 px-3 py-2.5">
                  <span className="block text-[10px] text-foreground-muted">播放状态</span>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <strong className="text-sm font-semibold text-foreground">
                      {playbackStatus.label}
                    </strong>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${playbackToneClasses.badge}`}
                    >
                      {peerDiagnosticsSnapshot?.transportHealth ?? "未知"}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] leading-5 text-foreground-muted">
                    {playbackStatus.detail}
                  </p>
                </div>

                <div className="rounded-lg border border-surface-border bg-background/40 px-3 py-2.5">
                  <span className="block text-[10px] text-foreground-muted">当前曲目缓存</span>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <strong className="text-sm font-semibold text-foreground">
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
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/6">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${toneClasses.progress}`}
                      style={{ width: `${currentTrackStatus.progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[10px] leading-5 text-foreground-muted">
                    {currentTrackStatus.detail}
                  </p>
                </div>

                <div className="rounded-lg border border-surface-border bg-background/40 px-3 py-2.5">
                  <span className="block text-[10px] text-foreground-muted">本地缓存库存</span>
                  <strong className="mt-2 block text-sm font-semibold text-foreground">
                    {libraryStatus.label}
                  </strong>
                  <p className="mt-2 text-[10px] leading-5 text-foreground-muted">
                    {libraryStatus.detail}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-surface-border bg-background/30 px-3 py-2 text-[10px] text-foreground-muted">
                {sourceSummary ? (
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
