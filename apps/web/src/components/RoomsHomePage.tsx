"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSnapshot } from "@music-room/shared";
import { TopBar } from "@/components/TopBar";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { musicRoomApi } from "@/lib/music-room-api";
import { getOnlineMemberCount, toUserFacingError } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

const lastRoomStorageKey = "music-room-last-room";

export function RoomsHomePage() {
  const router = useRouter();
  const clientPlatform = getClientPlatformFromBrowser();
  const workspaceEntryHref = buildAppEntryHref(clientPlatform);
  const buildRoomHref = (roomId: string) =>
    clientPlatform ? `/room/${roomId}?client=${clientPlatform}` : `/room/${roomId}`;
  const authEntryHref = buildWorkspaceAuthHref({
    clientPlatform,
    redirectTo: workspaceEntryHref
  });
  const [joinCode, setJoinCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [recentRoom, setRecentRoom] = useState<RoomSnapshot | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    activeSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    clearIdentity,
    refreshSession
  } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!activeSession) {
      router.replace(authEntryHref as Route);
    }
  }, [activeSession, hydrated, router, authEntryHref]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshSession();
    void refreshAvailableRooms();
    void refreshRecentRoom();
  }, [activeSession?.id, refreshSession]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const refresh = () => {
      void refreshAvailableRooms();
      void refreshRecentRoom();
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeSession?.id]);

  async function refreshAvailableRooms() {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }

  async function refreshRecentRoom() {
    try {
      const room = await musicRoomApi.getRecentRoom();
      setRecentRoom(room);
    } catch {
      setRecentRoom(null);
    }
  }

  async function handleCreateRoom(visibility: "public" | "private" = "public") {
    try {
      const snapshot = await musicRoomApi.createRoom(visibility);
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(buildRoomHref(snapshot.room.id) as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleJoinRoom(code: string) {
    if (!code.trim()) {
      setStatusMessage("请输入房间码。");
      return;
    }

    try {
      const snapshot = await musicRoomApi.joinRoomByCode(code.trim());
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(buildRoomHref(snapshot.room.id) as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleReturnToRecentRoom() {
    if (!recentRoom) {
      return;
    }

    try {
      const recovered = await musicRoomApi.recoverRoom(recentRoom.room.id);
      if (recovered) {
        window.localStorage.setItem(lastRoomStorageKey, recovered.room.id);
        router.push(buildRoomHref(recovered.room.id) as Route);
        return;
      }

      const joined = await musicRoomApi.joinRoomByCode(recentRoom.room.joinCode);
      window.localStorage.setItem(lastRoomStorageKey, joined.room.id);
      router.push(buildRoomHref(joined.room.id) as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  async function handleLogout() {
    try {
      await musicRoomApi.logout();
    } catch {
      // Ignore logout network errors and always clear local state.
    }

    clearIdentity();
    router.replace(authEntryHref as Route);
  }

  const visibleRooms = useMemo(
    () => availableRooms.filter((room) => room.room.id !== recentRoom?.room.id),
    [availableRooms, recentRoom?.room.id]
  );

  if (!hydrated || !activeSession) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-background pb-24 text-foreground">
      <TopBar activeSession={activeSession} onLogout={handleLogout} />

      <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-10 sm:px-6 md:py-14 lg:flex-row lg:gap-16 lg:px-8">
        <div className="z-10 flex flex-1 flex-col items-start justify-center">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.28em] text-accent">Music Room</p>
          <h1 className="mb-4 text-3xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-4xl md:text-5xl lg:text-6xl">
            欢迎回来，
            <br />
            <span className="bg-gradient-to-r from-accent to-fuchsia-400 bg-clip-text text-transparent">
              {activeSession.nickname}
            </span>
          </h1>
          <p className="mb-8 max-w-xl text-sm leading-relaxed text-foreground-muted sm:text-base md:text-lg">
            这里是你的房间列表。创建新房间、输入房间码快速加入，或直接回到最近的协作现场。
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button size="lg" className="w-full sm:w-auto" onClick={() => handleCreateRoom("public")} type="button">
              创建公开房间
            </Button>
            <Button variant="outline" size="lg" className="w-full sm:w-auto bg-surface hover:bg-surface-hover border-surface-border" onClick={() => handleCreateRoom("private")} type="button">
              创建私密房间
            </Button>
          </div>
        </div>

        <div className="z-10 w-full shrink-0 lg:w-[420px] xl:w-[460px]">
          <div className="glass-panel relative flex flex-col gap-5 overflow-hidden rounded-[28px] p-5 shadow-2xl sm:p-7">
            <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full bg-accent/20 blur-[90px]" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-foreground-muted">
                  Join with code
                </p>
                <h2 className="text-xl font-bold text-foreground sm:text-2xl">输入房间码加入</h2>
              </div>
              <span className="inline-flex max-w-full rounded-full border border-surface-border bg-surface px-3 py-1 text-xs font-medium text-foreground-muted">
                {activeSession.username}
              </span>
            </div>

            <div className="mt-1 flex flex-col gap-3">
              <input
                className="w-full rounded-2xl border border-surface-border bg-black/40 px-4 py-3 text-base font-mono uppercase text-foreground placeholder:font-sans placeholder:normal-case placeholder:text-foreground-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="输入 6 位房间码"
              />
              <Button
                size="lg"
                variant="outline"
                className="w-full bg-white/5 hover:bg-white/10"
                disabled={!joinCode.trim()}
                onClick={() => startTransition(() => void handleJoinRoom(joinCode))}
                type="button"
              >
                直接进入房间
              </Button>

              {statusMessage ? (
                <p className="animate-fade-in text-center text-sm text-red-400">{statusMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 pb-8 sm:px-6 lg:flex-row lg:gap-10 lg:px-8">
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[320px]">
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-foreground-muted">
              Recent room
            </p>
            <h2 className="text-xl font-bold text-foreground">最近一次协作</h2>
          </div>

          <div className="glass-panel flex h-full min-h-[220px] flex-col justify-between rounded-[28px] p-5 sm:p-6">
            {recentRoom ? (
              <div className="flex h-full flex-col gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-surface-border bg-gradient-to-br from-surface to-surface-hover text-accent shadow-inner">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-lg font-bold text-foreground">
                      {recentRoom.room.joinCode}
                    </span>
                    <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                      {getOnlineMemberCount(recentRoom.room.members)} 在线
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground-muted">
                    如果你刚离开不久，可以直接返回这个房间继续听歌、改队列和协作控制。
                  </p>
                </div>
                <div className="mt-auto pt-2">
                  <Button
                    variant="glass"
                    className="w-full border-accent/20 hover:border-accent hover:bg-accent/10"
                    onClick={() => startTransition(() => void handleReturnToRecentRoom())}
                    type="button"
                  >
                    回到最近房间
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface text-foreground-muted opacity-60">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <p className="text-sm text-foreground-muted opacity-80">
                  还没有历史房间记录。创建一个房间后，这里会成为你的快速返回列表。
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.24em] text-foreground-muted">
                Available rooms
              </p>
              <h2 className="flex items-center gap-3 text-xl font-bold text-foreground">
                正在开放的房间
                {isPending ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                ) : null}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => void refreshAvailableRooms())}
              type="button"
            >
              刷新
            </Button>
          </div>

          <div className="glass-panel min-h-[300px] rounded-[28px] p-4 sm:p-6">
            {visibleRooms.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleRooms.map((item) => {
                  const host =
                    item.room.members.find((member) => member.role === "host")?.nickname ?? "未知";

                  return (
                    <article
                      key={item.room.id}
                      className="group flex flex-col gap-4 rounded-3xl border border-surface-border bg-surface p-5 shadow-md transition-all duration-300 hover:-translate-y-1 hover:bg-surface-hover"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 font-mono font-bold text-accent">
                          {item.room.joinCode}
                        </span>
                        <span className="rounded-full border border-surface-border bg-background/50 px-2 py-1 text-xs font-medium text-foreground-muted">
                          {getOnlineMemberCount(item.room.members)} 人在线
                        </span>
                      </div>
                      <div className="mt-1">
                        <h3 className="truncate font-semibold text-foreground">{host} 的房间</h3>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground-muted">
                          进入后即可参与当前播放、共享队列和成员协作，所有动作都在同一处完成。
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        className="mt-auto w-full border border-surface-border bg-white/5 transition-all group-hover:border-accent group-hover:bg-accent group-hover:text-white"
                        onClick={() => handleJoinRoom(item.room.joinCode)}
                        type="button"
                      >
                        加入此房间
                      </Button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-14 text-center opacity-85">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-surface-border bg-surface text-foreground-muted">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </div>
                <h3 className="mb-2 font-semibold text-foreground">当前没有公开房间</h3>
                <p className="max-w-sm text-sm text-foreground-muted">
                  你可以先创建一个公开房间等待其他人加入，或者稍后回来刷新列表。
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
