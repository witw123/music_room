import { useEffect, useState, useTransition } from "react";
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
    return `已向 ${mediaConnectedPeersCount} 位成员分发音频`;
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
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const isSourceOwner =
    !!activeSession && activeSession.userId === roomSnapshot.room.playback.sourceSessionId;
  const compactStage = viewportHeight !== null && viewportHeight < 820;
  const ultraCompactStage = viewportHeight !== null && viewportHeight < 720;

  useEffect(() => {
    const updateViewportHeight = () => {
      setViewportHeight(window.innerHeight);
    };

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, []);

  return (
    <section
      className={`relative grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] px-4 sm:px-5 md:px-8 ${
        ultraCompactStage ? "py-2" : compactStage ? "py-3" : "py-4 sm:py-5 md:py-6"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-accent/5 to-transparent blur-[120px]" />

      <div
        className={`relative z-30 flex w-full shrink-0 items-start justify-between gap-3 ${
          compactStage ? "mb-3" : "mb-5 sm:mb-6"
        }`}
      >
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

      <div className="relative z-20 min-h-0 overflow-visible">
        <div
          className={`flex h-full items-center justify-center pointer-events-none ${
            ultraCompactStage ? "-translate-y-8" : compactStage ? "-translate-y-4" : ""
          }`}
        >
          <div className="group relative flex items-center justify-center">
            <div
              className={`relative flex items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-all duration-1000 ${
                ultraCompactStage
                  ? "h-[clamp(9.5rem,28vh,14rem)] w-[clamp(9.5rem,28vh,14rem)]"
                  : compactStage
                    ? "h-[clamp(10.5rem,31vh,17rem)] w-[clamp(10.5rem,31vh,17rem)]"
                    : "h-[clamp(11rem,34vh,20rem)] w-[clamp(11rem,34vh,20rem)]"
              } ${isPlaying ? "animate-spin-slow" : ""}`}
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
              <div className="relative z-10 flex h-[clamp(3.5rem,9vh,5rem)] w-[clamp(3.5rem,9vh,5rem)] items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner">
                <div className="h-[clamp(1rem,2.4vh,1.25rem)] w-[clamp(1rem,2.4vh,1.25rem)] rounded-full border border-white/5 bg-black shadow-inner" />
              </div>
            </div>

            <div
              className={`absolute right-[clamp(-2.4rem,-5vh,-1rem)] top-[clamp(0.5rem,1.8vh,0.75rem)] flex h-[clamp(7rem,21vh,12rem)] w-[clamp(1.75rem,4.2vh,2rem)] origin-[14px_14px] flex-col items-center transition-transform duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                isPlaying ? "rotate-[20deg]" : "-rotate-[15deg]"
              }`}
              style={{ zIndex: 30 }}
            >
              <div className="absolute top-0 z-10 flex h-[clamp(1.75rem,4.2vh,2rem)] w-[clamp(1.75rem,4.2vh,2rem)] items-center justify-center rounded-full border-2 border-[#111] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl">
                <div className="h-[clamp(0.75rem,1.8vh,0.8rem)] w-[clamp(0.75rem,1.8vh,0.8rem)] rounded-full bg-[#111] shadow-inner" />
              </div>
              <div className="h-full w-[clamp(0.6rem,1.5vh,0.65rem)] bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-[clamp(1.75rem,4.2vh,2rem)] shadow-lg" />
              <div className="ml-[clamp(-0.9rem,-2vh,-0.75rem)] h-[clamp(2.25rem,5.4vh,2.5rem)] w-[clamp(1.25rem,3vh,1.5rem)] skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#222] shadow-2xl">
                <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              </div>
            </div>

            <div
              className={`absolute bottom-[clamp(-2.5rem,-5vh,-2rem)] left-1/2 h-[clamp(2rem,5vh,2.5rem)] w-[72%] -translate-x-1/2 bg-accent/20 blur-[45px] transition-all duration-1000 sm:w-[80%] ${
                isPlaying ? "scale-110 opacity-100" : "scale-90 opacity-30"
              }`}
            />
          </div>
        </div>
      </div>

      <div
        className={`relative z-30 flex flex-col items-center pb-2 ${
          ultraCompactStage ? "gap-1.5 pt-0" : compactStage ? "gap-2 pt-1" : "gap-4 pt-4"
        }`}
      >
        <div className={`flex w-full flex-col items-center text-center ${compactStage ? "gap-1.5" : "gap-2 md:gap-3"}`}>
          {currentTrack ? (
            <>
              <div className={`flex flex-wrap items-center justify-center ${compactStage ? "mb-0.5 gap-1.5" : "mb-1 gap-2 sm:gap-3"}`}>
                <span
                  className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.22em] ${
                    isPlaying
                      ? "border border-accent/30 bg-accent/20 text-accent"
                      : "border border-white/10 bg-white/10 text-white/55"
                  }`}
                >
                  {isPlaying ? "正在播放" : "准备就绪"}
                </span>
                {currentSourceOwnerNickname ? (
                  <span className={`flex items-center gap-1 text-white/45 ${compactStage ? "text-[9px]" : "text-[10px]"}`}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    当前音源：<span className="text-white/70">{currentSourceOwnerNickname}</span>
                  </span>
                ) : null}
              </div>

              <h2
                className={`max-w-[18ch] font-extrabold tracking-tight text-white drop-shadow-lg ${
                  ultraCompactStage
                    ? "text-[2.2rem] leading-[0.96]"
                    : compactStage
                      ? "text-[2.7rem] leading-[0.98]"
                      : "text-2xl leading-[1.06] sm:text-3xl md:text-[38px] lg:text-[44px]"
                }`}
              >
                {currentTrack.title}
              </h2>
            </>
          ) : null}

          <p
            className={`font-medium tracking-wide text-white/60 ${
              ultraCompactStage
                ? "max-w-[24ch] text-[13px] leading-snug"
                : compactStage
                  ? "max-w-[24ch] text-[15px] leading-snug"
                  : "max-w-[26ch] text-sm leading-relaxed sm:text-base md:text-[17px]"
            }`}
          >
            {currentTrack
              ? `${currentTrack.artist} · ${formatDuration(currentTrackDuration)}`
              : "从曲库添加音乐，或导入本地音频，马上开始这场协作收听。"}
          </p>
        </div>

        <div className={`w-full ${ultraCompactStage ? "max-w-[460px]" : compactStage ? "max-w-[500px]" : "max-w-[540px]"}`}>
          <RoomChatOverlay
            roomId={roomSnapshot.room.id}
            activeSession={activeSession}
            socket={socket}
            compact={compactStage}
            ultraCompact={ultraCompactStage}
          />
        </div>
      </div>
    </section>
  );
}
