"use client";

import { memo } from "react";
import type { PeerDiagnosticsSnapshot, RoomMember } from "@music-room/shared";
import type { SegmentedPlaybackSnapshot } from "@/features/playback/use-segmented-opus-playback";
import { formatTransferRateMBps } from "@/lib/music-room-ui";
import {
  buildWanLinkScore,
  buildWanLinkScoreFromPeerDiagnostic,
  type WanLinkScore,
  type WanProviderSummary
} from "./wan-link-score";

export type MemberTransferSummary = {
  memberId: string;
  mediaTrackState: "none" | "live" | "ended" | "failed";
  mediaReceiveBitrateKbps: number | null;
  mediaSendBitrateKbps: number | null;
  mediaJitterMs: number | null;
  mediaPacketLossRate: number | null;
};

type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type LocalMemberPanelState = {
  memberId: string;
  presenceState: RoomMember["presenceState"];
  audioUnlocked: boolean;
  transportLabel: string;
  transportSummary: {
    totalRateKbps: number | null;
    receiveRateKbps: number | null;
    sendRateKbps: number | null;
    latencyMs: number | null;
    sampleAgeMs: number | null;
  };
  mediaSummary?: {
    receiveRateKbps: number | null;
    sendRateKbps: number | null;
    sampleAgeMs: number | null;
  };
  pieceSummary: {
    downloadRateKbps: number | null;
    uploadRateKbps: number | null;
    sampleAgeMs: number | null;
  };
  segmentedPlayback: SegmentedPlaybackSnapshot;
  playbackBitrateKbps: number | null;
  configuredPlaybackBitrateKbps?: number | null;
  mediaSourcePeerId?: string | null;
  isMediaSource?: boolean;
  mediaSourceMemberNickname?: string | null;
  dataReadyCount: number;
  playbackStatus: {
    label: string;
    detail: string;
    tone: StatusTone;
    badgeText: string;
  };
};

type MembersPanelProps = {
  members: RoomMember[];
  memberTransferSummaries?: MemberTransferSummary[];
  peerDiagnostics?: PeerDiagnosticsSnapshot[];
  localMemberState?: LocalMemberPanelState | null;
};

function getToneClasses(tone: StatusTone) {
  if (tone === "success") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (tone === "accent") return "border-accent/30 bg-accent/10 text-accent";
  if (tone === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (tone === "danger") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-surface-border bg-background/60 text-foreground-muted";
}

function formatRate(value: number | null, sampleAgeMs: number | null = null) {
  if (value === null) return "未知";
  const stale = sampleAgeMs !== null && sampleAgeMs > 6_000 ? " · stale" : "";
  return `${formatTransferRateMBps(value)}${stale}`;
}

function formatMetric(value: number | null, unit: string) {
  if (value === null) return "未知";
  return `${Math.abs(value) < 100 ? value.toFixed(1) : Math.round(value)}${unit}`;
}

export function formatOpusRate(
  actualKbps: number | null,
  configuredKbps: number | null | undefined,
  sampleAgeMs: number | null
) {
  if (typeof actualKbps === "number" && actualKbps > 0) {
    return `${Math.round(actualKbps)} kbps`;
  }
  if (actualKbps === 0 && sampleAgeMs !== null && sampleAgeMs <= 6_000) {
    return configuredKbps ? `采样中 · 目标 ${Math.round(configuredKbps)} kbps` : "采样中";
  }
  if (configuredKbps) {
    return `无 RTP · 目标 ${Math.round(configuredKbps)} kbps`;
  }
  return "未知";
}

function formatSampleAge(sampleAgeMs: number | null) {
  if (sampleAgeMs === null) return "暂无样本";
  const seconds = Math.max(0, Math.ceil(sampleAgeMs / 1000));
  return sampleAgeMs > 6_000 ? `stale · ${seconds}s前` : `${seconds}s前`;
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

export function getCurrentTrackStatus(
  summary: MemberTransferSummary | undefined,
  presenceState: RoomMember["presenceState"]
) {
  if (presenceState === "offline") {
    return { label: "离线", detail: "当前不参与实时媒体传输。", tone: "warning" as const };
  }
  if (presenceState === "reconnecting") {
    return { label: "重连中", detail: "正在恢复 WebRTC 媒体轨道。", tone: "warning" as const };
  }
  if (summary?.mediaTrackState === "live") {
    return { label: "Media track 实时", detail: "正在接收或发送 RTP Opus 音频。", tone: "success" as const };
  }
  if (summary?.mediaTrackState === "failed") {
    return { label: "Media track 失败", detail: "当前媒体轨道不可用，等待重连。", tone: "danger" as const };
  }
  if (summary?.mediaTrackState === "ended") {
    return { label: "媒体轨道已结束", detail: "当前轨道已停止，等待新的播放源。", tone: "warning" as const };
  }
  return { label: "等待媒体轨道", detail: "尚未收到当前播放源的 RTP Opus 轨道。", tone: "neutral" as const };
}

export function getPlaybackStatus(
  presenceState: RoomMember["presenceState"],
  peerDiagnostics: PeerDiagnosticsSnapshot | undefined,
  now = Date.now()
) {
  if (presenceState === "offline") {
    return { label: "离线", detail: "该成员当前不参与实时音频传输。", tone: "warning" as const };
  }
  if (presenceState === "reconnecting") {
    return { label: "链路重连中", detail: "正在恢复 WebRTC RTP Opus 媒体轨道。", tone: "warning" as const };
  }
  if (peerDiagnostics?.mediaConnectionState === "failed" || peerDiagnostics?.transportScore === "failed") {
    return {
      label: "媒体链路失败",
      detail: peerDiagnostics.lastFailureReason ?? "当前无法接收 RTP Opus 音频。",
      tone: "danger" as const
    };
  }
  if ((peerDiagnostics?.mediaReceiveBitrateKbps ?? 0) > 0 || (peerDiagnostics?.mediaSendBitrateKbps ?? 0) > 0) {
    return {
      label: "Media track 实时",
      detail: "本端已观测到 WebRTC RTP Opus 音频流。",
      tone: "success" as const,
      badgeText: "RTP Opus"
    };
  }
  if (peerDiagnostics?.dataChannelState === "open") {
    const sampleAt = new Date(peerDiagnostics.updatedAt).getTime();
    const sampleFresh = Number.isFinite(sampleAt) && now - sampleAt <= 6_000;
    const transferring = sampleFresh &&
      ((peerDiagnostics.pieceDownloadRateKbps ?? 0) > 0 || (peerDiagnostics.pieceUploadRateKbps ?? 0) > 0);
    return transferring
      ? { label: "原文件缓存传输中", detail: "本端观测到该成员正在收发手动缓存数据。", tone: "success" as const }
      : { label: "数据通道就绪", detail: "数据通道仅用于控制和手动原文件缓存。", tone: "accent" as const };
  }
  if (peerDiagnostics?.transportHealth === "failed") {
    return {
      label: "数据链路失败",
      detail: peerDiagnostics.lastFailureReason ?? "当前无法建立数据通道。",
      tone: "danger" as const
    };
  }
  return { label: "等待媒体链路", detail: "尚未观测到当前播放源的 RTP Opus 轨道。", tone: "neutral" as const };
}

function buildRoomProviders(summaries: MemberTransferSummary[]): WanProviderSummary[] {
  return summaries
    .filter((summary) => summary.mediaTrackState === "live")
    .map((summary) => ({
      peerId: summary.memberId,
      availableUnits: 1,
      totalUnits: 1,
      isPreferredSource: true
    }));
}

function resolveRoomWanScore(input: {
  summaries: MemberTransferSummary[];
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  localMemberState: LocalMemberPanelState | null;
}): WanLinkScore {
  const providers = buildRoomProviders(input.summaries);
  const playbackBitrateKbps = input.localMemberState?.playbackBitrateKbps ??
    input.localMemberState?.configuredPlaybackBitrateKbps ?? null;
  const mediaDiagnostics = input.peerDiagnostics.filter((snapshot) =>
    snapshot.peerId !== "system" && (
      snapshot.mediaConnectionState !== null ||
      (snapshot.mediaReceiveBitrateKbps ?? 0) > 0 ||
      (snapshot.mediaSendBitrateKbps ?? 0) > 0
    )
  );
  const sourcePeerId = input.localMemberState?.mediaSourcePeerId ?? null;
  const selectedDiagnostics = input.localMemberState?.isMediaSource
    ? mediaDiagnostics
    : sourcePeerId
      ? mediaDiagnostics.filter((snapshot) => snapshot.peerId === sourcePeerId)
      : mediaDiagnostics;
  const remoteScores = selectedDiagnostics
    .filter((snapshot) => snapshot.peerId !== "system")
    .map((diagnostic) => buildWanLinkScoreFromPeerDiagnostic({
      diagnostic,
      providers,
      playbackBitrateKbps,
      downloadRateKbps: diagnostic.mediaReceiveBitrateKbps,
      uploadRateKbps: diagnostic.mediaSendBitrateKbps
    }))
    .sort((left, right) => right.score - left.score);
  const selectedRemoteScore = input.localMemberState?.isMediaSource
    ? [...remoteScores].sort((left, right) => left.score - right.score)[0]
    : remoteScores[0];
  return selectedRemoteScore ?? buildWanLinkScore({
    protocol: "udp",
    rttMs: input.localMemberState?.transportSummary.latencyMs ?? null,
    downloadRateKbps: input.localMemberState?.mediaSummary?.receiveRateKbps ?? null,
    uploadRateKbps: input.localMemberState?.mediaSummary?.sendRateKbps ?? null,
    playbackBitrateKbps,
    mediaDirection: input.localMemberState?.isMediaSource ? "send" : "receive",
    mediaTrackState: input.localMemberState?.segmentedPlayback.state === "live" ? "live" : "none",
    mediaConnectionState: input.localMemberState?.segmentedPlayback.state === "live" ? "connected" : null,
    sampleAgeMs: input.localMemberState?.mediaSummary?.sampleAgeMs ?? null,
    providers
  });
}

function MembersPanelBase({
  members,
  memberTransferSummaries = [],
  peerDiagnostics = [],
  localMemberState = null
}: MembersPanelProps) {
  const summaryByMemberId = new Map(memberTransferSummaries.map((item) => [item.memberId, item]));
  const diagnosticsByPeerId = new Map(peerDiagnostics.map((item) => [item.peerId, item]));
  const roomWanScore = resolveRoomWanScore({
    summaries: memberTransferSummaries,
    peerDiagnostics,
    localMemberState
  });

  return (
    <section className="flex w-full flex-col gap-3">
      <p className="rounded-lg border border-surface-border bg-background/20 px-3 py-2 text-[10px] leading-4 text-foreground-muted">
        播放状态、媒体轨道、AudioContext 与 RTP 码率来自本端真实 WebRTC 观测；DataChannel 仅用于房间控制和手动原文件缓存。
      </p>

      <section className="border-y border-surface-border py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-foreground-muted">外网实时音频评分</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getToneClasses(roomWanScore.tone)}`}>
                {roomWanScore.grade} · {roomWanScore.score}
              </span>
            </div>
            <strong className="mt-1.5 block text-sm text-foreground">{roomWanScore.pathLabel}</strong>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">{roomWanScore.summary}</p>
          </div>
          <dl className="grid min-w-[15rem] grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-foreground-muted">
            <div>RTT：{roomWanScore.metrics.rttLabel}</div>
            <div>RTP 接收：{roomWanScore.metrics.downloadLabel}</div>
            <div>目标：{roomWanScore.metrics.audioBitrateLabel}</div>
            <div>余量：{roomWanScore.metrics.headroomLabel}</div>
            <div>RTP 发送：{roomWanScore.metrics.uploadLabel}</div>
            <div>媒体连接：{roomWanScore.metrics.providerLabel}</div>
            <div>方向：{roomWanScore.metrics.directionLabel}</div>
            <div>丢包：{roomWanScore.metrics.packetLossLabel}</div>
            <div>jitter：{roomWanScore.metrics.jitterLabel}</div>
            <div>样本：{roomWanScore.metrics.sampleAgeLabel}</div>
          </dl>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-foreground-muted">{roomWanScore.tips[0]}</p>
      </section>

      {localMemberState ? (
        <section className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-surface-border pb-3 sm:grid-cols-4">
          <div>
            <span className="text-[10px] text-foreground-muted">本机输出</span>
            <strong className="mt-1 block text-sm text-foreground">{localMemberState.playbackStatus.label}</strong>
          </div>
          <div>
            <span className="text-[10px] text-foreground-muted">音频格式</span>
            <strong className="mt-1 block text-sm text-foreground">
                  Opus · {formatOpusRate(
                    localMemberState.playbackBitrateKbps,
                    localMemberState.configuredPlaybackBitrateKbps,
                    localMemberState.mediaSummary?.sampleAgeMs ?? null
                  )}
            </strong>
          </div>
          <div>
            <span className="text-[10px] text-foreground-muted">媒体轨道</span>
            <strong className="mt-1 block text-sm text-foreground">
              {localMemberState.playbackStatus.badgeText}
            </strong>
          </div>
          <div>
            <span className="text-[10px] text-foreground-muted">当前媒体源</span>
            <strong className="mt-1 block text-sm text-foreground">
              {localMemberState.mediaSourceMemberNickname ?? "未选择"}
            </strong>
          </div>
          <div>
            <span className="text-[10px] text-foreground-muted">AudioContext</span>
            <strong className="mt-1 block text-sm text-foreground">
              {localMemberState.segmentedPlayback.audioContextState ?? "未创建"}
            </strong>
          </div>
          {localMemberState.segmentedPlayback.lastError ? (
            <p className="col-span-2 text-[10px] leading-4 text-amber-300 sm:col-span-4">
              最近错误：{localMemberState.segmentedPlayback.lastError}
            </p>
          ) : null}
        </section>
      ) : null}

      {members.length > 0 ? members.map((member) => {
        const summary = summaryByMemberId.get(member.id);
        const isLocal = localMemberState?.memberId === member.id;
        const diagnostic = member.peerId ? diagnosticsByPeerId.get(member.peerId) : undefined;
        const playbackStatus = isLocal
          ? localMemberState.playbackStatus
          : getPlaybackStatus(member.presenceState, diagnostic);
        const mediaStatus = getCurrentTrackStatus(summary, member.presenceState);
        const presence = getPresence(member);
        const downloadRate = isLocal
          ? localMemberState.mediaSummary?.receiveRateKbps ?? null
          : diagnostic?.mediaReceiveBitrateKbps ?? null;
        const uploadRate = isLocal
          ? localMemberState.mediaSummary?.sendRateKbps ?? null
          : diagnostic?.mediaSendBitrateKbps ?? null;
        const latency = isLocal
          ? localMemberState.transportSummary.latencyMs
          : diagnostic?.currentRoundTripTimeMs ?? null;
        const remoteWan = !isLocal && diagnostic
          ? buildWanLinkScoreFromPeerDiagnostic({
              diagnostic,
              playbackBitrateKbps: localMemberState?.playbackBitrateKbps ?? null,
              providers: summary?.mediaTrackState === "live" ? [{
                peerId: member.id,
                availableUnits: 1,
                totalUnits: 1,
                isPreferredSource: true
              }] : []
            })
          : null;

        return (
          <article key={member.id} className="rounded-lg border border-surface-border bg-surface/25 p-3">
            <header className="flex items-center justify-between gap-3">
              <div>
                <strong className="text-[13px] text-foreground">{member.nickname}</strong>
                <span className={`ml-2 text-[10px] ${member.role === "host" ? "font-semibold text-accent" : "text-foreground-muted"}`}>
                  {member.role === "host" ? "房主" : "成员"}{isLocal ? " · 本机" : ""}
                </span>
              </div>
              <span className={`flex items-center gap-1.5 text-xs ${presence.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${presence.dot}`} />{presence.label}
              </span>
            </header>

            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-surface-border pt-3 sm:grid-cols-3">
              <div>
                <span className="text-[10px] text-foreground-muted">播放 / 数据状态</span>
                <div className="mt-1 flex items-center gap-2">
                  <strong className="text-xs text-foreground">{playbackStatus.label}</strong>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${getToneClasses(playbackStatus.tone)}`}>
                    {isLocal ? localMemberState.playbackStatus.badgeText : mediaStatus.label}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-foreground-muted">{playbackStatus.detail}</p>
              </div>

              <div>
                <span className="text-[10px] text-foreground-muted">媒体轨道</span>
                <strong className="mt-1 block text-xs text-foreground">{mediaStatus.label}</strong>
                <p className="mt-1 text-[10px] leading-4 text-foreground-muted">{mediaStatus.detail}</p>
                <p className="mt-1 text-[10px] text-foreground-muted/80">
                  码率：{isLocal
                    ? formatOpusRate(
                        localMemberState.playbackBitrateKbps,
                        localMemberState.configuredPlaybackBitrateKbps,
                        localMemberState.mediaSummary?.sampleAgeMs ?? null
                      )
                    : formatRate(diagnostic?.mediaReceiveBitrateKbps ?? null)}
                </p>
              </div>

              <div>
                <span className="text-[10px] text-foreground-muted">本端链路观测</span>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-foreground-muted">
                  <span>接收：{formatRate(downloadRate, isLocal ? localMemberState.mediaSummary?.sampleAgeMs ?? null : null)}</span>
                  <span>发送：{formatRate(uploadRate, isLocal ? localMemberState.mediaSummary?.sampleAgeMs ?? null : null)}</span>
                  <span>RTT：{formatMetric(latency, "ms")}</span>
                  <span>丢包：{formatMetric(diagnostic?.packetLossRate ?? null, "%")}</span>
                  <span>jitter：{formatMetric(diagnostic?.jitterMs ?? null, "ms")}</span>
                  <span>路径：{remoteWan?.pathLabel ?? (isLocal ? "汇总" : "未知")}</span>
                </div>
                {isLocal ? (
                  <p className="mt-1 text-[10px] text-foreground-muted/80">
                    样本：{formatSampleAge(localMemberState.transportSummary.sampleAgeMs)}
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        );
      }) : (
        <p className="rounded-lg border border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
          当前还没有成员进入房间。
        </p>
      )}
    </section>
  );
}

export const MembersPanel = memo(MembersPanelBase);
