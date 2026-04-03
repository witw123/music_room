"use client";

import type { PlaybackSnapshot, RoomMember } from "@music-room/shared";

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

export function getPlaybackConsistencyVersion(playback: PlaybackSnapshot | null | undefined) {
  return playback?.queueVersion ?? 0;
}

export function isSamePlaybackSnapshot(
  current: PlaybackSnapshot | null | undefined,
  incoming: PlaybackSnapshot | null | undefined
) {
  if (current === incoming) {
    return true;
  }

  if (!current || !incoming) {
    return false;
  }

  return (
    current.status === incoming.status &&
    current.currentTrackId === incoming.currentTrackId &&
    current.currentQueueItemId === incoming.currentQueueItemId &&
    current.sourceSessionId === incoming.sourceSessionId &&
    current.sourcePeerId === incoming.sourcePeerId &&
    current.sourceTrackId === incoming.sourceTrackId &&
    current.positionMs === incoming.positionMs &&
    current.startedAt === incoming.startedAt &&
    current.queueVersion === incoming.queueVersion &&
    current.mediaEpoch === incoming.mediaEpoch
  );
}

export function shouldAcceptPlaybackSnapshot(
  current: PlaybackSnapshot | null | undefined,
  incoming: PlaybackSnapshot | null | undefined
) {
  return getPlaybackConsistencyVersion(incoming) >= getPlaybackConsistencyVersion(current);
}

export function shouldReplacePlaybackSnapshot(
  current: PlaybackSnapshot | null | undefined,
  incoming: PlaybackSnapshot | null | undefined
) {
  return shouldAcceptPlaybackSnapshot(current, incoming) && !isSamePlaybackSnapshot(current, incoming);
}

export function toUserFacingError(error: unknown) {
  const message = error instanceof Error ? error.message : "请求失败。";

  if (message.includes("Only the host can control playback")) {
    return "只有房主可以控制当前房间的播放。";
  }

  if (message.includes("Only the host or the requester can remove this queue item")) {
    return "只有房主或点歌人可以移除这首歌。";
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

  if (message.includes("Only the host can delete this room")) {
    return "只有房主可以删除房间。";
  }

  if (message.includes("All track uploaders must be online before deleting the room")) {
    return "只有所有已上传歌曲的成员都在线时才能解散房间。";
  }

  if (message.includes("Queue reorder payload does not match")) {
    return "队列顺序已经变化，请刷新后再试一次。";
  }

  if (message.includes("Queue item not found")) {
    return "这首歌已经不在当前播放队列里了。";
  }

  if (message.includes("Track owner is not online")) {
    return "这首歌的上传者当前不在线，暂时无法播放。";
  }

  if (message.includes("Only the original uploader can delete this track")) {
    return "只有歌曲上传者本人可以删除这首歌。";
  }

  if (message.includes("Playback state version conflict")) {
    return "房间播放状态刚刚被别人改动，请稍后再试。";
  }

  if (message.includes("Realtime sync unavailable")) {
    return "实时同步暂不可用，请稍后再试。";
  }

  if (message.includes("Playback control rate limit exceeded")) {
    return "操作过于频繁，请稍后再试。";
  }

  if (message.includes("Invalid username or password")) {
    return "用户名或密码错误。";
  }

  if (message.includes("Username already exists")) {
    return "这个用户名已被使用。";
  }

  if (message.includes("Nickname already exists in this room")) {
    return "这个昵称已经在房间里被使用了，请换一个再加入。";
  }

  if (message.includes("Account storage is temporarily unavailable")) {
    return "账号存储当前不可用。请检查数据库与迁移状态后重试。";
  }

  if (message.includes("Unauthorized")) {
    return "当前登录状态已失效，请重新登录。";
  }

  return message;
}
