"use client";

import { useTransition } from "react";
import type {
  GuestSession,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { formatDuration, getOnlineMemberCount } from "@/lib/music-room-ui";

type RoomStageProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: GuestSession | null;
  host: RoomMember | undefined;
  canDeleteRoom: boolean;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
};

function getMediaStageLabel(
  mediaConnectionState: RoomMediaConnectionState,
  isHost: boolean,
  mediaConnectedPeersCount: number
) {
  if (isHost) {
    return `实时音频已连接 ${mediaConnectedPeersCount} 人`;
  }

  switch (mediaConnectionState) {
    case "connecting":
      return "正在连接房主音频";
    case "buffering":
      return "正在缓冲直播音频";
    case "live":
      return "已接入房主直播音频";
    case "reconnecting":
      return "正在重连房主音频";
    case "failed":
      return "直播音频连接失败";
    default:
      return "等待房主开始播放";
  }
}

export function RoomStage({
  roomSnapshot,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  activeSession,
  host,
  canDeleteRoom,
  mediaConnectionState,
  mediaConnectedPeersCount,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom
}: RoomStageProps) {
  const [isPending, startTransition] = useTransition();
  const isHost = !!activeSession && activeSession.id === roomSnapshot.room.hostId;
  const roleLabel = isHost ? "房主" : "听众";

  return (
    <>
      <section className="room-stage room-command-bar">
        <div className="room-stage-copy room-command-copy">
          <p className="block-kicker">Now Playing</p>
          <h1>{currentTrack?.title ?? "等待播放"}</h1>
          <div className="room-command-meta">
            <span className={`room-playback-badge${isPlaying ? " live" : ""}`}>
              {isPlaying ? "正在播放" : "已暂停"}
            </span>
            <span className="room-code-chip">房间码 {roomSnapshot.room.joinCode}</span>
            <span className="room-code-chip room-code-chip-secondary">
              {getMediaStageLabel(mediaConnectionState, isHost, mediaConnectedPeersCount)}
            </span>
            <span className="room-meta-copy">
              {currentTrack
                ? `${currentTrack.artist} · ${formatDuration(currentTrackDuration)}`
                : `${roomSnapshot.tracks.length} 首曲目待命`}
            </span>
          </div>
        </div>

        <div className="room-stage-side">
          <div className="room-stage-identity">
            <span className="field-label">当前身份</span>
            <strong>{activeSession?.nickname ?? "未确认"}</strong>
            <p>
              你当前是 {roleLabel} · 房主: {host?.nickname ?? "未连接"}
            </p>
          </div>

          <div className="room-stage-buttons">
            <button
              className="solid-action compact room-copy-action"
              onClick={() => startTransition(() => void onCopyJoinCode())}
            >
              复制房间码
            </button>
            <button
              className="ghost-action room-leave-action"
              onClick={() => startTransition(() => void onLeaveRoom())}
            >
              离开房间
            </button>
            {canDeleteRoom ? (
              <button
                className="queue-remove room-delete-button"
                onClick={() => startTransition(() => void onDeleteRoom())}
              >
                删除房间
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="room-stat-strip room-stat-strip-compact">
        <div className="room-stat-card">
          <span className="field-label">曲目</span>
          <strong>{roomSnapshot.tracks.length}</strong>
        </div>
        <div className="room-stat-card">
          <span className="field-label">队列</span>
          <strong>{roomSnapshot.queue.length}</strong>
        </div>
        <div className="room-stat-card">
          <span className="field-label">成员</span>
          <strong>{getOnlineMemberCount(roomSnapshot.room.members)}</strong>
        </div>
      </div>

      {isPending ? <div className="pending-indicator">正在处理房间操作…</div> : null}
    </>
  );
}
