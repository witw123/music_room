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
  currentSourceOwnerNickname: string | null;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
};

function getMediaStageLabel(
  mediaConnectionState: RoomMediaConnectionState,
  isSourceOwner: boolean,
  mediaConnectedPeersCount: number
) {
  if (isSourceOwner) {
    return `正在向 ${mediaConnectedPeersCount} 位成员发送音频`;
  }

  switch (mediaConnectionState) {
    case "connecting":
      return "正在连接房间音频";
    case "buffering":
      return "正在缓冲实时音频";
    case "live":
      return "已接入房间直播音频";
    case "reconnecting":
      return "正在重连房间音频";
    case "failed":
      return "实时音频连接失败";
    default:
      return "等待音源开始播放";
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
  currentSourceOwnerNickname,
  mediaConnectionState,
  mediaConnectedPeersCount,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom
}: RoomStageProps) {
  const [isPending, startTransition] = useTransition();
  const isHost = !!activeSession && activeSession.id === roomSnapshot.room.hostId;
  const isSourceOwner =
    !!activeSession && activeSession.id === roomSnapshot.room.playback.sourceSessionId;

  return (
    <>
      <section className="room-stage room-command-bar workspace-block">
        <div className="room-stage-copy room-command-copy">
          <p className="block-kicker">Now Playing</p>
          <h1>{currentTrack?.title ?? "等待播放"}</h1>
          {currentTrack ? (
            <p className="room-stage-lead">
              {currentTrack.artist} · {formatDuration(currentTrackDuration)} · 当前音源{" "}
              {currentSourceOwnerNickname ?? "未连接"}
            </p>
          ) : (
            <p className="room-stage-lead room-stage-empty-copy">
              先导入一首本地歌曲，或从队列中点击一首歌，开始这个房间的实时同听。
            </p>
          )}

          <div className="room-command-meta">
            <span className={`room-playback-badge${isPlaying ? " live" : ""}`}>
              {isPlaying ? "正在播放" : "已暂停"}
            </span>
            <span className="room-code-chip">房间码 {roomSnapshot.room.joinCode}</span>
            <span className="room-code-chip">
              {getMediaStageLabel(mediaConnectionState, isSourceOwner, mediaConnectedPeersCount)}
            </span>
            <span className="room-meta-copy">
              {currentTrack
                ? `${roomSnapshot.queue.length} 首在队列中`
                : `${roomSnapshot.tracks.length} 首曲目待命`}
            </span>
          </div>
        </div>

        <div className="room-stage-side">
          <div className="room-stage-identity">
            <span className="field-label">当前身份</span>
            <strong>{activeSession?.nickname ?? "未确认"}</strong>
            <p>
              {isHost ? "房主" : "成员"} · 房主：{host?.nickname ?? "未连接"}
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
          <span className="field-label">在线成员</span>
          <strong>{getOnlineMemberCount(roomSnapshot.room.members)}</strong>
        </div>
      </div>

      {isPending ? <div className="pending-indicator">正在处理房间操作…</div> : null}
    </>
  );
}
