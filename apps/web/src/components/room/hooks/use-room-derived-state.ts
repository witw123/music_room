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
import { buildDiagnosticsViewModel } from "@/components/room/diagnostics-view-model";
import {
  resolveTrackPieceManifest,
  selectCanonicalTrackAvailabilityAnnouncement
} from "@/features/p2p";
import { buildManualCacheSchedulerAvailabilityFromParts } from "@/features/room/hooks/use-manual-cache-downloader";

export type UseRoomDerivedStateInput = {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  connectedPeers: string[];
  mediaConnectedPeers: string[];
  activeDashboardTab: "queue" | "library" | "cache" | "members";
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

const emptyWorkspacePeerDiagnostics: PeerDiagnosticsSnapshot[] = [];
const emptyWorkspacePeerRecentEvents: PeerRecentEvent[] = [];

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
  const roomId = roomSnapshot?.room.id ?? null;
  const roomMembers = roomSnapshot?.room.members ?? null;
  const roomTracks = roomSnapshot?.tracks ?? null;
  const roomPlayback = roomSnapshot?.room.playback ?? null;
  const host = roomMembers?.find((member) => member.role === "host");
  const activeMemberPeerIds = useMemo(
    () => getActiveMemberPeerIds(roomMembers ?? []),
    [roomMembers]
  );
  const derivedAvailabilityByTrack = useMemo(
    () => {
      if (!roomId || !roomMembers || !roomTracks) {
        return availabilityByTrack;
      }

      return buildManualCacheSchedulerAvailabilityFromParts({
        availabilityByTrack,
        manualCacheTrackIds: roomTracks.map((track) => track.id),
        roomId,
        members: roomMembers,
        playback: roomPlayback,
        tracks: roomTracks,
        localPeerId: peerId
      });
    },
    [availabilityByTrack, peerId, roomId, roomMembers, roomPlayback, roomTracks]
  );
  const systemDiagnostic = useMemo(
    () => peerDiagnostics.find((peer) => peer.peerId === "system") ?? null,
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

  const availabilitySummary = useMemo(
    () =>
      roomId && roomTracks
        ? buildAvailabilitySummary({
            tracks: roomTracks,
            availabilityByTrack: derivedAvailabilityByTrack,
            roomId,
            activeMemberPeerIds,
            localPeerId: peerId
          })
        : [],
    [activeMemberPeerIds, derivedAvailabilityByTrack, peerId, roomId, roomTracks]
  );

  const currentTrackAvailability = useMemo(
    () =>
      currentTrack
        ? availabilitySummary.find((entry) => entry.track.id === currentTrack.id) ?? null
        : null,
    [availabilitySummary, currentTrack]
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
    const currentTrackManifest = currentTrack
      ? resolveCurrentRoomTrackManifest(
          currentTrack,
          derivedAvailabilityByTrack[currentTrack.id] ?? {},
          roomSnapshot.room.id,
          activeMemberPeerIds
        )
      : null;
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
        derivedAvailabilityByTrack[track.id] ?? {},
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
      const manifestTotalChunks = currentTrackManifest?.totalChunks ?? 0;

      return {
        memberId: member.id,
        announcedTrackCount: stats?.announcedTrackIds.size ?? 0,
        totalChunkCount: stats?.totalChunkCount ?? 0,
        currentTrackChunkCount: stats?.currentTrackChunkCount ?? 0,
        currentTrackTotalChunks: manifestTotalChunks || (stats?.currentTrackTotalChunks ?? 0),
        currentTrackSources: [...(stats?.currentTrackSources ?? [])]
      };
    });
  }, [activeDashboardTab, activeMemberPeerIds, currentTrack, derivedAvailabilityByTrack, roomSnapshot]);

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
    const hasPieceMetricSample = hasPieceTransferSample(activePeerDiagnostics);
    const isSourceOwner = roomSnapshot.room.playback.sourceSessionId === activeSessionUserId;
    const transportSampleAgeMs = getLatestMetricSampleAgeMs(
      activePeerDiagnostics,
      [
        "availableOutgoingBitrateKbps",
        "currentRoundTripTimeMs"
      ]
    );
    const pieceSampleAgeMs = getLatestPieceSampleAgeMs(activePeerDiagnostics);
    const normalizedPieceDownloadRateKbps =
      totalPieceDownloadRateKbps ?? (hasPieceMetricSample ? 0 : null);
    const normalizedPieceUploadRateKbps =
      totalPieceUploadRateKbps ?? (hasPieceMetricSample ? 0 : null);

    return {
      memberId: localMember.id,
      presenceState: localMember.presenceState,
      audioUnlocked,
      sourceStartState,
      lastSourceStartError,
      transportLabel: "缓存播放链路（本机）",
      transportSummary: {
        totalRateKbps: sumNullableNumbers(
          normalizedPieceDownloadRateKbps,
          normalizedPieceUploadRateKbps
        ),
        receiveRateKbps: null,
        sendRateKbps: null,
        latencyMs: averageLatencyMs,
        sampleAgeMs: transportSampleAgeMs
      },
      pieceSummary: {
        downloadRateKbps: normalizedPieceDownloadRateKbps,
        uploadRateKbps: normalizedPieceUploadRateKbps,
        sampleAgeMs: pieceSampleAgeMs
      },
      cachePlayback: systemDiagnostic?.progressivePlaybackStatus
        ? {
            activeSource: systemDiagnostic.progressivePlaybackStatus.activeSource,
            engineType: systemDiagnostic.progressivePlaybackStatus.engineType,
            aheadBufferedMs: systemDiagnostic.progressivePlaybackStatus.aheadBufferedMs,
            fallbackReason: systemDiagnostic.progressivePlaybackStatus.fallbackReason,
            fullLocalReady: systemDiagnostic.progressivePlaybackStatus.fullLocalReady ?? false,
            progressiveLocalBlockedReason:
              systemDiagnostic.progressivePlaybackStatus.progressiveLocalBlockedReason ?? null,
            localAudioPaused: systemDiagnostic.progressivePlaybackStatus.localAudioPaused ?? null,
            localAudioMuted: systemDiagnostic.progressivePlaybackStatus.localAudioMuted ?? null,
            localAudioVolume: systemDiagnostic.progressivePlaybackStatus.localAudioVolume ?? null,
            localAudioReadyState:
              systemDiagnostic.progressivePlaybackStatus.localAudioReadyState ?? null,
            localAudioCurrentSrc:
              systemDiagnostic.progressivePlaybackStatus.localAudioCurrentSrc ?? null,
            localAudioHasSrcObject:
              systemDiagnostic.progressivePlaybackStatus.localAudioHasSrcObject ?? null,
            fullLocalPlaybackMode:
              systemDiagnostic.progressivePlaybackStatus.fullLocalPlaybackMode ?? null,
            pcmEngineStatus:
              systemDiagnostic.progressivePlaybackStatus.pcmEngineStatus ?? null,
            pcmAudioContextState:
              systemDiagnostic.progressivePlaybackStatus.pcmAudioContextState ?? null,
            pcmDirectOutputConnected:
              systemDiagnostic.progressivePlaybackStatus.pcmDirectOutputConnected ?? null,
            pcmContiguousChunkCount:
              systemDiagnostic.progressivePlaybackStatus.pcmContiguousChunkCount ?? null,
            pcmBufferedAheadMs:
              systemDiagnostic.progressivePlaybackStatus.pcmBufferedAheadMs ?? null,
            pcmDecodedSegmentCount:
              systemDiagnostic.progressivePlaybackStatus.pcmDecodedSegmentCount ?? null,
            pcmScheduledSegmentCount:
              systemDiagnostic.progressivePlaybackStatus.pcmScheduledSegmentCount ?? null,
            pcmLastDecodeError:
              systemDiagnostic.progressivePlaybackStatus.pcmLastDecodeError ?? null,
            pcmLastBlockedReason:
              systemDiagnostic.progressivePlaybackStatus.pcmLastBlockedReason ?? null,
            serverClockOffsetMs:
              systemDiagnostic.progressivePlaybackStatus.serverClockOffsetMs ?? null,
            serverClockRoundTripMs:
              systemDiagnostic.progressivePlaybackStatus.serverClockRoundTripMs ?? null,
            averageDriftMs:
              systemDiagnostic.progressivePlaybackStatus.averageDriftMs ?? null,
            maxDriftMs: systemDiagnostic.progressivePlaybackStatus.maxDriftMs ?? null,
            lastPlayStartFailure:
              systemDiagnostic.progressivePlaybackStatus.lastPlayStartFailure ?? null,
            lastSourceStartError:
              systemDiagnostic.progressivePlaybackStatus.lastSourceStartError ?? null,
            pendingPlaybackIntent:
              systemDiagnostic.progressivePlaybackStatus.pendingPlaybackIntent ?? null
          }
        : null,
      playbackSampleAgeMs: systemDiagnostic
        ? Math.max(0, Date.now() - new Date(systemDiagnostic.updatedAt).getTime())
        : null,
      dataReadyCount: countPeersWithinActiveMembers(connectedPeers, activeMemberPeerIds),
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
        cachePlayback: systemDiagnostic?.progressivePlaybackStatus ?? null,
        dataReadyCount: countPeersWithinActiveMembers(connectedPeers, activeMemberPeerIds),
        pieceDownloadRateKbps: normalizedPieceDownloadRateKbps,
        pieceUploadRateKbps: normalizedPieceUploadRateKbps,
        pieceSampleAgeMs
      })
    };
  }, [
    activeMemberPeerIds,
    activeSessionUserId,
    audioUnlocked,
    connectedPeers,
    lastSourceStartError,
    mediaConnectedPeers,
    mediaConnectionState,
    peerDiagnostics,
    roomSnapshot,
    sourceStartState,
    systemDiagnostic
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

  return 3;
}

export function getActiveMemberPeerIds(members: RoomSnapshot["room"]["members"]) {
  return new Set(
    members
      .map((member) => member.peerId)
      .filter((memberPeerId): memberPeerId is string => !!memberPeerId)
  );
}

export function resolveDerivedAvailabilityByTrack(input: {
  roomSnapshot: RoomSnapshot | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  localPeerId: string;
}) {
  if (!input.roomSnapshot) {
    return input.availabilityByTrack;
  }

  return buildManualCacheSchedulerAvailabilityFromParts({
    availabilityByTrack: input.availabilityByTrack,
    manualCacheTrackIds: input.roomSnapshot.tracks.map((track) => track.id),
    roomId: input.roomSnapshot.room.id,
    members: input.roomSnapshot.room.members,
    playback: input.roomSnapshot.room.playback,
    tracks: input.roomSnapshot.tracks,
    localPeerId: input.localPeerId
  });
}

export function buildAvailabilitySummary(input: {
  tracks: RoomSnapshot["tracks"];
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
  roomId: string;
  activeMemberPeerIds: Set<string>;
  localPeerId: string;
}) {
  return input.tracks.map((track) => {
    const trackAvailability = input.availabilityByTrack[track.id] ?? {};
    const peers = filterAvailabilityAnnouncementsByCurrentRoomPeers(
      trackAvailability,
      input.roomId,
      input.activeMemberPeerIds
    );
    const local = peers.find((entry) => entry.ownerPeerId === input.localPeerId);
    const remotePeerCount = peers.filter((entry) => entry.ownerPeerId !== input.localPeerId).length;
    const manifest = resolveCurrentRoomTrackManifest(
      track,
      trackAvailability,
      input.roomId,
      input.activeMemberPeerIds
    );

    return {
      track,
      peerCount: peers.length,
      remotePeerCount,
      localChunkCount: local?.availableChunks.length ?? 0,
      totalChunks: manifest?.totalChunks ?? 0,
      sources: peers.map((entry) => `${entry.nickname} (${entry.source})`),
      cachedMemberNicknames: [
        ...new Set(
          peers
            .filter(
              (entry) =>
                entry.totalChunks > 0 &&
                entry.availableChunks.length >= entry.totalChunks
            )
            .map((entry) => entry.nickname)
        )
      ]
    };
  });
}

export function selectWorkspacePeerDiagnostics(input: {
  activeDashboardTab: "queue" | "library" | "cache" | "members";
  visiblePeerDiagnostics: PeerDiagnosticsSnapshot[];
  visiblePeerRecentEvents: PeerRecentEvent[];
}) {
  if (input.activeDashboardTab === "members") {
    return {
      peerDiagnostics: input.visiblePeerDiagnostics,
      peerRecentEvents: input.visiblePeerRecentEvents
    };
  }

  return {
    peerDiagnostics: emptyWorkspacePeerDiagnostics,
    peerRecentEvents: emptyWorkspacePeerRecentEvents
  };
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

export function resolveCurrentRoomTrackManifest(
  track: RoomSnapshot["tracks"][number] | null | undefined,
  trackAvailability: Record<string, TrackAvailabilityAnnouncement>,
  roomId: string,
  activeMemberPeerIds: Set<string>
) {
  const announcements = filterAvailabilityAnnouncementsByCurrentRoomPeers(
    trackAvailability,
    roomId,
    activeMemberPeerIds
  );

  return resolveTrackPieceManifest({
    track,
    availability: selectCanonicalTrackAvailabilityAnnouncement(announcements)
  });
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

export function getLocalPlaybackStatus(input: {
  presenceState: RoomSnapshot["room"]["members"][number]["presenceState"];
  mediaConnectionState: RoomMediaConnectionState;
  isSourceOwner: boolean;
  audioUnlocked: boolean;
  sourceStartState: LocalMemberPanelState["sourceStartState"];
  lastSourceStartError: string | null;
  mediaConnectedPeersCount: number;
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  cachePlayback: PeerDiagnosticsSnapshot["progressivePlaybackStatus"] | null;
  dataReadyCount: number;
  pieceDownloadRateKbps: number | null;
  pieceUploadRateKbps: number | null;
  pieceSampleAgeMs?: number | null;
}): LocalMemberPanelState["playbackStatus"] {
  if (input.presenceState === "offline") {
    return {
      label: "未参与缓存播放",
      detail: "当前成员已离线。",
      tone: "warning",
      badgeText: "offline"
    };
  }

  if (input.presenceState === "reconnecting") {
    return {
      label: "缓存链路重连中",
      detail: "本机正在恢复房间状态和分片数据通道。",
      tone: "warning",
      badgeText: "reconnecting"
    };
  }

  if (input.playbackStatus !== "playing") {
    return {
      label: "本地待机",
      detail: "当前房间未处于播放状态，缓存链路保持待命。",
      tone: "neutral",
      badgeText: "idle"
    };
  }

  if (!input.audioUnlocked) {
    return {
      label: "等待本机音频解锁",
      detail: "浏览器还未允许音频输出，点击播放或任意交互后继续。",
      tone: "warning",
      badgeText: "awaiting-unlock"
    };
  }

  if (
    input.cachePlayback?.activeSource ||
    input.cachePlayback?.fallbackReason ||
    input.cachePlayback?.progressiveLocalBlockedReason ||
    input.cachePlayback?.pendingPlaybackIntent ||
    input.cachePlayback?.lastPlayStartFailure
  ) {
    const view = buildDiagnosticsViewModel({
      presenceState: input.presenceState,
      playback: input.cachePlayback,
      transfer: {
        downloadRateKbps: input.pieceDownloadRateKbps,
        uploadRateKbps: input.pieceUploadRateKbps,
        sampleAgeMs: input.pieceSampleAgeMs ?? 0
      },
      dataLink: {
        openCount: input.dataReadyCount,
        connectedPeerCount: input.dataReadyCount
      }
    });
    return {
      ...view.audibility,
      badgeText: view.playbackMode
    };
  }

  const transferActive = buildDiagnosticsViewModel({
    transfer: {
      downloadRateKbps: input.pieceDownloadRateKbps,
      uploadRateKbps: input.pieceUploadRateKbps,
      sampleAgeMs: input.pieceSampleAgeMs ?? 0
    }
  }).transfer.active;
  if (transferActive) {
    return {
      label: "正在缓存播放片段",
      detail: "已开始按当前播放进度拉取分片，等待本地播放窗口满足启动条件。",
      tone: "accent",
      badgeText: "cache-fill"
    };
  }

  if (input.dataReadyCount > 0) {
    return {
      label: "等待可播缓存",
      detail: "数据通道已就绪，等待当前曲目的可请求分片或本地解码窗口。",
      tone: "accent",
      badgeText: "data-ready"
    };
  }

  return {
    label: "等待缓存链路",
    detail: "正在等待当前播放曲目的分片来源和数据通道。",
    tone: "neutral",
    badgeText: "idle"
  };
}

export function filterVisiblePeerDiagnostics(
  peerDiagnostics: PeerDiagnosticsSnapshot[],
  activeMemberPeerIds: Set<string>,
  sourcePeerId: string | null
) {
  const visiblePeerIds = new Set<string>(["system"]);
  for (const peerId of activeMemberPeerIds) {
    visiblePeerIds.add(peerId);
  }
  if (sourcePeerId) {
    visiblePeerIds.add(sourcePeerId);
  }

  return peerDiagnostics.filter((peer) => visiblePeerIds.has(peer.peerId));
}
