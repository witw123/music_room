"use client";

import type { RoomMember } from "@music-room/shared";

export function formatDuration(durationMs: number) {
  if (!durationMs) {
    return "0:00";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function normalizePlaylistTitle(input: string, fallback = "Tonight Selects") {
  const trimmed = input.trim();
  return trimmed || fallback;
}

export function removeTracksFromUploads<T>(
  uploads: Record<string, T>,
  removedTrackIds: string[]
) {
  if (removedTrackIds.length === 0) {
    return uploads;
  }

  const next = { ...uploads };
  for (const trackId of removedTrackIds) {
    delete next[trackId];
  }
  return next;
}

export function getOnlineMembers(members: RoomMember[]) {
  return members.filter((member) => !!member.peerId);
}

export function getOnlineMemberCount(members: RoomMember[]) {
  return getOnlineMembers(members).length;
}

export function toUserFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : "请求失败。";

  if (message.includes("Only the host can control playback")) {
    return "只有房主可以控制当前房间的播放。";
  }

  if (message.includes("Only the host or the requester can remove this queue item")) {
    return "只有房主或点歌者可以移除这首歌。";
  }

  if (message.includes("Only room members can perform this action")) {
    return "加入房间后才能执行这个操作。";
  }

  if (message.includes("Room not found")) {
    return "房间不存在或已经被删除。";
  }

  if (message.includes("No tracks from this playlist are available")) {
    return "这个歌单和当前房间曲库不匹配。";
  }

  if (message.includes("Nickname is required")) {
    return "请输入昵称后再继续。";
  }

  if (message.includes("Nickname already exists in this room")) {
    return "这个昵称已经在房间里被使用了，请换一个再加入。";
  }

  if (message.includes("Only the host can delete this room")) {
    return "只有房主可以删除房间。";
  }

  if (message.includes("Queue reorder payload does not match")) {
    return "队列顺序已经变化，请刷新后再试一次。";
  }

  if (message.includes("Queue item not found")) {
    return "这首歌已经不在当前播放队列里了。";
  }

  return message;
}
