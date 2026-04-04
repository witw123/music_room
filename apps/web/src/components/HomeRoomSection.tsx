"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSnapshot } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  buildAppEntryHref,
  buildWorkspaceAuthHref,
  githubReleasesUrl
} from "@/lib/client-shell";
import { getClientPlatformFromBrowser } from "@/lib/client-shell-browser";
import { getOnlineMemberCount, toUserFacingError } from "@/lib/music-room-ui";
import { storeRoomSnapshotHandoff } from "@/lib/room-snapshot-handoff";

const lastRoomStorageKey = "music-room-last-room";

export function HomeRoomSection() {
  const router = useRouter();
  const clientPlatform = getClientPlatformFromBrowser();
  const workspaceEntryHref = buildAppEntryHref(clientPlatform);
  const authEntryHref = buildWorkspaceAuthHref({
    clientPlatform,
    redirectTo: workspaceEntryHref
  });
  const buildRoomHref = (roomId: string) =>
    clientPlatform ? `/room/${roomId}?client=${clientPlatform}` : `/room/${roomId}`;
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

  useEffect(() => {
    if (!hydrated || !activeSession) {
      return;
    }

    void refreshSession();
    void refreshAvailableRooms();
    void refreshRecentRoom();
  }, [hydrated, activeSession?.id, refreshSession]);

  async function refreshAvailableRooms() {
    if (!activeSession) {
      setAvailableRooms([]);
      return;
    }

    try {
      const rooms = await musicRoomApi.listRooms();
      setAvailableRooms(rooms);
    } catch {
      setAvailableRooms([]);
    }
  }

  async function refreshRecentRoom() {
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
  }

  async function handleCreateRoom(visibility: "public" | "private") {
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
    () => availableRooms.filter((room) => room.room.id !== recentRoom?.room.id).slice(0, 6),
    [availableRooms, recentRoom?.room.id]
  );

  return (
    <section className="mb-40 w-full">
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[30px] border border-white/10 bg-[#050505] p-6 shadow-2xl sm:p-8">
          {hydrated && activeSession ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
                    Signed in
                  </p>
                  <h3 className="text-2xl font-bold text-white">
                    {activeSession.nickname}
                  </h3>
                  <p className="mt-2 text-sm text-white/45">
                    直接从网页创建或加入音乐房。
                  </p>
                </div>

                <Link href={workspaceEntryHref as Route}>
                  <Button
                    variant="ghost"
                    className="border border-white/10 bg-white/5 text-white hover:bg-white/10"
                  >
                    打开完整房间页
                  </Button>
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  size="lg"
                  onClick={() => startTransition(() => void handleCreateRoom("public"))}
                  type="button"
                >
                  创建公开房间
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                  onClick={() => startTransition(() => void handleCreateRoom("private"))}
                  type="button"
                >
                  创建私密房间
                </Button>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
                      Join with code
                    </p>
                    <p className="mt-1 text-sm text-white/55">
                      输入房间码，直接进入音乐房。
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <input
                    className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 font-mono text-base uppercase text-white placeholder:font-sans placeholder:normal-case placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-accent"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    placeholder="输入 6 位房间码"
                  />
                  <Button
                    size="lg"
                    variant="outline"
                    className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                    disabled={!joinCode.trim()}
                    onClick={() => startTransition(() => void handleJoinRoom(joinCode))}
                    type="button"
                  >
                    立即加入
                  </Button>
                </div>
              </div>

              {recentRoom ? (
                <div className="rounded-2xl border border-accent/20 bg-accent/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-accent">
                        Recent room
                      </p>
                      <h4 className="mt-2 font-mono text-lg font-bold text-white">
                        {recentRoom.room.joinCode}
                      </h4>
                      <p className="mt-2 text-sm text-white/60">
                        {getOnlineMemberCount(recentRoom.room.members)} 人在线，可继续恢复协作。
                      </p>
                    </div>

                    <Button
                      variant="glass"
                      className="border-accent/30 hover:border-accent hover:bg-accent/10"
                      onClick={() => startTransition(() => void handleReturnToRecentRoom())}
                      type="button"
                    >
                      回到最近房间
                    </Button>
                  </div>
                </div>
              ) : null}

              {statusMessage ? (
                <p className="text-sm text-red-400">{statusMessage}</p>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full flex-col justify-between gap-8">
              <div>
                
                <h3 className="text-2xl font-bold text-white md:text-3xl">
                  网页体验
                </h3>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-white/55 md:text-base">
                  登录后可以直接在网页中创建房间、加入房间、恢复最近房间，再进入完整的实时音乐房。
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link href={authEntryHref as Route}>
                  <Button size="lg" className="w-full">
                    房间功能区
                  </Button>
                </Link>
                <Link href={workspaceEntryHref as Route}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full border-white/10 bg-white/5 text-white hover:bg-white/10"
                  >
                    浏览房间大厅
                  </Button>
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    title: "创建房间",
                    body: "公开房与私密房都能直接在网页里建立。"
                  },
                  {
                    title: "房间码加入",
                    body: "输入房间码后直达房间，不再要求客户端专用入口。"
                  },
                  {
                    title: "恢复最近房间",
                    body: "登录后继续上一场协作，不必重新找房。"
                  }
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"
                  >
                    <h4 className="text-sm font-semibold text-white">{item.title}</h4>
                    <p className="mt-2 text-xs leading-6 text-white/45">{item.body}</p>
                  </div>
                ))}
              </div>

              <p className="text-sm text-white/35">
                仍然建议下载客户端获得更稳定的本地播放与 P2P 体验。
                <Link
                  href={githubReleasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-accent hover:text-white"
                >
                  前往下载
                </Link>
              </p>
            </div>
          )}
        </div>

        <div className="rounded-[30px] border border-white/10 bg-[#050505] p-6 shadow-2xl sm:p-8">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              
              <h3 className="text-2xl font-bold text-white">房间大厅</h3>
            </div>

            <Link href={workspaceEntryHref as Route} className="text-sm text-accent hover:text-white">
              查看全部
            </Link>
          </div>

          {hydrated && activeSession ? (
            visibleRooms.length > 0 ? (
              <div className="flex flex-col gap-3">
                {visibleRooms.map((room) => {
                  const hostNickname =
                    room.room.members.find((member) => member.role === "host")?.nickname ?? "未知";

                  return (
                    <button
                      key={room.room.id}
                      type="button"
                      onClick={() => startTransition(() => void handleJoinRoom(room.room.joinCode))}
                      className="flex w-full flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-left transition hover:border-accent/30 hover:bg-accent/10"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm font-bold text-accent">
                          {room.room.joinCode}
                        </span>
                        <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white/50">
                          {getOnlineMemberCount(room.room.members)} 人在线
                        </span>
                      </div>

                      <div>
                        <p className="text-sm font-semibold text-white">
                          {hostNickname} 的房间
                        </p>
                        <p className="mt-1 text-xs leading-6 text-white/45">
                          从主页直接加入，进入完整音乐房继续协作播放。
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center">
                <p className="text-sm font-semibold text-white">当前没有公开房间</p>
                <p className="mt-2 text-sm leading-7 text-white/45">
                  你可以直接从左侧创建一个公开房间，网页端也会同步显示。
                </p>
              </div>
            )
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center">
              <p className="text-sm font-semibold text-white">公开房间</p>
              
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
