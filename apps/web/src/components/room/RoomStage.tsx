import { useTransition, useState } from "react";
import type {
  AuthSession,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { formatDuration, getOnlineMemberCount } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type RoomStageProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: AuthSession | null;
  host: RoomMember | undefined;
  canDeleteRoom: boolean;
  currentSourceOwnerNickname: string | null;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
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
      return "连接中";
    case "buffering":
      return "缓冲中";
    case "live":
      return "已接入";
    case "reconnecting":
      return "重连中";
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
  currentSourceOwnerNickname,
  mediaConnectionState,
  mediaConnectedPeersCount,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom
}: RoomStageProps) {
  const [isPending, startTransition] = useTransition();
  const [showSettings, setShowSettings] = useState(false);
  const isHost = !!activeSession && activeSession.id === roomSnapshot.room.hostId;
  const isSourceOwner =
    !!activeSession && activeSession.id === roomSnapshot.room.playback.sourceSessionId;

  return (
    <section className="relative flex h-full w-full flex-col justify-between px-4 py-6 md:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-accent/5 to-transparent blur-[120px]" />

      <div className="relative z-20 mb-10 flex w-full shrink-0 items-start justify-between">
        <div className="flex flex-col gap-2">
          <div
            className="group flex cursor-pointer items-center gap-2"
            onClick={() => startTransition(() => void onCopyJoinCode())}
          >
            <div className="flex items-center gap-2 rounded-full border border-white/5 bg-white/10 px-3 py-1.5 shadow-sm backdrop-blur-md transition-colors group-hover:bg-white/20">
              <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_rgba(0,112,243,0.8)]" />
              <span className="font-mono text-xs font-bold tracking-widest text-white">
                {roomSnapshot.room.joinCode}
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-white/50 group-hover:text-white"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </div>
            {isPending ? <span className="text-[10px] text-accent">已复制</span> : null}
          </div>

          <div className="flex items-center gap-2 text-[10px] tracking-wider text-white/50">
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
            <span className="uppercase">
              {roomSnapshot.room.visibility === "public" ? "公开房间" : "私密房间"}
            </span>
            <span>·</span>
            <span className={mediaConnectionState === "live" || isSourceOwner ? "text-green-400" : "text-yellow-400"}>
              {getConnectionLabel(mediaConnectionState, isSourceOwner, mediaConnectedPeersCount)}
            </span>
          </div>
        </div>

        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white/70 backdrop-blur-md transition-all hover:bg-white/15 hover:text-white"
            onClick={() => setShowSettings(!showSettings)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </Button>

          {showSettings ? (
            <div className="animate-fade-in absolute right-0 top-12 z-50 flex w-48 origin-top-right flex-col rounded-xl border border-white/10 bg-surface/90 p-1 shadow-2xl backdrop-blur-xl">
              {activeSession ? (
                <div className="mb-1 flex items-center gap-2 border-b border-white/5 px-3 py-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                    {activeSession.nickname.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="truncate text-sm font-medium text-white">{activeSession.nickname}</span>
                </div>
              ) : null}
              <button
                className="w-full rounded-md px-3 py-2 text-left text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => startTransition(() => void onLeaveRoom())}
                type="button"
              >
                离开房间
              </button>
              {canDeleteRoom ? (
                <button
                  className="my-1 w-full rounded-md px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => startTransition(() => void onDeleteRoom())}
                  type="button"
                >
                  解散房间
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="z-20 flex min-h-0 flex-1 flex-col overflow-hidden pb-8">
        <div className="relative mb-8 flex min-h-0 flex-1 items-center justify-center">
          <div className="group relative flex items-center justify-center">
            <div
              className={`relative flex h-48 w-48 items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-all duration-1000 md:h-64 md:w-64 lg:h-80 lg:w-80 ${
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
              <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner md:h-20 md:w-20">
                <div className="h-4 w-4 rounded-full border border-white/5 bg-black shadow-inner" />
              </div>
            </div>

            <div
              className={`absolute -right-6 top-4 flex h-32 w-8 origin-[16px_16px] flex-col items-center transition-transform duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] md:-right-8 md:h-48 ${
                isPlaying ? "rotate-[20deg]" : "-rotate-[15deg]"
              }`}
              style={{ zIndex: 30 }}
            >
              <div className="absolute top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#111] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl">
                <div className="h-3 w-3 rounded-full bg-[#111] shadow-inner" />
              </div>
              <div className="h-full w-2.5 bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-8 shadow-lg" />
              <div className="-ml-3 h-10 w-6 skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#222] shadow-2xl">
                <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              </div>
            </div>

            <div
              className={`absolute -bottom-10 left-1/2 h-10 w-[80%] -translate-x-1/2 bg-accent/20 blur-[50px] transition-all duration-1000 ${
                isPlaying ? "scale-110 opacity-100" : "scale-90 opacity-30"
              }`}
            />
          </div>
        </div>

        <div className="flex w-full shrink-0 flex-col items-center gap-2 text-center md:gap-3">
          <div className="mb-2 flex flex-wrap items-center justify-center gap-3">
            <span
              className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                isPlaying
                  ? "border border-accent/30 bg-accent/20 text-accent"
                  : "border border-white/10 bg-white/10 text-white/50"
              }`}
            >
              {isPlaying ? "正在播放" : "准备就绪"}
            </span>
            {currentTrack && currentSourceOwnerNickname ? (
              <span className="flex items-center gap-1 font-mono text-[10px] text-white/40">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                音源: <span className="text-white/70">{currentSourceOwnerNickname}</span>
              </span>
            ) : null}
          </div>

          <h2 className="max-w-[20ch] text-2xl font-extrabold leading-[1.08] tracking-tight text-white drop-shadow-lg md:text-4xl lg:text-5xl">
            {currentTrack?.title ?? "房间已空闲"}
          </h2>

          <p className="max-w-[28ch] text-sm font-medium tracking-wide text-white/60 md:text-lg">
            {currentTrack
              ? `${currentTrack.artist} · ${formatDuration(currentTrackDuration)}`
              : "请从曲库挑选或导入音频，开始这一场房间共听。"}
          </p>
        </div>
      </div>
    </section>
  );
}
