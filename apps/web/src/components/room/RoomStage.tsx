import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta,
  UpdateRoomRequest
} from "@music-room/shared";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { listRoomPlaylistTrackIndex, providerTrackKey } from "@/features/playlist/local-playlist";
import { getPlaybackEffectivePositionMs } from "@/features/playback/use-room-playback";
import { VinylAuraVisualizer } from "./VinylAuraVisualizer";
import { VinylTonearm } from "./VinylTonearm";
import { RoomControlHeader, getSourceModeLabel } from "./RoomControlHeader";
export { getSourceModeLabel };
import { RoomLyricsPanel } from "./RoomLyricsPanel";
import { hasWordSyncedRoomLyrics, selectRoomLyrics } from "@/features/playback/lyrics";
import { getArtworkSourceUrl, useArtworkPalette } from "@/components/bottom-player/artwork-colors";
import { resolvePreferredArtworkUrl } from "@/components/bottom-player/preferred-artwork";
import { SquareAlbumCover } from "@/components/PlayerArtwork";
import { usePlayerStyle } from "@/features/settings/use-player-style";
import type { RoomPlaybackBarrierClock } from "@/features/playback/room-playback-clock";
import { RoomReactionOverlay } from "./RoomReactionOverlay";
import { RoomReactionToolbar } from "./RoomReactionToolbar";
import type { RoomSocket } from "@/lib/network/ws-client";

type RoomStageProps = {
  roomSnapshot: RoomSnapshot;
  playbackBarrier?: RoomPlaybackBarrierClock | null;
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
  onShareRoom: () => Promise<void>;
  onAwayRoom: () => void;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onUpdateRoom: (input: UpdateRoomRequest) => Promise<boolean>;
  onSeek: (positionMs: number) => void;
  showMobilePlayer?: boolean;
  hideRoomMetadata?: boolean;
  mobileControlsOnly?: boolean;
  socket?: RoomSocket | null;
};

function RoomStageBase({
  roomSnapshot,
  playbackBarrier,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  host,
  canDeleteRoom,
  canDisbandRoom,
  currentSourceOwnerNickname,
  mediaConnectionState,
  onCopyJoinCode,
  onShareRoom,
  onAwayRoom,
  onLeaveRoom,
  onDeleteRoom,
  onUpdateRoom,
  onSeek,
  showMobilePlayer = false,
  hideRoomMetadata = false,
  mobileControlsOnly = false,
  socket
}: RoomStageProps) {
  const currentTrackId = currentTrack?.id ?? null;

  const [lyricsText, setLyricsText] = useState<string | null>(null);
  const [translatedLyricsText, setTranslatedLyricsText] = useState<string | null>(null);
  const [romanizedLyricsText, setRomanizedLyricsText] = useState<string | null>(null);
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [cachedArtworkUrl, setCachedArtworkUrl] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<{ height: number; width: number } | null>(null);
  const compactStage = viewportSize !== null && (viewportSize.height < 900 || viewportSize.width < 1024);
  const ultraCompactStage = viewportSize !== null && (viewportSize.height < 760 || viewportSize.width < 640);
  const playback = roomSnapshot.room.playback;
  const playbackPositionMs = playback.positionMs;
  const playbackStartedAt = playback.startedAt;
  const playbackStartAt = playback.startAt;
  const playbackStatus = playback.status;
  const playbackRevision = playback.playbackRevision;
  const barrierBlocked = playbackBarrier?.blocked;
  const barrierHoldPositionMs = playbackBarrier?.holdPositionMs;
  const barrierResumeAtMs = playbackBarrier?.resumeAtMs;
  const playbackPositionKey = [
    playbackPositionMs,
    playbackStartedAt ?? "",
    playbackStartAt ?? "",
    playbackStatus,
    playbackRevision
  ].join("|");
  const playbackBarrierKey = [
    barrierBlocked ? "blocked" : "ready",
    barrierHoldPositionMs ?? "",
    barrierResumeAtMs ?? ""
  ].join("|");
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const playbackBarrierRef = useRef(playbackBarrier);
  playbackBarrierRef.current = playbackBarrier;
  const [lyricsPositionMs, setLyricsPositionMs] = useState(playback.positionMs);
  const sourceProvider = currentTrack?.sourceRef?.provider ?? null;

  const sourceTrackId = currentTrack?.sourceRef?.trackId ?? null;
  const currentTrackFileHash = currentTrack?.fileHash ?? null;
  const currentTrackLyrics = currentTrack?.lyrics?.trim() || null;
  const currentTrackTranslatedLyrics = currentTrack?.translatedLyrics?.trim() || null;
  const currentTrackRomanizedLyrics = currentTrack?.romanizedLyrics?.trim() || null;
  const artworkUrl = resolvePreferredArtworkUrl(cachedArtworkUrl, currentTrack?.artworkUrl)
    ?? cachedArtworkUrl
    ?? null;
  const artworkPalette = useArtworkPalette(artworkUrl);
  const playerStyle = usePlayerStyle();
  const recordSize = ultraCompactStage
    ? "clamp(9.5rem, min(26vh, 44vw), 12rem)"
    : compactStage
      ? "clamp(10rem, min(28vh, 42vw), 14rem)"
      : "clamp(12rem, min(36vh, 42vw), 20rem)";
  const stageContentOffset = hideRoomMetadata
      ? "translate-y-0"
    : ultraCompactStage
      ? "-translate-y-3"
      : compactStage
        ? "-translate-y-[clamp(1.5rem,5vh,4rem)]"
        : "-translate-y-[clamp(2rem,5vh,4rem)]";

  useEffect(() => {
    let cancelled = false;
    if (!currentTrackId) {
      setCachedArtworkUrl(null);
      return;
    }
    void listRoomPlaylistTrackIndex()
      .then((index) => {
        if (cancelled) return;
        const key = sourceProvider && sourceTrackId
          ? providerTrackKey(sourceProvider, sourceTrackId)
          : currentTrackId;
        setCachedArtworkUrl(index.get(key)?.artworkUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setCachedArtworkUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrackId, sourceProvider, sourceTrackId]);

  useEffect(() => {
    const updateViewportSize = () => {
      const viewport = window.visualViewport;
      setViewportSize({
        height: viewport?.height ?? window.innerHeight,
        width: viewport?.width ?? window.innerWidth
      });
    };

    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    window.visualViewport?.addEventListener("resize", updateViewportSize);
    return () => {
      window.removeEventListener("resize", updateViewportSize);
      window.visualViewport?.removeEventListener("resize", updateViewportSize);
    };
  }, []);

  useEffect(() => {
    const updatePosition = () => {
      setLyricsPositionMs(
        getPlaybackEffectivePositionMs(
          playbackRef.current,
          currentTrackDuration,
          undefined,
          playbackBarrierRef.current
        )
      );
    };

    updatePosition();
    if (
      !isPlaying ||
      playbackRef.current.status !== "playing" ||
      (!playbackRef.current.startedAt && !playbackRef.current.startAt && playbackBarrierRef.current?.holdPositionMs === null)
    ) return;

    const timer = window.setInterval(updatePosition, 50);
    return () => window.clearInterval(timer);
  }, [
    currentTrackDuration,
    isPlaying,
    playbackPositionKey,
    playbackBarrierKey
  ]);

  useEffect(() => {
    if (!currentTrackId) {
      setLyricsText(null);
      setTranslatedLyricsText(null);
      setRomanizedLyricsText(null);
      setLyricsStatus("idle");
      return;
    }

    let cancelled = false;
    setLyricsStatus("loading");
    setLyricsText(null);
    setTranslatedLyricsText(currentTrackTranslatedLyrics);
    setRomanizedLyricsText(currentTrackRomanizedLyrics);

    const loadLyrics = async () => {
      let localLyrics = currentTrackLyrics;
      try {
        if (!localLyrics) {
          const index = await listRoomPlaylistTrackIndex();
          const records = [...index.values()];
          const localRecord = index.get(currentTrackId) ?? records.find((record) =>
            record.fileHash === currentTrackFileHash ||
            (record.provider === sourceProvider && record.providerTrackId === sourceTrackId)
          );
          localLyrics = localRecord?.lyrics?.trim() || null;
        }
      } catch {
        // A provider request below can still supply lyrics when local storage is unavailable.
      }
      if (localLyrics && (hasWordSyncedRoomLyrics(localLyrics) || !sourceProvider || !sourceTrackId)) {
        if (!cancelled) {
          setLyricsText(localLyrics);
          setLyricsStatus("ready");
        }
        if (!sourceProvider || !sourceTrackId) return;
      }

      if (!sourceProvider || !sourceTrackId) {
        if (!cancelled) setLyricsStatus("ready");
        return;
      }

      try {
        const response = sourceProvider === "netease"
          ? await musicRoomApi.getNeteaseLyrics(sourceTrackId)
          : await musicRoomApi.getQqMusicLyrics(sourceTrackId);
        if (!cancelled) {
          setLyricsText(selectRoomLyrics({
            localLyrics,
            wordSyncedLyric: response.wordSyncedLyric,
            plainLyric: response.plainLyric
          }));
          setTranslatedLyricsText(response.translatedLyric?.trim() || null);
          setRomanizedLyricsText(response.romanizedLyric?.trim() || null);
          setLyricsStatus("ready");
        }
      } catch (error) {
        if (localLyrics && !cancelled) {
          setLyricsText(localLyrics);
          setLyricsStatus("ready");
          return;
        }
        throw error;
      }
    };

    void loadLyrics().catch(() => {
      if (!cancelled) setLyricsStatus("error");
    });

    return () => {
      cancelled = true;
    };
  }, [currentTrackFileHash, currentTrackId, currentTrackLyrics, currentTrackRomanizedLyrics, currentTrackTranslatedLyrics, sourceProvider, sourceTrackId]);

  return (
    <section
      className={`relative flex h-auto w-full min-h-0 flex-col px-3 pb-3 ${hideRoomMetadata ? "pt-[calc(0.75rem+env(safe-area-inset-top))]" : "pt-[calc(2.25rem+env(safe-area-inset-top))]"} ${mobileControlsOnly ? "max-lg:pb-0 max-lg:pt-3" : ""} sm:px-5 md:px-8 lg:h-full ${
        ultraCompactStage ? "lg:py-2" : compactStage ? "lg:py-3" : "lg:py-4 xl:py-5"
      }`}
    >
      <RoomControlHeader
        roomSnapshot={roomSnapshot}
        mediaConnectionState={mediaConnectionState}
        currentTrack={currentTrack}
        host={host}
        canDeleteRoom={canDeleteRoom}
        canDisbandRoom={canDisbandRoom}
        onCopyJoinCode={onCopyJoinCode}
        onShareRoom={onShareRoom}
        onAwayRoom={onAwayRoom}
        onLeaveRoom={onLeaveRoom}
        onDeleteRoom={onDeleteRoom}
        onUpdateRoom={onUpdateRoom}
        hideRoomMetadata={hideRoomMetadata}
        className={
          hideRoomMetadata && !mobileControlsOnly
            ? "absolute right-3 top-[calc(0.75rem+env(safe-area-inset-top))] sm:right-5 md:right-8 z-30"
            : mobileControlsOnly
              ? `relative z-30 ${compactStage ? "mb-0 lg:mb-3" : "mb-0 lg:mb-5 xl:mb-6"}`
              : `relative z-30 ${compactStage ? "mb-0 lg:mb-3" : "mb-0 lg:mb-5 xl:mb-6"}`
        }
      />

      {showMobilePlayer ? (
        <MobileRoomStagePlayer
          artworkPalette={artworkPalette}
          artworkUrl={artworkUrl}
          currentTrack={currentTrack}
          currentTrackDuration={currentTrackDuration}
          isPlaying={isPlaying}
          playbackBarrier={playbackBarrier}
          playerStyle={playerStyle}
          progressMs={lyricsPositionMs}
        />
      ) : null}

      <div className={`relative z-20 flex min-h-0 flex-1 flex-col items-center overflow-visible ${showMobilePlayer ? "hidden lg:flex" : ""}`}>
        <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-visible">
          <div className={`flex min-h-0 w-full max-w-[48rem] flex-col items-center justify-center overflow-visible px-1 ${stageContentOffset}`}>
            <div
                className="relative flex h-[var(--record-size)] min-h-0 w-full shrink-0 items-center justify-center"
                data-room-stage-record="true"
              >
                <div
                  className="pointer-events-none relative flex min-h-0 w-full items-center justify-center"
                  data-room-stage-record-surface="true"
                  style={{ "--record-size": recordSize, height: "var(--record-size)" } as CSSProperties}
                >
                  <div
                    className="relative flex items-center justify-center overflow-visible"
                    style={{ width: "var(--record-size)", height: "var(--record-size)" }}
                  >
                    {playerStyle === "square-cover" ? (
                      <SquareAlbumCover artworkUrl={artworkUrl} className="h-full w-full rounded-[1rem] shadow-2xl" />
                    ) : (
                      <>
                        <VinylAuraVisualizer
                          accentColor={artworkPalette.accent}
                          frozen={playbackBarrier?.blocked === true}
                          isPlaying={isPlaying}
                        />
                        <div
                          className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-white/5 bg-gradient-to-tr from-[#020202] via-[#111111] to-[#1a1a1a] shadow-2xl transition-[box-shadow,opacity,transform] duration-700 ease-out animate-spin-slow"
                          style={{ animationPlayState: isPlaying ? "running" : "paused" }}
                        >
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.1),transparent_40%)]" />
                          <div
                            className="absolute inset-0 rounded-full"
                            style={{
                              background: `conic-gradient(from 0deg at 50% 50%, ${artworkPalette.accentSoft} 0deg, transparent 90deg, ${artworkPalette.accentSoft} 180deg, transparent 270deg, ${artworkPalette.accentSoft} 360deg)`
                            }}
                          />
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
                              style={{ backgroundImage: `url("${getArtworkSourceUrl(artworkUrl)}")` }}
                            />
                          ) : null}
                          <div
                            className="absolute z-20 flex aspect-square items-center justify-center rounded-full border shadow-inner"
                            style={{
                              width: "26%",
                              height: "26%",
                              borderColor: artworkPalette.border,
                              backgroundColor: artworkPalette.accentSoft
                            }}
                          >
                            <div className="rounded-full border border-white/5 bg-black shadow-inner" style={{ width: "32%", height: "32%" }} />
                          </div>
                        </div>
                        <VinylTonearm
                          accentColor={artworkPalette.accent}
                          frozen={playbackBarrier?.blocked === true}
                          isPlaying={isPlaying}
                        />
                      </>
                    )}
                  </div>

                </div>
              </div>
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
                        {playbackBarrier?.blocked ? "缓存中" : isPlaying ? "正在播放" : "准备就绪"}
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

            <RoomLyricsPanel
              className="max-w-[36rem]"
              frozen={playbackBarrier?.blocked === true}
              visibleLines={3}
              fontScale="medium"
              isPlaying={isPlaying}
              lyrics={lyricsText}
              translatedLyrics={translatedLyricsText}
              romanizedLyrics={romanizedLyricsText}
              showControls={false}
              showTranslation={false}
              showRomanized={false}
              positionMs={lyricsPositionMs}
              status={lyricsStatus}
              onSeek={onSeek}
            />

            {/* Interactive Room Reaction Bar */}
            {roomSnapshot.room.roomType === "interactive" && (
              <div className="mt-3 flex justify-center">
                <RoomReactionToolbar
                  roomId={roomSnapshot.room.id}
                  socket={socket}
                  variant="interactive"
                />
              </div>
            )}
          </div>
        </div>

        {/* Floating Vector SVG Reaction Overlay */}
        <RoomReactionOverlay roomId={roomSnapshot.room.id} socket={socket} />
      </div>
    </section>
  );
}

export const RoomStage = memo(RoomStageBase);

function MobileRoomStagePlayer({
  artworkPalette,
  artworkUrl,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  playbackBarrier,
  playerStyle,
  progressMs
}: {
  artworkPalette: ReturnType<typeof useArtworkPalette>;
  artworkUrl: string | null;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  playbackBarrier?: RoomPlaybackBarrierClock | null;
  playerStyle: ReturnType<typeof usePlayerStyle>;
  progressMs: number;
}) {
  const boundedProgressMs = currentTrackDuration > 0
    ? Math.min(Math.max(0, progressMs), currentTrackDuration)
    : 0;
  const progressPercent = currentTrackDuration > 0
    ? Math.round((boundedProgressMs / currentTrackDuration) * 100)
    : 0;
  const playbackLabel = playbackBarrier?.blocked ? "缓存中" : isPlaying ? "正在播放" : "准备就绪";

  return <div className="relative z-20 flex min-h-[22rem] flex-1 flex-col items-center justify-center px-5 pb-7 pt-4 text-center lg:hidden" data-room-mobile-player="true">
    <div className="relative flex w-full max-w-[22rem] flex-col items-center">
      <div className="relative aspect-square w-[min(56vw,15rem)]">
        {playerStyle === "square-cover" ? (
          <SquareAlbumCover artworkUrl={artworkUrl} className="h-full w-full rounded-2xl border border-white/10 shadow-[0_18px_44px_rgba(0,0,0,0.38)]" />
        ) : (
          <div className="relative flex h-full w-full items-center justify-center rounded-full border border-white/10 bg-black shadow-[0_18px_44px_rgba(0,0,0,0.38)]">
            <div className="absolute inset-[7%] overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
              {artworkUrl ? <div aria-hidden="true" className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url("${getArtworkSourceUrl(artworkUrl)}")` }} /> : <div className="flex h-full w-full items-center justify-center text-xs text-white/45">音乐</div>}
            </div>
            <div className="relative z-10 h-[18%] w-[18%] rounded-full border border-white/15 bg-black" style={{ boxShadow: `0 0 0 0.6rem ${artworkPalette.accentSoft}` }} />
          </div>
        )}
        <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap border px-2.5 py-1 font-mono text-[10px] font-semibold" style={{ borderColor: artworkPalette.border, backgroundColor: artworkPalette.accentSoft, color: artworkPalette.accent }}>{playbackLabel}</span>
      </div>

      <div className="mt-7 min-w-0 w-full">
        <h2 className="mx-auto max-w-[22ch] truncate text-xl font-semibold text-white">{currentTrack?.title ?? "等待节目开始"}</h2>
        <p className="mx-auto mt-1 max-w-[28ch] truncate text-sm text-white/60">{currentTrack ? `${currentTrack.artist}${currentTrack.album ? ` · ${currentTrack.album}` : ""}` : "主持人准备好节目后会在这里播放"}</p>
        <div className="mt-5 h-px w-full overflow-hidden bg-white/10"><div className="h-full transition-[width] duration-200" style={{ width: `${progressPercent}%`, backgroundColor: artworkPalette.accent }} /></div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-white/45"><span>{formatDuration(boundedProgressMs)}</span><span>{formatDuration(currentTrackDuration)}</span></div>
      </div>
    </div>
  </div>;
}
