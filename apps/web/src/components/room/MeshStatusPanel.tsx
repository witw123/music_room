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
import { buildDiagnosticsViewModel } from "./diagnostics-view-model";

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
  availabilitySummary: AvailabilityEntry[];
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  localMemberState: LocalMemberPanelState | null;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  recentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  onVisibilityChange?: (open: boolean) => void;
};

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", { hour12: false });
}

function formatMaybeTimestamp(value: string | null | undefined) {
  return value ? formatTimestamp(value) : "未知";
}

function formatMetric(value: number | null | undefined, unit: string) {
  if (value === null || typeof value === "undefined") {
    return "未知";
  }

  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

function formatRateM(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "未知";
  }
  return formatTransferRateMBps(value);
}

function formatBoolean(value: boolean | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "未知";
  }

  return value ? "是" : "否";
}

function formatCandidateType(value: string | null | undefined) {
  if (!value) {
    return "未知";
  }

  if (value === "relay") {
    return "relay";
  }

  if (value === "host" || value === "srflx" || value === "prflx") {
    return `direct (${value})`;
  }

  return value;
}

function formatSampleAge(sampleAgeMs: number | null) {
  if (sampleAgeMs === null) {
    return "暂无样本";
  }

  const seconds = Math.max(0, Math.ceil(sampleAgeMs / 1000));
  return sampleAgeMs > 6_000 ? `stale · ${seconds}s前` : `${seconds}s前`;
}

function formatEventLabel(event: PeerRecentEvent) {
  const channelMap: Record<PeerRecentEvent["channelKind"], string> = {
    data: "数据",
    media: "音频",
    system: "系统"
  };
  const directionMap: Record<PeerRecentEvent["direction"], string> = {
    sent: "发出",
    received: "收到",
    local: "本地"
  };

  return `[${channelMap[event.channelKind]}/${directionMap[event.direction]}] ${event.summary}`;
}

function describeCandidatePath(peer: PeerDiagnosticsSnapshot) {
  if (peer.dataCandidateType) {
    const protocol = peer.dataRelayProtocol ?? peer.dataProtocol;
    const protocolLabel = protocol ? `/${protocol}` : "";
    return peer.dataCandidateType === "relay"
      ? `数据通道经过 relay${protocolLabel}`
      : `数据通道 direct (${peer.dataCandidateType}${protocolLabel})`;
  }

  if (peer.dataConnectionState || peer.dataChannelState) {
    return `数据 ${peer.dataConnectionState ?? "未知"} / channel ${peer.dataChannelState ?? "未知"}`;
  }

  return null;
}

function getHealthClass(peer: PeerDiagnosticsSnapshot) {
  switch (peer.transportHealth) {
    case "healthy":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
    case "degraded":
    case "recovering":
    case "reconnecting":
      return "border-amber-500/25 bg-amber-500/10 text-amber-300";
    case "failed":
      return "border-red-500/25 bg-red-500/10 text-red-300";
    default:
      return "border-surface-border bg-background/60 text-foreground-muted";
  }
}

function getEventClass(level: PeerRecentEvent["level"]) {
  switch (level) {
    case "error":
      return "border-red-500/20 bg-red-500/10";
    case "warning":
      return "border-amber-500/20 bg-amber-500/10";
    default:
      return "border-surface-border bg-black/20";
  }
}

function DiagnosticGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[10px] leading-4 text-foreground-muted sm:grid-cols-2 [&_span]:min-w-0 [&_span]:break-words">
      {children}
    </div>
  );
}

function DiagnosticBlock({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-background/30 p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-muted/80">
        {title}
      </h3>
      {children}
    </div>
  );
}

function PeerDiagnosticCard({
  peer,
  label
}: {
  peer: PeerDiagnosticsSnapshot;
  label: string;
}) {
  return (
    <details className="overflow-hidden rounded-lg border border-surface-border bg-background/30 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <strong className="truncate text-xs font-semibold text-foreground">{label}</strong>
            <p className="mt-1 text-[10px] text-foreground-muted">
              {describeCandidatePath(peer) ??
                `数据 ${peer.dataConnectionState ?? "未知"} / channel ${peer.dataChannelState ?? "未知"}`}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${getHealthClass(peer)}`}
          >
            {peer.transportHealth ?? "未知"}
          </span>
        </div>
        {peer.lastError ? <p className="mt-2 text-[10px] text-red-400">{peer.lastError}</p> : null}
      </summary>

      <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <DiagnosticBlock title="数据链路">
          <DiagnosticGrid>
            <span>数据连接: {peer.dataConnectionState ?? "未知"}</span>
            <span>DataChannel: {peer.dataChannelState ?? "未知"}</span>
            <span>链路类型: {formatCandidateType(peer.dataCandidateType)}</span>
            <span>协议: {peer.dataRelayProtocol ?? peer.dataProtocol ?? "暂无样本"}</span>
            <span>RTT: {formatMetric(peer.currentRoundTripTimeMs, "ms")}</span>
            <span>发送队列: {formatMetric(peer.dataBufferedAmountBytes, " bytes")}</span>
            <span>传输接收: {formatRateM(peer.transportReceiveBitrateKbps)}</span>
            <span>传输发送: {formatRateM(peer.transportSendBitrateKbps)}</span>
          </DiagnosticGrid>
          {peer.dataCandidateType === "relay" || peer.dataProtocol === "tcp" || peer.dataRelayProtocol === "tcp" ? (
            <p className="mt-2 text-[10px] text-amber-300">
              当前链路不满足缓存 UDP 要求，cache stream 将暂停并切换其他 provider。
            </p>
          ) : null}
          {peer.degradedReason ? (
            <p className="mt-2 text-[10px] text-amber-300">降级原因: {peer.degradedReason}</p>
          ) : null}
        </DiagnosticBlock>

        <DiagnosticBlock title="缓存传输">
          <DiagnosticGrid>
            <span>分片下载: {formatRateM(peer.pieceDownloadRateKbps)}</span>
            <span>分片上传: {formatRateM(peer.pieceUploadRateKbps)}</span>
            <span>分片 RTT p50: {formatMetric(peer.pieceRttMsP50, "ms")}</span>
            <span>分片 RTT p95: {formatMetric(peer.pieceRttMsP95, "ms")}</span>
            <span>请求超时率: {formatMetric(peer.pieceTimeoutRate, "%")}</span>
            <span>最近分片: {formatMaybeTimestamp(peer.lastPieceReceivedAt)}</span>
            <span>校验队列: {formatMetric(peer.validationQueueBytes, " bytes")}</span>
            <span>持久化积压: {formatMetric(peer.persistenceBacklogBytes, " bytes")}</span>
            <span>最近校验: {formatMaybeTimestamp(peer.lastValidatedAt)}</span>
            <span>最近落盘: {formatMaybeTimestamp(peer.lastPersistedAt)}</span>
          </DiagnosticGrid>
        </DiagnosticBlock>
      </div>
    </details>
  );
}

function MeshStatusPanelBase({
  members,
  availabilitySummary,
  connectedPeersCount,
  cachedTrackCount,
  localMemberState,
  peerDiagnostics,
  recentEvents,
  onVisibilityChange
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    onVisibilityChange?.(isOpen);
  }, [isOpen, onVisibilityChange]);

  useEffect(
    () => () => {
      onVisibilityChange?.(false);
    },
    [onVisibilityChange]
  );

  const onlineCount = useMemo(
    () => members.filter((member) => member.presenceState === "online").length,
    [members]
  );
  const activePeerIds = useMemo(
    () => new Set(members.map((member) => member.peerId).filter((peerId): peerId is string => !!peerId)),
    [members]
  );
  const dataReadyCount = useMemo(
    () =>
      peerDiagnostics.filter(
        (peer) => activePeerIds.has(peer.peerId) && peer.dataChannelState === "open"
      ).length,
    [activePeerIds, peerDiagnostics]
  );
  const degradedCount = useMemo(
    () =>
      peerDiagnostics.filter(
        (peer) =>
          activePeerIds.has(peer.peerId) &&
          (peer.transportHealth === "degraded" ||
            peer.transportHealth === "recovering" ||
            peer.transportHealth === "reconnecting" ||
            peer.transportHealth === "failed")
      ).length,
    [activePeerIds, peerDiagnostics]
  );
  const memberLabelByPeerId = useMemo(
    () =>
      new Map(
        members
          .filter((member) => !!member.peerId)
          .map((member) => [
            member.peerId!,
            `${member.nickname} · ${member.role === "host" ? "房主" : "成员"}`
          ])
      ),
    [members]
  );
  const localDiagnosticsView = useMemo(
    () =>
      buildDiagnosticsViewModel({
        presenceState: localMemberState?.presenceState,
        playback: localMemberState?.cachePlayback ?? null,
        playbackSampleAgeMs: localMemberState?.playbackSampleAgeMs ?? null,
        transfer: localMemberState?.pieceSummary ?? null,
        dataLink: {
          openCount: dataReadyCount,
          connectedPeerCount: connectedPeersCount
        }
      }),
    [connectedPeersCount, dataReadyCount, localMemberState]
  );
  const visibleAvailability = availabilitySummary.slice(0, 6);
  const visibleEvents = recentEvents.slice(0, 8);

  return (
    <section className="flex w-full flex-col gap-4 rounded-2xl border border-surface-border bg-surface/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">缓存播放诊断</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            默认展示可听、缓存与同步结论；需要定位问题时展开开发详情。
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? "收起" : "开发详情"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-medium text-foreground-muted">
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          在线: {onlineCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          Data: {dataReadyCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          播放: {localDiagnosticsView.audibility.label}
        </span>
        <span
          className={`rounded border px-2 py-1 ${
            degradedCount > 0
              ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
              : "border-surface-border bg-background/40"
          }`}
        >
          异常: {degradedCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          缓存库: {cachedTrackCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-surface-border pt-4 text-xs sm:grid-cols-3">
        <div>
          <span className="text-[10px] text-foreground-muted">实际播放</span>
          <strong className="mt-1 block text-foreground">{localDiagnosticsView.audibility.label}</strong>
        </div>
        <div>
          <span className="text-[10px] text-foreground-muted">播放模式</span>
          <strong className="mt-1 block text-foreground">{localDiagnosticsView.playbackMode}</strong>
        </div>
        <div>
          <span className="text-[10px] text-foreground-muted">缓存可读性</span>
          <strong className="mt-1 block text-foreground">
            PCM 连续 {localDiagnosticsView.cache.pcmContiguousChunks ?? 0} 片
          </strong>
        </div>
        <div>
          <span className="text-[10px] text-foreground-muted">缓冲健康</span>
          <strong className="mt-1 block text-foreground">
            {localDiagnosticsView.cache.healthLabel} · {localDiagnosticsView.cache.aheadLabel}
          </strong>
        </div>
        <div>
          <span className="text-[10px] text-foreground-muted">同步状态</span>
          <strong className="mt-1 block text-foreground">{localDiagnosticsView.sync.label}</strong>
        </div>
        <div>
          <span className="text-[10px] text-foreground-muted">当前问题</span>
          <strong className={`mt-1 block ${localDiagnosticsView.activeIssue ? "text-amber-300" : "text-foreground"}`}>
            {localDiagnosticsView.activeIssue ?? "无"}
          </strong>
        </div>
      </div>

      {isOpen ? (
        <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
          {localMemberState ? (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              <DiagnosticBlock title="音频与 PCM">
                <DiagnosticGrid>
                  <span>实际播放: {localDiagnosticsView.audibility.label}</span>
                  <span>模式: {localDiagnosticsView.playbackMode}</span>
                  <span>音频上下文: {localMemberState.cachePlayback?.pcmAudioContextState ?? "暂无样本"}</span>
                  <span>输出连接: {formatBoolean(localMemberState.cachePlayback?.pcmDirectOutputConnected)}</span>
                  <span>连续分片: {localMemberState.cachePlayback?.pcmContiguousChunkCount ?? "暂无样本"}</span>
                  <span>已解码段: {localMemberState.cachePlayback?.pcmDecodedSegmentCount ?? "暂无样本"}</span>
                  <span>已调度段: {localMemberState.cachePlayback?.pcmScheduledSegmentCount ?? "暂无样本"}</span>
                  <span>前向缓冲: {localDiagnosticsView.cache.aheadLabel}</span>
                </DiagnosticGrid>
              </DiagnosticBlock>

              <DiagnosticBlock title="缓存传输">
                <DiagnosticGrid>
                  <span>下载: {localDiagnosticsView.transfer.downloadLabel}</span>
                  <span>上传: {localDiagnosticsView.transfer.uploadLabel}</span>
                  <span>传输状态: {localDiagnosticsView.transfer.active ? "正在传输" : "当前无传输"}</span>
                  <span>样本: {formatSampleAge(localMemberState.pieceSummary.sampleAgeMs)}</span>
                </DiagnosticGrid>
              </DiagnosticBlock>

              <DiagnosticBlock title="同步">
                <DiagnosticGrid>
                  <span>状态: {localDiagnosticsView.sync.label}</span>
                  <span>{localDiagnosticsView.sync.detail}</span>
                  <span>时钟偏移: {formatMetric(localMemberState.cachePlayback?.serverClockOffsetMs, "ms")}</span>
                  <span>校准 RTT: {formatMetric(localMemberState.cachePlayback?.serverClockRoundTripMs, "ms")}</span>
                  <span>平均漂移: {formatMetric(localMemberState.cachePlayback?.averageDriftMs, "ms")}</span>
                  <span>最大漂移: {formatMetric(localMemberState.cachePlayback?.maxDriftMs, "ms")}</span>
                </DiagnosticGrid>
              </DiagnosticBlock>

              <DiagnosticBlock title="数据链路">
                <DiagnosticGrid>
                  <span>DataChannel: {dataReadyCount}</span>
                  <span>连接成员: {connectedPeersCount}</span>
                  <span>状态: {localDiagnosticsView.dataLink.label}</span>
                  <span>延迟: {formatMetric(localMemberState.transportSummary.latencyMs, "ms")}</span>
                  <span>发送队列: 见成员链路</span>
                  <span>样本: {formatSampleAge(localMemberState.transportSummary.sampleAgeMs)}</span>
                </DiagnosticGrid>
              </DiagnosticBlock>
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
            <div className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
              当前没有可展示的活跃链路诊断。
            </div>
          )}

          <details className="rounded-lg border border-surface-border bg-background/30 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">
              曲目分片摘要
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {visibleAvailability.length ? (
                visibleAvailability.map(({ track, peerCount, remotePeerCount, localChunkCount, totalChunks, sources }) => (
                  <div
                    key={track.id}
                    className="rounded-lg border border-surface-border bg-black/20 p-3 text-[10px]"
                  >
                    <strong className="block truncate text-xs text-foreground">{track.title}</strong>
                    <div className="mt-1 flex items-center justify-between text-foreground-muted">
                      <span>本地分片 {localChunkCount}/{totalChunks || 0}</span>
                      <span>可见/远端 {peerCount}/{remotePeerCount}</span>
                    </div>
                    {sources.length ? (
                      <p className="mt-1 truncate text-foreground-muted/80">
                        {sources.slice(0, 3).join(" / ")}
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-[10px] text-foreground-muted">当前还没有分片摘要。</p>
              )}
              {availabilitySummary.length > visibleAvailability.length ? (
                <p className="text-[10px] text-foreground-muted">
                  另有 {availabilitySummary.length - visibleAvailability.length} 首曲目已隐藏。
                </p>
              ) : null}
            </div>
          </details>

          <details className="rounded-lg border border-surface-border bg-background/30 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">
              最近事件
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {visibleEvents.length ? (
                visibleEvents.map((event) => (
                  <div
                    key={event.id}
                    className={`rounded-lg border px-3 py-2 text-[10px] ${getEventClass(event.level)}`}
                  >
                    <div className="flex items-center justify-between gap-2 text-foreground-muted">
                      <span>{formatTimestamp(event.timestamp)}</span>
                    </div>
                    <p className="mt-1 text-foreground">{formatEventLabel(event)}</p>
                  </div>
                ))
              ) : (
                <p className="text-[10px] text-foreground-muted">当前没有最近事件。</p>
              )}
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}

export const MeshStatusPanel = memo(MeshStatusPanelBase);
