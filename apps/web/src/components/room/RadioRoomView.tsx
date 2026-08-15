"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { MembersPanel } from "./MembersPanel";
import { RoomChatPanel } from "./RoomChatOverlay";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomStage } from "./RoomStage";
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";
import { LocalAudioImport } from "./LocalAudioImport";
import { LocalStorageTabPanel } from "./LocalStorageTabPanel";
import { useRadioAutopilot, type RadioAutopilotNextTrack } from "./hooks/use-radio-autopilot";

type ProviderCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;
type RadioScrollRegionId = "library" | "stage" | "host" | "chat" | "members";

export function RadioRoomView(props: RoomDashboardViewProps) {
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const [activeScrollRegion, setActiveScrollRegion] = useState<RadioScrollRegionId | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const redirectWheelToPage = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-radio-scroll-region]")
      : null;
    const regionId = target?.dataset.radioScrollRegion as RadioScrollRegionId | undefined;
    if (!regionId || regionId === activeScrollRegion) return;

    event.preventDefault();
    pageRef.current?.scrollBy({ left: event.deltaX, top: event.deltaY });
  }, [activeScrollRegion]);

  useEffect(() => {
    const timer = window.setInterval(() => setMembershipNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hide-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-0" data-room-view="radio" onPointerDown={(event) => { if (event.target === event.currentTarget) setActiveScrollRegion(null); }} onWheelCapture={redirectWheelToPage} ref={pageRef}>
      <section className="mx-auto grid w-full max-w-[1600px] lg:h-full lg:min-h-full lg:grid-cols-[minmax(20rem,38fr)_minmax(0,62fr)]">
        <RadioScrollRegion
          activeRegion={activeScrollRegion}
          className="order-2 lg:order-1 lg:min-h-0"
          id="library"
          onActivate={setActiveScrollRegion}
        >
          <RadioLibraryList
            currentTrack={props.currentTrack}
            isHost={isHost}
            onAddToQueue={props.onAddToQueue}
            roomTracks={props.roomSnapshot.tracks}
          />
        </RadioScrollRegion>
        <RadioScrollRegion activeRegion={activeScrollRegion} className="order-1 min-h-[30rem] border-b border-surface-border bg-surface/[0.12] lg:order-2 lg:h-full lg:min-h-0 lg:border-b-0 lg:border-l" id="stage" onActivate={setActiveScrollRegion}>
          <RoomStage {...buildRoomStageProps(props, { hideRoomMetadata: true, showMobilePlayer: true })} />
        </RadioScrollRegion>
      </section>

      <section className={`mx-auto grid w-full max-w-[1600px] border-t border-surface-border ${isHost ? "lg:grid-cols-[minmax(20rem,38fr)_minmax(20rem,34fr)_minmax(18rem,28fr)]" : "lg:grid-cols-[minmax(0,62fr)_minmax(18rem,38fr)]"}`}>
        {isHost ? <RadioScrollRegion activeRegion={activeScrollRegion} className="min-w-0 border-b border-surface-border bg-background lg:border-b-0" id="host" onActivate={setActiveScrollRegion}><HostBroadcastDesk {...props} /></RadioScrollRegion> : null}
        <RadioCommunityPanels {...props} activeScrollRegion={activeScrollRegion} membershipNow={membershipNow} onActivateScrollRegion={setActiveScrollRegion} />
      </section>
    </div>
  );
}

function RadioLibraryList({
  currentTrack,
  isHost,
  onAddToQueue,
  roomTracks,
}: {
  currentTrack: TrackMeta | null;
  isHost: boolean;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  roomTracks: TrackMeta[];
}) {
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const addTrackToQueue = async (trackId: string) => {
    if (pendingTrackId) return;
    setPendingTrackId(trackId);
    setErrorMessage(null);
    try {
      await onAddToQueue(trackId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌曲未能加入队列，请稍后重试。");
    } finally {
      setPendingTrackId(null);
    }
  };

  return (
    <aside className="flex min-h-[22rem] min-w-0 flex-col bg-surface/[0.14] lg:h-full lg:min-h-0" data-testid="radio-library-list">
      <header className="shrink-0 px-4 py-5 sm:px-6 lg:px-7">
        <h1 className="text-xl font-semibold text-foreground">曲库单</h1>
      </header>
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6 lg:px-7">
        <div className="space-y-1">
          {roomTracks.map((track, index) => <LibraryTrack key={track.id} index={index + 1} isCurrent={track.id === currentTrack?.id} isHost={isHost} onAddToQueue={addTrackToQueue} pending={pendingTrackId === track.id} track={track} />)}
        </div>
        {errorMessage ? <p className="mt-3 text-xs text-danger" role="status">{errorMessage}</p> : null}
      </div>
    </aside>
  );
}

function RadioCommunityPanels(props: RoomDashboardViewProps & {
  activeScrollRegion: RadioScrollRegionId | null;
  membershipNow: number;
  onActivateScrollRegion: (region: RadioScrollRegionId) => void;
}) {
  const [mobileTab, setMobileTab] = useState<"chat" | "members">("chat");
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const chatDesktopDivider = isHost ? "lg:border-l" : "";

  return (
    <>
      <div className="col-span-full border-b border-surface-border bg-background px-4 py-3 lg:hidden">
        <div aria-label="电台社区" className="grid grid-cols-2 border border-surface-border p-1" role="tablist">
          <button aria-controls="radio-chat" aria-selected={mobileTab === "chat"} className={`min-h-10 px-3 text-sm font-medium transition-colors ${mobileTab === "chat" ? "bg-accent text-white" : "text-foreground-muted"}`} onClick={() => setMobileTab("chat")} role="tab" type="button">聊天</button>
          <button aria-controls="radio-members" aria-selected={mobileTab === "members"} className={`min-h-10 px-3 text-sm font-medium transition-colors ${mobileTab === "members" ? "bg-accent text-white" : "text-foreground-muted"}`} onClick={() => setMobileTab("members")} role="tab" type="button">成员</button>
        </div>
      </div>
      <RadioScrollRegion activeRegion={props.activeScrollRegion} className={`${mobileTab === "chat" ? "block border-b border-surface-border bg-background lg:border-b-0" : "hidden border-b border-surface-border bg-background lg:block lg:border-b-0"} ${chatDesktopDivider}`} id="chat" onActivate={props.onActivateScrollRegion}>
        <div id="radio-chat" role="tabpanel"><RoomChatPanel activeSession={props.activeSession} roomId={props.roomSnapshot.room.id} socket={props.socket} /></div>
      </RadioScrollRegion>
      <RadioScrollRegion activeRegion={props.activeScrollRegion} className={mobileTab === "members" ? "block border-surface-border bg-background lg:border-l" : "hidden border-surface-border bg-background lg:block lg:border-l"} id="members" onActivate={props.onActivateScrollRegion}>
        <section className="min-h-[24rem] bg-surface/25" id="radio-members" role="tabpanel">
          <header className="px-4 py-4 sm:px-5"><h2 className="text-base font-semibold text-foreground">成员</h2></header>
          <div className="p-3 sm:p-4"><MembersPanel activeSessionId={props.activeSession?.userId ?? null} isHost={props.roomSnapshot.room.hostId === props.activeSession?.userId} members={props.roomSnapshot.room.members} now={props.membershipNow} onRemoveMember={props.onRemoveMember} onUpdateMemberPermissions={props.onUpdateMemberPermissions} /></div>
        </section>
      </RadioScrollRegion>
    </>
  );
}

function HostBroadcastDesk(props: RoomDashboardViewProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<"local" | "playlists">("local");
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const isAutopilotEnabled = props.roomSnapshot.room.radioAutopilot?.enabled === true;
  const currentProviderTrack = props.currentTrack?.sourceRef &&
    (props.currentTrack.sourceType === "netease" || props.currentTrack.sourceType === "qqmusic")
    ? props.currentTrack
    : null;
  const autopilot = useRadioAutopilot({
    roomSnapshot: props.roomSnapshot,
    isHost,
    onImportNeteaseTrack: props.onImportNeteaseTrack,
    onImportQqMusicTrack: props.onImportQqMusicTrack,
    onRefreshRoom: props.onRefreshRoom
  });

  const importAndQueue = async (candidate: ProviderCandidate) => {
    setMessage(null);
    if (candidate.provider === "netease") {
      await props.onImportNeteaseTrack(candidate);
    } else {
      await props.onImportQqMusicTrack(candidate);
    }

    const snapshot = await musicRoomApi.getRoom(props.roomSnapshot.room.id);
    const track = snapshot.tracks.find((item) =>
      item.sourceRef?.provider === candidate.provider && item.sourceRef.trackId === candidate.providerTrackId
    );
    if (!track) throw new Error("歌曲已导入，但尚未同步到节目单。请稍后重试。");
    if (snapshot.queue.some((item) => item.trackId === track.id)) {
      setMessage(`《${track.title}》已在队列中。`);
      return;
    }

    const queuedItem = await props.onAddToQueue(track.id);
    if (!queuedItem) throw new Error("歌曲已导入，但未能加入队列。请稍后重试。");
    setMessage(`《${track.title}》已加入队列。`);
  };

  const toggleAutopilot = async () => {
    setMessage(null);
    try {
      await musicRoomApi.updateRadioAutopilot(props.roomSnapshot.room.id, { enabled: !isAutopilotEnabled });
      await props.onRefreshRoom();
      setMessage(isAutopilotEnabled ? "自动续播已停止。" : "自动续播已开启。房主页面会根据当前歌曲补足节目单。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动续播设置失败。请稍后重试。");
    }
  };

  return (
    <aside className="min-w-0 px-4 pb-6 pt-4 sm:px-5 lg:pb-7" data-testid="radio-host-console">
      <div>
        <h2 className="text-base font-semibold text-foreground">主持人控制台</h2>
      </div>
      <section className="mt-5 border-l-2 border-accent/50 pl-4" data-testid="radio-autopilot">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">自动续播</h3>
        </div>
        {currentProviderTrack ? <p className="mt-1 truncate text-xs text-foreground-muted">{currentProviderTrack.title} · {currentProviderTrack.artist}</p> : null}
        {autopilot.nextTrack ? <RadioAutopilotNextTrackCard track={autopilot.nextTrack} /> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={!isAutopilotEnabled && !currentProviderTrack} onClick={() => void toggleAutopilot()} size="sm" type="button" variant={isAutopilotEnabled ? "outline" : "default"}>{isAutopilotEnabled ? "停止自动续播" : "开启自动续播"}</Button>
          {autopilot.state.kind === "paused" && currentProviderTrack ? <Button onClick={() => void autopilot.retry()} size="sm" type="button" variant="outline">重试补歌</Button> : null}
        </div>
        {autopilot.state.message ? <p className={`mt-3 text-xs leading-5 ${autopilot.state.kind === "paused" ? "text-amber-200" : "text-foreground-muted"}`} role="status">{autopilot.state.message}</p> : null}
      </section>
      <div className="mt-6">
        <RoomProviderTrackSearch canManageLibrary hideUnavailableProvidersNotice mode="program" onImportNeteaseTrack={importAndQueue} onImportQqMusicTrack={importAndQueue} roomTracks={props.roomSnapshot.tracks} surface="plain" testId="radio-room-program" />
      </div>
      <section className="mt-6 border-t border-surface-border pt-5" data-testid="radio-room-imports">
        <h3 className="text-sm font-semibold text-foreground">导入歌曲</h3>
        <div aria-label="导入歌曲方式" className="mt-3 grid grid-cols-2 rounded-xl border border-surface-border p-1" role="tablist">
          <button aria-controls="radio-import-local" aria-selected={importTab === "local"} className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${importTab === "local" ? "bg-accent text-white" : "text-foreground-muted hover:text-foreground"}`} onClick={() => setImportTab("local")} role="tab" type="button">本地音频</button>
          <button aria-controls="radio-import-playlists" aria-selected={importTab === "playlists"} className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${importTab === "playlists" ? "bg-accent text-white" : "text-foreground-muted hover:text-foreground"}`} onClick={() => setImportTab("playlists")} role="tab" type="button">我的歌单</button>
        </div>
        <div className="mt-4">
          {importTab === "local" ? (
            <div id="radio-import-local" role="tabpanel">
              <LocalAudioImport onFilesSelected={props.onFilesSelected} testId="radio-track-upload-input" />
            </div>
          ) : (
            <div id="radio-import-playlists" role="tabpanel">
              <LocalStorageTabPanel
                activeSession={props.activeSession}
                canManageLibrary
                hideUnavailableProvidersNotice
                localStorageSummary={props.localStorageSummary}
                onCleanLocalStorage={props.onCleanLocalStorage}
                onDeletePlaylist={props.onDeletePlaylist}
                onImportCachedTrack={props.onImportCachedTrack}
                onImportNeteaseTrack={props.onImportNeteaseTrack}
                onImportNeteaseTracks={props.onImportNeteaseTracks}
                onImportQqMusicTrack={props.onImportQqMusicTrack}
                onImportQqMusicTracks={props.onImportQqMusicTracks}
                onLoadPlaylistIntoRoom={props.onLoadPlaylistIntoRoom}
                onRefreshLocalStorage={props.onRefreshLocalStorage}
                onSavePlaylistFromQueue={props.onSavePlaylistFromQueue}
                onUpdatePlaylistTitle={props.onUpdatePlaylistTitle}
                onUpdatePlaylistTracks={props.onUpdatePlaylistTracks}
                playlists={props.playlists}
                tracks={props.roomSnapshot.tracks}
              />
            </div>
          )}
        </div>
      </section>
      {message ? <p className="mt-4 text-sm text-foreground-muted" role="status">{message}</p> : null}
    </aside>
  );
}

function RadioAutopilotNextTrackCard({ track }: { track: RadioAutopilotNextTrack }) {
  return (
    <article className="mt-4 flex min-w-0 items-center gap-3 bg-white/[0.035] p-3" data-testid="radio-autopilot-next-track">
      {track.artworkUrl ? (
        <img alt="" className="h-14 w-14 shrink-0 object-cover" src={track.artworkUrl} />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted">音乐</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-accent">下一首自动续播</p>
        <p className="mt-1 truncate text-sm font-semibold text-foreground" title={track.title}>{track.title}</p>
        <p className="mt-1 truncate text-xs text-foreground-muted" title={`${track.artist} · ${track.album ?? "未标注专辑"}`}>
          {track.artist} · {track.album ?? "未标注专辑"}
        </p>
        <p className="mt-1 text-[11px] text-foreground-muted">{formatDuration(track.durationMs)} · {track.provider === "netease" ? "网易云音乐" : "QQ 音乐"}</p>
      </div>
      <span className={`shrink-0 text-[11px] font-medium ${track.preloadStatus === "ready" ? "text-emerald-300" : "text-accent"}`}>
        {track.preloadStatus === "ready" ? "已预加载" : "预加载中"}
      </span>
    </article>
  );
}

function LibraryTrack({ track, index, isCurrent, isHost, pending, onAddToQueue }: { track: TrackMeta; index: number; isCurrent: boolean; isHost: boolean; pending: boolean; onAddToQueue: (trackId: string) => Promise<void> }) {
  return <article className={`grid min-w-0 grid-cols-[1.25rem_3rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-2 py-3 sm:grid-cols-[1.25rem_3rem_minmax(0,1fr)_auto] sm:px-3 ${isCurrent ? "bg-accent/[0.06]" : ""}`}><span className={`pt-1 text-right font-mono text-xs ${isCurrent ? "text-accent" : "text-foreground-muted"}`}>{String(index).padStart(2, "0")}</span><TrackArtwork track={track} /><div className="min-w-0"><p className="break-words text-sm font-medium leading-5 text-foreground">{track.title}</p><p className="mt-1 break-words text-xs leading-5 text-foreground-muted">{track.artist}</p><div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] leading-4 text-foreground-muted"><span className="break-words">{track.album ?? "未标注专辑"}</span><span>{formatDuration(track.durationMs)}</span><span>{getTrackSourceLabel(track)}</span>{track.bitrate ? <span>{Math.round(track.bitrate / 1_000)} kbps</span> : null}</div></div>{isHost ? <Button className="col-start-3 justify-self-start sm:col-start-auto sm:justify-self-end sm:self-center" disabled={pending} onClick={() => void onAddToQueue(track.id)} size="sm" type="button" variant="outline">{pending ? "加入中…" : "加入队列"}</Button> : null}</article>;
}

function TrackArtwork({ track }: { track: TrackMeta }) {
  return track.artworkUrl ? <img alt="" className="h-12 w-12 shrink-0 object-cover" src={track.artworkUrl} /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted">音乐</span>;
}

function getTrackSourceLabel(track: TrackMeta) {
  if (track.sourceType === "netease") return "网易云音乐";
  if (track.sourceType === "qqmusic") return "QQ 音乐";
  return "本地上传";
}

function RadioScrollRegion({
  activeRegion,
  children,
  className,
  id,
  onActivate
}: {
  activeRegion: RadioScrollRegionId | null;
  children: ReactNode;
  className?: string;
  id: RadioScrollRegionId;
  onActivate: (region: RadioScrollRegionId) => void;
}) {
  return <div className={className} data-radio-scroll-region={id} data-radio-scroll-selected={activeRegion === id ? "true" : "false"} onFocusCapture={() => onActivate(id)} onPointerDown={() => onActivate(id)}>{children}</div>;
}
