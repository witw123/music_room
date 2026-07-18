"use client";

import { memo, useEffect, useState } from "react";
import type { PeerDiagnosticsSnapshot, PlaybackSnapshot, RoomMember } from "@music-room/shared";
import {
  dedupePeerDiagnostics,
  dedupeRoomMembers,
  hasFreshMediaObservation,
} from "./member-data";

type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type LocalMemberPanelState = {
  memberId: string;
  audible: boolean | null;
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

function formatMetric(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return null;
  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

function formatTelemetryMetric(value: number | null | undefined, unit: string) {
  return formatMetric(value, unit) ?? "暂无";
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
    return { label: "离线", detail: "", tone: "neutral" as const, badgeText: "离线" };
  }
  if (presenceState === "reconnecting") {
    return { label: "正在重连", detail: "", tone: "warning" as const, badgeText: "正在重连" };
  }
  if (!playbackActive) {
    return peerDiagnostics?.dataChannelState === "open" || peerDiagnostics?.mediaConnectionState === "connected"
      ? { label: "连接正常", detail: "", tone: "accent" as const, badgeText: "连接正常" }
      : { label: "连接中", detail: "", tone: "neutral" as const, badgeText: "连接中" };
  }
  if (peerDiagnostics?.mediaConnectionState === "failed" || peerDiagnostics?.transportScore === "failed") {
    return {
      label: "音频异常",
      detail: "",
      tone: "danger" as const,
      badgeText: "音频异常"
    };
  }
  if (hasFreshMediaObservation(peerDiagnostics)) {
    const isReceivingAudio =
      (peerDiagnostics?.mediaReceiveBitrateKbps ?? 0) > 0 ||
      !!peerDiagnostics?.receiverTrackId;
    return {
      label: isCurrentSource || isReceivingAudio ? "正常出声" : "连接正常",
      detail: "",
      tone: isCurrentSource || isReceivingAudio ? "success" as const : "accent" as const,
      badgeText: isCurrentSource || isReceivingAudio ? "正常出声" : "连接正常"
    };
  }
  if (peerDiagnostics?.mediaConnectionState === "connected" || peerDiagnostics?.senderTrackId || peerDiagnostics?.receiverTrackId) {
    return { label: "音频准备中", detail: "", tone: "warning" as const, badgeText: "音频准备中" };
  }
  return { label: "连接中", detail: "", tone: "neutral" as const, badgeText: "连接中" };
}

const memberReportedTelemetryFreshMs = 6_000;

export type MemberAudibleStatus = {
  label: "正在发声" | "未发声" | "等待音频" | "未播放" | "等待重连" | "离线";
  tone: StatusTone;
  active: boolean;
};

export function getMemberAudibleStatus(input: {
  presenceState: RoomMember["presenceState"];
  playbackActive: boolean;
  isLocal: boolean;
  localMemberState: LocalMemberPanelState | null;
  diagnostic: PeerDiagnosticsSnapshot | undefined;
  now?: number;
}): MemberAudibleStatus {
  if (input.presenceState === "offline") {
    return { label: "离线", tone: "neutral", active: false };
  }
  if (input.presenceState === "reconnecting") {
    return { label: "等待重连", tone: "warning", active: false };
  }
  if (!input.playbackActive) {
    return { label: "未播放", tone: "neutral", active: false };
  }

  if (input.isLocal) {
    if (input.localMemberState?.audible === true) {
      return { label: "正在发声", tone: "success", active: true };
    }
    if (input.localMemberState?.audible === false) {
      return { label: "未发声", tone: "warning", active: false };
    }
    return { label: "等待音频", tone: "accent", active: false };
  }

  const reportedAt = input.diagnostic?.reportedAudibleAt ?? input.diagnostic?.reportedTelemetryAt;
  const reportedAtMs = reportedAt ? Date.parse(reportedAt) : Number.NaN;
  const sampleAgeMs = Number.isFinite(reportedAtMs)
    ? Math.max(0, (input.now ?? Date.now()) - reportedAtMs)
    : null;
  if (sampleAgeMs === null || sampleAgeMs > memberReportedTelemetryFreshMs) {
    return { label: "等待音频", tone: "accent", active: false };
  }

  if (typeof input.diagnostic?.reportedAudible === "boolean") {
    return input.diagnostic.reportedAudible
      ? { label: "正在发声", tone: "success", active: true }
      : { label: "未发声", tone: "warning", active: false };
  }

  // Older peers do not send an explicit audible flag. Their fresh self-reported
  // RTP traffic remains a useful compatibility signal until they reconnect.
  const hasReportedTraffic =
    (input.diagnostic?.reportedSendRateKbps ?? 0) > 0 ||
    (input.diagnostic?.reportedReceiveRateKbps ?? 0) > 0;
  if (input.diagnostic?.reportedAudible === null && !hasReportedTraffic) {
    return { label: "等待音频", tone: "accent", active: false };
  }
  return hasReportedTraffic
    ? { label: "正在发声", tone: "success", active: true }
    : { label: "未发声", tone: "warning", active: false };
}

export function resolveMemberMediaRates(input: {
  diagnostic: PeerDiagnosticsSnapshot | undefined;
  isLocal: boolean;
  localMemberState: LocalMemberPanelState | null;
  now?: number;
}) {
  const now = input.now ?? Date.now();

  if (input.isLocal) {
    const sampleAgeMs = input.localMemberState?.mediaSummary?.sampleAgeMs ?? null;
    const localFresh =
      sampleAgeMs === null || sampleAgeMs <= memberReportedTelemetryFreshMs;
    const sendRateKbps = localFresh
      ? input.localMemberState?.mediaSummary?.sendRateKbps ??
        input.diagnostic?.reportedSendRateKbps ??
        input.diagnostic?.mediaSendBitrateKbps ??
        null
      : null;
    const receiveRateKbps = localFresh
      ? input.localMemberState?.mediaSummary?.receiveRateKbps ??
        input.diagnostic?.reportedReceiveRateKbps ??
        input.diagnostic?.mediaReceiveBitrateKbps ??
        null
      : null;
    return {
      sendRateKbps,
      receiveRateKbps,
      sampleAgeMs
    };
  }

  // Only use the remote peer's self-reported aggregate rates. Local path samples
  // (mediaSend/Receive on this browser) describe this browser's link, not that member's totals.
  const reportedAt = input.diagnostic?.reportedTelemetryAt;
  const reportedAtMs = reportedAt ? Date.parse(reportedAt) : Number.NaN;
  const sampleAgeMs = Number.isFinite(reportedAtMs) ? Math.max(0, now - reportedAtMs) : null;
  const reportedFresh =
    sampleAgeMs !== null && sampleAgeMs <= memberReportedTelemetryFreshMs;
  if (!reportedFresh) {
    return {
      sendRateKbps: null,
      receiveRateKbps: null,
      sampleAgeMs
    };
  }

  return {
    sendRateKbps: input.diagnostic?.reportedSendRateKbps ?? null,
    receiveRateKbps: input.diagnostic?.reportedReceiveRateKbps ?? null,
    sampleAgeMs
  };
}

function MemberTelemetry({
  diagnostic,
  isLocal,
  localMemberState,
  now
}: {
  diagnostic: PeerDiagnosticsSnapshot | undefined;
  isLocal: boolean;
  localMemberState: LocalMemberPanelState | null;
  now: number;
}) {
  const rates = resolveMemberMediaRates({ diagnostic, isLocal, localMemberState, now });
  const receiveRate = rates.receiveRateKbps;
  const sendRate = rates.sendRateKbps;
  const telemetry = isLocal
    ? [
        `上传 ${formatTelemetryMetric(sendRate, " kbps")}`,
        `下载 ${formatTelemetryMetric(receiveRate, " kbps")}`
      ]
    : [
        `上传 ${formatTelemetryMetric(sendRate, " kbps")}`,
        `下载 ${formatTelemetryMetric(receiveRate, " kbps")}`,
        `延迟 ${formatTelemetryMetric(diagnostic?.currentRoundTripTimeMs, " ms")}`
      ];

  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] leading-4 text-foreground-muted/80">
      {telemetry.map((item) => <span key={item} className="whitespace-nowrap">{item}</span>)}
    </p>
  );
}

function MembersPanelBase({
  members,
  peerDiagnostics = [],
  localMemberState = null,
  playbackStatus: roomPlaybackStatus,
  sourcePeerId
}: MembersPanelProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let intervalId: number | null = null;
    const refresh = () => setNow(Date.now());
    const start = () => {
      if (intervalId === null && document.visibilityState === "visible") {
        intervalId = window.setInterval(refresh, 1_000);
      }
    };
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibilityChange = () => {
      refresh();
      if (document.visibilityState === "visible") start();
      else stop();
    };

    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

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
            const audible = getMemberAudibleStatus({
              presenceState: member.presenceState,
              playbackActive: roomPlaybackStatus === "playing",
              isLocal,
              localMemberState,
              diagnostic,
              now
            });

            return (
              <article key={member.id} className="py-2.5 first:pt-2.5 last:pb-2.5">
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
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getToneClasses(audible.tone)}`}
                      aria-label={`音频状态：${audible.label}`}
                    >
                      {audible.label}
                    </span>
                    {member.presenceState === "online" && status.label !== "正常出声" ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${getToneClasses(status.tone)}`}>
                        {status.label}
                      </span>
                    ) : null}
                    {roomPlaybackStatus === "playing" && isCurrentSource ? (
                      <span className="text-[10px] text-accent">当前音源</span>
                    ) : null}
                  </div>
                  {member.presenceState === "online" ? (
                    <MemberTelemetry
                      diagnostic={diagnostic}
                      isLocal={isLocal}
                      localMemberState={localMemberState}
                      now={now}
                    />
                  ) : null}
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
