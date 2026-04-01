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

    return roomSnapshot.room.members.map((member) => {
      const announcements = member.peerId
        ? Object.values(availabilityByTrack).flatMap((trackAvailability) =>
            Object.values(trackAvailability).filter(
              (announcement) => announcement.ownerPeerId === member.peerId
            )
          )
        : [];
      const currentTrackAnnouncements = currentTrack
        ? announcements.filter((announcement) => announcement.trackId === currentTrack.id)
        : [];

      return {
        memberId: member.id,
        announcedTrackCount: new Set(announcements.map((announcement) => announcement.trackId)).size,
        totalChunkCount: announcements.reduce(
          (total, announcement) => total + announcement.availableChunks.length,
          0
        ),
        currentTrackChunkCount: currentTrackAnnouncements.reduce(
          (total, announcement) => total + announcement.availableChunks.length,
          0
        ),
        currentTrackTotalChunks: currentTrackAnnouncements[0]?.totalChunks ?? 0,
        currentTrackSources: [
          ...new Set(currentTrackAnnouncements.map((announcement) => announcement.source))
        ]
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
