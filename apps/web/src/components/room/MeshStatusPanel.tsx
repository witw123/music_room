"use client";

import { memo, useMemo, useState } from "react";
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
};

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

function formatDurationMs(value: number | null) {
  if (value === null) {
    return "未知";
  }

  if (Math.abs(value) < 1000) {
    return `${Math.round(value)}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
}

function formatPreciseMetric(
  value: number | null,
  unit: string,
  sampleAgeMs: number | null = null
) {
  if (value === null) {
    return "未知";
  }

  const rendered = Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value).toString();
  const staleSuffix =
    sampleAgeMs !== null && sampleAgeMs > 6_000 ? " · stale" : "";
  return `${rendered}${unit}${staleSuffix}`;
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
  if (peer.mediaCandidateType && peer.dataCandidateType) {
    if (peer.mediaCandidateType !== peer.dataCandidateType) {
      return "媒体和数据当前走的是不同 candidate pair";
    }

    if (peer.mediaCandidateType === "relay") {
      return "媒体和数据当前都经过 relay";
    }

    return "媒体和数据当前都走 direct";
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
  members,
  availabilitySummary,
  connectedPeersCount,
  mediaConnectedPeersCount,
  cachedTrackCount,
  localMemberState,
  peerDiagnostics,
  recentEvents,
  iceConfigSource,
  iceConfigStatus
}: MeshStatusPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const onlineCount = useMemo(
    () => members.filter((member) => member.presenceState === "online").length,
    [members]
  );
  const reconnectingCount = useMemo(
    () => members.filter((member) => member.presenceState === "reconnecting").length,
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
  const mediaReadyCount = useMemo(
    () =>
      peerDiagnostics.filter(
        (peer) =>
          activePeerIds.has(peer.peerId) &&
          (peer.mediaConnectionState === "connected" || peer.mediaConnectionState === "live")
      ).length,
    [activePeerIds, peerDiagnostics]
  );
  const degradedCount = useMemo(
    () =>
      peerDiagnostics.filter(
        (peer) =>
          activePeerIds.has(peer.peerId) &&
          (peer.transportHealth === "media-only" ||
            peer.transportHealth === "reconnecting" ||
            peer.transportHealth === "failed")
      ).length,
    [activePeerIds, peerDiagnostics]
  );

  return (
    <section className="flex w-full flex-col gap-4 rounded-2xl border border-surface-border bg-surface/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Developer
          </p>
          <h2 className="text-sm font-bold text-foreground">连接诊断（开发）</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            默认只展示房间摘要，展开后再看链路细节。
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
          重连中: {reconnectingCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          Data Ready: {dataReadyCount || connectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          Media Ready: {mediaReadyCount || mediaConnectedPeersCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          Degraded: {degradedCount}
        </span>
        <span className="rounded border border-surface-border bg-background/40 px-2 py-1">
          本地缓存: {cachedTrackCount}
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
            <div className="rounded-lg border border-surface-border bg-background/30 p-3 text-[10px] text-foreground-muted">
              <div className="mb-2 font-semibold uppercase tracking-[0.18em] text-foreground-muted/80">
                本机传输摘要
              </div>
              <div className="grid grid-cols-2 gap-2">
                <span>链路: {localMemberState.transportLabel}</span>
                <span>样本: {formatSampleAge(localMemberState.transportSummary.sampleAgeMs)}</span>
                <span>
                  总传输:{" "}
                  {formatPreciseMetric(
                    localMemberState.transportSummary.totalRateKbps,
                    " kbps",
                    localMemberState.transportSummary.sampleAgeMs
                  )}
                </span>
                <span>
                  延迟:{" "}
                  {formatPreciseMetric(
                    localMemberState.transportSummary.latencyMs,
                    "ms",
                    localMemberState.transportSummary.sampleAgeMs
                  )}
                </span>
                <span>
                  接收:{" "}
                  {formatPreciseMetric(
                    localMemberState.transportSummary.receiveRateKbps,
                    " kbps",
                    localMemberState.transportSummary.sampleAgeMs
                  )}
                </span>
                <span>
                  发送:{" "}
                  {formatPreciseMetric(
                    localMemberState.transportSummary.sendRateKbps,
                    " kbps",
                    localMemberState.transportSummary.sampleAgeMs
                  )}
                </span>
                <span>
                  分片下载:{" "}
                  {formatPreciseMetric(
                    localMemberState.pieceSummary.downloadRateKbps,
                    " kbps",
                    localMemberState.pieceSummary.sampleAgeMs
                  )}
                </span>
                <span>
                  分片上传:{" "}
                  {formatPreciseMetric(
                    localMemberState.pieceSummary.uploadRateKbps,
                    " kbps",
                    localMemberState.pieceSummary.sampleAgeMs
                  )}
                </span>
              </div>
            </div>
          ) : null}

          {peerDiagnostics.length ? (
            <div className="flex flex-col gap-2">
              {peerDiagnostics.map((peer) => (
                <details
                  key={peer.peerId}
                  className="rounded-lg border border-surface-border bg-background/30 px-3 py-2"
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="truncate text-xs font-semibold text-foreground">
                          {peer.peerId}
                        </strong>
                        <p className="mt-1 text-[10px] text-foreground-muted">
                          {describeCandidatePath(peer) ??
                            `数据 ${peer.dataConnectionState ?? "未知"} / 音频 ${peer.mediaConnectionState ?? "未知"}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] text-foreground-muted">
                        {formatTimestamp(peer.updatedAt)}
                      </span>
                    </div>
                    {peer.lastError ? (
                      <p className="mt-2 text-[10px] text-red-400">{peer.lastError}</p>
                    ) : null}
                  </summary>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-foreground-muted">
                    <span>数据连接: {peer.dataConnectionState ?? "未知"}</span>
                    <span>DataChannel: {peer.dataChannelState ?? "未知"}</span>
                    <span>音频连接: {peer.mediaConnectionState ?? "未知"}</span>
                    <span>数据 ICE: {peer.dataIceState ?? "未知"}</span>
                    <span>音频 ICE: {peer.mediaIceState ?? "未知"}</span>
                    <span>传输健康: {peer.transportHealth ?? "未知"}</span>
                    <span>降级原因: {peer.degradedReason ?? "无"}</span>
                    <span>数据候选: {formatCandidateType(peer.dataCandidateType)}</span>
                    <span>媒体候选: {formatCandidateType(peer.mediaCandidateType)}</span>
                    <span>媒体协议: {peer.mediaProtocol ?? "未知"}</span>
                    <span>RTT: {formatMetric(peer.currentRoundTripTimeMs, "ms")}</span>
                    <span>
                      接收抖动缓冲目标: {formatDurationMs(peer.receiverJitterTargetMs ?? null)}
                    </span>
                    <span>可用上行: {formatMetric(peer.availableOutgoingBitrateKbps, " kbps")}</span>
                    <span>媒体接收: {formatMetric(peer.mediaReceiveBitrateKbps, " kbps")}</span>
                    <span>媒体发送: {formatMetric(peer.mediaSendBitrateKbps, " kbps")}</span>
                    <span>分片下载: {formatMetric(peer.pieceDownloadRateKbps, " kbps")}</span>
                    <span>分片上传: {formatMetric(peer.pieceUploadRateKbps, " kbps")}</span>
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
                    <span>
                      最近 availability: {peer.lastAvailabilitySeenAt ? formatTimestamp(peer.lastAvailabilitySeenAt) : "未知"}
                    </span>
                    <span>
                      最近收片: {peer.lastPieceReceivedAt ? formatTimestamp(peer.lastPieceReceivedAt) : "未知"}
                    </span>
                  </div>

                  {peer.progressivePlaybackStatus ? (
                    <div className="mt-3 rounded-lg border border-surface-border bg-black/20 p-3 text-[10px] text-foreground-muted">
                      <div className="mb-2 font-semibold uppercase tracking-[0.18em] text-foreground-muted/80">
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
                        <span>
                          启动缓冲: {formatDurationMs(peer.progressivePlaybackStatus.startupBufferMs ?? null)}
                        </span>
                        <span>
                          远端主路锁定: {peer.progressivePlaybackStatus.remoteFirstLock ? "是" : "否"}
                        </span>
                        <span>
                          锁定原因: {peer.progressivePlaybackStatus.remoteFirstLockReason ?? "无"}
                        </span>
                        <span>
                          完整本地可切: {peer.progressivePlaybackStatus.fullLocalReady ? "是" : "否"}
                        </span>
                        <span>
                          本地接管资格: {peer.progressivePlaybackStatus.fullLocalEligible ? "是" : "否"}
                        </span>
                        <span>
                          缓存填充耗时:{" "}
                          {formatDurationMs(
                            peer.progressivePlaybackStatus.estimatedFillTimeMs ?? null
                          )}
                        </span>
                        <span>
                          剩余播放时长:{" "}
                          {formatDurationMs(
                            peer.progressivePlaybackStatus.remainingPlaybackMs ?? null
                          )}
                        </span>
                        <span>
                          安全余量:{" "}
                          {formatDurationMs(
                            peer.progressivePlaybackStatus.bufferSafetyMarginMs ?? null
                          )}
                        </span>
                      </div>
                      {peer.progressivePlaybackStatus.fullLocalBlockedReason ? (
                        <p className="mt-2 text-amber-300">
                          禁止切本地: {peer.progressivePlaybackStatus.fullLocalBlockedReason}
                        </p>
                      ) : null}
                      {peer.progressivePlaybackStatus.fallbackReason ? (
                        <p className="mt-2 text-amber-300">
                          回退原因: {peer.progressivePlaybackStatus.fallbackReason}
                        </p>
                      ) : null}
                      {peer.progressivePlaybackStatus.localTakeoverCooldownMs ? (
                        <p className="mt-1 text-foreground-muted">
                          本地接管冷却: {Math.ceil(peer.progressivePlaybackStatus.localTakeoverCooldownMs / 1000)}s
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
                      {peer.progressivePlaybackStatus.lastStablePlaybackAt ? (
                        <p className="mt-1 text-foreground-muted">
                          最近稳播:{" "}
                          {formatTimestamp(peer.progressivePlaybackStatus.lastStablePlaybackAt)}
                        </p>
                      ) : null}
                      {peer.timeOnRemoteStreamMs !== null ? (
                        <p className="mt-1 text-foreground-muted">
                          远端流停留: {Math.round(peer.timeOnRemoteStreamMs / 1000)}s
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
              当前没有可展示的活跃链路诊断。
            </div>
          )}

          <details className="rounded-lg border border-surface-border bg-background/30 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">
              曲目缓存摘要
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {availabilitySummary.length ? (
                availabilitySummary.map(({ track, peerCount, localChunkCount, totalChunks, sources }) => (
                  <div
                    key={track.id}
                    className="rounded-lg border border-surface-border bg-black/20 p-3 text-[10px]"
                  >
                    <strong className="block truncate text-xs text-foreground">{track.title}</strong>
                    <div className="mt-1 flex items-center justify-between text-foreground-muted">
                      <span>本地缓存 {localChunkCount}/{totalChunks || 0}</span>
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
                <p className="text-[10px] text-foreground-muted">当前还没有缓存摘要。</p>
              )}
            </div>
          </details>

          <details className="rounded-lg border border-surface-border bg-background/30 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">
              最近事件
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {recentEvents.length ? (
                recentEvents.slice(0, 16).map((event) => (
                  <div
                    key={event.id}
                    className="rounded-lg border border-surface-border bg-black/20 px-3 py-2 text-[10px]"
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
