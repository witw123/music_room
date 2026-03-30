"use client";

import { useState, useTransition } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import { getOnlineMemberCount } from "@/lib/music-room-ui";

type LobbyViewProps = {
  nickname: string;
  setNickname: (n: string) => void;
  activeSession: GuestSession | null;
  visibleRooms: RoomSnapshot[];
  statusMessage: string;
  onConfirmIdentity: () => Promise<void>;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom?: () => void;
  onRefreshRooms: () => Promise<void>;
};

export function LobbyView({
  nickname,
  setNickname,
  activeSession,
  visibleRooms,
  statusMessage,
  onConfirmIdentity,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onRefreshRooms
}: LobbyViewProps) {
  const [joinCode, setJoinCode] = useState("");
  const [isPending, startTransition] = useTransition();
  const statusTone =
    statusMessage.includes("失败") || statusMessage.includes("不可用") ? "negative" : "";

  return (
    <div className="room-section">
      <section className="lobby-hero">
        <div className="lobby-hero-copy">
          <p className="lobby-kicker">Music Room</p>
          <h1>音乐房间</h1>
          <p className="lobby-lead">
            本地曲库，实时同播。先确认昵称，再创建房间或通过房间码加入。
          </p>
        </div>

        {!activeSession ? (
          <section className="lobby-form-shell">
            <div className="lobby-form-intro">
              <p className="block-kicker">第一步</p>
              <h2>确认昵称</h2>
              <p className={`lobby-support-copy ${statusTone}`}>
                {statusMessage || "昵称是创建或加入房间的前提。"}
              </p>
            </div>

            <div className="lobby-form-stack">
              <label className="field-stack compact-field">
                <span className="field-label">昵称</span>
                <input
                  className="hero-input subtle"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="输入你的昵称"
                />
              </label>

              <button
                className="solid-action lobby-primary-action"
                disabled={!nickname.trim()}
                onClick={() => startTransition(() => void onConfirmIdentity())}
              >
                确认昵称
              </button>
            </div>
          </section>
        ) : (
          <section className="lobby-form-shell">
            <div className="lobby-form-intro">
              <p className="block-kicker">第二步</p>
              <h2>创建房间或加入房间</h2>
              <p className={`lobby-support-copy ${statusTone}`}>
                {statusMessage || "现在可以创建新房间，或通过房间码加入已有房间。"}
              </p>
            </div>

            <div className="lobby-form-stack">
              <div className="lobby-identity-row">
                <span className="identity-badge lobby-identity-badge">{activeSession.nickname}</span>
                <button className="ghost-action lobby-inline-action" onClick={onLeaveRoom}>
                  更换昵称
                </button>
              </div>

              <button className="solid-action lobby-primary-action" onClick={onCreateRoom}>
                创建房间
              </button>

              <label className="field-stack compact-field">
                <span className="field-label">房间码</span>
                <input
                  className="hero-input subtle"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="输入房间码后加入"
                />
              </label>

              <button
                className="ghost-action ghost-action-emphasis lobby-secondary-action"
                disabled={!joinCode.trim()}
                onClick={() => onJoinRoom(joinCode)}
              >
                加入已有房间
              </button>
            </div>
          </section>
        )}
      </section>

      <section className="workspace-block lobby-room-list">
        <div className="block-heading lobby-room-list-heading">
          <div>
            <p className="block-kicker">公开房间</p>
            <h2>正在开放的房间</h2>
          </div>
          <button
            className="ghost-action lobby-refresh"
            onClick={() => startTransition(() => void onRefreshRooms())}
          >
            刷新
          </button>
        </div>

        {visibleRooms.length ? (
          <div className="room-list">
            {visibleRooms.map((item) => {
              const roomHost =
                item.room.members.find((member) => member.role === "host")?.nickname ?? "未知";

              return (
                <button
                  key={item.room.id}
                  type="button"
                  className="room-card room-card-button"
                  onClick={() => onJoinRoom(item.room.joinCode)}
                >
                  <div className="room-card-info">
                    <div className="room-card-code-row">
                      <span className="room-card-code">{item.room.joinCode}</span>
                    </div>
                    <span className="room-card-host">房主：{roomHost}</span>
                  </div>
                  <span className="room-card-members">
                    {getOnlineMemberCount(item.room.members)} 人在线
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="placeholder-copy">当前还没有公开房间，先创建一个让朋友加入。</p>
        )}

        {isPending ? <div className="pending-indicator">正在刷新房间列表…</div> : null}
      </section>
    </div>
  );
}
