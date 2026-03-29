"use client";

import { useTransition } from "react";
import type { GuestSession, RoomMember, RoomSnapshot, TrackMeta } from "@music-room/shared";

type RoomStageProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: GuestSession | null;
  host: RoomMember | undefined;
  canDeleteRoom: boolean;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
};

function formatDuration(durationMs: number) {
  if (!durationMs) return "0:00";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function RoomStage({
  roomSnapshot,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  activeSession,
  host,
  canDeleteRoom,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom
}: RoomStageProps) {
  const [isPending, startTransition] = useTransition();

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
            <strong>{activeSession?.nickname ?? "—"}</strong>
            <p>房主：{host?.nickname ?? "—"}</p>
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
          <strong>{roomSnapshot.room.members.length}</strong>
        </div>
      </div>
    </>
  );
}
