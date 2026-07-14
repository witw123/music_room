"use client";

import { useMemo } from "react";
import type {
  AssetAvailabilityAnnouncement,
  IceConfigResponse,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomSnapshot,
  TrackAvailabilityAnnouncement,
  TrackMeta
} from "@music-room/shared";
import type { LocalMemberPanelState } from "@/components/room/MembersPanel";
import type { SegmentedPlaybackSnapshot } from "@/features/playback/use-segmented-opus-playback";
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
  availabilityByAsset: Record<string, Record<string, AssetAvailabilityAnnouncement>>;
  segmentedPlayback: SegmentedPlaybackSnapshot;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  canDeleteRoom: boolean;
  statusMessage: string;
  iceConfig: IceConfigResponse | null;
  iceConfigResolved: boolean;
  workspaceOnly: boolean;
  initialRoomId: string | null;
  activeSessionUserId?: string;
  audioUnlocked: boolean;
  suppressRoomRecovery: boolean;
  isNavigatingRoomExit: boolean;
  isRecoveringRoom: boolean;
};

export type OriginalAssetAvailabilityEntry = {
  trackId: string;
  assetId: string;
  remotePeerCount: number;
  availableUnitCount: number;
  totalUnits: number;
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
  availabilityByAsset,
  segmentedPlayback,
  peerDiagnostics,
  peerRecentEvents,
  canDeleteRoom,
  statusMessage,
  iceConfig,
  iceConfigResolved,
  workspaceOnly,
  initialRoomId,
  activeSessionUserId,
  audioUnlocked,
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
  const originalAssetAvailabilitySummary = useMemo(
    () => buildOriginalAssetAvailabilitySummary({
      tracks: roomTracks ?? [],
      availabilityByAsset,
      roomId,
      activeMemberPeerIds,
      localPeerId: peerId
    }),
    [activeMemberPeerIds, availabilityByAsset, peerId, roomId, roomTracks]
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
    return buildMemberMediaSummaries({
      roomSnapshot,
      peerDiagnostics,
      activeMemberPeerIds,
      localPeerId: peerId,
      segmentedPlayback
    });
  }, [
    activeDashboardTab,
    activeMemberPeerIds,
    peerId,
    peerDiagnostics,
    roomSnapshot,
    segmentedPlayback
  ]);

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
    const totalDataReceiveRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "transportReceiveBitrateKbps"
    );
    const totalDataSendRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "transportSendBitrateKbps"
    );
    const totalMediaReceiveRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "mediaReceiveBitrateKbps"
    );
    const totalMediaSendRateKbps = sumDiagnosticsValue(
      activePeerDiagnostics,
      "mediaSendBitrateKbps"
    );
    const isLocalMediaSource = roomSnapshot.room.playback.sourcePeerId === peerId;
    const averageLatencyMs = averageDiagnosticsValue(activePeerDiagnostics, "currentRoundTripTimeMs");
    const hasPieceMetricSample = hasPieceTransferSample(activePeerDiagnostics);
    const transportSampleAgeMs = getLatestMetricSampleAgeMs(
      activePeerDiagnostics,
      [
        "transportReceiveBitrateKbps",
        "transportSendBitrateKbps",
        "currentRoundTripTimeMs"
      ]
    );
    const pieceSampleAgeMs = getLatestPieceSampleAgeMs(activePeerDiagnostics);
    const mediaSampleAgeMs = getLatestMetricSampleAgeMs(
      activePeerDiagnostics,
      ["mediaReceiveBitrateKbps", "mediaSendBitrateKbps"]
    );
    const configuredPlaybackBitrateKbps = currentTrack?.playbackAsset?.bitrate
      ? currentTrack.playbackAsset.bitrate / 1000
      : null;
    const normalizedPieceDownloadRateKbps =
      totalPieceDownloadRateKbps ?? (hasPieceMetricSample ? 0 : null);
    const normalizedPieceUploadRateKbps =
      totalPieceUploadRateKbps ?? (hasPieceMetricSample ? 0 : null);

    return {
      memberId: localMember.id,
      presenceState: localMember.presenceState,
      audioUnlocked,
      transportLabel: "WebRTC RTP Opus（本机）",
      transportSummary: {
        totalRateKbps: sumNullableNumbers(totalDataReceiveRateKbps, totalDataSendRateKbps),
        receiveRateKbps: totalDataReceiveRateKbps,
        sendRateKbps: totalDataSendRateKbps,
        latencyMs: averageLatencyMs,
        sampleAgeMs: transportSampleAgeMs
      },
      mediaSummary: {
        receiveRateKbps: totalMediaReceiveRateKbps,
        sendRateKbps: totalMediaSendRateKbps,
        sampleAgeMs: mediaSampleAgeMs
      },
      pieceSummary: {
        downloadRateKbps: normalizedPieceDownloadRateKbps,
        uploadRateKbps: normalizedPieceUploadRateKbps,
        sampleAgeMs: pieceSampleAgeMs
      },
      segmentedPlayback,
      playbackBitrateKbps: isLocalMediaSource
        ? totalMediaSendRateKbps
        : totalMediaReceiveRateKbps,
      configuredPlaybackBitrateKbps,
      mediaSourcePeerId: roomSnapshot.room.playback.sourcePeerId,
      isMediaSource: isLocalMediaSource,
      mediaSourceMemberNickname:
        roomSnapshot.room.members.find(
          (member) => member.id === roomSnapshot.room.playback.sourceSessionId
        )?.nickname ?? null,
      dataReadyCount: countPeersWithinActiveMembers(connectedPeers, activeMemberPeerIds),
      playbackStatus: getLocalPlaybackStatus({
        presenceState: localMember.presenceState,
        playbackStatus: roomSnapshot.room.playback.status,
        segmentedPlayback
      })
    };
  }, [
    activeMemberPeerIds,
    activeSessionUserId,
    audioUnlocked,
    connectedPeers,
    currentTrack,
    peerId,
    peerDiagnostics,
    roomSnapshot,
    segmentedPlayback
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
    originalAssetAvailabilitySummary,
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

export function buildOriginalAssetAvailabilitySummary(input: {
  tracks: TrackMeta[];
  availabilityByAsset: Record<string, Record<string, AssetAvailabilityAnnouncement>>;
  roomId: string | null;
  activeMemberPeerIds: Set<string>;
  localPeerId: string;
}): OriginalAssetAvailabilityEntry[] {
  return input.tracks.flatMap((track) => {
    const asset = track.originalAsset;
    if (!asset) {
      return [];
    }
    const announcements = Object.values(input.availabilityByAsset[asset.assetId] ?? {})
      .filter((announcement) =>
        (!input.roomId || announcement.roomId === input.roomId) &&
        input.activeMemberPeerIds.has(announcement.ownerPeerId)
      );
    const remoteAnnouncements = announcements.filter(
      (announcement) => announcement.ownerPeerId !== input.localPeerId
    );
    return [{
      trackId: track.id,
      assetId: asset.assetId,
      remotePeerCount: remoteAnnouncements.filter((announcement) =>
        announcement.availableRanges.some((range) => range.end >= range.start)
      ).length,
      availableUnitCount: resolveAvailableUnitCount(remoteAnnouncements),
      totalUnits: asset.unitCount
    }];
  });
}

function resolveAvailableUnitCount(announcements: AssetAvailabilityAnnouncement[]) {
  const ranges = announcements
    .flatMap((announcement) => announcement.availableRanges)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  for (const range of ranges) {
    if (currentStart === null || currentEnd === null) {
      currentStart = range.start;
      currentEnd = range.end;
      continue;
    }
    if (range.start > currentEnd + 1) {
      total += currentEnd - currentStart + 1;
      currentStart = range.start;
      currentEnd = range.end;
      continue;
    }
    currentEnd = Math.max(currentEnd, range.end);
  }
  if (currentStart !== null && currentEnd !== null) {
    total += currentEnd - currentStart + 1;
  }
  return total;
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

export function buildMemberMediaSummaries(input: {
  roomSnapshot: RoomSnapshot;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  availabilityByAsset?: Record<string, Record<string, AssetAvailabilityAnnouncement>>;
  activeMemberPeerIds: Set<string>;
  localPeerId: string;
  segmentedPlayback: SegmentedPlaybackSnapshot;
}) {
  return input.roomSnapshot.room.members.map((member) => {
    const diagnostic = member.peerId
      ? input.peerDiagnostics.find((candidate) => candidate.peerId === member.peerId)
      : null;
    const isLocalSource = member.peerId === input.localPeerId &&
      input.roomSnapshot.room.playback.sourcePeerId === input.localPeerId;
    const mediaTrackState: "none" | "live" | "ended" | "failed" = isLocalSource
      ? input.segmentedPlayback.state === "live" ? "live" : "none"
      : diagnostic?.mediaConnectionState === "failed" || diagnostic?.transportHealth === "failed"
        ? "failed"
        : (diagnostic?.mediaReceiveBitrateKbps ?? 0) > 0 || (diagnostic?.mediaSendBitrateKbps ?? 0) > 0
          ? "live"
          : "none";
    return {
      memberId: member.id,
      mediaTrackState,
      mediaReceiveBitrateKbps: diagnostic?.mediaReceiveBitrateKbps ?? null,
      mediaSendBitrateKbps: diagnostic?.mediaSendBitrateKbps ?? null,
      mediaJitterMs: diagnostic?.jitterMs ?? null,
      mediaPacketLossRate: diagnostic?.packetLossRate ?? null
    };
  });
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
    | "transportReceiveBitrateKbps"
    | "transportSendBitrateKbps"
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
    | "mediaReceiveBitrateKbps"
    | "mediaSendBitrateKbps"
    | "transportReceiveBitrateKbps"
    | "transportSendBitrateKbps"
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
  playbackStatus: RoomSnapshot["room"]["playback"]["status"];
  segmentedPlayback: SegmentedPlaybackSnapshot;
}): LocalMemberPanelState["playbackStatus"] {
  if (input.presenceState === "offline") {
    return {
      label: "本机已离线",
      detail: "当前成员已离线。",
      tone: "warning",
      badgeText: "offline"
    };
  }

  if (input.presenceState === "reconnecting") {
    return {
      label: "媒体链路重连中",
      detail: "本机正在恢复房间状态与 RTP Opus 音频轨道。",
      tone: "warning",
      badgeText: "reconnecting"
    };
  }

  if (input.playbackStatus !== "playing") {
    return {
      label: "本地待机",
      detail: "当前房间未播放，媒体轨道保持待命。",
      tone: "neutral",
      badgeText: "Media idle"
    };
  }

  switch (input.segmentedPlayback.state) {
    case "live":
      return {
        label: "正在发声",
        detail: "本机正在发送或接收 WebRTC RTP Opus 音频。",
        tone: "success",
        badgeText: "RTP Opus"
      };
    case "buffering":
      return {
        label: input.segmentedPlayback.lastError ? "正在自动恢复" : "等待媒体轨道",
        detail:
          input.segmentedPlayback.lastError ??
          "正在等待当前播放源建立或恢复 RTP Opus 音频轨道。",
        tone: input.segmentedPlayback.lastError ? "warning" : "accent",
        badgeText: "Media buffering"
      };
    case "awaiting-unlock":
      return {
        label: "等待本机音频解锁",
        detail: "AudioContext 当前未运行，点击播放或在房间内交互即可恢复。",
        tone: "warning",
        badgeText: "Audio unlock"
      };
    case "unavailable":
      return {
        label: "媒体源不可用",
        detail: "当前播放源没有可用的 WebRTC 音频轨道。",
        tone: "danger",
        badgeText: "Media failed"
      };
    case "paused":
      return {
        label: "本地已暂停",
        detail: "房间播放已暂停，已停止媒体音频输出。",
        tone: "neutral",
        badgeText: "Media paused"
      };
    case "ended":
      return {
        label: "当前曲目已结束",
        detail: "本机已完成当前媒体轨道。",
        tone: "neutral",
        badgeText: "Media ended"
      };
    default:
      return {
        label: "准备媒体播放",
        detail: "正在等待当前播放源与房间时间线。",
        tone: "neutral",
        badgeText: "Media idle"
      };
  }
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
