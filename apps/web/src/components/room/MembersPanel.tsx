"use client";

import { memo, useState } from "react";
import { getRoomMemberPermissions, type PeerDiagnosticsSnapshot, type RoomMember, type RoomMemberPermissions } from "@music-room/shared";
import type { PlaybackAudioPath } from "@/features/playback/use-segmented-opus-playback";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  dedupeRoomMembers,
  hasFreshMediaObservation,
} from "./member-data";

type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type LocalMemberPanelState = {
  memberId: string;
  audible: boolean | null;
  playbackPath?: PlaybackAudioPath;
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
  activeSessionId: string | null;
  isHost: boolean;
  onUpdateMemberPermissions: (memberId: string, permissions: RoomMemberPermissions) => Promise<boolean>;
  onRemoveMember: (memberId: string) => Promise<boolean>;
};

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
  label: "正在发声" | "本地播放" | "正在播放" | "未发声" | "未播放" | "等待音频" | "等待重连" | "离线";
  tone: StatusTone;
  active: boolean;
};

export function isMemberCurrentSource(input: {
  member: Pick<RoomMember, "id" | "peerId">;
  sourceSessionId?: string | null;
  sourcePeerId: string | null;
}) {
  // sourceSessionId is stable across peer reconnects. Only use the peer id
  // for snapshots from before session identity was persisted.
  if (input.sourceSessionId !== null && input.sourceSessionId !== undefined) {
    return input.member.id === input.sourceSessionId;
  }

  return input.member.peerId !== null && input.member.peerId === input.sourcePeerId;
}

export function getMemberAudibleStatus(input: {
  presenceState: RoomMember["presenceState"];
  playbackActive: boolean;
  isLocal: boolean;
  isCurrentSource?: boolean;
  localMemberState: LocalMemberPanelState | null;
  diagnostic: PeerDiagnosticsSnapshot | undefined;
  now?: number;
}): MemberAudibleStatus {
  const isCurrentSource = input.isCurrentSource ?? true;
  const isLocalPlayback = input.localMemberState?.playbackPath === "local-file" ||
    input.localMemberState?.playbackPath === "local-segmented";
  if (input.presenceState === "offline") {
    return { label: "离线", tone: "neutral", active: false };
  }
  if (input.presenceState === "reconnecting") {
    return { label: "等待重连", tone: "warning", active: false };
  }
  if (!input.playbackActive) {
    return {
      label: input.isCurrentSource ? "未发声" : "未播放",
      tone: "neutral",
      active: false
    };
  }

  if (input.isLocal) {
    if (input.localMemberState?.audible === true) {
      return {
        label: isCurrentSource ? "正在发声" : isLocalPlayback ? "本地播放" : "正在播放",
        tone: "success",
        active: true
      };
    }
    if (input.localMemberState?.audible === false) {
      return {
        label: isCurrentSource ? "未发声" : "未播放",
        tone: "warning",
        active: false
      };
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
      ? {
          label: isCurrentSource ? "正在发声" : "正在播放",
          tone: "success",
          active: true
        }
      : {
          label: isCurrentSource ? "未发声" : "未播放",
          tone: "warning",
          active: false
        };
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
    ? {
        label: isCurrentSource ? "正在发声" : "正在播放",
        tone: "success",
        active: true
      }
    : {
        label: isCurrentSource ? "未发声" : "未播放",
        tone: "warning",
        active: false
      };
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

function MembersPanelBase({
  members,
  activeSessionId,
  isHost,
  onUpdateMemberPermissions,
  onRemoveMember
}: MembersPanelProps) {
  const [openSettingsMemberId, setOpenSettingsMemberId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RoomMember | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const normalizedMembers = dedupeRoomMembers(members);
  const onlineCount = normalizedMembers.filter((member) => member.presenceState === "online").length;

  const handlePermissionChange = async (
    member: RoomMember,
    permission: keyof RoomMemberPermissions,
    checked: boolean
  ) => {
    const key = `${member.id}:${permission}`;
    setPendingPermission(key);
    try {
      await onUpdateMemberPermissions(member.id, {
        ...getRoomMemberPermissions(member),
        [permission]: checked
      });
    } finally {
      setPendingPermission(null);
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setIsRemoving(true);
    try {
      const removed = await onRemoveMember(removeTarget.id);
      if (removed) setRemoveTarget(null);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <section className="flex w-full flex-col gap-3" data-testid="members-panel">
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
            const presence = getPresence(member);
            const canManageMember = isHost && member.role !== "host" && member.id !== activeSessionId;
            const isSettingsOpen = openSettingsMemberId === member.id;

            return (
              <div key={member.id} className="group">
                <article className="flex min-w-0 items-center gap-3 px-3 py-3.5 transition-colors duration-200 hover:bg-white/[0.03] sm:px-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-sm font-semibold text-foreground">
                    {member.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <strong className="truncate text-sm font-semibold text-foreground">{member.nickname}</strong>
                      {member.id === activeSessionId ? <span className="shrink-0 text-[10px] text-foreground-muted">本机</span> : null}
                    </div>
                    <span className="mt-0.5 block text-[11px] text-foreground-muted">
                      {member.role === "host" ? "房主" : "成员"}
                    </span>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1.5 text-xs ${presence.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${presence.dot}`} />
                    {presence.label}
                  </span>
                  {canManageMember ? (
                    <div className="flex shrink-0 items-center gap-0.5 border-l border-surface-border pl-2">
                      <Button
                        aria-expanded={isSettingsOpen}
                        aria-controls={`member-permissions-${member.id}`}
                        aria-label={`设置 ${member.nickname} 的权限`}
                        className="h-8 w-8 rounded-lg p-0"
                        data-testid={`member-settings-${member.id}`}
                        onClick={() => setOpenSettingsMemberId(isSettingsOpen ? null : member.id)}
                        title="设置权限"
                        type="button"
                        variant="ghost"
                        size="icon"
                      >
                        <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                          <path d="M4 7h16M4 12h16M4 17h16" />
                          <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
                          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
                          <circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
                        </svg>
                      </Button>
                      <Button
                        aria-label={`移除 ${member.nickname}`}
                        className="h-8 w-8 rounded-lg p-0 text-red-300 hover:text-red-200"
                        data-testid={`member-remove-${member.id}`}
                        onClick={() => setRemoveTarget(member)}
                        title="移除成员"
                        type="button"
                        variant="ghost"
                        size="icon"
                      >
                        <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                          <path d="M9 10h6M10 14h4M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />
                          <path d="m17 17 4 4M21 17l-4 4" />
                        </svg>
                      </Button>
                    </div>
                  ) : null}
                </article>
                {isSettingsOpen ? (
                  <div className="motion-safe:animate-fade-in border-t border-surface-border bg-background/30 px-3 py-3 sm:px-4" data-testid={`member-permissions-${member.id}`} id={`member-permissions-${member.id}`}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-foreground">房间权限</span>
                      <span className="text-[10px] text-foreground-muted">仅房主可修改</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {([
                        ["library", "曲库权", "上传和管理房间曲库"],
                        ["queue", "队列权", "添加和整理共享队列"],
                        ["player", "播放器权", "控制房间播放状态"]
                      ] as Array<[keyof RoomMemberPermissions, string, string]>).map(([permission, label, description]) => {
                        const checked = getRoomMemberPermissions(member)[permission];
                        const pending = pendingPermission === `${member.id}:${permission}`;
                        return (
                          <div key={permission} className="flex items-center justify-between gap-3 rounded-lg border border-surface-border px-3 py-2.5">
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-foreground">{label}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-foreground-muted">{description}</span>
                            </span>
                            <button
                              aria-checked={checked}
                              aria-label={`${label}${checked ? "已开启" : "已关闭"}`}
                              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${checked ? "bg-accent" : "bg-surface-hover"} ${pending ? "cursor-wait opacity-60" : ""}`}
                              disabled={pendingPermission !== null}
                              onClick={() => void handlePermissionChange(member, permission, !checked)}
                              role="switch"
                              type="button"
                            >
                              <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="border-y border-dashed border-surface-border px-4 py-6 text-center text-xs text-foreground-muted">
          当前还没有成员进入房间。
        </p>
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        title="移除房间成员"
        description={removeTarget ? `确定要将“${removeTarget.nickname}”移出这个房间吗？对方会立即失去房间访问权限。` : ""}
        confirmLabel="移除成员"
        destructive
        pending={isRemoving}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void handleRemove()}
      />
    </section>
  );
}

export const MembersPanel = memo(MembersPanelBase);
