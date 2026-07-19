import { memo, useEffect, useState, type CSSProperties } from "react";
import type {
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration, getOnlineMemberCount } from "@/lib/music-room-ui";
import type { RoomSocket } from "@/lib/ws-client";
import { musicRoomApi } from "@/lib/music-room-api";
import { listRoomPlaylistTrackIndex, providerTrackKey } from "@/features/playlist/local-playlist";
import { getPlaybackEffectivePositionMs } from "@/features/playback/use-room-playback";
import { VinylAuraVisualizer } from "./VinylAuraVisualizer";
import { VinylTonearm } from "./VinylTonearm";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RoomLyricsPanel } from "./RoomLyricsPanel";

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
  onAwayRoom: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  isLyricsOpen: boolean;
  onToggleLyrics: () => void;
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
  onAwayRoom,
  onLeaveRoom,
  onDeleteRoom,
  isLyricsOpen
}: RoomStageProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeletingRoom, setIsDeletingRoom] = useState(false);
  const [lyricsText, setLyricsText] = useState<string | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [cachedArtworkUrl, setCachedArtworkUrl] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<{ height: number; width: number } | null>(null);
  const compactStage = viewportSize !== null && (viewportSize.height < 900 || viewportSize.width < 1024);
  const ultraCompactStage = viewportSize !== null && (viewportSize.height < 760 || viewportSize.width < 640);
  const onlineMemberCount = getOnlineMemberCount(roomSnapshot.room.members);
  const playback = roomSnapshot.room.playback;
  const [lyricsPositionMs, setLyricsPositionMs] = useState(playback.positionMs);
  const sourceProvider = currentTrack?.sourceRef?.provider ?? null;
  const sourceTrackId = currentTrack?.sourceRef?.trackId ?? null;
  const artworkUrl = currentTrack?.artworkUrl ?? cachedArtworkUrl;
  const recordSize = ultraCompactStage
    ? "clamp(9.5rem, min(26vh, 44vw), 12rem)"
    : compactStage
      ? "clamp(10rem, min(28vh, 42vw), 14rem)"
      : "clamp(12rem, min(36vh, 42vw), 20rem)";
  const stageContentOffset = isLyricsOpen
    ? "translate-y-0"
    : ultraCompactStage
      ? "-translate-y-3"
      : compactStage
        ? "-translate-y-[clamp(1.5rem,5vh,4rem)]"
        : "-translate-y-[clamp(2rem,5vh,4rem)]";

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
    let cancelled = false;
    if (!currentTrack) {
      setCachedArtworkUrl(null);
      return;
    }
    void listRoomPlaylistTrackIndex()
      .then((index) => {
        if (cancelled) return;
        const key = sourceProvider && sourceTrackId
          ? providerTrackKey(sourceProvider, sourceTrackId)
          : currentTrack.id;
        setCachedArtworkUrl(index.get(key)?.artworkUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setCachedArtworkUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack, sourceProvider, sourceTrackId]);

  useEffect(() => {
    const updateViewportHeight = () => {
      setViewportSize({ height: window.innerHeight, width: window.innerWidth });
    };

    updateViewportHeight();
    window.addEventListener("resize", updateViewportHeight);
    return () => window.removeEventListener("resize", updateViewportHeight);
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      setLyricsPositionMs(
        getPlaybackEffectivePositionMs(playback, currentTrackDuration)
      );
    };

    updatePosition();
    if (!isPlaying || playback.status !== "playing" || !playback.startedAt) return;

    const timer = window.setInterval(updatePosition, 250);
    return () => window.clearInterval(timer);
  }, [currentTrackDuration, isPlaying, playback]);

  useEffect(() => {
    if (!currentTrack) {
      setLyricsText(null);
      setLyricsStatus("idle");
      return;
    }

    let cancelled = false;
    setLyricsStatus("loading");
    setLyricsText(null);

    const loadLyrics = async () => {
      let localLyrics: string | null = null;
      try {
        const index = await listRoomPlaylistTrackIndex();
        const records = [...index.values()];
        const localRecord = index.get(currentTrack.id) ?? records.find((record) =>
          record.fileHash === currentTrack.fileHash ||
          (record.provider === sourceProvider && record.providerTrackId === sourceTrackId)
        );
        localLyrics = localRecord?.lyrics?.trim() || null;
      } catch {
        // A provider request below can still supply lyrics when local storage is unavailable.
      }
      if (localLyrics) {
        if (!cancelled) {
          setLyricsText(localLyrics);
          setLyricsStatus("ready");
        }
        return;
      }

      if (!sourceProvider || !sourceTrackId) {
        if (!cancelled) setLyricsStatus("ready");
        return;
      }

      const response = sourceProvider === "netease"
        ? await musicRoomApi.getNeteaseLyrics(sourceTrackId)
        : await musicRoomApi.getQqMusicLyrics(sourceTrackId);
      if (!cancelled) {
        setLyricsText(response.plainLyric?.trim() || null);
        setLyricsStatus("ready");
      }
    };

    void loadLyrics().catch(() => {
      if (!cancelled) setLyricsStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, [currentTrack, sourceProvider, sourceTrackId]);

  return (
    <section
      className={`relative flex h-full w-full min-h-0 flex-col px-3 sm:px-5 md:px-8 ${
        ultraCompactStage ? "py-2" : compactStage ? "py-3" : "py-4 sm:py-5 md:py-6"
      }`}
    >
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
                data-testid="away-room-button"
                className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-left text-sm text-amber-200 transition-colors hover:bg-amber-300/10 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                onClick={() => {
                  setShowSettings(false);
                  onAwayRoom();
                }}
                type="button"
              >
                暂离房间
              </button>
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

      <div className="relative z-20 flex min-h-0 flex-1 flex-col items-center overflow-visible">
        <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-visible">
          <div className={`flex min-h-0 w-full max-w-[48rem] flex-col items-center justify-center overflow-visible px-1 ${stageContentOffset}`}>
            {!isLyricsOpen ? (
              <div
                className="relative flex h-[var(--record-size)] min-h-0 w-full shrink-0 items-center justify-center"
              >
          <div
            className="pointer-events-none relative flex min-h-0 w-full items-center justify-center"
            style={{ "--record-size": recordSize, height: "var(--record-size)" } as CSSProperties}
          >
            <VinylAuraVisualizer isPlaying={isPlaying} />

            <div
              className="relative flex items-center justify-center overflow-visible"
              style={{ width: "var(--record-size)", height: "var(--record-size)" }}
            >
              <div
                className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-[box-shadow,opacity,transform] duration-700 ease-out animate-spin-slow"
                style={{ animationPlayState: isPlaying ? "running" : "paused" }}
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
                {artworkUrl ? (
                  <div
                    aria-hidden="true"
                    className="absolute z-10 aspect-square w-[48%] overflow-hidden rounded-full border border-white/10 bg-cover bg-center shadow-[0_0_24px_rgba(0,0,0,0.35)]"
                    style={{ backgroundImage: `url("${artworkUrl}")` }}
                  />
                ) : null}
                <div className="absolute z-20 flex aspect-square items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-accent/20 to-blue-500/20 shadow-inner" style={{ width: "26%", height: "26%" }}>
                  <div className="rounded-full border border-white/5 bg-black shadow-inner" style={{ width: "32%", height: "32%" }} />
                </div>
              </div>
              <VinylTonearm isPlaying={isPlaying} />
            </div>

          </div>
              </div>
            ) : null}
            {!isLyricsOpen ? (
              <div
                className={`relative z-30 flex shrink-0 flex-col items-center text-center ${
                  ultraCompactStage ? "gap-3 pt-4" : compactStage ? "gap-4 pt-5" : "gap-5 pt-6 sm:gap-6 sm:pt-7"
                }`}
              >
                {currentTrack ? (
                  <>
                    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-3">
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

                    <p
                      className={`font-medium tracking-wide text-white/60 ${
                        ultraCompactStage
                          ? "max-w-[24ch] text-[13px] leading-snug"
                          : compactStage
                            ? "max-w-[24ch] text-[15px] leading-snug"
                            : "max-w-[26ch] text-sm leading-relaxed sm:text-base md:text-[17px]"
                      }`}
                    >
                      {`${currentTrack.artist} · ${formatDuration(currentTrackDuration)}`}
                    </p>
                  </>
                ) : (
                  <p className="max-w-[26ch] text-center text-sm leading-relaxed text-white/60 sm:text-base">
                    从曲库添加音乐，或导入本地音频，马上开始这场协作收听。
                  </p>
                )}
              </div>
            ) : null}

            <RoomLyricsPanel
              className={isLyricsOpen ? "max-w-[42rem]" : "max-w-[36rem]"}
              visibleLines={isLyricsOpen ? 5 : 3}
              isPlaying={isPlaying}
              lyrics={lyricsText}
              positionMs={lyricsPositionMs}
              status={lyricsStatus}
            />
          </div>
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
