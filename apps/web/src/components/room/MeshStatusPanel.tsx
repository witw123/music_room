"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMember,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatTransferRateMBps } from "@/lib/music-room-ui";
import type { LocalMemberPanelState } from "./MembersPanel";

export type AvailabilityEntry = {
  track: TrackMeta;
  peerCount: number;
  remotePeerCount: number;
  localChunkCount: number;
  totalChunks: number;
  sources: string[];
  cachedMemberNicknames: string[];
};

type MeshStatusPanelProps = {
  members: RoomMember[];
  connectedPeersCount: number;
  localMemberState: LocalMemberPanelState | null;
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
  return value ? formatTimestamp(value) : "未知";
}

function formatMetric(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return "未知";
  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

function formatRate(value: number | null | undefined) {
  return value === null || value === undefined ? "未知" : formatTransferRateMBps(value);
}

function formatDuration(ms: number) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
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
  if (!peer.dataCandidateType) return null;
  const protocol = peer.dataRelayProtocol ?? peer.dataProtocol;
  return peer.dataCandidateType === "relay"
    ? `数据通道经过 relay${protocol ? `/${protocol}` : ""}`
    : `数据通道 direct (${peer.dataCandidateType}${protocol ? `/${protocol}` : ""})`;
}

function PeerDiagnosticCard({ peer, label }: { peer: PeerDiagnosticsSnapshot; label: string }) {
  return (
    <details className="rounded-lg border border-surface-border bg-background/25 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <strong className="truncate text-xs text-foreground">{label}</strong>
            <p className="mt-1 text-[10px] text-foreground-muted">
              {describeCandidatePath(peer) ??
                `数据 ${peer.dataConnectionState ?? "未知"} / channel ${peer.dataChannelState ?? "未知"}`}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${getHealthClass(peer)}`}>
            {peer.transportHealth ?? "未知"}
          </span>
        </div>
        {peer.lastError ? <p className="mt-2 text-[10px] text-red-300">{peer.lastError}</p> : null}
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DiagnosticSection title="DataChannel">
          <DiagnosticGrid>
            <span>连接: {peer.dataConnectionState ?? "未知"}</span>
            <span>通道: {peer.dataChannelState ?? "未知"}</span>
            <span>候选: {peer.dataCandidateType ?? "未知"}</span>
            <span>协议: {peer.dataRelayProtocol ?? peer.dataProtocol ?? "未知"}</span>
            <span>RTT: {formatMetric(peer.currentRoundTripTimeMs, "ms")}</span>
            <span>发送队列: {formatMetric(peer.dataBufferedAmountBytes, " bytes")}</span>
            <span>接收: {formatRate(peer.transportReceiveBitrateKbps)}</span>
            <span>发送: {formatRate(peer.transportSendBitrateKbps)}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
        <DiagnosticSection title="v4 资产传输">
          <DiagnosticGrid>
            <span>单元下载: {formatRate(peer.pieceDownloadRateKbps)}</span>
            <span>单元上传: {formatRate(peer.pieceUploadRateKbps)}</span>
            <span>单元 RTT p50: {formatMetric(peer.pieceRttMsP50, "ms")}</span>
            <span>单元 RTT p95: {formatMetric(peer.pieceRttMsP95, "ms")}</span>
            <span>请求超时率: {formatMetric(peer.pieceTimeoutRate, "%")}</span>
            <span>最近单元: {formatMaybeTimestamp(peer.lastPieceReceivedAt)}</span>
            <span>校验队列: {formatMetric(peer.validationQueueBytes, " bytes")}</span>
            <span>持久化积压: {formatMetric(peer.persistenceBacklogBytes, " bytes")}</span>
          </DiagnosticGrid>
        </DiagnosticSection>
      </div>
    </details>
  );
}

function MeshStatusPanelBase({
  members,
  connectedPeersCount,
  localMemberState,
  peerDiagnostics,
  recentEvents,
  iceConfigSource,
  iceConfigStatus,
  onVisibilityChange
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => onVisibilityChange?.(isOpen), [isOpen, onVisibilityChange]);
  useEffect(() => () => onVisibilityChange?.(false), [onVisibilityChange]);

  const onlineCount = useMemo(
    () => members.filter((member) => member.presenceState === "online").length,
    [members]
  );
  const activePeerIds = useMemo(
    () => new Set(members.flatMap((member) => member.peerId ? [member.peerId] : [])),
    [members]
  );
  const dataReadyCount = useMemo(
    () => peerDiagnostics.filter(
      (peer) => activePeerIds.has(peer.peerId) && peer.dataChannelState === "open"
    ).length,
    [activePeerIds, peerDiagnostics]
  );
  const degradedCount = useMemo(
    () => peerDiagnostics.filter(
      (peer) => activePeerIds.has(peer.peerId) &&
        ["degraded", "recovering", "reconnecting", "failed"].includes(peer.transportHealth ?? "")
    ).length,
    [activePeerIds, peerDiagnostics]
  );
  const memberLabelByPeerId = useMemo(
    () => new Map(members.flatMap((member) => member.peerId
      ? [[member.peerId, `${member.nickname} · ${member.role === "host" ? "房主" : "成员"}`] as const]
      : [])),
    [members]
  );
  const visibleEvents = recentEvents.slice(0, 8);
  const playback = localMemberState?.segmentedPlayback ?? null;

  return (
    <section className="flex w-full flex-col gap-4 border-t border-surface-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">分段播放诊断</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            直接读取 v4 播放器、播放资产与 DataChannel 状态。
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? "收起" : "开发详情"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-foreground-muted">
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">在线: {onlineCount}</span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">Data: {dataReadyCount}</span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          播放: {localMemberState?.playbackStatus.label ?? "等待房间状态"}
        </span>
        <span className={`rounded border px-2 py-1 ${degradedCount > 0 ? "border-amber-500/25 bg-amber-500/10 text-amber-300" : "border-surface-border bg-background/40"}`}>
          异常: {degradedCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-surface-border pt-4 text-xs sm:grid-cols-3">
        <div><span className="text-[10px] text-foreground-muted">实际播放</span><strong className="mt-1 block text-foreground">{localMemberState?.playbackStatus.label ?? "等待房间状态"}</strong></div>
        <div><span className="text-[10px] text-foreground-muted">播放引擎</span><strong className="mt-1 block text-foreground">分段 Opus</strong></div>
        <div><span className="text-[10px] text-foreground-muted">音频码率</span><strong className="mt-1 block text-foreground">{localMemberState?.playbackBitrateKbps ?? "--"} kbps</strong></div>
        <div><span className="text-[10px] text-foreground-muted">前向可播</span><strong className="mt-1 block text-foreground">{formatDuration(playback?.bufferedMs ?? 0)}</strong></div>
        <div><span className="text-[10px] text-foreground-muted">AudioContext</span><strong className="mt-1 block text-foreground">{playback?.audioContextState ?? "未创建"}</strong></div>
        <div><span className="text-[10px] text-foreground-muted">当前问题</span><strong className={`mt-1 block ${playback?.lastError ? "text-amber-300" : "text-foreground"}`}>{playback?.lastError ?? "无"}</strong></div>
      </div>

      {isOpen ? (
        <div className="flex flex-col gap-3">
          {localMemberState && playback ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <DiagnosticSection title="分段播放器">
                <DiagnosticGrid>
                  <span>状态: {playback.state}</span>
                  <span>AudioContext: {playback.audioContextState ?? "未创建"}</span>
                  <span>前向可播: {formatDuration(playback.bufferedMs)}</span>
                  <span>持有单元: {playback.ownedUnitCount}/{playback.totalUnitCount || 0}</span>
                  <span>音频码率: {localMemberState.playbackBitrateKbps ?? "--"} kbps</span>
                  <span>最近错误: {playback.lastError ?? "无"}</span>
                </DiagnosticGrid>
              </DiagnosticSection>
              <DiagnosticSection title="本机资产传输">
                <DiagnosticGrid>
                  <span>下载: {formatRate(localMemberState.pieceSummary.downloadRateKbps)}</span>
                  <span>上传: {formatRate(localMemberState.pieceSummary.uploadRateKbps)}</span>
                  <span>Data 接收: {formatRate(localMemberState.transportSummary.receiveRateKbps)}</span>
                  <span>Data 发送: {formatRate(localMemberState.transportSummary.sendRateKbps)}</span>
                  <span>RTT: {formatMetric(localMemberState.transportSummary.latencyMs, "ms")}</span>
                  <span>就绪通道: {localMemberState.dataReadyCount}</span>
                </DiagnosticGrid>
              </DiagnosticSection>
              <DiagnosticSection title="房间连接">
                <DiagnosticGrid>
                  <span>DataChannel: {dataReadyCount}</span>
                  <span>已连接成员: {connectedPeersCount}</span>
                  <span>在线成员: {onlineCount}</span>
                  <span>异常链路: {degradedCount}</span>
                </DiagnosticGrid>
              </DiagnosticSection>
              <DiagnosticSection title="ICE">
                <DiagnosticGrid>
                  <span>配置来源: {iceConfigSource}</span>
                  <span>{iceConfigStatus}</span>
                </DiagnosticGrid>
              </DiagnosticSection>
            </div>
          ) : null}

          {peerDiagnostics.length ? (
            <div className="flex flex-col gap-2">
              {peerDiagnostics.map((peer) => (
                <PeerDiagnosticCard
                  key={peer.peerId}
                  peer={peer}
                  label={peer.peerId === "system" ? "本机" : memberLabelByPeerId.get(peer.peerId) ?? "房间成员"}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
              当前没有可展示的活跃链路诊断。
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
