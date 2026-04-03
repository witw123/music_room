"use client";

import { memo } from "react";
import type { RoomMember } from "@music-room/shared";

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
      label: summary?.announcedTrackCount ? "未接管当前曲目" : "等待首批分片",
      detail: summary?.announcedTrackCount
        ? "本地已有其他缓存，但当前曲目还没形成可接管播放的前缀。"
        : "当前仍需要等待实时音频或其他成员先提供分片。",
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
    label: "等待首批分片",
    detail: "当前曲目还没进入本地缓存，暂时继续依赖实时音频。",
    progressPercent: 0,
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

function MembersPanelBase({
  members,
  memberTransferSummaries = []
}: MembersPanelProps) {
  const summaryByMemberId = new Map(
    memberTransferSummaries.map((summary) => [summary.memberId, summary])
  );

  return (
    <section className="flex w-full flex-col gap-3">
      {members.length > 0 ? (
        members.map((member) => {
          const summary = summaryByMemberId.get(member.id);
          const currentTrackStatus = getCurrentTrackStatus(summary, member.presenceState);
          const libraryStatus = getLibraryStatus(summary);
          const sourceSummary = formatCurrentTrackSources(summary?.currentTrackSources ?? []);
          const toneClasses = getToneClasses(currentTrackStatus.tone);
          const presenceBadge = getPresenceBadge(member);

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
                <div className="rounded-lg border border-surface-border bg-background/40 px-3 py-2.5">
                  <span className="block text-[10px] text-foreground-muted">当前曲目状态</span>
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
