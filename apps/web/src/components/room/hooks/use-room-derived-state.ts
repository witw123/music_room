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
import {
  resolveTrackPieceManifest,
  selectCanonicalTrackAvailabilityAnnouncement
} from "@/features/p2p";
import { buildManualCacheSchedulerAvailabilityFromParts } from "@/features/room/hooks/use-manual-cache-downloader";

type UseRoomDerivedStateInput = {
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
            contiguousBufferedMs: systemDiagnostic.progressivePlaybackStatus.contiguousBufferedMs,
            aheadBufferedMs: systemDiagnostic.progressivePlaybackStatus.aheadBufferedMs,
            schedulerPolicy: systemDiagnostic.progressivePlaybackStatus.schedulerPolicy,
            startupReady: systemDiagnostic.progressivePlaybackStatus.startupReady,
            fallbackReason: systemDiagnostic.progressivePlaybackStatus.fallbackReason,
            estimatedFillTimeMs: systemDiagnostic.progressivePlaybackStatus.estimatedFillTimeMs ?? null,
            bufferSafetyMarginMs: systemDiagnostic.progressivePlaybackStatus.bufferSafetyMarginMs ?? null,
            fullLocalReady: systemDiagnostic.progressivePlaybackStatus.fullLocalReady ?? false,
            progressiveLocalEligible:
              systemDiagnostic.progressivePlaybackStatus.progressiveLocalEligible ?? false,
            progressiveLocalBlockedReason:
              systemDiagnostic.progressivePlaybackStatus.progressiveLocalBlockedReason ?? null,
            waitingEventsLast30s:
              systemDiagnostic.progressivePlaybackStatus.waitingEventsLast30s ?? null,
            stalledEventsLast30s:
              systemDiagnostic.progressivePlaybackStatus.stalledEventsLast30s ?? null,
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
            pcmDecodedSegmentCount:
              systemDiagnostic.progressivePlaybackStatus.pcmDecodedSegmentCount ?? null,
            pcmScheduledSegmentCount:
              systemDiagnostic.progressivePlaybackStatus.pcmScheduledSegmentCount ?? null,
            pcmLastDecodeError:
              systemDiagnostic.progressivePlaybackStatus.pcmLastDecodeError ?? null,
            pcmLastBlockedReason:
              systemDiagnostic.progressivePlaybackStatus.pcmLastBlockedReason ?? null,
            lastPlayStartFailure:
              systemDiagnostic.progressivePlaybackStatus.lastPlayStartFailure ?? null,
            pendingPlaybackIntent:
              systemDiagnostic.progressivePlaybackStatus.pendingPlaybackIntent ?? null
          }
        : null,
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
        pieceUploadRateKbps: normalizedPieceUploadRateKbps
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
    const manifest = resolveCurrentRoomTrackManifest(
      track,
      trackAvailability,
      input.roomId,
      input.activeMemberPeerIds
    );

    return {
      track,
      peerCount: peers.length,
      localChunkCount: local?.availableChunks.length ?? 0,
      totalChunks: manifest?.totalChunks ?? 0,
      sources: peers.map((entry) => `${entry.nickname} (${entry.source})`)
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

function formatDurationMs(value: number | null | undefined) {
  if (value === null || typeof value === "undefined") {
    return "未知";
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
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

function getLocalAudioPlaybackIssue(
  cachePlayback: PeerDiagnosticsSnapshot["progressivePlaybackStatus"]
) {
  if (!cachePlayback) {
    return null;
  }

  const readyState = cachePlayback.localAudioReadyState ?? 0;
  const hasPlayableOutput = cachePlayback.localAudioHasSrcObject || readyState >= 2;
  const nativeBlobFullLocalReady =
    cachePlayback.activeSource === "full-local" &&
    cachePlayback.fullLocalPlaybackMode === "native-blob" &&
    !!cachePlayback.localAudioCurrentSrc &&
    hasPlayableOutput;
  const playingFullLocalReady =
    cachePlayback.activeSource === "full-local" &&
    cachePlayback.fullLocalReady === true &&
    cachePlayback.localAudioPaused === false;

  const pcmHasScheduledOutput =
    cachePlayback.engineType === "pcm" &&
    cachePlayback.pcmAudioContextState === "running" &&
    (cachePlayback.pcmDecodedSegmentCount ?? 0) > 0 &&
    (cachePlayback.pcmScheduledSegmentCount ?? 0) > 0 &&
    !(
      cachePlayback.pcmLastBlockedReason &&
      !(
        cachePlayback.pcmLastBlockedReason === "engine-failed" &&
        (cachePlayback.pcmDecodedSegmentCount ?? 0) > 0
      )
    );
  const pcmElementOutputAudible =
    cachePlayback.localAudioHasSrcObject === true &&
    cachePlayback.localAudioPaused === false &&
    cachePlayback.localAudioMuted !== true &&
    cachePlayback.localAudioVolume !== 0;
  const pcmOutputAudible =
    pcmHasScheduledOutput &&
    (cachePlayback.pcmDirectOutputConnected !== false || pcmElementOutputAudible);
  if (pcmOutputAudible) {
    return null;
  }

  if (cachePlayback.lastPlayStartFailure) {
    return `本地音频启动失败: ${cachePlayback.lastPlayStartFailure}。`;
  }

  if (cachePlayback.pendingPlaybackIntent) {
    return `等待浏览器允许音频输出: ${cachePlayback.pendingPlaybackIntent}。`;
  }

  if (cachePlayback.localAudioMuted) {
    return "本地音频元素处于静音状态。";
  }

  if (cachePlayback.localAudioVolume === 0) {
    return "本地音频音量为 0。";
  }

  if (nativeBlobFullLocalReady || playingFullLocalReady) {
    return null;
  }

  if (cachePlayback.localAudioPaused === true) {
    return "缓存窗口已准备好，但本地音频元素仍处于暂停状态。";
  }

  if (cachePlayback.localAudioPaused === false && !hasPlayableOutput) {
    return `本地音频元素未拿到可播放数据，readyState=${readyState}。`;
  }

  if (cachePlayback.localAudioPaused !== false) {
    return "尚未确认本地音频元素已经开始播放。";
  }

  const shouldInspectPcmOutput =
    cachePlayback.engineType === "pcm" &&
    (cachePlayback.activeSource !== "full-local" ||
      cachePlayback.fullLocalPlaybackMode === "pcm-engine" ||
      cachePlayback.localAudioHasSrcObject === true);
  if (shouldInspectPcmOutput) {
    if (cachePlayback.pcmAudioContextState && cachePlayback.pcmAudioContextState !== "running") {
      return `PCM 音频上下文未运行: ${cachePlayback.pcmAudioContextState}。`;
    }

    if (
      cachePlayback.pcmLastBlockedReason &&
      !(cachePlayback.pcmLastBlockedReason === "engine-failed" && (cachePlayback.pcmDecodedSegmentCount ?? 0) > 0)
    ) {
      return `PCM 播放未就绪: ${cachePlayback.pcmLastBlockedReason}。`;
    }

    if (
      cachePlayback.pcmDirectOutputConnected === false &&
      cachePlayback.localAudioHasSrcObject !== true
    ) {
      return "PCM 引擎尚未连接到本机音频输出。";
    }

    if ((cachePlayback.pcmDecodedSegmentCount ?? 0) <= 0) {
      return "PCM 引擎尚未解码出可播放音频帧。";
    }

    if ((cachePlayback.pcmScheduledSegmentCount ?? 0) <= 0) {
      return "PCM 引擎尚未调度音频帧到输出。";
    }
  }

  return null;
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

  if (input.cachePlayback?.activeSource === "lossless-local") {
    const localAudioIssue = getLocalAudioPlaybackIssue(input.cachePlayback);
    if (localAudioIssue) {
      return {
        label: "无损缓存待发声",
        detail: localAudioIssue,
        tone: "accent",
        badgeText: "lossless-wait"
      };
    }

    return {
      label: "无损滑动窗口播放",
      detail: "当前使用本地缓存分片解码发声，并持续追随房间播放时钟。",
      tone: "success",
      badgeText: "lossless-local"
    };
  }

  if (input.cachePlayback?.activeSource === "full-local") {
    const localAudioIssue = getLocalAudioPlaybackIssue(input.cachePlayback);
    if (localAudioIssue) {
      return {
        label: "完整缓存待发声",
        detail: localAudioIssue,
        tone: "accent",
        badgeText: "audio-wait"
      };
    }

    return {
      label: "完整缓存播放",
      detail: "当前使用完整本地缓存播放，网络只负责同步控制和分片回传。",
      tone: "success",
      badgeText: "full-local"
    };
  }

  if (input.cachePlayback?.activeSource === "progressive-local") {
    if (input.cachePlayback.startupReady) {
      const localAudioIssue = getLocalAudioPlaybackIssue(input.cachePlayback);
      if (localAudioIssue) {
        return {
          label: "缓存已就绪但未发声",
          detail: localAudioIssue,
          tone: "accent",
          badgeText: "audio-wait"
        };
      }

      return {
        label: "边下边播",
        detail: `当前本地缓存窗口已可播，ahead ${formatDurationMs(input.cachePlayback.aheadBufferedMs)}。`,
        tone: "success",
        badgeText: "progressive"
      };
    }

    return {
      label: "缓存启动中",
      detail:
        input.cachePlayback.fallbackReason ??
        input.cachePlayback.progressiveLocalBlockedReason ??
        "正在缓存当前播放位置所需分片。",
      tone: "accent",
      badgeText: "buffering"
    };
  }

  if ((input.pieceDownloadRateKbps ?? 0) > 0 || (input.pieceUploadRateKbps ?? 0) > 0) {
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

  if (input.mediaConnectionState === "failed") {
      return {
      label: "数据链路不可用",
      detail: "当前缓存播放所需的数据链路尚未恢复。",
      tone: "warning",
      badgeText: "failed"
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
