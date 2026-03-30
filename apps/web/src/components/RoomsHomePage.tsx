"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSnapshot } from "@music-room/shared";
import { TopBar } from "@/components/TopBar";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { musicRoomApi } from "@/lib/music-room-api";
import { getOnlineMemberCount, toUserFacingError } from "@/lib/music-room-ui";

const sessionStorageKey = "music-room-session";
const lastRoomStorageKey = "music-room-last-room";

export function RoomsHomePage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [recentRoom, setRecentRoom] = useState<RoomSnapshot | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    nickname,
    setNickname,
    activeSession,
    setActiveSession,
    statusMessage,
    setStatusMessage,
    clearIdentity
  } = useSessionIdentity({
    sessionStorageKey,
    initialStatusMessage: "请输入昵称并确认身份。"
  });

  async function refreshAvailableRooms() {
    try {
      const rooms = await musicRoomApi.listRooms(activeSession?.id);
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }

  async function refreshRecentRoom(sessionId: string) {
    try {
      const room = await musicRoomApi.getRecentRoom(sessionId);
      setRecentRoom(room);
    } catch {
      setRecentRoom(null);
    }
  }

  async function ensureSession(actionLabel: string) {
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      setStatusMessage("请输入昵称。");
      return null;
    }

    setNickname(trimmedNickname);

    if (activeSession && activeSession.nickname === trimmedNickname) {
      return activeSession;
    }

    try {
      const session = await musicRoomApi.createGuestSession(trimmedNickname);
      setActiveSession(session);
      return session;
    } catch (error) {
      setStatusMessage(`${actionLabel}失败：${toUserFacingError(error)}`);
      return null;
    }
  }

  async function handleConfirmIdentity() {
    const session = await ensureSession("确认昵称");
    if (!session) {
      return;
    }
    setStatusMessage(`已确认身份：${session.nickname}。现在可以创建或加入房间。`);
    await Promise.all([refreshAvailableRooms(), refreshRecentRoom(session.id)]);
  }

  async function handleCreateRoom() {
    if (!activeSession) {
      setStatusMessage("请先确认昵称。");
      return;
    }

    try {
      const snapshot = await musicRoomApi.createRoom(activeSession.id, "public");
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(`/room/${snapshot.room.id}` as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleJoinRoom(code: string) {
    if (!activeSession) {
      setStatusMessage("请先确认昵称。");
      return;
    }

    if (!code.trim()) {
      setStatusMessage("请输入房间码。");
      return;
    }

    try {
      const snapshot = await musicRoomApi.joinRoomByCode(activeSession.id, code.trim());
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(`/room/${snapshot.room.id}` as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  function handleResetIdentity() {
    clearIdentity();
    setRecentRoom(null);
    setAvailableRooms([]);
    setJoinCode("");
  }

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshAvailableRooms();
    void refreshRecentRoom(activeSession.id);

    const intervalId = window.setInterval(() => {
      void refreshAvailableRooms();
    }, 5000);

    const handleFocus = () => {
      void refreshAvailableRooms();
      void refreshRecentRoom(activeSession.id);
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [activeSession?.id]);

  const visibleRooms = useMemo(
    () => availableRooms.filter((room) => room.room.id !== recentRoom?.room.id),
    [availableRooms, recentRoom?.room.id]
  );

  return (
    <main className="stage-shell">
      <TopBar activeSession={activeSession} />

      <section className="rooms-home-hero">
        <div className="rooms-home-hero__copy">
          <p className="landing-kicker">Rooms home</p>
          <h1>先确认身份，再进入一个真正能协作听歌的房间。</h1>
          <p className="rooms-home-hero__lead">
            房间主页只负责进入房间前的动作：确认昵称、创建公开房间、输入房间码加入，
            以及浏览当前在线的公开房间。
          </p>
        </div>

        <section className="rooms-home-panel">
          {!activeSession ? (
            <>
              <div className="rooms-home-panel__header">
                <p className="landing-kicker">第一步</p>
                <h2>确认昵称</h2>
                <p>{statusMessage}</p>
              </div>

              <label className="field-stack">
                <span className="field-label">昵称</span>
                <input
                  className="hero-input"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="输入你的昵称"
                />
              </label>

              <button
                className="solid-action rooms-home-panel__primary"
                disabled={!nickname.trim()}
                onClick={() => startTransition(() => void handleConfirmIdentity())}
              >
                确认昵称
              </button>
            </>
          ) : (
            <>
              <div className="rooms-home-panel__header">
                <p className="landing-kicker">第二步</p>
                <h2>创建或加入房间</h2>
                <p>{statusMessage}</p>
              </div>

              <div className="rooms-home-panel__identity">
                <span className="identity-badge">{activeSession.nickname}</span>
                <button className="ghost-action" onClick={handleResetIdentity}>
                  更换昵称
                </button>
              </div>

              <button className="solid-action rooms-home-panel__primary" onClick={handleCreateRoom}>
                创建公开房间
              </button>

              <label className="field-stack">
                <span className="field-label">房间码</span>
                <input
                  className="hero-input"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="输入房间码加入"
                />
              </label>

              <button
                className="ghost-action ghost-action-emphasis"
                disabled={!joinCode.trim()}
                onClick={() => handleJoinRoom(joinCode)}
              >
                加入已有房间
              </button>

              {recentRoom ? (
                <div className="rooms-home-panel__recent">
                  <div>
                    <span className="field-label">最近房间</span>
                    <strong>{recentRoom.room.joinCode}</strong>
                  </div>
                  <button
                    className="ghost-action"
                    onClick={() => router.push(`/room/${recentRoom.room.id}` as Route)}
                  >
                    恢复上次房间
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </section>

      <section className="rooms-home-list">
        <div className="rooms-home-list__header">
          <div>
            <p className="landing-kicker">公开房间</p>
            <h2>当前可加入的房间</h2>
          </div>
          <button className="ghost-action" onClick={() => startTransition(() => void refreshAvailableRooms())}>
            刷新列表
          </button>
        </div>

        {visibleRooms.length ? (
          <div className="rooms-home-grid">
            {visibleRooms.map((item) => {
              const host =
                item.room.members.find((member) => member.role === "host")?.nickname ?? "未知";
              return (
                <article key={item.room.id} className="rooms-home-card">
                  <div className="rooms-home-card__meta">
                    <span className="rooms-home-card__code">{item.room.joinCode}</span>
                    <span>{getOnlineMemberCount(item.room.members)} 人在线</span>
                  </div>
                  <h3>房主：{host}</h3>
                  <p>进入后即可上传歌曲、加入队列并开始房间协作。</p>
                  <button
                    className="solid-action compact"
                    disabled={!activeSession}
                    onClick={() => handleJoinRoom(item.room.joinCode)}
                  >
                    加入房间
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rooms-home-empty">
            <h3>当前没有公开房间</h3>
            <p>先创建一个公开房间，让朋友通过房间码或列表加入。</p>
          </div>
        )}

        {isPending ? <div className="pending-indicator">正在刷新房间列表…</div> : null}
      </section>
    </main>
  );
}
