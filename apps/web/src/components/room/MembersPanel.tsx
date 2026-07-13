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
  playbackAssetCount: number;
  totalPlaybackUnitCount: number;
  currentTrackOwnedUnitCount: number;
  currentTrackTotalUnitCount: number;
  currentTrackSources: string[];
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
  pieceSummary: {
    downloadRateKbps: number | null;
    uploadRateKbps: number | null;
    sampleAgeMs: number | null;
  };
  segmentedPlayback: SegmentedPlaybackSnapshot;
  playbackBitrateKbps: number | null;
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

function formatDuration(ms: number) {
  if (ms <= 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
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
    return { label: "离线", detail: "当前不提供播放资产单元。", tone: "warning" as const };
  }
  if (presenceState === "reconnecting") {
    return { label: "重新声明中", detail: "连接恢复后会重新发布持有范围。", tone: "warning" as const };
  }
  const owned = summary?.currentTrackOwnedUnitCount ?? 0;
  const total = summary?.currentTrackTotalUnitCount ?? 0;
  if (total <= 0) {
    return { label: "等待播放资产", detail: "当前曲目尚未发布分段 Opus 清单。", tone: "neutral" as const };
  }
  if (owned >= total) {
    return { label: "持有全部播放单元", detail: `已声明 ${owned}/${total} 个 Opus 单元。`, tone: "success" as const };
  }
  if (owned > 0) {
    return { label: `持有 ${owned}/${total} 个单元`, detail: "只保留已播放和滚动窗口所需单元。", tone: "accent" as const };
  }
  return { label: `持有 0/${total} 个单元`, detail: "当前没有可向其他成员提供的播放单元。", tone: "neutral" as const };
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
    return { label: "链路重连中", detail: "正在恢复播放资产数据通道。", tone: "warning" as const };
  }
  if (peerDiagnostics?.dataChannelState === "open") {
    const sampleAt = new Date(peerDiagnostics.updatedAt).getTime();
    const sampleFresh = Number.isFinite(sampleAt) && now - sampleAt <= 6_000;
    const transferring = sampleFresh &&
      ((peerDiagnostics.pieceDownloadRateKbps ?? 0) > 0 || (peerDiagnostics.pieceUploadRateKbps ?? 0) > 0);
    return transferring
      ? { label: "播放单元传输中", detail: "本端观测到该成员正在收发分段资产。", tone: "success" as const }
      : { label: "DataChannel 就绪", detail: "声音是否正在输出只在该成员本机可确认。", tone: "accent" as const };
  }
  if (peerDiagnostics?.transportHealth === "failed") {
    return {
      label: "数据链路失败",
      detail: peerDiagnostics.lastFailureReason ?? "当前无法交换播放资产单元。",
      tone: "danger" as const
    };
  }
  return { label: "等待数据链路", detail: "尚未观测到可用的播放资产通道。", tone: "neutral" as const };
}

function buildRoomProviders(summaries: MemberTransferSummary[]): WanProviderSummary[] {
  return summaries
    .filter((summary) => summary.currentTrackOwnedUnitCount > 0)
    .map((summary) => ({
      peerId: summary.memberId,
      availableUnits: summary.currentTrackOwnedUnitCount,
      totalUnits: summary.currentTrackTotalUnitCount
    }));
}

function resolveRoomWanScore(input: {
  summaries: MemberTransferSummary[];
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  localMemberState: LocalMemberPanelState | null;
}): WanLinkScore {
  const providers = buildRoomProviders(input.summaries);
  const playbackBitrateKbps = input.localMemberState?.playbackBitrateKbps ?? 192;
  const remoteScores = input.peerDiagnostics
    .filter((snapshot) => snapshot.peerId !== "system")
    .map((diagnostic) => buildWanLinkScoreFromPeerDiagnostic({
      diagnostic,
      providers,
      playbackBitrateKbps,
      downloadRateKbps:
        input.localMemberState?.pieceSummary.downloadRateKbps ?? diagnostic.pieceDownloadRateKbps,
      uploadRateKbps:
        input.localMemberState?.pieceSummary.uploadRateKbps ?? diagnostic.pieceUploadRateKbps
    }))
    .sort((left, right) => right.score - left.score);
  return remoteScores[0] ?? buildWanLinkScore({
    protocol: "udp",
    rttMs: input.localMemberState?.transportSummary.latencyMs ?? null,
    downloadRateKbps: input.localMemberState?.pieceSummary.downloadRateKbps ?? null,
    uploadRateKbps: input.localMemberState?.pieceSummary.uploadRateKbps ?? null,
    playbackBitrateKbps,
    dataChannelState: (input.localMemberState?.dataReadyCount ?? 0) > 0 ? "open" : "connecting",
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
        播放状态、AudioContext 与前向缓冲仅显示本机真实值；其他成员只展示其已声明的 v4 播放资产范围和本端 DataChannel 观测。
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
            <div>下载：{roomWanScore.metrics.downloadLabel}</div>
            <div>音频：{roomWanScore.metrics.audioBitrateLabel}</div>
            <div>余量：{roomWanScore.metrics.headroomLabel}</div>
            <div>上传：{roomWanScore.metrics.uploadLabel}</div>
            <div>来源：{roomWanScore.metrics.providerLabel}</div>
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
              Opus · {localMemberState.playbackBitrateKbps ?? "--"} kbps
            </strong>
          </div>
          <div>
            <span className="text-[10px] text-foreground-muted">前向可播</span>
            <strong className="mt-1 block text-sm text-foreground">
              {formatDuration(localMemberState.segmentedPlayback.bufferedMs)}
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
        const assetStatus = getCurrentTrackStatus(summary, member.presenceState);
        const presence = getPresence(member);
        const downloadRate = isLocal
          ? localMemberState.pieceSummary.downloadRateKbps
          : diagnostic?.pieceDownloadRateKbps ?? null;
        const uploadRate = isLocal
          ? localMemberState.pieceSummary.uploadRateKbps
          : diagnostic?.pieceUploadRateKbps ?? null;
        const latency = isLocal
          ? localMemberState.transportSummary.latencyMs
          : diagnostic?.currentRoundTripTimeMs ?? null;
        const sourceLabel = summary?.currentTrackSources.includes("live_upload")
          ? "上传端播放资产"
          : summary?.currentTrackSources.includes("local_cache")
            ? "本地持有播放资产"
            : "暂无声明";
        const remoteWan = !isLocal && diagnostic
          ? buildWanLinkScoreFromPeerDiagnostic({
              diagnostic,
              playbackBitrateKbps: localMemberState?.playbackBitrateKbps ?? 192,
              providers: summary ? [{
                peerId: member.id,
                availableUnits: summary.currentTrackOwnedUnitCount,
                totalUnits: summary.currentTrackTotalUnitCount
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
                    {isLocal ? localMemberState.playbackStatus.badgeText : diagnostic?.dataChannelState ?? "未知"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-foreground-muted">{playbackStatus.detail}</p>
              </div>

              <div>
                <span className="text-[10px] text-foreground-muted">当前播放资产</span>
                <strong className="mt-1 block text-xs text-foreground">{assetStatus.label}</strong>
                <p className="mt-1 text-[10px] leading-4 text-foreground-muted">{assetStatus.detail}</p>
                <p className="mt-1 text-[10px] text-foreground-muted/80">来源：{sourceLabel}</p>
              </div>

              <div>
                <span className="text-[10px] text-foreground-muted">本端链路观测</span>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-foreground-muted">
                  <span>下载：{formatRate(downloadRate, isLocal ? localMemberState.pieceSummary.sampleAgeMs : null)}</span>
                  <span>上传：{formatRate(uploadRate, isLocal ? localMemberState.pieceSummary.sampleAgeMs : null)}</span>
                  <span>RTT：{formatMetric(latency, "ms")}</span>
                  <span>路径：{remoteWan?.pathLabel ?? (isLocal ? "汇总" : "未知")}</span>
                </div>
                {isLocal ? (
                  <p className="mt-1 text-[10px] text-foreground-muted/80">
                    样本：{formatSampleAge(localMemberState.pieceSummary.sampleAgeMs)}
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
