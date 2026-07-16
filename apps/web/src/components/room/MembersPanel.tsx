"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, PlaybackSnapshot, RoomMember } from "@music-room/shared";
import { formatTransferRateMBps } from "@/lib/music-room-ui";
import {
  dedupePeerDiagnostics,
  dedupeRoomMembers,
  getMediaSampleAgeMs,
  hasFreshMediaObservation,
  realtimeMediaSampleWindowMs
} from "./member-data";

type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type LocalMemberPanelState = {
  memberId: string;
  mediaSummary?: {
    receiveRateKbps: number | null;
    sendRateKbps: number | null;
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
  peerDiagnostics?: PeerDiagnosticsSnapshot[];
  localMemberState?: LocalMemberPanelState | null;
  playbackStatus: PlaybackSnapshot["status"];
  sourcePeerId: string | null;
};

function getToneClasses(tone: StatusTone) {
  if (tone === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (tone === "accent") return "border-accent/30 bg-accent/10 text-accent";
  if (tone === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (tone === "danger") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-surface-border bg-background/60 text-foreground-muted";
}

function formatRate(value: number | null) {
  return value === null ? null : formatTransferRateMBps(value);
}

function formatMetric(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return null;
  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

function formatTelemetryMetric(value: number | null | undefined, unit: string) {
  return formatMetric(value, unit) ?? "暂无";
}

function formatSampleAge(sampleAgeMs: number | null) {
  if (sampleAgeMs === null) return null;
  const seconds = Math.max(0, Math.ceil(sampleAgeMs / 1000));
  return sampleAgeMs > realtimeMediaSampleWindowMs ? `样本过期 · ${seconds}s前` : `样本 ${seconds}s前`;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "暂无";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleTimeString("zh-CN", { hour12: false });
}

function getPresence(member: RoomMember) {
  if (member.presenceState === "online") {
    return { dot: "animate-pulse bg-green-500", text: "text-green-400", label: "在线" };
  }
  if (member.presenceState === "reconnecting") {
    return { dot: "bg-amber-400", text: "text-amber-300", label: "重连中" };
  }
  return { dot: "bg-neutral-600", text: "text-foreground-muted", label: "离线" };
}

export function getPlaybackStatus(
  presenceState: RoomMember["presenceState"],
  peerDiagnostics: PeerDiagnosticsSnapshot | undefined,
  options: { playbackActive?: boolean; isCurrentSource?: boolean } = {}
) {
  const playbackActive = options.playbackActive ?? true;
  const isCurrentSource = options.isCurrentSource ?? true;

  if (presenceState === "offline") {
    return { label: "离线", detail: "该成员当前不参与实时音频传输。", tone: "warning" as const, badgeText: "offline" };
  }
  if (presenceState === "reconnecting") {
    return { label: "链路重连中", detail: "正在恢复 WebRTC RTP Opus 媒体轨道。", tone: "warning" as const, badgeText: "reconnecting" };
  }
  if (!playbackActive) {
    return peerDiagnostics?.dataChannelState === "open"
      ? { label: "已连接", detail: "控制通道已连接，当前房间没有播放。", tone: "accent" as const, badgeText: "Data open" }
      : { label: "在线", detail: "成员在线，尚未观测到控制通道。", tone: "neutral" as const, badgeText: "online" };
  }
  if (!isCurrentSource) {
    return peerDiagnostics?.dataChannelState === "open"
      ? { label: "已连接", detail: "当前不是音频源，不承担本次 RTP Opus 发送。", tone: "accent" as const, badgeText: "not source" }
      : { label: "在线", detail: "当前不是音频源，暂无本次媒体链路样本。", tone: "neutral" as const, badgeText: "not source" };
  }
  if (peerDiagnostics?.mediaConnectionState === "failed" || peerDiagnostics?.transportScore === "failed") {
    return {
      label: "媒体链路失败",
      detail: peerDiagnostics.lastFailureReason ?? "当前无法接收 RTP Opus 音频。",
      tone: "danger" as const,
      badgeText: "Media failed"
    };
  }
  if (hasFreshMediaObservation(peerDiagnostics)) {
    return {
      label: "RTP 正常",
      detail: "最近 6 秒内已观测到当前媒体源的 RTP Opus 数据。",
      tone: "success" as const,
      badgeText: "RTP Opus"
    };
  }
  if (peerDiagnostics?.mediaConnectionState === "connected" || peerDiagnostics?.senderTrackId || peerDiagnostics?.receiverTrackId) {
    return { label: "等待音频数据", detail: "媒体连接已建立，但最近没有有效 RTP 速率样本。", tone: "warning" as const, badgeText: "Media waiting" };
  }
  return { label: "等待媒体样本", detail: "当前没有可确认的 RTP Opus 媒体观测。", tone: "neutral" as const, badgeText: "Media pending" };
}

function MemberMetrics({
  diagnostic,
  localMemberState,
  isLocal
}: {
  diagnostic: PeerDiagnosticsSnapshot | undefined;
  localMemberState: LocalMemberPanelState | null;
  isLocal: boolean;
}) {
  const mediaSampleAgeMs = isLocal
    ? localMemberState?.mediaSummary?.sampleAgeMs ?? null
    : getMediaSampleAgeMs(diagnostic);
  const mediaSampleIsFresh = mediaSampleAgeMs !== null && mediaSampleAgeMs <= realtimeMediaSampleWindowMs;
  const receiveRate = isLocal
    ? localMemberState?.mediaSummary?.receiveRateKbps ?? null
    : diagnostic?.mediaReceiveBitrateKbps ?? null;
  const sendRate = isLocal
    ? localMemberState?.mediaSummary?.sendRateKbps ?? null
    : diagnostic?.mediaSendBitrateKbps ?? null;
  const metrics: string[] = [];

  if (mediaSampleIsFresh && receiveRate !== null && receiveRate > 0) {
    metrics.push(`RTP 接收 ${formatRate(receiveRate)}`);
  }
  if (mediaSampleIsFresh && sendRate !== null && sendRate > 0) {
    metrics.push(`RTP 发送 ${formatRate(sendRate)}`);
  }
  if (diagnostic && !isLocal) {
    const rtt = formatMetric(diagnostic.currentRoundTripTimeMs, "ms");
    const loss = mediaSampleIsFresh ? formatMetric(diagnostic.packetLossRate, "%") : null;
    const jitter = mediaSampleIsFresh ? formatMetric(diagnostic.jitterMs, "ms") : null;
    if (rtt) metrics.push(`RTT ${rtt}`);
    if (loss) metrics.push(`丢包 ${loss}`);
    if (jitter) metrics.push(`jitter ${jitter}`);
  }
  const sampleLabel = formatSampleAge(mediaSampleAgeMs);
  if (sampleLabel) metrics.push(sampleLabel);

  return (
    <>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-foreground-muted">
        {metrics.length > 0 ? metrics.map((metric) => <span key={metric}>{metric}</span>) : <span>暂无实时样本</span>}
      </div>
      <MemberTelemetry
        diagnostic={diagnostic}
        isLocal={isLocal}
        localMemberState={localMemberState}
      />
    </>
  );
}

function MemberTelemetry({
  diagnostic,
  isLocal,
  localMemberState
}: {
  diagnostic: PeerDiagnosticsSnapshot | undefined;
  isLocal: boolean;
  localMemberState: LocalMemberPanelState | null;
}) {
  const playback = diagnostic?.segmentedPlaybackStatus;
  const receiveRate = isLocal
    ? localMemberState?.mediaSummary?.receiveRateKbps ?? null
    : diagnostic?.mediaReceiveBitrateKbps ?? null;
  const sendRate = isLocal
    ? localMemberState?.mediaSummary?.sendRateKbps ?? null
    : diagnostic?.mediaSendBitrateKbps ?? null;
  const telemetry = isLocal
    ? [
        `播放 ${playback?.listenerPlaybackState ?? localMemberState?.playbackStatus.badgeText ?? "暂无"}`,
        `AudioContext ${playback?.audioContextState ?? "暂无"}`,
        `RTP ↓${formatTelemetryMetric(receiveRate, "kbps")} ↑${formatTelemetryMetric(sendRate, "kbps")}`,
        `观测 ${formatTimestamp(diagnostic?.updatedAt)}`
      ]
    : [
        `数据 ${diagnostic?.dataConnectionState ?? "暂无"} / ${diagnostic?.dataChannelState ?? "暂无"}`,
        `媒体 ${diagnostic?.mediaConnectionState ?? "暂无"} / ICE ${diagnostic?.mediaIceState ?? "暂无"}`,
        `RTP ↓${formatTelemetryMetric(receiveRate, "kbps")} ↑${formatTelemetryMetric(sendRate, "kbps")}`,
        `RTT ${formatTelemetryMetric(diagnostic?.currentRoundTripTimeMs, "ms")} · 丢包 ${formatTelemetryMetric(diagnostic?.packetLossRate, "%")} · jitter ${formatTelemetryMetric(diagnostic?.jitterMs, "ms")}`,
        `观测 ${formatTimestamp(diagnostic?.updatedAt)}`
      ];

  return (
    <div className="mt-2 rounded-md border border-white/[0.06] bg-black/20 px-2 py-1.5 text-[10px] leading-4 text-foreground-muted">
      <div className="mb-0.5 font-medium text-foreground/70">
        {isLocal ? "本机真实状态" : "本机对该成员的实时观测"}
      </div>
      <div className="grid gap-x-3 sm:grid-cols-2">
        {telemetry.map((item) => <span key={item} className="min-w-0 break-words">{item}</span>)}
      </div>
    </div>
  );
}

function MembersPanelBase({
  members,
  peerDiagnostics = [],
  localMemberState = null,
  playbackStatus: roomPlaybackStatus,
  sourcePeerId
}: MembersPanelProps) {
  const normalizedMembers = dedupeRoomMembers(members);
  const diagnosticsByPeerId = new Map(
    dedupePeerDiagnostics(peerDiagnostics).map((item) => [item.peerId, item])
  );
  const onlineCount = normalizedMembers.filter((member) => member.presenceState === "online").length;

  return (
    <section className="flex w-full flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">房间成员</h2>
          <p className="mt-1 text-[10px] text-foreground-muted">
            {onlineCount} 人在线 · 共 {normalizedMembers.length} 人
          </p>
        </div>
        <span className="rounded-full border border-surface-border bg-background/40 px-2.5 py-1 text-[10px] font-mono text-foreground-muted">
          {normalizedMembers.length}
        </span>
      </header>

      {normalizedMembers.length > 0 ? (
        <div className="divide-y divide-surface-border border-y border-surface-border">
          {normalizedMembers.map((member) => {
            const isLocal = localMemberState?.memberId === member.id;
            const diagnostic = isLocal
              ? diagnosticsByPeerId.get("system")
              : member.peerId
                ? diagnosticsByPeerId.get(member.peerId)
                : undefined;
            const isCurrentSource = member.peerId !== null && member.peerId === sourcePeerId;
            const status = isLocal
              ? localMemberState.playbackStatus
              : getPlaybackStatus(member.presenceState, diagnostic, {
                  playbackActive: roomPlaybackStatus === "playing",
                  isCurrentSource
                });
            const presence = getPresence(member);

            return (
              <article key={member.id} className="py-3 first:pt-3 last:pb-3">
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[10px] font-semibold text-foreground">
                        {member.nickname.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <strong className="block truncate text-[13px] text-foreground">{member.nickname}</strong>
                        <span className="text-[10px] text-foreground-muted">
                          {member.role === "host" ? "房主" : "成员"}{isLocal ? " · 本机" : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1.5 text-xs ${presence.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${presence.dot}`} />
                    {presence.label}
                  </span>
                </header>

                <div className="ml-9 mt-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getToneClasses(status.tone)}`}>
                      {status.label}
                    </span>
                    {roomPlaybackStatus === "playing" && isCurrentSource ? (
                      <span className="text-[10px] text-accent">当前音源</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-foreground-muted">{status.detail}</p>
                  <MemberMetrics diagnostic={diagnostic} localMemberState={localMemberState} isLocal={isLocal} />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="border-y border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
          当前还没有成员进入房间。
        </p>
      )}
    </section>
  );
}

export const MembersPanel = memo(MembersPanelBase);
