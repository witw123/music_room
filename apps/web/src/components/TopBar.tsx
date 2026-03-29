"use client";

import type { GuestSession, RoomSnapshot } from "@music-room/shared";

type TopBarProps = {
  activeSession: GuestSession | null;
  roomSnapshot: RoomSnapshot | null;
  connectedPeersCount: number;
  mediaConnectedPeersCount: number;
};

export function TopBar({
  activeSession,
  roomSnapshot,
  connectedPeersCount,
  mediaConnectedPeersCount
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <span className="top-bar-appname">音乐房间</span>
        {roomSnapshot ? (
          <span className="top-bar-room-info">
            <span className={`signal-dot${roomSnapshot ? " live" : ""}`} />
            房间码 <strong>{roomSnapshot.room.joinCode}</strong>
            <span className="top-bar-sep">·</span>
            {roomSnapshot.room.members.length} 人在线
            <span className="top-bar-sep">·</span>
            直播音频 {mediaConnectedPeersCount} 已连接
            <span className="top-bar-sep">·</span>
            缓存 Mesh {connectedPeersCount}
          </span>
        ) : (
          <span className="top-bar-mode">本地曲库实时同播</span>
        )}
      </div>
      <div className="top-bar-intro">
        {roomSnapshot
          ? "房间、曲库、队列和歌单已经合到同一工作台"
          : "输入昵称后即可开房或通过房间码加入"}
      </div>
      <div className="top-bar-right">
        {activeSession?.nickname ? <span className="identity-badge">{activeSession.nickname}</span> : null}
      </div>
    </header>
  );
}
