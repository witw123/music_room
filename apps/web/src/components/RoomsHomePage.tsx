"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSummary } from "@music-room/shared";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildAppEntryHref, buildWorkspaceAuthHref } from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { musicRoomApi } from "@/lib/music-room-api";
import { toUserFacingError } from "@/lib/music-room-ui";
import { storeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";
import { Button } from "@/components/ui/button";
import { useClientUpdateControls } from "@/components/ClientUpdateManager";

const lastRoomStorageKey = "music-room-last-room";

export function RoomsHomePage() {
  const router = useRouter();
  const clientPlatform = getClientPlatformFromBrowser();
  const updateControls = useClientUpdateControls();
  const workspaceEntryHref = buildAppEntryHref(clientPlatform);
  const buildRoomHref = (roomId: string) =>
    clientPlatform ? `/room/${roomId}?client=${clientPlatform}` : `/room/${roomId}`;
  const authEntryHref = buildWorkspaceAuthHref({
    clientPlatform,
    redirectTo: workspaceEntryHref
  });
  const [joinCode, setJoinCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<RoomSummary[]>([]);
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

  const refreshAvailableRooms = useCallback(async () => {
    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms.items);
    } catch {
      setAvailableRooms([]);
    }
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshSession();
    void refreshAvailableRooms();
  }, [activeSession, refreshSession, refreshAvailableRooms]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const refresh = () => {
      void refreshAvailableRooms();
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeSession, refreshAvailableRooms]);

  async function handleCreateRoom(visibility: "public" | "private" = "public") {
    try {
      const snapshot = await musicRoomApi.createRoom(visibility);
      storeRoomSnapshotHandoff(snapshot);
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
      storeRoomSnapshotHandoff(snapshot);
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(buildRoomHref(snapshot.room.id) as Route);
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

  if (!hydrated || !activeSession) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-black pb-24 text-foreground selection:bg-accent/30 selection:text-white">
      <div className="fixed inset-0 -z-10 bg-black">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        <div className="absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-fuchsia-600/10 blur-[150px]" />
      </div>

      <div className="absolute right-4 top-6 z-20 sm:right-6 lg:right-8">
        <div className="flex items-center gap-2">
          {clientPlatform ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void updateControls?.checkForUpdates("manual")}
              disabled={updateControls?.checking}
              className="font-medium text-white/40 transition-all hover:bg-white/5 hover:text-white"
              type="button"
            >
              {updateControls?.checking ? "检查中..." : "检查更新"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="font-medium text-white/40 transition-all hover:bg-white/5 hover:text-white"
          >
            退出登录
          </Button>
        </div>
        {updateControls?.statusMessage ? (
          <p className="mt-2 text-right text-xs text-white/40">{updateControls.statusMessage}</p>
        ) : null}
      </div>



      <section className="relative mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-10 sm:px-6 md:py-14 lg:flex-row lg:gap-16 lg:px-8">
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
            这里是你的房间列表。创建新房间、输入房间码快速加入，或从开放列表进入已有房间。
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <Button data-testid="create-public-room" size="lg" className="w-full sm:w-auto" onClick={() => handleCreateRoom("public")} type="button">
              创建公开房间
            </Button>
            <Button data-testid="create-private-room" variant="outline" size="lg" className="w-full sm:w-auto bg-surface hover:bg-surface-hover border-surface-border" onClick={() => handleCreateRoom("private")} type="button">
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
                data-testid="join-code-input"
                className="w-full rounded-2xl border border-surface-border bg-black/40 px-4 py-3 text-base font-mono uppercase text-foreground placeholder:font-sans placeholder:normal-case placeholder:text-foreground-muted/50 focus:outline-none focus:ring-2 focus:ring-accent"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="输入 6 位房间码"
              />
              <Button
                data-testid="join-code-submit"
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
                <p data-testid="room-home-status" className="animate-fade-in text-center text-sm text-red-400">{statusMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1200px] px-4 pb-8 sm:px-6 lg:px-8">
        <div className="flex min-w-0 flex-col gap-4">
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
            {availableRooms.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {availableRooms.map((item) => {
                  const host = item.hostNickname;

                  return (
                    <article
                      key={item.id}
                      className="group flex flex-col gap-4 rounded-3xl border border-surface-border bg-surface/50 backdrop-blur-md p-5 shadow-md transition-all duration-300 hover:-translate-y-1 hover:bg-surface-hover hover:border-accent/30"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="rounded-md border border-accent/20 bg-accent/10 px-2 py-0.5 font-mono font-bold text-accent">
                            {item.joinCode}
                          </span>
                          <span className="text-xs text-foreground-muted">
                            {item.visibility === "public" ? "公开" : "私密"}
                          </span>
                        </div>
                        <span className="rounded-full border border-surface-border bg-background/50 px-2 py-1 text-xs font-medium text-foreground-muted">
                          {item.onlineMemberCount} 人在线
                        </span>
                      </div>
                      <div className="mt-1">
                        <h3 className="truncate font-semibold text-foreground">{host} 的房间</h3>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-foreground-muted">
                          进入后即可参与当前播放、共享队列和成员协作，所有动作都在同一处完成。
                        </p>
                      </div>
                      <Button
                        data-testid="join-public-room"
                        variant="ghost"
                        className="mt-auto w-full border border-surface-border bg-white/5 transition-all group-hover:border-accent group-hover:bg-accent group-hover:text-white"
                        onClick={() => handleJoinRoom(item.joinCode)}
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
                <h3 className="mb-2 font-semibold text-foreground">当前没有房间</h3>
                <p className="max-w-sm text-sm text-foreground-muted">
                  你可以先创建一个房间等待其他人加入，或者稍后回来刷新列表。
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
