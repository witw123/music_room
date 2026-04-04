"use client";

import { useMemo } from "react";
import type {
  IceConfigResponse,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";

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
  suppressRoomRecovery,
  isNavigatingRoomExit,
  isRecoveringRoom
}: UseRoomDerivedStateInput) {
  const host = roomSnapshot?.room.members.find((member) => member.role === "host");
  const activeMemberPeerIds = useMemo(
    () => getActiveMemberPeerIds(roomSnapshot?.room.members ?? []),
    [roomSnapshot?.room.members]
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
        totalChunks: local?.totalChunks ?? peers[0]?.totalChunks ?? 0,
        sources: peers.map((entry) => `${entry.nickname} (${entry.source})`)
      };
    }) ?? [];

  const currentTrackAvailability = currentTrack
    ? availabilitySummary.find((entry) => entry.track.id === currentTrack.id) ?? null
    : null;

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

      return {
        memberId: member.id,
        announcedTrackCount: stats?.announcedTrackIds.size ?? 0,
        totalChunkCount: stats?.totalChunkCount ?? 0,
        currentTrackChunkCount: stats?.currentTrackChunkCount ?? 0,
        currentTrackTotalChunks: stats?.currentTrackTotalChunks ?? 0,
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
