"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { RoomSnapshot } from "@music-room/shared";
import { TopBar } from "@/components/TopBar";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { musicRoomApi } from "@/lib/music-room-api";
import { getOnlineMemberCount, toUserFacingError } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

const lastRoomStorageKey = "music-room-last-room";

export function RoomsHomePage() {
  const router = useRouter();
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
    initialStatusMessage: "登录后即可创建房间、加入房间，并直接进入音乐房工作台。"
  });

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!activeSession) {
      router.replace("/auth?redirectTo=/rooms" as Route);
    }
  }, [activeSession, hydrated, router]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    void refreshSession();
    void refreshAvailableRooms();
    void refreshRecentRoom();
  }, [activeSession?.id, refreshSession]);

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

  async function handleCreateRoom() {
    try {
      const snapshot = await musicRoomApi.createRoom("public");
      window.localStorage.setItem(lastRoomStorageKey, snapshot.room.id);
      router.push(`/room/${snapshot.room.id}` as Route);
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
      router.push(`/room/${snapshot.room.id}` as Route);
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
    router.replace("/auth?redirectTo=/rooms" as Route);
  }

  const visibleRooms = useMemo(
    () => availableRooms.filter((room) => room.room.id !== recentRoom?.room.id),
    [availableRooms, recentRoom?.room.id]
  );

  if (!hydrated || !activeSession) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <main className="min-h-screen pb-20 bg-background text-foreground flex flex-col relative">
      <TopBar activeSession={activeSession} onLogout={handleLogout} />

      {/* Hero Section */}
      <section className="relative px-4 py-16 md:py-24 mx-auto max-w-[1200px] w-full flex flex-col md:flex-row gap-12 lg:gap-24">
        <div className="flex-1 flex flex-col justify-center items-start z-10">
          <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase mb-4 text-glow transition-all">
            Music Room
          </p>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-foreground mb-6 leading-[1.1]">
            欢迎回来，<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-fuchsia-400">
              {activeSession.nickname}
            </span>。
          </h1>
          <p className="text-lg text-foreground-muted leading-relaxed max-w-md mb-10">
            这里是你的音乐房入口。可以随时创建新房间发起一起听、或者通过房间码快速加入。
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button size="lg" onClick={handleCreateRoom} type="button">
              创建公开房间
            </Button>
            <Link href={"/features" as Route}>
              <Button variant="ghost" size="lg">查看产品结构</Button>
            </Link>
          </div>
        </div>

        {/* Join Card */}
        <div className="w-full md:w-[400px] lg:w-[480px] shrink-0 z-10">
          <div className="glass-panel p-8 md:p-10 rounded-3xl flex flex-col gap-6 shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-30 opacity-20 bg-accent blur-[100px] w-full h-full rounded-full mix-blend-screen -z-10 pointer-events-none" />
             
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-2">Join with code</p>
                <h2 className="text-2xl font-bold text-foreground">输入房间码加入</h2>
              </div>
              <span className="px-3 py-1 rounded-full bg-surface border border-surface-border text-xs font-medium text-foreground-muted truncate max-w-[120px]">
                {activeSession.username}
              </span>
            </div>

            <div className="flex flex-col gap-4 mt-2">
              <input
                className="w-full bg-black/40 border border-surface-border rounded-xl px-5 py-4 text-base font-mono text-foreground uppercase placeholder:text-foreground-muted/50 placeholder:normal-case placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="输入音乐房 6 位房间码..."
              />
              <Button
                size="lg"
                variant="outline"
                className="w-full bg-white/5 hover:bg-white/10"
                disabled={!joinCode.trim()}
                onClick={() => startTransition(() => void handleJoinRoom(joinCode))}
                type="button"
              >
                直接进入工作台
              </Button>

              {statusMessage && (
                <p className="text-sm text-red-400 mt-2 text-center animate-fade-in">{statusMessage}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Second half - Grids */}
      <section className="px-4 py-12 mx-auto max-w-[1200px] w-full flex flex-col lg:flex-row gap-8 lg:gap-12 relative z-10">
        
        {/* Recent Room */}
        <div className="w-full lg:w-[320px] shrink-0 flex flex-col gap-6">
          <div className="flex flex-col justify-end min-h-[50px]">
            <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Recent room</p>
            <h2 className="text-xl font-bold text-foreground">最近的协作</h2>
          </div>

          <div className="glass-panel p-6 rounded-3xl h-full flex flex-col justify-between">
            {recentRoom ? (
              <div className="flex flex-col h-full gap-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-surface to-surface-hover border border-surface-border shadow-inner flex items-center justify-center text-accent">
                   <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-lg font-bold text-foreground">{recentRoom.room.joinCode}</span>
                    <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 text-xs font-medium border border-green-500/20">
                      {getOnlineMemberCount(recentRoom.room.members)} 在线
                    </span>
                  </div>
                  <p className="text-sm text-foreground-muted leading-relaxed">
                    如果你刚离开不久，可以直接回到这个房间继续听歌和改队列。
                  </p>
                </div>
                <div className="mt-auto pt-4">
                  <Button
                    variant="glass"
                    className="w-full border-accent/20 hover:border-accent hover:bg-accent/10"
                    onClick={() => router.push(`/room/${recentRoom.room.id}` as Route)}
                    type="button"
                  >
                    回到最近房间
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <div className="w-10 h-10 rounded-full bg-surface border border-surface-border flex items-center justify-center mb-3 text-foreground-muted opacity-50">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </div>
                <p className="text-sm text-foreground-muted opacity-70">还没有历史房间记录。创建一个房间后，这里会成为快速返回入口。</p>
              </div>
            )}
          </div>
        </div>

        {/* Available Rooms */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          <div className="flex items-end justify-between min-h-[50px]">
            <div>
               <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Available rooms</p>
               <h2 className="text-xl font-bold text-foreground flex items-center gap-3">
                 正在开放的房间
                 {isPending && <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />}
               </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => void refreshAvailableRooms())}
              type="button"
            >
              刷新列表
            </Button>
          </div>

          <div className="glass-panel p-6 sm:p-8 rounded-3xl min-h-[300px]">
            {visibleRooms.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {visibleRooms.map((item) => {
                  const host =
                    item.room.members.find((member) => member.role === "host")?.nickname ?? "未知";

                  return (
                    <article key={item.room.id} className="group bg-surface hover:bg-surface-hover border border-surface-border rounded-2xl p-5 flex flex-col gap-4 transition-all duration-300 hover:-translate-y-1 shadow-md">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-accent px-2 py-0.5 rounded-md bg-accent/10 border border-accent/20">{item.room.joinCode}</span>
                        <span className="text-xs font-medium text-foreground-muted px-2 py-1 rounded bg-background/50 border border-surface-border">
                          {getOnlineMemberCount(item.room.members)} 人在线
                        </span>
                      </div>
                      <div className="mt-1">
                        <h3 className="font-semibold text-foreground truncate">{host} 的房间</h3>
                        <p className="text-xs text-foreground-muted line-clamp-2 mt-1.5 leading-relaxed">
                          进入后会直接跳到房间工作台，队列、当前播放和成员状态都在同一页完成。
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        className="w-full mt-auto bg-white/5 group-hover:bg-accent group-hover:text-white border border-surface-border group-hover:border-accent transition-all"
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
              <div className="flex flex-col items-center justify-center h-full text-center py-16 opacity-80">
                <div className="w-16 h-16 rounded-full bg-surface border border-surface-border flex items-center justify-center mb-4 text-foreground-muted">
                   <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                </div>
                <h3 className="font-semibold text-foreground mb-2">当前没有公开的房间</h3>
                <p className="text-sm text-foreground-muted max-w-sm">你可以先创建一个公开房间，等待别人加入，或者稍后再回来刷新列表。</p>
              </div>
            )}
          </div>
        </div>

      </section>

    </main>
  );
}
