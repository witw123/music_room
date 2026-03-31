import { useState, useTransition } from "react";
import { RoomChatOverlay } from "./RoomChatOverlay";
import type {
  AuthSession,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration, getOnlineMemberCount } from "@/lib/music-room-ui";
import { RoomSocket } from "@/lib/ws-client";

type RoomStageProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: AuthSession | null;
  host: RoomMember | undefined;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
  currentSourceOwnerNickname: string | null;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  socket: RoomSocket | null;
};

function getConnectionLabel(
  mediaConnectionState: RoomMediaConnectionState,
  isSourceOwner: boolean,
  mediaConnectedPeersCount: number
) {
  if (isSourceOwner) {
    return `向 ${mediaConnectedPeersCount} 位成员分发音频`;
  }

  switch (mediaConnectionState) {
    case "connecting":
      return "正在连接";
    case "buffering":
      return "正在缓冲";
    case "live":
      return "已接入音频";
    case "reconnecting":
      return "重新连接中";
    case "failed":
      return "连接失败";
    default:
      return "等待播放";
  }
}

export function RoomStage({
  roomSnapshot,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  activeSession,
  host,
  canDeleteRoom,
  canDisbandRoom,
  currentSourceOwnerNickname,
  mediaConnectionState,
  mediaConnectedPeersCount,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom,
  socket
}: RoomStageProps) {
  const [isPending, startTransition] = useTransition();
  const [showSettings, setShowSettings] = useState(false);
  const isSourceOwner =
    !!activeSession && activeSession.id === roomSnapshot.room.playback.sourceSessionId;

  return (
    <section className="relative flex h-full w-full flex-col justify-between px-4 py-4 sm:px-5 sm:py-5 md:px-8 md:py-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-accent/5 to-transparent blur-[120px]" />

      <div className="relative z-30 mb-5 flex w-full shrink-0 items-start justify-between gap-3 sm:mb-6">
        <div className="min-w-0 space-y-2">
          <button
            className="group flex max-w-full items-center gap-2"
            onClick={() => startTransition(() => void onCopyJoinCode())}
            type="button"
          >
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/5 bg-white/10 px-3 py-1.5 shadow-sm backdrop-blur-md transition-colors group-hover:bg-white/20">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgba(0,112,243,0.8)]" />
              <span className="truncate font-mono text-[11px] font-bold tracking-[0.28em] text-white">
                {roomSnapshot.room.joinCode}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 text-white/50 group-hover:text-white"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </div>
            {isPending ? <span className="text-[10px] text-accent">已复制</span> : null}
          </button>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] tracking-[0.18em] text-white/50">
            <span className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              {getOnlineMemberCount(roomSnapshot.room.members)} 人在线
            </span>
            <span>·</span>
            <span>{roomSnapshot.room.visibility === "public" ? "公开房间" : "私密房间"}</span>
            <span>·</span>
            <span
              className={
                mediaConnectionState === "live" || isSourceOwner ? "text-green-400" : "text-yellow-400"
              }
            >
              {getConnectionLabel(mediaConnectionState, isSourceOwner, mediaConnectedPeersCount)}
            </span>
          </div>
        </div>

        <div className="relative shrink-0 pointer-events-auto">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white sm:h-10 sm:w-10"
            onClick={() => setShowSettings((value) => !value)}
            type="button"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </Button>

          {showSettings ? (
            <div className="animate-fade-in absolute right-0 top-11 z-[60] flex w-56 origin-top-right flex-col rounded-2xl border border-white/10 bg-surface/92 p-1 shadow-2xl backdrop-blur-xl">


              <button
                className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-accent/40"
                onClick={() => {
                  setShowSettings(false);
                  void onLeaveRoom();
                }}
                type="button"
              >
                离开房间
              </button>

              {canDeleteRoom ? (
                <>
                  <button
                    className={`my-1 w-full rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/30 ${
                      canDisbandRoom
                        ? "cursor-pointer text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        : "cursor-not-allowed text-red-400/45 opacity-70"
                    }`}
                    disabled={!canDisbandRoom}
                    onClick={() => {
                      setShowSettings(false);
                      void onDeleteRoom();
                    }}
                    title={canDisbandRoom ? "解散房间" : "只有所有成员都在线时才能解散房间"}
                    type="button"
                  >
                    解散房间
                  </button>
                  {!canDisbandRoom ? (
                    <p className="px-3 pb-2 text-[11px] leading-5 text-white/45">
                      只有所有成员都在线时才能解散房间
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="z-20 flex min-h-0 flex-1 flex-col overflow-hidden pb-4 sm:pb-6">
        <div className="relative mb-6 flex min-h-0 flex-1 items-center justify-center sm:mb-8">
          <div className="group relative flex items-center justify-center">
            <div
              className={`relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-all duration-1000 sm:h-48 sm:w-48 md:h-64 md:w-64 lg:h-80 lg:w-80 ${
                isPlaying ? "animate-spin-slow" : ""
              }`}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
              <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,rgba(0,112,243,0.1)_0deg,rgba(0,0,0,0)_90deg,rgba(0,112,243,0.1)_180deg,rgba(0,0,0,0)_270deg,rgba(0,112,243,0.1)_360deg)]" />
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="absolute rounded-full border border-white/[0.02]"
                  style={{ width: `${100 - index * 15}%`, height: `${100 - index * 15}%` }}
                />
              ))}
              <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner sm:h-16 sm:w-16 md:h-20 md:w-20">
                <div className="h-4 w-4 rounded-full border border-white/5 bg-black shadow-inner" />
              </div>
            </div>

            <div
              className={`absolute -right-4 top-3 flex h-28 w-7 origin-[14px_14px] flex-col items-center transition-transform duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] sm:-right-5 sm:h-32 sm:w-8 md:-right-8 md:h-48 ${
                isPlaying ? "rotate-[20deg]" : "-rotate-[15deg]"
              }`}
              style={{ zIndex: 30 }}
            >
              <div className="absolute top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#111] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl sm:h-8 sm:w-8">
                <div className="h-3 w-3 rounded-full bg-[#111] shadow-inner" />
              </div>
              <div className="h-full w-2.5 bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-8 shadow-lg" />
              <div className="-ml-3 h-9 w-5 skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#222] shadow-2xl sm:h-10 sm:w-6">
                <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              </div>
            </div>

            <div
              className={`absolute -bottom-8 left-1/2 h-8 w-[72%] -translate-x-1/2 bg-accent/20 blur-[45px] transition-all duration-1000 sm:-bottom-10 sm:h-10 sm:w-[80%] ${
                isPlaying ? "scale-110 opacity-100" : "scale-90 opacity-30"
              }`}
            />
          </div>
        </div>

        <RoomChatOverlay 
          roomId={roomSnapshot.room.id}
          activeSession={activeSession}
          socket={socket}
        />

        <div className="flex w-full shrink-0 flex-col items-center gap-2 text-center md:gap-3">
          <div className="mb-1 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em] ${
                isPlaying
                  ? "border border-accent/30 bg-accent/20 text-accent"
                  : "border border-white/10 bg-white/10 text-white/55"
              }`}
            >
              {isPlaying ? "正在播放" : "准备就绪"}
            </span>
            {currentTrack && currentSourceOwnerNickname ? (
              <span className="flex items-center gap-1 text-[10px] text-white/45">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                当前音源：<span className="text-white/70">{currentSourceOwnerNickname}</span>
              </span>
            ) : null}
          </div>

          <h2 className="max-w-[18ch] text-2xl font-extrabold leading-[1.06] tracking-tight text-white drop-shadow-lg sm:text-3xl md:text-4xl lg:text-5xl">
            {currentTrack?.title ?? "房间已就绪"}
          </h2>

          <p className="max-w-[26ch] text-sm font-medium leading-relaxed tracking-wide text-white/60 sm:text-base md:text-lg">
            {currentTrack
              ? `${currentTrack.artist} · ${formatDuration(currentTrackDuration)}`
              : "从曲库添加音乐，或导入本地音频，马上开始这场协作收听。"}
          </p>
        </div>
      </div>
    </section>
  );
}
