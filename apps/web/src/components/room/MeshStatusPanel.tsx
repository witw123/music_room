"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMember,
  RoomSnapshot
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { dedupePeerDiagnostics, dedupeRoomMembers } from "./member-data";
import {
  getMemberAudibleStatus,
  isMemberCurrentSource,
  resolveMemberMediaRates,
  type LocalMemberPanelState
} from "./MembersPanel";

type MeshStatusPanelProps = {
  members: RoomMember[];
  activeSessionId: string | null;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  localMemberState: LocalMemberPanelState | null;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  sourceSessionId: string | null;
  sourcePeerId: string | null;
  recentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  onVisibilityChange?: (open: boolean) => void;
};

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

function formatMetric(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return "暂无";
  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

function formatConnectionState(value: string | null | undefined) {
  const labels: Record<string, string> = {
    new: "未开始",
    checking: "检查中",
    connected: "已连接",
    completed: "已完成",
    disconnected: "已断开",
    failed: "连接失败",
    closed: "已关闭",
    open: "已连接",
    connecting: "连接中"
  };
  return value ? labels[value] ?? "状态未知" : "未建立";
}

function formatHealth(value: PeerDiagnosticsSnapshot["transportHealth"]) {
  const labels: Record<string, string> = {
    healthy: "正常",
    "media-only": "音频正常",
    degraded: "质量下降",
    recovering: "恢复中",
    reconnecting: "重连中",
    failed: "失败"
  };
  return value ? labels[value] ?? "状态未知" : "暂无状态";
}

function formatPresence(member: RoomMember) {
  if (member.presenceState === "online") return "在线";
  if (member.presenceState === "reconnecting") return "重连中";
  return "离线";
}

function formatRoomPlaybackStatus(value: RoomSnapshot["room"]["playback"]["status"]) {
  if (value === "playing") return "播放中";
  if (value === "paused") return "已暂停";
  return "待机";
}

function formatSampleAge(value: number | null) {
  if (value === null) return "暂无采样";
  if (value < 1_000) return "刚刚";
  return `${Math.round(value / 1_000)} 秒前`;
}

function formatPlaybackTransport(value: PeerDiagnosticsSnapshot["playbackTransport"]) {
  if (value === "segmented-opus-local") return "本地分段音频";
  if (value === "webrtc-opus-remote") return "WebRTC Opus";
  return "暂无";
}

function formatListenerPlaybackState(value: PeerDiagnosticsSnapshot["segmentedPlaybackStatus"] | undefined) {
  const labels: Record<string, string> = {
    idle: "待机",
    "awaiting-unlock": "等待解锁",
    buffering: "缓冲中",
    live: "播放中",
    paused: "已暂停",
    failed: "播放失败"
  };
  return value?.listenerPlaybackState ? labels[value.listenerPlaybackState] ?? "状态未知" : "暂无";
}

function formatAudioEvent(value: PeerDiagnosticsSnapshot["remoteTrackStatus"]["lastAudioEvent"]) {
  if (value === "playing") return "播放事件";
  if (value === "waiting") return "等待音频";
  if (value === "pause") return "已暂停";
  if (value === "error") return "音频错误";
  return "暂无";
}

function formatPlaybackPath(value: LocalMemberPanelState["playbackPath"]) {
  const labels: Record<string, string> = {
    "local-file": "本地文件",
    "local-segmented": "本地分段",
    "remote-stream": "远程流",
    "broadcast-segmented": "广播分段"
  };
  return value ? labels[value] ?? value : "暂无";
}

function formatIceSource(value: string) {
  const labels: Record<string, string> = {
    "short-lived-turn": "短期 TURN",
    "static-fallback": "静态备用配置",
    "stun-only": "仅 STUN",
    loading: "获取中"
  };
  return labels[value] ?? value;
}

function formatEventLabel(event: PeerRecentEvent) {
  const channels: Record<PeerRecentEvent["channelKind"], string> = {
    data: "数据",
    media: "音频",
    system: "系统"
  };
  const directions: Record<PeerRecentEvent["direction"], string> = {
    sent: "发出",
    received: "收到",
    local: "本地"
  };
  return `[${channels[event.channelKind]}/${directions[event.direction]}] ${event.summary}`;
}

function getHealthClass(peer: PeerDiagnosticsSnapshot | undefined) {
  if (!peer) {
    return "border-surface-border bg-background/60 text-foreground-muted";
  }
  if (peer.transportHealth === "healthy") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  }
  if (peer.transportHealth === "failed") {
    return "border-red-500/25 bg-red-500/10 text-red-300";
  }
  if (["degraded", "recovering", "reconnecting"].includes(peer.transportHealth ?? "")) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  }
  return "border-surface-border bg-background/60 text-foreground-muted";
}

function getPlaybackClass(tone: "neutral" | "accent" | "success" | "warning" | "danger") {
  if (tone === "success") return "text-emerald-300";
  if (tone === "danger") return "text-red-300";
  if (tone === "warning") return "text-amber-300";
  if (tone === "accent") return "text-accent";
  return "text-foreground-muted";
}

function getEventClass(level: PeerRecentEvent["level"]) {
  if (level === "error") return "border-red-500/20 bg-red-500/10";
  if (level === "warning") return "border-amber-500/20 bg-amber-500/10";
  return "border-surface-border bg-black/20";
}

function DiagnosticGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[10px] leading-4 text-foreground-muted sm:grid-cols-2 [&_span]:min-w-0 [&_span]:break-words">
      {children}
    </div>
  );
}

function DiagnosticSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-surface-border pt-3">
      <h3 className="mb-2 text-[10px] font-semibold text-foreground-muted">{title}</h3>
      {children}
    </section>
  );
}

function describeCandidatePath(peer: PeerDiagnosticsSnapshot) {
  const candidate = peer.mediaCandidateType ?? peer.dataCandidateType;
  const protocol = peer.mediaProtocol ?? peer.dataRelayProtocol ?? peer.dataProtocol;
  if (!candidate && !protocol) return "路径暂无样本";
  const candidateLabels: Record<string, string> = {
    host: "直连",
    srflx: "NAT 直连",
    prflx: "点对点",
    relay: "中继"
  };
  const protocolLabels: Record<string, string> = {
    udp: "UDP",
    tcp: "TCP",
    tls: "TLS"
  };
  return `${candidate ? candidateLabels[candidate] ?? candidate : "未知路径"}${protocol ? ` / ${protocolLabels[protocol] ?? protocol}` : ""}`;
}

function formatTrackStatus(peer: PeerDiagnosticsSnapshot | undefined) {
  const track = peer?.remoteTrackStatus;
  if (!track) return "暂无";
  if (track.trackReadyState === "live") {
    return track.trackMuted ? "已建立 · 静音" : "已建立";
  }
  if (track.trackReadyState === "ended") return "已结束";
  return track.received ? "已收到" : "未收到";
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[3.35rem] min-w-0 flex-col justify-center px-3 py-2 first:border-r first:border-surface-border sm:px-3.5">
      <span className="text-[10px] text-foreground-muted">{label}</span>
      <strong className="mt-1 truncate text-xs font-semibold text-foreground">{value}</strong>
    </div>
  );
}

function MemberDiagnosticCard({
  member,
  activeSessionId,
  peer,
  localMemberState,
  playbackStatus,
  sourceSessionId,
  sourcePeerId
}: {
  member: RoomMember;
  activeSessionId: string | null;
  peer: PeerDiagnosticsSnapshot | undefined;
  localMemberState: LocalMemberPanelState | null;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  sourceSessionId: string | null;
  sourcePeerId: string | null;
}) {
  const isLocal = member.id === activeSessionId;
  const isCurrentSource = isMemberCurrentSource({
    member,
    sourceSessionId,
    sourcePeerId
  });
  const audibleStatus = getMemberAudibleStatus({
    presenceState: member.presenceState,
    playbackActive: playbackStatus === "playing",
    isLocal,
    isCurrentSource,
    localMemberState: isLocal ? localMemberState : null,
    diagnostic: peer
  });
  const memberPlaybackStatus = isLocal
    ? localMemberState?.playbackStatus.label ?? audibleStatus.label
    : audibleStatus.label;
  const mediaRates = resolveMemberMediaRates({
    diagnostic: peer,
    isLocal,
    localMemberState: isLocal ? localMemberState : null
  });
  const connectionState = peer
    ? `${formatConnectionState(peer.dataChannelState)} / ${formatConnectionState(peer.mediaConnectionState)}`
    : "暂无样本";
  const playbackPath = isLocal
    ? formatPlaybackPath(localMemberState?.playbackPath)
    : formatPlaybackTransport(peer?.playbackTransport ?? null);
  const memberLabel = `${member.nickname} · ${member.role === "host" ? "房主" : "成员"}`;

  return (
    <details className="min-h-[14rem] rounded-lg border border-surface-border bg-background/25 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="min-h-[10.75rem]">
          <div className="flex min-h-[4.7rem] items-start justify-between gap-3">
            <div className="min-w-0">
              <strong className="block truncate text-xs text-foreground">{memberLabel}</strong>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                <span className={getPlaybackClass(audibleStatus.tone)}>播放：{memberPlaybackStatus}</span>
                <span className="text-foreground-muted">在线：{formatPresence(member)}</span>
              </div>
              <p className="mt-1 truncate text-[10px] text-foreground-muted">连接：{connectionState}</p>
            </div>
            <span className={`min-w-[3.5rem] shrink-0 rounded-full border px-2 py-0.5 text-center text-[10px] ${getHealthClass(peer)}`}>
              {formatHealth(peer?.transportHealth)}
            </span>
          </div>

          <div className="grid min-h-[3.35rem] grid-cols-2 border-y border-surface-border">
            <DiagnosticMetric label="成员上行" value={formatMetric(mediaRates.sendRateKbps, " kbps")} />
            <DiagnosticMetric label="成员下行" value={formatMetric(mediaRates.receiveRateKbps, " kbps")} />
          </div>
        </div>
        <p className={`mt-2 min-h-4 text-[10px] text-red-300 ${peer?.lastError ? "" : "invisible"}`}>
          {peer?.lastError ?? "暂无错误"}
        </p>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DiagnosticSection title="连接路径">
          <DiagnosticGrid>
            <span>网络路径：{peer ? describeCandidatePath(peer) : "路径暂无样本"}</span>
            <span>往返延迟：{formatMetric(peer?.currentRoundTripTimeMs, " ms")}</span>
            <span>数据通道：{formatConnectionState(peer?.dataChannelState)}</span>
            <span>音频通道：{formatConnectionState(peer?.mediaConnectionState)}</span>
            <span>数据 ICE：{formatConnectionState(peer?.dataIceState)}</span>
            <span>媒体 ICE：{formatConnectionState(peer?.mediaIceState)}</span>
            <span>连接健康：{formatHealth(peer?.transportHealth)}</span>
            <span>数据缓冲：{formatMetric(peer?.dataBufferedAmountBytes, " bytes")}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
        <DiagnosticSection title="实际音频流量">
          <DiagnosticGrid>
            <span>成员上行：{formatMetric(mediaRates.sendRateKbps, " kbps")}</span>
            <span>成员下行：{formatMetric(mediaRates.receiveRateKbps, " kbps")}</span>
            <span>采样状态：{formatSampleAge(mediaRates.sampleAgeMs)}</span>
            <span>链路上行：{formatMetric(peer?.mediaSendBitrateKbps, " kbps")}</span>
            <span>链路下行：{formatMetric(peer?.mediaReceiveBitrateKbps, " kbps")}</span>
            <span>丢包：{formatMetric(peer?.packetLossRate, "%")}</span>
            <span>抖动：{formatMetric(peer?.jitterMs ?? peer?.receiverJitterTargetMs, " ms")}</span>
            <span>音频编码：{peer?.opusCodec ?? "暂无"}</span>
            <span>目标码率：{formatMetric(peer?.targetAudioBitrateKbps, " kbps")}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
        <DiagnosticSection title="播放与音频状态">
          <DiagnosticGrid>
            <span>房间播放：{formatRoomPlaybackStatus(playbackStatus)}</span>
            <span>成员播放：{memberPlaybackStatus}</span>
            <span>音频表现：{audibleStatus.label}</span>
            <span>播放链路：{playbackPath}</span>
            <span>监听状态：{formatListenerPlaybackState(peer?.segmentedPlaybackStatus)}</span>
            <span>媒体轨道：{formatTrackStatus(peer)}</span>
            <span>音频事件：{formatAudioEvent(peer?.remoteTrackStatus?.lastAudioEvent ?? null)}</span>
            <span>缓冲：{formatMetric(peer?.segmentedPlaybackStatus?.bufferedAheadMs, " ms")}</span>
            <span>音频上下文：{peer?.segmentedPlaybackStatus?.audioContextState ?? "暂无"}</span>
            <span>恢复状态：{peer?.segmentedPlaybackStatus?.mediaRecoveryState ?? "暂无"}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
      </div>
    </details>
  );
}

function MeshStatusPanelBase({
  members,
  activeSessionId,
  peerDiagnostics,
  localMemberState,
  playbackStatus,
  sourceSessionId,
  sourcePeerId,
  recentEvents,
  iceConfigSource,
  iceConfigStatus,
  onVisibilityChange
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => onVisibilityChange?.(isOpen), [isOpen, onVisibilityChange]);
  useEffect(() => () => onVisibilityChange?.(false), [onVisibilityChange]);

  const memberOrderRef = useRef(new Map<string, number>());
  const normalizedMembers = useMemo(() => {
    const nextMembers = dedupeRoomMembers(members);
    let nextOrder = memberOrderRef.current.size;
    for (const member of nextMembers) {
      if (!memberOrderRef.current.has(member.id)) {
        memberOrderRef.current.set(member.id, nextOrder);
        nextOrder += 1;
      }
    }
    return [...nextMembers].sort(
      (left, right) =>
        (memberOrderRef.current.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (memberOrderRef.current.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
  }, [members]);
  const normalizedDiagnostics = useMemo(
    () => dedupePeerDiagnostics(peerDiagnostics),
    [peerDiagnostics]
  );
  const activePeerIds = useMemo(
    () => new Set(normalizedMembers.flatMap((member) => member.peerId ? [member.peerId] : [])),
    [normalizedMembers]
  );
  const diagnosticByPeerId = useMemo(
    () => new Map(normalizedDiagnostics.map((peer) => [peer.peerId, peer] as const)),
    [normalizedDiagnostics]
  );
  const visibleDiagnostics = normalizedDiagnostics.filter(
    (peer) => activePeerIds.has(peer.peerId)
  );
  const visibleEvents = useMemo(
    () => [...new Map(recentEvents.map((event) => [event.id, event])).values()].slice(0, 8),
    [recentEvents]
  );

  return (
    <section className="flex w-full flex-col gap-3 border-t border-surface-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">连接诊断</h2>
          <p className="mt-1 text-[10px] text-foreground-muted">
            {normalizedMembers.length} 位成员 · {visibleDiagnostics.length} 条唯一诊断样本
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
        >
          {isOpen ? "收起" : "查看详情"}
        </Button>
      </div>

      {isOpen ? (
        <div className="flex flex-col gap-3">
          <DiagnosticSection title="ICE 配置">
            <DiagnosticGrid>
              <span>配置来源：{formatIceSource(iceConfigSource)}</span>
              <span>{iceConfigStatus}</span>
            </DiagnosticGrid>
          </DiagnosticSection>

          {normalizedMembers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {normalizedMembers.map((member) => (
                <MemberDiagnosticCard
                  key={member.id}
                  member={member}
                  activeSessionId={activeSessionId}
                  peer={member.peerId ? diagnosticByPeerId.get(member.peerId) : undefined}
                  localMemberState={localMemberState}
                  playbackStatus={playbackStatus}
                  sourceSessionId={sourceSessionId}
                  sourcePeerId={sourcePeerId}
                />
              ))}
            </div>
          ) : (
            <p className="border-y border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
              当前没有可展示的连接样本。
            </p>
          )}

          <details className="rounded-lg border border-surface-border bg-background/25 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">最近事件</summary>
            <div className="mt-3 flex flex-col gap-2">
              {visibleEvents.length ? visibleEvents.map((event) => (
                <div key={event.id} className={`rounded-lg border px-3 py-2 text-[10px] ${getEventClass(event.level)}`}>
                  <span className="text-foreground-muted">{formatTimestamp(event.timestamp)}</span>
                  <p className="mt-1 text-foreground">{formatEventLabel(event)}</p>
                </div>
              )) : <p className="text-[10px] text-foreground-muted">当前没有最近事件。</p>}
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}

export const MeshStatusPanel = memo(MeshStatusPanelBase);
