"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSnapshot } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildAppEntryHref,
  buildWorkspaceAuthHref
} from "@/lib/client-shell";
import { getOnlineMemberCount, toUserFacingError } from "@/lib/music-room-ui";
import { storeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";
import { filterRoomsForSession } from "@/features/room/room-list-visibility";

const lastRoomStorageKey = "music-room-last-room";

export function HomeRoomSection() {
  const router = useRouter();
  const workspaceEntryHref = buildAppEntryHref();
  const authEntryHref = buildWorkspaceAuthHref({
    redirectTo: workspaceEntryHref
  });
  const buildRoomHref = (roomId: string) => `/room/${roomId}`;
  const [joinCode, setJoinCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<RoomSnapshot[]>([]);
  const [recentRoom, setRecentRoom] = useState<RoomSnapshot | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    activeSession,
    hydrated,
    statusMessage,
    setStatusMessage,
    refreshSession
  } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });

  const refreshAvailableRooms = useCallback(async () => {
    if (!activeSession) {
      setAvailableRooms([]);
      return;
    }

    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(filterRoomsForSession(rooms, activeSession.userId));
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }, [activeSession, setStatusMessage]);

  const refreshRecentRoom = useCallback(async () => {
    if (!activeSession) {
      setRecentRoom(null);
      return;
    }

    try {
      const room = await musicRoomApi.getRecentRoom();
      setRecentRoom(room);
    } catch {
      setRecentRoom(null);
    }
  }, [activeSession]);

  useEffect(() => {
    if (!hydrated || !activeSession) {
      return;
    }

    void refreshSession();
    void refreshAvailableRooms();
    void refreshRecentRoom();
  }, [hydrated, activeSession, refreshSession, refreshAvailableRooms, refreshRecentRoom]);

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
  }, [activeSession, refreshAvailableRooms, refreshRecentRoom]);

  async function handleCreateRoom(visibility: "public" | "private") {
    try {
      const snapshot = await musicRoomApi.createRoom({ visibility });
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

  async function handleReturnToRecentRoom() {
    if (!recentRoom) {
      return;
    }

    try {
      const recovered = await musicRoomApi.recoverRoom(recentRoom.room.id);
      if (recovered) {
        storeRoomSnapshotHandoff(recovered);
        window.localStorage.setItem(lastRoomStorageKey, recovered.room.id);
        router.push(buildRoomHref(recovered.room.id) as Route);
        return;
      }

      const joined = await musicRoomApi.joinRoomByCode(recentRoom.room.joinCode);
      storeRoomSnapshotHandoff(joined);
      window.localStorage.setItem(lastRoomStorageKey, joined.room.id);
      router.push(buildRoomHref(joined.room.id) as Route);
    } catch (error) {
      setStatusMessage(toUserFacingError(error));
    }
  }

  const visibleRooms = useMemo(
    () => [...availableRooms].sort(
      (left, right) => getOnlineMemberCount(right.room.members) - getOnlineMemberCount(left.room.members)
    ),
    [availableRooms]
  );

  return (
    <section id="try" className="mx-auto w-full max-w-[1120px] px-5 pb-24 sm:px-6 md:pb-32">
      <div className="grid gap-8 border-y border-white/[0.05] py-12 md:grid-cols-[0.82fr_1.18fr] md:py-16">
        <div>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.24em] text-accent">
            Online trial
          </p>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-5xl">
            直接进入网页房间
          </h2>
          <p className="mt-5 text-base leading-8 text-white/[0.56]">
            浏览器中即可创建房间、通过房间码加入、浏览公开房间并恢复最近的协作房间。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            {["创建公开或私密房间", "用 6 位房间码加入", "恢复最近协作房间"].map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm text-white/70">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-[#05070a] p-5 shadow-2xl sm:p-6">
          {hydrated && activeSession ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-300">
                    Signed in
                  </p>
                  <h3 className="mt-2 text-2xl font-bold text-white">{activeSession.nickname}</h3>
                  <p className="mt-2 text-sm text-white/[0.45]">可以直接创建、加入或恢复房间。</p>
                </div>
                <Link href={workspaceEntryHref as Route}>
                  <Button
                    variant="outline"
                    className="w-full border-white/[0.08] bg-white/[0.04] text-white hover:bg-white/[0.08] sm:w-auto"
                  >
                    打开房间页
                  </Button>
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  size="lg"
                  disabled={isPending}
                  onClick={() => startTransition(() => void handleCreateRoom("public"))}
                  type="button"
                >
                  创建公开房间
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/[0.08] bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  disabled={isPending}
                  onClick={() => startTransition(() => void handleCreateRoom("private"))}
                  type="button"
                >
                  创建私密房间
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  className="min-w-0 rounded-lg border border-white/[0.08] bg-black/40 px-4 py-3 font-mono text-base uppercase text-white placeholder:font-sans placeholder:normal-case placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-accent"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="输入 6 位房间码"
                />
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/[0.08] bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  disabled={!joinCode.trim() || isPending}
                  onClick={() => startTransition(() => void handleJoinRoom(joinCode))}
                  type="button"
                >
                  立即加入
                </Button>
              </div>

              {recentRoom ? (
                <button
                  className="rounded-xl border border-accent/25 bg-accent/10 p-4 text-left transition-colors hover:bg-accent/15"
                  disabled={isPending}
                  onClick={() => startTransition(() => void handleReturnToRecentRoom())}
                  type="button"
                >
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-accent">
                    Recent room
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <span className="font-mono text-lg font-bold text-white">
                      {recentRoom.room.joinCode}
                    </span>
                    <span className="text-sm text-white/[0.55]">
                      {getOnlineMemberCount(recentRoom.room.members)} 人在线
                    </span>
                  </div>
                </button>
              ) : null}

              {visibleRooms.length > 0 ? (
                <div>
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-white/[0.35]">
                    All rooms
                  </p>
                  <div className="grid gap-2">
                    {visibleRooms.map((room) => (
                      <button
                        key={room.room.id}
                        className="flex items-center justify-between rounded-lg border border-transparent bg-white/[0.025] px-4 py-3 text-left transition-colors hover:border-white/[0.05] hover:bg-white/[0.06]"
                        disabled={isPending}
                        onClick={() => startTransition(() => void handleJoinRoom(room.room.joinCode))}
                        type="button"
                      >
                        <span className="font-mono text-sm font-semibold text-white">{room.room.joinCode}</span>
                        <span className="text-xs text-white/[0.45]">
                          {getOnlineMemberCount(room.room.members)} 人在线
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {statusMessage ? <p className="text-sm text-red-400">{statusMessage}</p> : null}
            </div>
          ) : (
            <div className="grid gap-6">
              <div>
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.24em] text-white/[0.35]">
                  Guest view
                </p>
                <h3 className="mt-2 text-2xl font-bold text-white">登录后体验完整网页房间</h3>
                <p className="mt-3 text-sm leading-7 text-white/50">
                  你可以先进入大厅，也可以登录后创建房间、导入本地音乐并邀请成员加入。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href={authEntryHref as Route}>
                  <Button size="lg" className="w-full">
                    在线体验
                  </Button>
                </Link>
                <Link href={workspaceEntryHref as Route}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full border-white/[0.08] bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  >
                    浏览房间大厅
                  </Button>
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {["创建房间", "导入音乐", "同步播放"].map((item) => (
                  <div key={item} className="rounded-lg border border-transparent bg-white/[0.025] p-4">
                    <p className="text-sm font-semibold text-white">{item}</p>
                    <p className="mt-2 text-xs leading-5 text-white/[0.42]">网页端可验证核心流程。</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
