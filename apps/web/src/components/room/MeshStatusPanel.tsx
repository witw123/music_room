"use client";

import { memo, useEffect, useMemo, useState } from "react";
import type { PeerDiagnosticsSnapshot, PeerRecentEvent, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";

export type AvailabilityEntry = {
  track: TrackMeta;
  peerCount: number;
  localChunkCount: number;
  totalChunks: number;
  sources: string[];
};

type MeshStatusPanelProps = {
  availabilitySummary: AvailabilityEntry[];
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  recentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
};

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

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", {
    hour12: false
  });
}

function formatCandidateType(value: string | null) {
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

function formatMetric(value: number | null, unit: string) {
  if (value === null) {
    return "未知";
  }

  return `${value}${unit}`;
}

function describeCandidatePath(peer: PeerDiagnosticsSnapshot) {
  if (peer.mediaCandidateType && peer.dataCandidateType) {
    if (peer.mediaCandidateType !== peer.dataCandidateType) {
      return "媒体/数据走不同 candidate pair";
    }

    if (peer.mediaCandidateType === "relay") {
      return "媒体与数据当前都经过 relay";
    }

    return "媒体与数据当前都走 direct";
  }

  if (peer.mediaCandidateType === "relay" || peer.dataCandidateType === "relay") {
    return "当前至少一条链路经过 relay";
  }

  if (peer.mediaCandidateType || peer.dataCandidateType) {
    return "当前链路已进入 direct";
  }

  return null;
}

function MeshStatusPanelBase({
  availabilitySummary,
  connectedPeersCount,
  mediaConnectedPeersCount,
  cachedTrackCount,
  peerDiagnostics,
  recentEvents,
  iceConfigSource,
  iceConfigStatus
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const updateViewport = () => {
      setIsMobileViewport(window.innerWidth < 768);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (isMobileViewport) {
      setIsOpen(false);
    }
  }, [isMobileViewport]);

  const visiblePeerDiagnostics = useMemo(
    () => (isMobileViewport ? peerDiagnostics.slice(0, 4) : peerDiagnostics),
    [isMobileViewport, peerDiagnostics]
  );
  const visibleAvailabilitySummary = useMemo(
    () => availabilitySummary.slice(0, isMobileViewport ? 3 : 6),
    [availabilitySummary, isMobileViewport]
  );
  const visibleRecentEvents = useMemo(
    () => recentEvents.slice(0, isMobileViewport ? 8 : 20),
    [isMobileViewport, recentEvents]
  );

  return (
    <section className="flex w-full flex-col gap-4">
      <div
        className="group flex cursor-pointer items-start justify-between"
        onClick={() => setIsOpen((current) => !current)}
      >
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Diagnostics
          </p>
          <h2 className="text-sm font-bold text-foreground transition-colors group-hover:text-accent">
            连接与缓存诊断
          </h2>
        </div>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-foreground-muted">
          {isOpen ? "收起" : "展开"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono font-medium text-foreground-muted">
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          P2P 节点: {connectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          实时音频: {mediaConnectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          本地缓存: {cachedTrackCount}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          曲目统计: {availabilitySummary.length}
        </span>
        <span className="rounded border border-surface-border bg-surface px-1.5 py-0.5">
          ICE: {iceConfigSource}
        </span>
      </div>

      {isOpen ? (
        <div className="mt-2 flex flex-col gap-3 border-t border-surface-border pt-4">
          <div className="rounded-lg border border-surface-border bg-surface/30 p-3 text-[10px] text-foreground-muted">
            {iceConfigStatus}
          </div>

          {visiblePeerDiagnostics.length ? (
            <div className="flex flex-col gap-2">
              {visiblePeerDiagnostics.map((peer) => (
                <div
                  key={peer.peerId}
                  className="rounded-lg border border-surface-border bg-surface/30 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-xs font-semibold text-foreground">{peer.peerId}</strong>
                    <span className="text-[10px] text-foreground-muted">
                      {formatTimestamp(peer.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-foreground-muted">
                    <span>数据连接: {peer.dataConnectionState ?? "未知"}</span>
                    <span>音频连接: {peer.mediaConnectionState ?? "未知"}</span>
                    <span>数据 ICE: {peer.dataIceState ?? "未知"}</span>
                    <span>音频 ICE: {peer.mediaIceState ?? "未知"}</span>
                    <span>数据候选: {formatCandidateType(peer.dataCandidateType)}</span>
                    <span>媒体候选: {formatCandidateType(peer.mediaCandidateType)}</span>
                    <span>媒体协议: {peer.mediaProtocol ?? "未知"}</span>
                    <span>RTT: {formatMetric(peer.currentRoundTripTimeMs, "ms")}</span>
                    <span>可用上行: {formatMetric(peer.availableOutgoingBitrateKbps, " kbps")}</span>
                    <span>丢包: {peer.packetsLost ?? "未知"}</span>
                    <span>抖动: {formatMetric(peer.jitterMs, "ms")}</span>
                    <span>
                      发信令:
                      {` ${peer.signalStats.sentOffers}/${peer.signalStats.sentAnswers}/${peer.signalStats.sentCandidates}`}
                    </span>
                    <span>
                      收信令:
                      {` ${peer.signalStats.receivedOffers}/${peer.signalStats.receivedAnswers}/${peer.signalStats.receivedCandidates}`}
                    </span>
                    <span>收到远端 track: {peer.remoteTrackStatus.received ? "是" : "否"}</span>
                    <span>
                      绑定音频元素: {peer.remoteTrackStatus.boundToAudioElement ? "是" : "否"}
                    </span>
                  </div>
                  {describeCandidatePath(peer) ? (
                    <p className="mt-2 text-[10px] text-cyan-300">{describeCandidatePath(peer)}</p>
                  ) : null}
                  {peer.progressivePlaybackStatus ? (
                    <div className="mt-3 rounded-lg border border-surface-border bg-background/30 p-2.5 text-[10px] text-foreground-muted">
                      <div className="mb-1 font-semibold uppercase tracking-[0.18em] text-foreground-muted/80">
                        Progressive
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <span>播放源: {peer.progressivePlaybackStatus.activeSource ?? "未启用"}</span>
                        <span>引擎: {peer.progressivePlaybackStatus.engineType ?? "none"}</span>
                        <span>
                          连续缓冲: {Math.round(peer.progressivePlaybackStatus.contiguousBufferedMs / 1000)}s
                        </span>
                        <span>
                          前向缓冲: {Math.round(peer.progressivePlaybackStatus.aheadBufferedMs / 1000)}s
                        </span>
                        <span>调度策略: {peer.progressivePlaybackStatus.schedulerPolicy ?? "未激活"}</span>
                        <span>启动就绪: {peer.progressivePlaybackStatus.startupReady ? "是" : "否"}</span>
                      </div>
                      {peer.progressivePlaybackStatus.fallbackReason ? (
                        <p className="mt-2 text-amber-300">
                          回退原因: {peer.progressivePlaybackStatus.fallbackReason}
                        </p>
                      ) : null}
                      {peer.progressivePlaybackStatus.pendingPlaybackIntent ? (
                        <p className="mt-1 text-cyan-300">
                          启动意图: {peer.progressivePlaybackStatus.pendingPlaybackIntent}
                        </p>
                      ) : null}
                      {peer.progressivePlaybackStatus.intentMatchedSource ? (
                        <p className="mt-1 text-emerald-300">
                          已匹配音源: {peer.progressivePlaybackStatus.intentMatchedSource}
                        </p>
                      ) : null}
                      {peer.progressivePlaybackStatus.lastPlayStartFailure ? (
                        <p className="mt-1 text-red-300">
                          最近启动失败: {peer.progressivePlaybackStatus.lastPlayStartFailure}
                        </p>
                      ) : null}
                      {peer.progressivePlaybackStatus.nextQueueTrackPrefetch ? (
                        <p className="mt-1 text-foreground-muted">
                          下一首预热: {peer.progressivePlaybackStatus.nextQueueTrackPrefetch}
                        </p>
                      ) : null}
                      {peer.timeOnRemoteStreamMs !== null ? (
                        <p className="mt-1 text-foreground-muted">
                          远端流停留: {Math.round(peer.timeOnRemoteStreamMs / 1000)}s
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {peer.lastError ? (
                    <p className="mt-2 text-[10px] text-red-400">{peer.lastError}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {visibleAvailabilitySummary.length ? (
            visibleAvailabilitySummary.map(
              ({ track, peerCount, localChunkCount, totalChunks, sources }) => (
                <div
                  key={track.id}
                  className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface/30 p-3"
                >
                  <strong className="truncate text-xs font-semibold text-foreground">
                    {track.title}
                  </strong>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-foreground-muted">
                    <span>本地缓存 {localChunkCount}/{totalChunks || 0}</span>
                    <span>可见节点 {peerCount}</span>
                  </div>
                  {sources.length ? (
                    <span className="mt-0.5 truncate text-[9px] text-foreground-muted/60">
                      {sources.slice(0, 2).join(" / ")}
                    </span>
                  ) : null}
                </div>
              )
            )
          ) : (
            <div className="py-4 text-center">
              <p className="text-[10px] text-foreground-muted/70">
                导入曲目后，这里会显示缓存分片与连接诊断信息。
              </p>
            </div>
          )}

          {visibleRecentEvents.length ? (
            <div className="flex flex-col gap-2 border-t border-surface-border pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground-muted">
                最近事件
              </p>
              {visibleRecentEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-surface-border bg-background/40 px-3 py-2 text-[10px]"
                >
                  <div className="flex items-center justify-between gap-2 text-foreground-muted">
                    <span>{formatTimestamp(event.timestamp)}</span>
                    <span>{event.peerId}</span>
                  </div>
                  <p className="mt-1 text-foreground">{formatEventLabel(event)}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-2 flex items-center justify-between border-t border-surface-border pt-3">
            <span className="text-[10px] text-foreground-muted">
              如果本地缓存异常，可以在这里清理后重新同步。
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-destructive/30 px-3 text-xs text-destructive transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
              onClick={async () => {
                if (confirm("确定要清空当前设备上的本地音乐缓存吗？页面将会重新加载。")) {
                  const { clearAllCachedTracks } = await import("@/lib/indexeddb");
                  await clearAllCachedTracks();
                  window.location.reload();
                }
              }}
            >
              清除本地缓存
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export const MeshStatusPanel = memo(MeshStatusPanelBase);
