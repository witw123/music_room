import { memo, useEffect, useState } from "react";
import type {
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration, getOnlineMemberCount } from "@/lib/music-room-ui";
import type { RoomSocket } from "@/lib/ws-client";
import { VinylAuraVisualizer } from "./VinylAuraVisualizer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type RoomStageProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  host: RoomMember | undefined;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
  currentSourceOwnerNickname: string | null;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  iceConfigSource: string;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  socket: RoomSocket | null;
};



export function getSourceModeLabel(
  mediaConnectionState: RoomMediaConnectionState,
  currentTrack: TrackMeta | null
) {
  if (!currentTrack) {
    return "未选择歌曲";
  }

  if (!currentTrack.playbackAsset) {
    return "不支持的旧版曲目";
  }
  if (mediaConnectionState === "failed") {
    return "音源暂不可用";
  }
  if (mediaConnectionState === "connecting" || mediaConnectionState === "reconnecting") {
    return "正在连接音源";
  }
  if (mediaConnectionState === "buffering") return "等待 RTP Opus 媒体轨道";
  return "WebRTC RTP Opus 播放";
}



function RoomStageBase({
  roomSnapshot,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  host,
  canDeleteRoom,
  currentSourceOwnerNickname,
  mediaConnectionState,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom
}: RoomStageProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const compactStage = viewportHeight !== null && viewportHeight < 900;
  const ultraCompactStage = viewportHeight !== null && viewportHeight < 760;
  const onlineMemberCount = getOnlineMemberCount(roomSnapshot.room.members);

  const sourceModeLabel = getSourceModeLabel(mediaConnectionState, currentTrack);

  const handleCopyJoinCode = async () => {
    if (isCopying) return;
    setIsCopying(true);
    try {
      await onCopyJoinCode();
    } finally {
      window.setTimeout(() => setIsCopying(false), 1200);
    }
  };

  const handleDeleteRoom = async () => {
    setIsDeletingRoom(true);
    try {
      await onDeleteRoom();
      setShowDeleteConfirmation(false);
    } finally {
      setIsDeletingRoom(false);
    }
  };

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
      <div className="pointer-events-none absolute inset-0 -z-10 bg-accent/[0.035] blur-[110px]" />

      <div
        className={`relative z-30 flex w-full shrink-0 items-start justify-between gap-3 ${
          compactStage ? "mb-3" : "mb-5 sm:mb-6"
        }`}
      >
        <div className="min-w-0 space-y-2">
          <button
            data-testid="room-code-button"
            className="group flex max-w-full items-center gap-2"
            disabled={isCopying}
            onClick={() => void handleCopyJoinCode()}
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
            {isCopying ? <span className="text-[10px] text-accent">已复制</span> : null}
          </button>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] tracking-[0.18em] text-white/50">
            <span className="flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span data-testid="online-member-count">{onlineMemberCount}</span> 人在线
            </span>
            <span>·</span>
            <span>{roomSnapshot.room.visibility === "public" ? "公开房间" : "私密房间"}</span>
            {host ? (
              <>
                <span>·</span>
                <span>房主 {host.nickname}</span>
              </>
            ) : null}
            <span>·</span>
            <span>{sourceModeLabel}</span>
          </div>


        </div>

        <div className="relative shrink-0 pointer-events-auto">
          <Button
            data-testid="room-settings-button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70 backdrop-blur-md transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out hover:bg-white/15 hover:text-white sm:h-10 sm:w-10"
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
                data-testid="leave-room-button"
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
                    data-testid="delete-room-button"
                    className="my-1 w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                    onClick={() => {
                      setShowSettings(false);
                      setShowDeleteConfirmation(true);
                    }}
                    title="解散房间"
                    type="button"
                  >
                    解散房间
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-20 min-h-0 overflow-x-clip overflow-y-visible">
        <div
          className={`pointer-events-none flex h-full items-center justify-center ${
            ultraCompactStage ? "-translate-y-8" : compactStage ? "-translate-y-4" : ""
          }`}
        >
          <div className="group relative flex items-center justify-center">
            <VinylAuraVisualizer isPlaying={isPlaying} />

            <div
              className={`relative flex items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-[box-shadow,opacity,transform] duration-700 ease-out ${
                ultraCompactStage
                  ? "h-[clamp(7.5rem,20vh,9.5rem)] w-[clamp(7.5rem,20vh,9.5rem)]"
                  : compactStage
                    ? "h-[clamp(8rem,22vh,11rem)] w-[clamp(8rem,22vh,11rem)]"
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
              className={`absolute right-[clamp(-2.4rem,-5vh,-1rem)] top-[clamp(0.5rem,1.8vh,0.75rem)] flex h-[clamp(7rem,21vh,12rem)] w-[clamp(1.75rem,4.2vh,2rem)] origin-[14px_14px] flex-col items-center transition-transform duration-500 ease-out ${
                isPlaying ? "rotate-[20deg]" : "-rotate-[15deg]"
              }`}
              style={{ zIndex: 30 }}
            >
              <div className="absolute top-0 z-10 flex h-[clamp(1.75rem,4.2vh,2rem)] w-[clamp(1.75rem,4.2vh,2rem)] items-center justify-center rounded-full border-2 border-[#111] bg-gradient-to-br from-neutral-300 to-neutral-600 shadow-xl">
                <div className="h-[clamp(0.75rem,1.8vh,0.8rem)] w-[clamp(0.75rem,1.8vh,0.8rem)] rounded-full bg-[#111] shadow-inner" />
              </div>
              <div className="h-full w-[clamp(0.6rem,1.5vh,0.65rem)] bg-gradient-to-r from-neutral-400 via-neutral-200 to-neutral-500 pt-[clamp(1.75rem,4.2vh,2rem)] shadow-lg" />
              <div className="relative ml-[clamp(-0.9rem,-2vh,-0.75rem)] h-[clamp(2.25rem,5.4vh,2.5rem)] w-[clamp(1.25rem,3vh,1.5rem)] skew-x-[15deg] rounded-b-md border-b-2 border-accent bg-[#222] shadow-2xl">
                <div className="absolute right-0 top-2 h-2 w-2 rounded-full bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
              </div>
            </div>

            <div
              className={`absolute bottom-[clamp(-2.5rem,-5vh,-2rem)] left-1/2 h-[clamp(2rem,5vh,2.5rem)] w-[72%] -translate-x-1/2 bg-accent/20 blur-[45px] transition-[opacity,transform] duration-700 ease-out sm:w-[80%] ${
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
                      : "border border-white/10 bg-white/10 text-white/[0.55]"
                  }`}
                >
                  {isPlaying ? "正在播放" : "准备就绪"}
                </span>
                {currentSourceOwnerNickname ? (
                  <span className={`flex items-center gap-1 text-white/[0.45] ${compactStage ? "text-[9px]" : "text-[10px]"}`}>
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
                    ? "text-[1.55rem] leading-[1]"
                    : compactStage
                      ? "text-[1.85rem] leading-[1]"
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
      </div>
      <ConfirmDialog
        confirmLabel="解散房间"
        description="房间、队列和共享曲库状态将被删除，所有成员都会离开。此操作无法撤销。"
        destructive
        onCancel={() => setShowDeleteConfirmation(false)}
        onConfirm={() => void handleDeleteRoom()}
        open={showDeleteConfirmation}
        pending={isDeletingRoom}
        title="确认解散房间？"
      />
    </section>
  );
}

export const RoomStage = memo(RoomStageBase);
