"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { PeerDiagnosticsSnapshot, PeerRecentEvent, RoomMember } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { dedupePeerDiagnostics, dedupeRoomMembers } from "./member-data";

type MeshStatusPanelProps = {
  members: RoomMember[];
  peerDiagnostics: PeerDiagnosticsSnapshot[];
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

function formatMaybeTimestamp(value: string | null | undefined) {
  return value ? formatTimestamp(value) : "暂无";
}

function formatMetric(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return "暂无";
  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
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

function getHealthClass(peer: PeerDiagnosticsSnapshot) {
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
  return `${candidate ?? "未知候选"}${protocol ? ` / ${protocol}` : ""}`;
}

function PeerDiagnosticCard({ peer, label }: { peer: PeerDiagnosticsSnapshot; label: string }) {
  return (
    <details className="rounded-lg border border-surface-border bg-background/25 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <strong className="truncate text-xs text-foreground">{label}</strong>
            <p className="mt-1 text-[10px] text-foreground-muted">
              数据 {peer.dataChannelState ?? "未建立"} · 媒体 {peer.mediaConnectionState ?? "未建立"}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${getHealthClass(peer)}`}>
            {peer.transportHealth ?? "暂无状态"}
          </span>
        </div>
        {peer.lastError ? <p className="mt-2 text-[10px] text-red-300">{peer.lastError}</p> : null}
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DiagnosticSection title="连接路径">
          <DiagnosticGrid>
            <span>路径: {describeCandidatePath(peer)}</span>
            <span>数据 ICE: {peer.dataIceState ?? "暂无"}</span>
            <span>媒体 ICE: {peer.mediaIceState ?? "暂无"}</span>
            <span>RTT: {formatMetric(peer.currentRoundTripTimeMs, "ms")}</span>
            <span>数据协议: {peer.dataRelayProtocol ?? peer.dataProtocol ?? "暂无"}</span>
            <span>发送队列: {formatMetric(peer.dataBufferedAmountBytes, " bytes")}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
        <DiagnosticSection title="音频轨道">
          <DiagnosticGrid>
            <span>编码: {peer.opusCodec ?? "暂无"}</span>
            <span>发送轨道: {peer.senderTrackId ?? "暂无"}</span>
            <span>接收轨道: {peer.receiverTrackId ?? "暂无"}</span>
            <span>媒体包: {formatMaybeTimestamp(peer.lastMediaPacketAt)}</span>
            <span>发送连接: {peer.mediaConnectionState ?? "暂无"}</span>
            <span>最近恢复: {peer.lastRecoveryAction ?? "暂无"}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
      </div>
    </details>
  );
}

function MeshStatusPanelBase({
  members,
  peerDiagnostics,
  recentEvents,
  iceConfigSource,
  iceConfigStatus,
  onVisibilityChange
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => onVisibilityChange?.(isOpen), [isOpen, onVisibilityChange]);
  useEffect(() => () => onVisibilityChange?.(false), [onVisibilityChange]);

  const normalizedMembers = useMemo(() => dedupeRoomMembers(members), [members]);
  const normalizedDiagnostics = useMemo(
    () => dedupePeerDiagnostics(peerDiagnostics),
    [peerDiagnostics]
  );
  const activePeerIds = useMemo(
    () => new Set(normalizedMembers.flatMap((member) => member.peerId ? [member.peerId] : [])),
    [normalizedMembers]
  );
  const memberLabelByPeerId = useMemo(
    () => new Map(normalizedMembers.flatMap((member) => member.peerId
      ? [[member.peerId, `${member.nickname} · ${member.role === "host" ? "房主" : "成员"}`] as const]
      : [])),
    [normalizedMembers]
  );
  const visibleDiagnostics = normalizedDiagnostics.filter(
    (peer) => peer.peerId === "system" || activePeerIds.has(peer.peerId)
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
            {visibleDiagnostics.length} 条唯一诊断样本
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
              <span>配置来源: {iceConfigSource}</span>
              <span>{iceConfigStatus}</span>
            </DiagnosticGrid>
          </DiagnosticSection>

          {visibleDiagnostics.length > 0 ? (
            <div className="flex flex-col gap-2">
              {visibleDiagnostics.map((peer) => (
                <PeerDiagnosticCard
                  key={peer.peerId}
                  peer={peer}
                  label={peer.peerId === "system" ? "本机" : memberLabelByPeerId.get(peer.peerId) ?? "房间成员"}
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
