"use client";

import { useMemo } from "react";
import type { IceConfigResponse, RoomSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";

type UseRoomDerivedStateInput = {
  roomSnapshot: RoomSnapshot | null;
  peerId: string;
  activeDashboardTab: "queue" | "library" | "members";
  currentTrack: RoomSnapshot["tracks"][number] | null;
  availabilityByTrack: Record<string, Record<string, TrackAvailabilityAnnouncement>>;
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
  activeDashboardTab,
  currentTrack,
  availabilityByTrack,
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

  const canDisbandRoom =
    !!roomSnapshot &&
    canDeleteRoom &&
    (() => {
      const uploaderIds = new Set(roomSnapshot.tracks.map((track) => track.ownerSessionId));
      return !roomSnapshot.room.members.some(
        (member) => uploaderIds.has(member.id) && !member.peerId
      );
    })();

  const availabilitySummary =
    roomSnapshot?.tracks.map((track) => {
      const peers = Object.values(availabilityByTrack[track.id] ?? {});
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

    const statsByPeer = new Map<
      string,
      {
        announcedTrackIds: Set<string>;
        totalChunkCount: number;
        currentTrackChunkCount: number;
        currentTrackTotalChunks: number;
        currentTrackSources: Set<string>;
      }
    >();

    for (const trackAvailability of Object.values(availabilityByTrack)) {
      for (const announcement of Object.values(trackAvailability)) {
        const existing =
          statsByPeer.get(announcement.ownerPeerId) ??
          (() => {
            const initial = {
              announcedTrackIds: new Set<string>(),
              totalChunkCount: 0,
              currentTrackChunkCount: 0,
              currentTrackTotalChunks: 0,
              currentTrackSources: new Set<string>()
            };
            statsByPeer.set(announcement.ownerPeerId, initial);
            return initial;
          })();

        existing.announcedTrackIds.add(announcement.trackId);
        existing.totalChunkCount += announcement.availableChunks.length;

        if (currentTrack && announcement.trackId === currentTrack.id) {
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
      const stats = member.peerId ? statsByPeer.get(member.peerId) : null;

      return {
        memberId: member.id,
        announcedTrackCount: stats?.announcedTrackIds.size ?? 0,
        totalChunkCount: stats?.totalChunkCount ?? 0,
        currentTrackChunkCount: stats?.currentTrackChunkCount ?? 0,
        currentTrackTotalChunks: stats?.currentTrackTotalChunks ?? 0,
        currentTrackSources: [...(stats?.currentTrackSources ?? [])]
      };
    });
  }, [activeDashboardTab, availabilityByTrack, currentTrack, roomSnapshot]);

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
    availabilitySummary,
    currentTrackAvailability,
    memberTransferSummaries,
    statusTone,
    iceConfigStatus,
    iceConfigSource,
    isRoomTransitionPending,
    showRoomTransitionState
  };
}
