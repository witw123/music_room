"use client";

import { useMemo } from "react";
import type {
  IceConfigResponse,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import type { LocalMemberPanelState } from "@/components/room/MembersPanel";
import { pickActiveMediaDiagnostic } from "@/features/p2p";

type UseRoomDerivedStateInput = {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  connectedPeers: string[];
  mediaConnectedPeers: string[];
  activeDashboardTab: "queue" | "library" | "members";
  currentTrack: RoomSnapshot["tracks"][number] | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  canDeleteRoom: boolean;
  statusMessage: string;
  iceConfig: IceConfigResponse | null;
  iceConfigResolved: boolean;
  workspaceOnly: boolean;
  initialRoomId: string | null;
  activeSessionUserId?: string;
  mediaConnectionState: RoomMediaConnectionState;
  audioUnlocked: boolean;
  sourceStartState: LocalMemberPanelState["sourceStartState"];
  lastSourceStartError: string | null;
  suppressRoomRecovery: boolean;
  isNavigatingRoomExit: boolean;
  isRecoveringRoom: boolean;
};

export function useRoomDerivedState({
  roomSnapshot,
  peerId,
  connectedPeers,
  mediaConnectedPeers,
  activeDashboardTab,
  currentTrack,
  availabilityByTrack,
  peerDiagnostics,
  peerRecentEvents,
  canDeleteRoom,
  statusMessage,
  iceConfig,
  iceConfigResolved,
  workspaceOnly,
  initialRoomId,
  activeSessionUserId,
  mediaConnectionState,
  audioUnlocked,
  sourceStartState,
  lastSourceStartError,
  suppressRoomRecovery,
  isNavigatingRoomExit,
  isRecoveringRoom
}: UseRoomDerivedStateInput) {
  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const activeMemberPeerIds = useMemo(
    () => getActiveMemberPeerIds(roomSnapshot?.room.members ?? []),
    [roomSnapshot?.room.members]
  );
  const remoteMediaDiagnostic = useMemo(
    () => peerDiagnostics.find((peer) => peer.peerId === "remote-media") ?? null,
    [peerDiagnostics]
  );

  const canDisbandRoom =
    !!roomSnapshot &&
    canDeleteRoom &&
    (() => {
      const uploaderIds = new Set(roomSnapshot.tracks.map((track) => track.ownerSessionId));
      return !roomSnapshot.room.members.some(
        (member) => uploaderIds.has(member.id) && member.presenceState !== "online"
      );
    })();

  const availabilitySummary =
    roomSnapshot?.tracks.map((track) => {
      const peers = filterAvailabilityAnnouncementsByCurrentRoomPeers(
        availabilityByTrack[track.id] ?? {},
        roomSnapshot.room.id,
        activeMemberPeerIds
      );
      const local = peers.find((entry) => entry.ownerPeerId === peerId);
      return {
        track,
        peerCount: peers.length,
        localChunkCount: local?.availableChunks.length ?? 0,
        totalChunks: local?.totalChunks ?? peers[0]?.totalChunks ?? track.pieceManifest?.totalChunks ?? 0,
        sources: peers.map((entry) => `${entry.nickname} (${entry.source})`)
      };
    }) ?? [];

  const currentTrackAvailability = currentTrack
    ? availabilitySummary.find((entry) => entry.track.id === currentTrack.id) ?? null
    : null;
  const activeMediaDiagnostic = useMemo(
    () => pickActiveMediaDiagnostic(peerDiagnostics, roomSnapshot?.room.playback.sourcePeerId ?? null),
    [peerDiagnostics, roomSnapshot?.room.playback.sourcePeerId]
  );

  const memberTransferSummaries = useMemo(() => {
    if (!roomSnapshot || activeDashboardTab !== "members") {
      return [];
    }

    const memberIdByPeerId = new Map(
      roomSnapshot.room.members
        .filter((member) => !!member.peerId)
        .map((member) => [member.peerId as string, member.id])
    );
    const statsByMember = new Map<
      string,
      {
        announcedTrackIds: Set<string>;
        totalChunkCount: number;
        currentTrackChunkCount: number;
        currentTrackTotalChunks: number;
        currentTrackSources: Set<string>;
      }
    >();

    for (const track of roomSnapshot.tracks) {
      for (const announcement of filterAvailabilityAnnouncementsByCurrentRoomPeers(
        availabilityByTrack[track.id] ?? {},
        roomSnapshot.room.id,
        activeMemberPeerIds
      )) {
        const memberId = memberIdByPeerId.get(announcement.ownerPeerId) ?? null;
        if (!memberId) {
          continue;
        }

        const existing =
          statsByMember.get(memberId) ??
          (() => {
            const initial = {
              announcedTrackIds: new Set<string>(),
              totalChunkCount: 0,
              currentTrackChunkCount: 0,
              currentTrackTotalChunks: 0,
              currentTrackSources: new Set<string>()
            };
            statsByMember.set(memberId, initial);
            return initial;
          })();

        existing.announcedTrackIds.add(track.id);
        existing.totalChunkCount += announcement.availableChunks.length;

        if (currentTrack && track.id === currentTrack.id) {
          existing.currentTrackChunkCount += announcement.availableChunks.length;
          existing.currentTrackTotalChunks = Math.max(
            existing.currentTrackTotalChunks,
            announcement.totalChunks
          );
          existing.currentTrackSources.add(announcement.source);
        }
      }
    }

    return roomSnapshot.room.members.map((member) => {
      const stats = statsByMember.get(member.id) ?? null;
      const manifestTotalChunks = currentTrack?.pieceManifest?.totalChunks ?? 0;

      return {
        memberId: member.id,
        announcedTrackCount: stats?.announcedTrackIds.size ?? 0,
        totalChunkCount: stats?.totalChunkCount ?? 0,
        currentTrackChunkCount: stats?.currentTrackChunkCount ?? 0,
        currentTrackTotalChunks: Math.max(stats?.currentTrackTotalChunks ?? 0, manifestTotalChunks),
        currentTrackSources: [...(stats?.currentTrackSources ?? [])]
      };
    });
  }, [activeDashboardTab, activeMemberPeerIds, availabilityByTrack, currentTrack, roomSnapshot]);

  const visiblePeerDiagnostics = useMemo(() => {
    return filterVisiblePeerDiagnostics(
      peerDiagnostics,
      activeMemberPeerIds,
      roomSnapshot?.room.playback.sourcePeerId ?? null
    )
      .sort((left, right) => {
        const leftPriority = getDiagnosticPriority(left.peerId, roomSnapshot?.room.playback.sourcePeerId ?? null);
        const rightPriority = getDiagnosticPriority(right.peerId, roomSnapshot?.room.playback.sourcePeerId ?? null);
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [activeMemberPeerIds, peerDiagnostics, roomSnapshot?.room.playback.sourcePeerId]);

  const visiblePeerRecentEvents = useMemo(() => {
    const visiblePeerIds = new Set(visiblePeerDiagnostics.map((item) => item.peerId));
    return peerRecentEvents.filter((event) => visiblePeerIds.has(event.peerId));
  }, [peerRecentEvents, visiblePeerDiagnostics]);

  const localMemberState = useMemo<LocalMemberPanelState | null>(() => {
    if (!roomSnapshot || !activeSessionUserId) {
      return null;
    }

    const localMember =
      roomSnapshot.room.members.find((member) => member.id === activeSessionUserId) ?? null;
    if (!localMember) {
      return null;
    }

    const activePeerDiagnostics = peerDiagnostics.filter((peer) => activeMemberPeerIds.has(peer.peerId));
    const totalPieceDownloadRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "pieceDownloadRateKbps"
    );
    const totalPieceUploadRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "pieceUploadRateKbps"
    );
    const averageLatencyMs = averageDiagnosticsValue(activePeerDiagnostics, "currentRoundTripTimeMs");
    const totalMediaSendRateKbps = sumDiagnosticsValue(activePeerDiagnostics, "mediaSendBitrateKbps");
    const totalMediaReceiveRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "mediaReceiveBitrateKbps"
    );
    const effectiveMediaReceiveRateKbps =
      totalMediaReceiveRateKbps ??
      activeMediaDiagnostic?.mediaReceiveBitrateKbps ??
      (activeMediaDiagnostic?.mediaSendBitrateKbps === null
        ? activeMediaDiagnostic?.availableOutgoingBitrateKbps ?? null
        : null);
    const effectiveMediaSendRateKbps =
      totalMediaSendRateKbps ??
      activeMediaDiagnostic?.mediaSendBitrateKbps ??
      null;
    const hasTransportMetricSample = hasDiagnosticsMetricSample(activePeerDiagnostics, [
      "mediaReceiveBitrateKbps",
      "mediaSendBitrateKbps",
      "availableOutgoingBitrateKbps",
      "currentRoundTripTimeMs"
    ]);
    const hasPieceMetricSample = hasPieceTransferSample(activePeerDiagnostics);
    const isSourceOwner = roomSnapshot.room.playback.sourceSessionId === activeSessionUserId;
    const transportSampleAgeMs = getLatestMetricSampleAgeMs(
      activePeerDiagnostics,
      [
        "mediaReceiveBitrateKbps",
        "mediaSendBitrateKbps",
        "availableOutgoingBitrateKbps",
        "currentRoundTripTimeMs"
      ]
    );
    const pieceSampleAgeMs = getLatestPieceSampleAgeMs(activePeerDiagnostics);
    const normalizedMediaReceiveRateKbps =
      effectiveMediaReceiveRateKbps ?? (hasTransportMetricSample ? 0 : null);
    const normalizedMediaSendRateKbps =
      effectiveMediaSendRateKbps ?? (hasTransportMetricSample ? 0 : null);
    const normalizedPieceDownloadRateKbps =
      totalPieceDownloadRateKbps ?? (hasPieceMetricSample ? 0 : null);
    const normalizedPieceUploadRateKbps =
      totalPieceUploadRateKbps ?? (hasPieceMetricSample ? 0 : null);

    return {
      memberId: localMember.id,
      audioUnlocked,
      sourceStartState,
      lastSourceStartError,
      transportLabel: isSourceOwner ? "实时音频分发（本机汇总）" : "远端流链路（本机）",
      transportSummary: {
        totalRateKbps:
          sumNullableNumbers(normalizedMediaReceiveRateKbps, normalizedMediaSendRateKbps),
        receiveRateKbps: normalizedMediaReceiveRateKbps,
        sendRateKbps: normalizedMediaSendRateKbps,
        latencyMs: averageLatencyMs,
        sampleAgeMs: transportSampleAgeMs
      },
      pieceSummary: {
        downloadRateKbps: normalizedPieceDownloadRateKbps,
        uploadRateKbps: normalizedPieceUploadRateKbps,
        sampleAgeMs: pieceSampleAgeMs
      },
      playbackStatus: getLocalPlaybackStatus({
        presenceState: localMember.presenceState,
        mediaConnectionState,
        isSourceOwner,
        audioUnlocked,
        sourceStartState,
        lastSourceStartError,
        mediaConnectedPeersCount: countPeersWithinActiveMembers(
          mediaConnectedPeers,
          activeMemberPeerIds
        ),
        playbackStatus: roomSnapshot.room.playback.status,
        remoteMediaPlaybackReady: isRemoteMediaPlaybackReady(remoteMediaDiagnostic),
        remoteTrackReceived: !!remoteMediaDiagnostic?.remoteTrackStatus.received,
        remoteTrackBound: !!remoteMediaDiagnostic?.remoteTrackStatus.boundToAudioElement
      })
    };
  }, [
    activeMediaDiagnostic,
    activeMemberPeerIds,
    activeSessionUserId,
    audioUnlocked,
    lastSourceStartError,
    mediaConnectedPeers,
    mediaConnectionState,
    peerDiagnostics,
    remoteMediaDiagnostic,
    roomSnapshot,
    sourceStartState
  ]);

  const statusTone =
    statusMessage.includes("失败") || statusMessage.includes("不可用")
      ? "warning"
      : statusMessage.includes("已")
        ? "success"
        : "neutral";

  const iceConfigStatus = iceConfig
    ? `当前 ICE 配置来源：${iceConfig.source}，共 ${iceConfig.iceServers.length} 组服务器。`
    : iceConfigResolved
      ? "当前未拿到短期 TURN 凭证，已回退静态 STUN/TURN 配置。"
      : "正在获取 ICE/TURN 配置…";

  const iceConfigSource = iceConfig?.source ?? (iceConfigResolved ? "static-fallback" : "loading");

  const isRoomTransitionPending =
    workspaceOnly &&
    !!initialRoomId &&
    !!activeSessionUserId &&
    !suppressRoomRecovery &&
    !roomSnapshot;

  const showRoomTransitionState =
    isNavigatingRoomExit || isRecoveringRoom || isRoomTransitionPending;

  return {
    host,
    canDisbandRoom,
    connectedPeersCount: countPeersWithinActiveMembers(connectedPeers, activeMemberPeerIds),
    mediaConnectedPeersCount: countPeersWithinActiveMembers(
      mediaConnectedPeers,
      activeMemberPeerIds
    ),
    availabilitySummary,
    currentTrackAvailability,
    memberTransferSummaries,
    localMemberState,
    visiblePeerDiagnostics,
    visiblePeerRecentEvents,
    statusTone,
    iceConfigStatus,
    iceConfigSource,
    isRoomTransitionPending,
    showRoomTransitionState
  };
}

function getDiagnosticPriority(peerId: string, sourcePeerId: string | null) {
  if (peerId === "system") {
    return 0;
  }

  if (peerId === sourcePeerId) {
    return 1;
  }

  if (peerId === "remote-media") {
    return 2;
  }

  return 3;
}

export function getActiveMemberPeerIds(members: RoomSnapshot["room"]["members"]) {
  return new Set(
    members
      .map((member) => member.peerId)
      .filter((memberPeerId): memberPeerId is string => !!memberPeerId)
  );
}

export function filterAvailabilityAnnouncementsByActivePeers(
  trackAvailability: Record<string, TrackAvailabilityAnnouncement>,
  activeMemberPeerIds: Set<string>
) {
  return Object.values(trackAvailability).filter((announcement) =>
    activeMemberPeerIds.has(announcement.ownerPeerId)
  );
}

export function filterAvailabilityAnnouncementsByCurrentRoomPeers(
  trackAvailability: Record<string, TrackAvailabilityAnnouncement>,
  roomId: string,
  activeMemberPeerIds: Set<string>
) {
  return filterAvailabilityAnnouncementsByActivePeers(
    trackAvailability,
    activeMemberPeerIds
  ).filter((announcement) => announcement.roomId === roomId);
}

export function countPeersWithinActiveMembers(
  peerIds: string[],
  activeMemberPeerIds: Set<string>
) {
  return peerIds.filter((peerId) => activeMemberPeerIds.has(peerId)).length;
}

function sumDiagnosticsValue(
  diagnostics: PeerDiagnosticsSnapshot[],
  key:
    | "pieceDownloadRateKbps"
    | "pieceUploadRateKbps"
    | "mediaSendBitrateKbps"
    | "mediaReceiveBitrateKbps"
) {
  const values = diagnostics
    .map((peer) => peer[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

function sumNullableNumbers(...values: Array<number | null>) {
  const numbers = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (numbers.length === 0) {
    return null;
  }

  return Math.round(numbers.reduce((sum, value) => sum + value, 0) * 10) / 10;
}

function averageDiagnosticsValue(
  diagnostics: PeerDiagnosticsSnapshot[],
  key: "currentRoundTripTimeMs"
) {
  const values = diagnostics
    .map((peer) => peer[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function getLatestMetricSampleAgeMs(
  diagnostics: PeerDiagnosticsSnapshot[],
  keys: Array<
    | "availableOutgoingBitrateKbps"
    | "mediaReceiveBitrateKbps"
    | "mediaSendBitrateKbps"
    | "currentRoundTripTimeMs"
  >,
  now = Date.now()
) {
  const latestTimestampMs = diagnostics.reduce<number | null>((latest, diagnostic) => {
    const hasMetric = keys.some(
      (key) => typeof diagnostic[key] === "number" && Number.isFinite(diagnostic[key])
    );
    if (!hasMetric) {
      return latest;
    }

    const timestampMs = new Date(diagnostic.updatedAt).getTime();
    if (!Number.isFinite(timestampMs)) {
      return latest;
    }

    return latest === null ? timestampMs : Math.max(latest, timestampMs);
  }, null);

  return latestTimestampMs === null ? null : Math.max(0, now - latestTimestampMs);
}

function hasDiagnosticsMetricSample(
  diagnostics: PeerDiagnosticsSnapshot[],
  keys: Array<
    | "availableOutgoingBitrateKbps"
    | "mediaReceiveBitrateKbps"
    | "mediaSendBitrateKbps"
    | "currentRoundTripTimeMs"
  >
) {
  return diagnostics.some((diagnostic) =>
    keys.some((key) => typeof diagnostic[key] === "number" && Number.isFinite(diagnostic[key]))
  );
}

function getLatestPieceSampleAgeMs(diagnostics: PeerDiagnosticsSnapshot[], now = Date.now()) {
  const latestTimestampMs = diagnostics.reduce<number | null>((latest, diagnostic) => {
    const candidateTimestamps = [
      diagnostic.lastPieceReceivedAt,
      typeof diagnostic.pieceDownloadRateKbps === "number" ||
      typeof diagnostic.pieceUploadRateKbps === "number"
        ? diagnostic.updatedAt
        : null
    ]
      .filter((value): value is string => !!value)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    if (candidateTimestamps.length === 0) {
      return latest;
    }

    const diagnosticLatest = Math.max(...candidateTimestamps);
    return latest === null ? diagnosticLatest : Math.max(latest, diagnosticLatest);
  }, null);

  return latestTimestampMs === null ? null : Math.max(0, now - latestTimestampMs);
}

function hasPieceTransferSample(diagnostics: PeerDiagnosticsSnapshot[]) {
  return diagnostics.some(
    (diagnostic) =>
      typeof diagnostic.pieceDownloadRateKbps === "number" ||
      typeof diagnostic.pieceUploadRateKbps === "number" ||
      !!diagnostic.lastPieceReceivedAt
  );
}

function getLocalPlaybackStatus(input: {
  presenceState: RoomSnapshot["room"]["members"][number]["presenceState"];
  mediaConnectionState: RoomMediaConnectionState;
  isSourceOwner: boolean;
  audioUnlocked: boolean;
  sourceStartState: LocalMemberPanelState["sourceStartState"];
  lastSourceStartError: string | null;
  mediaConnectedPeersCount: number;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  remoteMediaPlaybackReady: boolean;
  remoteTrackReceived: boolean;
  remoteTrackBound: boolean;
}): LocalMemberPanelState["playbackStatus"] {
  if (input.presenceState === "offline") {
    return {
      label: "未接入音频",
      detail: "当前成员已离线。",
      tone: "warning",
      badgeText: "offline"
    };
  }

  if (input.presenceState === "reconnecting") {
    return {
      label: "实时音频重连中",
      detail: "本机正在恢复实时播放链路。",
      tone: "warning",
      badgeText: "reconnecting"
    };
  }

  if (input.isSourceOwner) {
    if (input.playbackStatus !== "playing") {
      return {
        label: "本地待机",
        detail: "当前还没有在向房间持续分发实时音频。",
        tone: "neutral",
        badgeText: "source-idle"
      };
    }

    if (input.sourceStartState === "awaiting-unlock" || !input.audioUnlocked) {
      return {
        label: "等待本机音频启动",
        detail: "当前设备尚未完成本机音频解锁，下一次任意交互后会自动开始实时分发。",
        tone: "warning",
        badgeText: "source-awaiting-unlock"
      };
    }

    if (input.sourceStartState === "starting") {
      return {
        label: "正在启动实时分发",
        detail: "本机已解锁，正在拉起本地音频并同步给房间。",
        tone: "accent",
        badgeText: "source-starting"
      };
    }

    if (input.sourceStartState === "failed") {
      return {
        label: "本机音频启动失败",
        detail: input.lastSourceStartError
          ? `本机音频启动被阻止：${input.lastSourceStartError}`
          : "当前未能拉起本机音频输出，等待下一次交互后自动重试。",
        tone: "warning",
        badgeText: "source-failed"
      };
    }

    if (input.mediaConnectedPeersCount > 0) {
      return {
        label: "本地播放中",
        detail: `当前正在向 ${input.mediaConnectedPeersCount} 位成员分发实时音频。`,
        tone: "success",
        badgeText: "source-live"
      };
    }

    return {
      label: "本地播放中",
      detail: "当前曲目正在本机播放，等待其他成员接入实时音频。",
      tone: "accent",
      badgeText: "source-waiting"
    };
  }

  switch (input.mediaConnectionState) {
    case "live":
      if (input.remoteMediaPlaybackReady) {
        return {
          label: "实时音频中",
          detail: "当前已接入远端实时音频链路。",
          tone: "success",
          badgeText: "healthy"
        };
      }
      return {
        label: "实时音频缓冲中",
        detail: "链路已连接，但远端音频元素尚未进入实际播放。",
        tone: "accent",
        badgeText: "buffering"
      };
    case "buffering":
      if (input.remoteMediaPlaybackReady) {
        return {
          label: "实时音频中",
          detail: "当前已接入远端实时音频链路。",
          tone: "success",
          badgeText: "healthy"
        };
      }
      if (input.remoteTrackReceived || input.remoteTrackBound) {
        return {
          label: "实时音频缓冲中",
          detail: "已收到远端媒体，正在等待音频元素进入播放。",
          tone: "accent",
          badgeText: "buffering"
        };
      }
      return {
        label: "正在连接实时音频",
        detail: "实时链路已建立，正在等待远端音频轨到达。",
        tone: "accent",
        badgeText: "connecting"
      };
    case "connecting":
      return {
        label: "正在连接实时音频",
        detail: "当前正在接入房间实时音频。",
        tone: "accent",
        badgeText: "connecting"
      };
    case "reconnecting":
      return {
        label: "实时音频重连中",
        detail: "链路状态正在恢复，音频可能暂时抖动。",
        tone: "warning",
        badgeText: "reconnecting"
      };
    case "failed":
      return {
        label: "实时音频连接失败",
        detail: "当前实时音频链路恢复失败。",
        tone: "warning",
        badgeText: "failed"
      };
    default:
      if (input.remoteMediaPlaybackReady) {
        return {
          label: "实时音频中",
          detail: "当前已接入远端实时音频链路。",
          tone: "success",
          badgeText: "healthy"
        };
      }
      return {
        label: "未接入音频",
        detail: "当前还没有稳定的实时音频链路。",
        tone: "neutral",
        badgeText: "idle"
      };
  }
}

export function isRemoteMediaPlaybackReady(peer: PeerDiagnosticsSnapshot | null | undefined) {
  if (!peer || peer.peerId !== "remote-media") {
    return false;
  }

  const status = peer.remoteTrackStatus;
  return (
    status.received &&
    status.boundToAudioElement &&
    status.hasSrcObject === true &&
    status.audioPaused === false &&
    (status.lastAudioEvent === "playing" || status.lastPlayAttemptResult === "ok")
  );
}

export function filterVisiblePeerDiagnostics(
  peerDiagnostics: PeerDiagnosticsSnapshot[],
  activeMemberPeerIds: Set<string>,
  sourcePeerId: string | null
) {
  const visiblePeerIds = new Set<string>(["system", "remote-media"]);
  for (const peerId of activeMemberPeerIds) {
    visiblePeerIds.add(peerId);
  }
  if (sourcePeerId) {
    visiblePeerIds.add(sourcePeerId);
  }

  return peerDiagnostics.filter((peer) => visiblePeerIds.has(peer.peerId));
}
