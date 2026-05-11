"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMember,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import type { LocalMemberPanelState } from "./MembersPanel";

export type AvailabilityEntry = {
  track: TrackMeta;
  peerCount: number;
  localChunkCount: number;
  totalChunks: number;
  sources: string[];
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

function formatLevel(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "未知";
  }

  return value.toFixed(6);
}

function formatDurationMs(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "未知";
  }

  if (Math.abs(value) < 1000) {
    return `${Math.round(value)}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
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
    return peer.dataCandidateType === "relay"
      ? "数据通道经过 relay"
      : `数据通道 direct (${peer.dataCandidateType})`;
  }

  if (peer.dataConnectionState || peer.dataChannelState) {
    return `数据 ${peer.dataConnectionState ?? "未知"} / channel ${peer.dataChannelState ?? "未知"}`;
  }

  return null;
}

function getHealthClass(peer: PeerDiagnosticsSnapshot) {
  switch (peer.transportHealth) {
    case "healthy":
    case "media-only":
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

function PeerDiagnosticCard({ peer }: { peer: PeerDiagnosticsSnapshot }) {
  const playback = peer.progressivePlaybackStatus ?? null;

  return (
    <details className="overflow-hidden rounded-lg border border-surface-border bg-background/30 px-3 py-2">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <strong className="truncate text-xs font-semibold text-foreground">{peer.peerId}</strong>
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
            <span>恢复级别: {peer.recoveryActionLevel ?? "observe"}</span>
            <span>数据候选: {formatCandidateType(peer.dataCandidateType)}</span>
            <span>RTT: {formatMetric(peer.currentRoundTripTimeMs, "ms")}</span>
            <span>发送队列: {formatMetric(peer.dataBufferedAmountBytes, " bytes")}</span>
            <span>最近分片: {formatMaybeTimestamp(peer.lastPieceReceivedAt)}</span>
            <span>更新: {formatTimestamp(peer.updatedAt)}</span>
          </DiagnosticGrid>
          {peer.degradedReason ? (
            <p className="mt-2 text-[10px] text-amber-300">降级原因: {peer.degradedReason}</p>
          ) : null}
        </DiagnosticBlock>

        <DiagnosticBlock title="分片质量">
          <DiagnosticGrid>
            <span>可用上行: {formatMetric(peer.availableOutgoingBitrateKbps, " kbps")}</span>
            <span>分片下载: {formatMetric(peer.pieceDownloadRateKbps, " kbps")}</span>
            <span>分片上传: {formatMetric(peer.pieceUploadRateKbps, " kbps")}</span>
            <span>分片 RTT p50: {formatMetric(peer.pieceRttMsP50, "ms")}</span>
            <span>分片 RTT p95: {formatMetric(peer.pieceRttMsP95, "ms")}</span>
            <span>请求超时率: {formatMetric(peer.pieceTimeoutRate, "%")}</span>
            <span>最近数据活动: {formatMaybeTimestamp(peer.lastDataActivityAt)}</span>
          </DiagnosticGrid>
        </DiagnosticBlock>

        {playback ? (
          <DiagnosticBlock title="缓存播放运行时">
            <DiagnosticGrid>
              <span>播放源: {playback.activeSource ?? "等待缓存"}</span>
              <span>引擎: {playback.engineType ?? "none"}</span>
              <span>播放面: {playback.playbackSurfaceKey ?? "未知"}</span>
              <span>时间线: {playback.playbackTimelineKey ?? "未知"}</span>
              <span>房间变更: {playback.roomChangeKind ?? "未知"}</span>
              <span>恢复阶段: {playback.recoveryPhase ?? "未知"}</span>
              <span>调度: {playback.schedulerPolicy ?? "未激活"}</span>
              <span>启动就绪: {formatBoolean(playback.startupReady)}</span>
              <span>连续缓存: {formatDurationMs(playback.contiguousBufferedMs)}</span>
              <span>前向缓冲: {formatDurationMs(playback.aheadBufferedMs)}</span>
              <span>预计补齐: {formatDurationMs(playback.estimatedFillTimeMs)}</span>
              <span>安全余量: {formatDurationMs(playback.bufferSafetyMarginMs)}</span>
              <span>完整缓存: {formatBoolean(playback.fullLocalReady)}</span>
              <span>渐进可播: {formatBoolean(playback.progressiveLocalEligible)}</span>
              <span>平均漂移: {formatMetric(playback.averageDriftMs, "ms")}</span>
              <span>最大漂移: {formatMetric(playback.maxDriftMs, "ms")}</span>
              <span>waiting/30s: {formatMetric(playback.waitingEventsLast30s, "")}</span>
              <span>stalled/30s: {formatMetric(playback.stalledEventsLast30s, "")}</span>
              <span>音频解锁: {formatBoolean(playback.audioUnlocked)}</span>
              <span>本地暂停: {formatBoolean(playback.localAudioPaused)}</span>
              <span>本地静音: {formatBoolean(playback.localAudioMuted)}</span>
              <span>本地音量: {formatMetric(playback.localAudioVolume, "")}</span>
              <span>本地 readyState: {formatMetric(playback.localAudioReadyState, "")}</span>
              <span>本地 srcObject: {formatBoolean(playback.localAudioHasSrcObject)}</span>
              <span>本地 src: {playback.localAudioCurrentSrc ? "media-src" : "无"}</span>
              <span>full-local: {playback.fullLocalPlaybackMode ?? "无"}</span>
              <span>PCM 状态: {playback.pcmEngineStatus ?? "未知"}</span>
              <span>PCM ctx: {playback.pcmAudioContextState ?? "未知"}</span>
              <span>PCM stream: {formatBoolean(playback.pcmHasOutputStream)}</span>
              <span>PCM out: {formatBoolean(playback.pcmDirectOutputConnected)}</span>
              <span>PCM ahead: {formatDurationMs(playback.pcmBufferedAheadMs)}</span>
              <span>PCM 播放: {playback.pcmPlayoutState ?? "未知"}</span>
              <span>PCM 分片: {formatMetric(playback.pcmContiguousChunkCount, "")}</span>
              <span>PCM 包: {formatMetric(playback.pcmDecodedPacketCount, "")}</span>
              <span>PCM flush try: {formatMetric(playback.pcmDecoderFlushAttemptCount, "")}</span>
              <span>PCM flush: {formatMetric(playback.pcmDecoderFlushCount, "")}</span>
              <span>PCM 解码: {formatMetric(playback.pcmDecodedSegmentCount, "")}</span>
              <span>PCM 调度: {formatMetric(playback.pcmScheduledSegmentCount, "")}</span>
              <span>PCM peak: {formatLevel(playback.pcmDecodedPeak)}</span>
              <span>PCM RMS: {formatLevel(playback.pcmDecodedRms)}</span>
              <span>PCM 非零: {formatMetric(playback.pcmDecodedNonZeroSampleCount, "")}</span>
              <span>PCM 阻塞: {playback.pcmLastBlockedReason ?? "无"}</span>
              <span>PCM 错误: {playback.pcmLastDecodeError ?? "无"}</span>
            </DiagnosticGrid>
            {playback.pendingPlaybackIntent ? (
              <p className="mt-2 text-[10px] text-amber-300">
                等待音频启动: {playback.pendingPlaybackIntent}
              </p>
            ) : null}
            {playback.lastPlayStartFailure ? (
              <p className="mt-2 text-[10px] text-red-300">
                本地音频启动失败: {playback.lastPlayStartFailure}
              </p>
            ) : null}
            {playback.lastSourceStartError ? (
              <p className="mt-2 text-[10px] text-red-300">
                音源启动错误: {playback.lastSourceStartError}
              </p>
            ) : null}
            {playback.hostPublishFailureReason ? (
              <p className="mt-1 text-[10px] text-amber-300">
                发布源异常: {playback.hostPublishFailureReason}
              </p>
            ) : null}
            {playback.fallbackReason ? (
              <p className="mt-1 text-[10px] text-amber-300">
                缓存播放阻塞: {playback.fallbackReason}
              </p>
            ) : null}
            {playback.progressiveLocalBlockedReason ? (
              <p className="mt-1 text-[10px] text-amber-300">
                渐进播放未就绪: {playback.progressiveLocalBlockedReason}
              </p>
            ) : null}
          </DiagnosticBlock>
        ) : null}
      </div>
    </details>
  );
}

function MeshStatusPanelBase({
  members,
  availabilitySummary,
  connectedPeersCount,
  mediaConnectedPeersCount,
  cachedTrackCount,
  localMemberState,
  peerDiagnostics,
  recentEvents,
  iceConfigSource,
  iceConfigStatus,
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
          (peer.transportHealth === "media-only" ||
            peer.transportHealth === "degraded" ||
            peer.transportHealth === "recovering" ||
            peer.transportHealth === "reconnecting" ||
            peer.transportHealth === "failed")
      ).length,
    [activePeerIds, peerDiagnostics]
  );
  const visibleAvailability = availabilitySummary.slice(0, 6);
  const visibleEvents = recentEvents.slice(0, 8);

  return (
    <section className="flex w-full flex-col gap-4 rounded-2xl border border-surface-border bg-surface/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Advanced
          </p>
          <h2 className="text-sm font-bold text-foreground">缓存播放诊断</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            默认只展示摘要；播放缓冲或分片下载慢时，再展开查看缓存窗口、分片吞吐和数据通道。
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setIsOpen((value) => !value)}>
          {isOpen ? "收起" : "展开"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-medium text-foreground-muted">
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          在线: {onlineCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          Data: {dataReadyCount || connectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          缓存播放: {localMemberState?.cachePlayback?.activeSource ?? "等待缓存"}
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
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          ICE: {iceConfigSource}
        </span>
      </div>

      {isOpen ? (
        <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
          <div className="rounded-lg border border-surface-border bg-background/30 p-3 text-xs text-foreground-muted">
            {iceConfigStatus}
          </div>

          {localMemberState ? (
            <DiagnosticBlock title="本机摘要">
              <DiagnosticGrid>
                <span>链路: {localMemberState.transportLabel}</span>
                <span>播放: {localMemberState.playbackStatus.label}</span>
                <span>
                  总传输: {formatMetric(localMemberState.transportSummary.totalRateKbps, " kbps")}
                </span>
                <span>延迟: {formatMetric(localMemberState.transportSummary.latencyMs, "ms")}</span>
                <span>
                  分片下载: {formatMetric(localMemberState.pieceSummary.downloadRateKbps, " kbps")}
                </span>
                <span>
                  分片上传: {formatMetric(localMemberState.pieceSummary.uploadRateKbps, " kbps")}
                </span>
                <span>传输样本: {formatSampleAge(localMemberState.transportSummary.sampleAgeMs)}</span>
                <span>分片样本: {formatSampleAge(localMemberState.pieceSummary.sampleAgeMs)}</span>
              </DiagnosticGrid>
              {localMemberState.lastSourceStartError ? (
                <p className="mt-2 text-[10px] text-red-300">
                  本机音源错误: {localMemberState.lastSourceStartError}
                </p>
              ) : null}
            </DiagnosticBlock>
          ) : null}

          {peerDiagnostics.length ? (
            <div className="flex flex-col gap-2">
              {peerDiagnostics.map((peer) => (
                <PeerDiagnosticCard key={peer.peerId} peer={peer} />
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
                visibleAvailability.map(({ track, peerCount, localChunkCount, totalChunks, sources }) => (
                  <div
                    key={track.id}
                    className="rounded-lg border border-surface-border bg-black/20 p-3 text-[10px]"
                  >
                    <strong className="block truncate text-xs text-foreground">{track.title}</strong>
                    <div className="mt-1 flex items-center justify-between text-foreground-muted">
                      <span>本地分片 {localChunkCount}/{totalChunks || 0}</span>
                      <span>可见节点 {peerCount}</span>
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
                      <span>{event.peerId}</span>
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
