"use client";

import { useState, useTransition } from "react";
import type { GuestSession, RoomSnapshot } from "@music-room/shared";
import { getOnlineMemberCount } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

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
    statusMessage.includes("失败") || statusMessage.includes("不可用")
      ? "text-red-400"
      : "text-accent";

  return (
    <div className="flex flex-col gap-12 max-w-[800px] w-full mx-auto p-6 md:p-10">
      <section className="flex flex-col md:flex-row md:items-start justify-between gap-10">
        <div className="flex-1 shrink-0 pt-4">
          <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase mb-3 text-glow">
            Music Room
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground mb-4">
            音乐房间
          </h1>
          <p className="text-lg text-foreground-muted leading-relaxed max-w-sm">
            本地曲库，实时同播。<br/>先确认昵称，再创建房间或通过房间码加入。
          </p>
        </div>

        <div className="flex-1 w-full max-w-sm">
          {!activeSession ? (
            <section className="glass-panel p-8 rounded-3xl flex flex-col gap-8 shadow-2xl relative overflow-hidden group hover:border-accent/30 transition-colors">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent to-fuchsia-500 opacity-50" />
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-2">Step 1</p>
                <h2 className="text-2xl font-bold text-foreground mb-2">确认昵称</h2>
                <p className={`text-sm ${statusTone}`}>
                  {statusMessage || "昵称是创建或加入房间的前提。"}
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-foreground-muted">昵称</span>
                  <input
                    className="w-full bg-black/40 border border-surface-border rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="输入你的昵称"
                  />
                </label>

                <Button
                  size="lg"
                  disabled={!nickname.trim()}
                  onClick={() => startTransition(() => void onConfirmIdentity())}
                  className="w-full mt-2"
                >
                  确认昵称
                </Button>
              </div>
            </section>
          ) : (
            <section className="glass-panel p-8 rounded-3xl flex flex-col gap-8 shadow-2xl relative overflow-hidden group hover:border-accent/30 transition-colors">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent to-fuchsia-500 opacity-50" />
              <div>
                <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-2">Step 2</p>
                <h2 className="text-2xl font-bold text-foreground mb-2">创建或加入</h2>
                <p className={`text-sm ${statusTone}`}>
                  {statusMessage || "现在可以创建新房间，或通过房间码加入已有房间。"}
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between bg-surface p-3 rounded-xl border border-surface-border">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm font-medium text-foreground">{activeSession.nickname}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={onLeaveRoom}>
                    更换
                  </Button>
                </div>

                <Button size="lg" onClick={onCreateRoom} className="w-full">
                  创建新房间
                </Button>
                
                <div className="relative py-2 flex items-center">
                  <div className="h-px w-full bg-surface-border" />
                  <span className="absolute left-1/2 -translate-x-1/2 bg-surface text-xs text-foreground-muted px-2 rounded-md border border-surface-border">OR</span>
                </div>

                <div className="flex gap-2 w-full">
                  <input
                    className="flex-1 w-0 bg-black/40 border border-surface-border rounded-xl px-4 py-3 text-sm text-foreground uppercase placeholder:text-foreground-muted/50 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    placeholder="输入房间码"
                  />
                  <Button
                    variant="outline"
                    className="h-auto shrink-0"
                    disabled={!joinCode.trim()}
                    onClick={() => onJoinRoom(joinCode)}
                  >
                    加入
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-6 pt-10 border-t border-surface-border">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-2">Public Rooms</p>
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
              正在开放的房间
              {isPending && <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />}
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={() => startTransition(() => void onRefreshRooms())}>
            刷新
          </Button>
        </div>

        {visibleRooms.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {visibleRooms.map((item) => {
              const roomHost =
                item.room.members.find((member) => member.role === "host")?.nickname ?? "未知";

              return (
                <button
                  key={item.room.id}
                  type="button"
                  className="flex items-start justify-between text-left glass-panel p-5 rounded-2xl hover:-translate-y-1 hover:border-accent/30 transition-all duration-300 group"
                  onClick={() => onJoinRoom(item.room.joinCode)}
                >
                  <div className="flex flex-col gap-1">
                    <span className="font-mono font-bold text-xl text-foreground group-hover:text-accent transition-colors">{item.room.joinCode}</span>
                    <span className="text-sm text-foreground-muted truncate max-w-[120px]">房主：{roomHost}</span>
                  </div>
                  <span className="px-2 py-1 bg-surface rounded-md text-xs font-medium text-foreground-muted border border-surface-border">
                    {getOnlineMemberCount(item.room.members)} 在线
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-surface-border rounded-3xl bg-surface/50">
            <div className="w-12 h-12 rounded-full bg-surface border border-surface-border flex items-center justify-center mb-4 text-foreground-muted">
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path></svg>
            </div>
            <p className="text-foreground-muted text-sm max-w-xs">当前还没有公开房间，先创建一个让朋友加入吧。</p>
          </div>
        )}
      </section>
    </div>
  );
}
