"use client";

import { useState, useTransition } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";

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
  const statusTone = statusMessage.includes("失败") || statusMessage.includes("不可用") ? "negative" : "";

  return (
    <div className="room-section">
      <section className="lobby-hero">
        <div className="lobby-hero-copy">
          <p className="lobby-kicker">MUSIC ROOM</p>
          <h1>音乐房间</h1>
          <p className="lobby-lead">先确认昵称，再创建房间或通过房间码加入别人的房间。</p>
        </div>

        <div className="lobby-form-shell">
          <div className="lobby-form-intro">
            <p className="block-kicker">{activeSession ? "身份已确认" : "先确认身份"}</p>
            <h2>{activeSession ? "创建房间或加入已有房间" : "输入昵称"}</h2>
            <p className={`lobby-support-copy ${statusTone}`}>
              {statusMessage || "昵称是创建房间的前提，房间码会在建房成功后生成。"}
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
                disabled={Boolean(activeSession)}
              />
            </label>

            <div className="lobby-action-stack">
              {!activeSession ? (
                <button
                  className="solid-action lobby-primary-action"
                  disabled={!nickname.trim()}
                  onClick={() => startTransition(() => void onConfirmIdentity())}
                >
                  确认昵称
                </button>
              ) : (
                <>
                  <div className="lobby-identity-row">
                    <span className="identity-badge lobby-identity-badge">
                      {activeSession.nickname}
                    </span>
                    <button
                      className="ghost-action lobby-inline-action"
                      onClick={onLeaveRoom}
                    >
                      更换昵称
                    </button>
                  </div>

                  <button
                    className="solid-action lobby-primary-action"
                    onClick={onCreateRoom}
                  >
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
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-block lobby-room-list">
        <div className="block-heading lobby-room-list-heading">
          <div>
            <p className="block-kicker">实时房间</p>
            <h2>可加入的房间</h2>
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
                item.room.members.find((m) => m.role === "host")?.nickname ?? "—";

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
                    {item.room.members.length} 人在线
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="placeholder-copy">当前还没有公开房间，先创建一个让朋友加入。</p>
        )}
      </section>
    </div>
  );
}
