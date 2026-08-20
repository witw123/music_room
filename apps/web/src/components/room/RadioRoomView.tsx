"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate, TrackMeta } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { PlayerQueueList } from "@/components/PlayerQueueDrawer";
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

export function RadioRoomView(props: RoomDashboardViewProps) {
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const [isChatScrollEnabled, setIsChatScrollEnabled] = useState(false);
  const [leftTab, setLeftTab] = useState<RadioLeftTab>("queue");
  const [rightTab, setRightTab] = useState<RadioRightTab>(isHost ? "console" : "members");

  useEffect(() => {
    if (!isHost) setRightTab("members");
  }, [isHost]);

  useEffect(() => {
    setIsChatScrollEnabled(false);
  }, [props.roomSnapshot.room.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setMembershipNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hide-scrollbar h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-0" data-room-view="radio">
      <section className={`mx-auto grid w-full max-w-[1600px] gap-3 px-3 pt-3 lg:grid-cols-[minmax(0,64fr)_minmax(22rem,36fr)] lg:gap-0 lg:px-0 lg:pt-0 ${isChatScrollEnabled ? "lg:h-full lg:min-h-full" : "lg:h-auto lg:min-h-0"}`} data-testid="radio-room-hero">
        <div className={`min-h-0 overflow-visible lg:min-h-0 lg:border-r lg:border-surface-border lg:bg-surface/[0.12] ${isChatScrollEnabled ? "lg:h-full lg:overflow-hidden" : "lg:h-auto lg:overflow-visible"}`}>
          <RoomStage {...buildRoomStageProps(props, { hideRoomMetadata: true, mobileControlsOnly: true })} />
        </div>
        <div className={`h-[28rem] min-h-[24rem] min-w-0 overflow-hidden rounded-2xl border border-surface-border bg-background sm:h-[30rem] lg:min-h-0 lg:rounded-none lg:border-0 ${isChatScrollEnabled ? "lg:h-full" : "lg:h-[32rem]"}`}>
          <RoomChatPanel
            activeSession={props.activeSession}
            isHost={isHost}
            onActivateScroll={() => setIsChatScrollEnabled(true)}
            roomId={props.roomSnapshot.room.id}
            scrollEnabled={isChatScrollEnabled}
            socket={props.socket}
          />
        </div>
      </section>

      <section className="mx-auto mt-3 grid w-full max-w-[1600px] gap-3 px-3 lg:mt-0 lg:min-h-[32rem] lg:grid-cols-[minmax(0,64fr)_minmax(18rem,36fr)] lg:gap-0 lg:px-0" data-testid="radio-room-workspace">
        <div className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-background lg:min-h-0 lg:rounded-none lg:border-0 lg:border-r">
          <RadioWorkspaceTabs
            activeTab={leftTab}
            ariaLabel="电台内容"
            panelPrefix="radio-left"
            onChange={setLeftTab}
            tabs={[{ id: "queue", label: "队列" }, { id: "library", label: "曲库" }]}
          />
          <div aria-labelledby={`radio-left-tab-${leftTab}`} className="min-h-0 flex-1 overflow-y-auto" id={`radio-left-panel-${leftTab}`} role="tabpanel">
            {leftTab === "queue" ? (
              <div className="flex h-full min-h-0 flex-col" data-testid="radio-queue-panel">
                <PlayerQueueList
                  canControlPlayback={props.canControlPlayback}
                  canRemoveQueue={props.canRemoveQueue}
                  canReorderQueue={props.canReorderQueue}
                  currentQueueItemId={props.roomSnapshot.room.playback.currentQueueItemId}
                  nextQueueItemId={props.roomSnapshot.room.playback.nextQueueItemId ?? null}
                  onPlayNextQueueItem={props.onPlayNextQueueItem}
                  onPlayQueueItem={props.onPlayQueueItem}
                  onRemoveQueueItem={props.onRemoveQueueItem}
                  onReorderQueue={props.onReorderQueue}
                  queue={props.roomSnapshot.queue}
                  tracks={props.roomSnapshot.tracks}
                />
              </div>
            ) : (
              <RadioLibraryList
                currentTrack={props.currentTrack}
                isHost={isHost}
                onAddToQueue={props.onAddToQueue}
                onDeleteTrack={props.onDeleteTrack}
                roomTracks={props.roomSnapshot.tracks}
              />
            )}
          </div>
        </div>
        <div className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-background lg:min-h-0 lg:rounded-none lg:border-0">
          <RadioWorkspaceTabs
            activeTab={rightTab}
            ariaLabel="电台管理"
            panelPrefix="radio-right"
            onChange={setRightTab}
            tabs={isHost ? [{ id: "console", label: "控制台" }, { id: "members", label: "成员" }] : [{ id: "members", label: "成员" }]}
          />
          <div aria-labelledby={`radio-right-tab-${rightTab}`} className="min-h-0 flex-1 overflow-y-auto" id={`radio-right-panel-${rightTab}`} role="tabpanel">
            {rightTab === "console" && isHost ? <HostBroadcastDesk {...props} /> : <RadioMembersPanel {...props} membershipNow={membershipNow} />}
          </div>
        </div>
      </section>
    </div>
  );
}

type RadioLeftTab = "queue" | "library";
type RadioRightTab = "console" | "members";

function RadioWorkspaceTabs<T extends string>({
  activeTab,
  ariaLabel,
  panelPrefix,
  onChange,
  tabs
}: {
  activeTab: T;
  ariaLabel: string;
  panelPrefix: string;
  onChange: (tab: T) => void;
  tabs: Array<{ id: T; label: string }>;
}) {
  return (
    <div className="shrink-0 px-3 py-2 sm:px-5" data-testid={`radio-${ariaLabel === "电台内容" ? "content" : "management"}-tabs`}>
      <div aria-label={ariaLabel} className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-surface-border bg-surface/55 p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${panelPrefix}-tab-${tab.id}`}
            aria-controls={`${panelPrefix}-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={`min-h-10 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${activeTab === tab.id ? "bg-accent text-white shadow-sm" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
            onClick={() => onChange(tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RadioLibraryList({
  currentTrack,
  isHost,
  onAddToQueue,
  onDeleteTrack,
  roomTracks,
}: {
  currentTrack: TrackMeta | null;
  isHost: boolean;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  roomTracks: TrackMeta[];
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visibleTrackCount, setVisibleTrackCount] = useState(10);

  const visibleTracks = roomTracks.slice(0, visibleTrackCount);

  useEffect(() => {
    setVisibleTrackCount(10);
  }, [roomTracks.length]);

  const runTrackAction = async (key: string, action: () => Promise<unknown>) => {
    if (pendingAction) return;
    setPendingAction(key);
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "曲库操作失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <aside className="flex min-h-0 min-w-0 flex-col bg-surface/[0.14] lg:h-full lg:min-h-0" data-testid="radio-library-list">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-7">
        <h1 className="text-xl font-semibold text-foreground">曲库单</h1>
      </header>
      <div
        className="hide-scrollbar min-h-0 max-h-[36rem] flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6 lg:max-h-[min(42rem,calc(100dvh-10rem))] lg:px-7 lg:pb-5"
        id="radio-library-tracks"
        onScroll={(event) => {
          if (visibleTrackCount >= roomTracks.length) return;
          const target = event.currentTarget;
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) {
            setVisibleTrackCount((count) => Math.min(count + 10, roomTracks.length));
          }
        }}
      >
        <div className="space-y-1">
          {visibleTracks.map((track, index) => <div key={track.id}><LibraryTrack index={index + 1} isCurrent={track.id === currentTrack?.id} isHost={isHost} onAddToQueue={() => runTrackAction(`queue:${track.id}`, () => onAddToQueue(track.id))} onDeleteTrack={() => runTrackAction(`delete:${track.id}`, () => onDeleteTrack(track.id))} pendingAction={pendingAction} track={track} /></div>)}
        </div>
        {errorMessage ? <p className="mt-3 text-xs text-danger" role="status">{errorMessage}</p> : null}
      </div>
    </aside>
  );
}

function RadioMembersPanel(props: RoomDashboardViewProps & { membershipNow: number }) {
  return <section className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-background lg:min-h-0 lg:rounded-none lg:border-0" data-testid="radio-members-panel">
    <header className="shrink-0 px-4 py-4 sm:px-5"><h2 className="text-base font-semibold text-foreground">成员</h2></header>
    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
      <MembersPanel
        activeSessionId={props.activeSession?.userId ?? null}
        isHost={props.roomSnapshot.room.hostId === props.activeSession?.userId}
        members={props.roomSnapshot.room.members}
        now={props.membershipNow}
        onRemoveMember={props.onRemoveMember}
        onUpdateMemberPermissions={props.onUpdateMemberPermissions}
      />
    </div>
  </section>;
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
  const canRefillNext = Boolean(
    currentProviderTrack &&
    props.roomSnapshot.room.playback.currentQueueItemId &&
    props.roomSnapshot.room.playback.status === "playing"
  );
  const autopilot = useRadioAutopilot({
    roomSnapshot: props.roomSnapshot,
    isHost,
    userId: props.activeSession?.userId ?? null,
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
      setMessage(isAutopilotEnabled ? "自动续播已停止。" : "自动续播已开启，将在播放到节目单最后一首时补充下一首。");
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
          <Button disabled={!isAutopilotEnabled && !canRefillNext} onClick={() => void toggleAutopilot()} size="sm" type="button" variant={isAutopilotEnabled ? "outline" : "default"}>{isAutopilotEnabled ? "停止自动续播" : "开启自动续播"}</Button>
          <Button disabled={!canRefillNext || autopilot.state.kind === "refilling"} onClick={() => void autopilot.refillNow()} size="sm" type="button" variant="outline">{autopilot.state.kind === "refilling" ? "补充中…" : "补充下一首"}</Button>
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

function LibraryTrack({ track, index, isCurrent, isHost, pendingAction, onAddToQueue, onDeleteTrack }: { track: TrackMeta; index: number; isCurrent: boolean; isHost: boolean; pendingAction: string | null; onAddToQueue: () => Promise<void>; onDeleteTrack: () => Promise<void> }) {
  const isQueuePending = pendingAction === `queue:${track.id}`;
  const isDeletePending = pendingAction === `delete:${track.id}`;
  return <article className={`grid min-w-0 grid-cols-[1.25rem_3rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-2 py-3 sm:grid-cols-[1.25rem_3rem_minmax(0,1fr)_auto] sm:px-3 ${isCurrent ? "bg-accent/[0.06]" : ""}`}><span className={`pt-1 text-right font-mono text-xs ${isCurrent ? "text-accent" : "text-foreground-muted"}`}>{String(index).padStart(2, "0")}</span><TrackArtwork track={track} /><div className="min-w-0"><p className="break-words text-sm font-medium leading-5 text-foreground">{track.title}</p><p className="mt-1 break-words text-xs leading-5 text-foreground-muted">{track.artist}</p><div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] leading-4 text-foreground-muted"><span className="break-words">{track.album ?? "未标注专辑"}</span><span>{formatDuration(track.durationMs)}</span><span>{getTrackSourceLabel(track)}</span>{track.bitrate ? <span>{Math.round(track.bitrate / 1_000)} kbps</span> : null}</div></div>{isHost ? <div className="col-start-3 flex min-w-max items-center gap-0.5 justify-self-start sm:col-start-auto sm:justify-self-end sm:self-center sm:gap-1"><Button aria-label={`将《${track.title}》加入队列`} data-testid="radio-track-add-queue-button" className="h-10 w-10 shrink-0 !rounded-none bg-transparent p-0 hover:bg-transparent hover:text-foreground sm:h-8 sm:w-8" disabled={pendingAction !== null} onClick={() => void onAddToQueue()} size="icon" title={isQueuePending ? "加入中" : "加入队列"} type="button" variant="ghost"><svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="M12 5v14M5 12h14" /></svg></Button><Button aria-label={`删除《${track.title}》`} data-testid="radio-track-delete-button" className="h-10 w-10 shrink-0 !rounded-none bg-transparent p-0 text-destructive hover:bg-transparent hover:text-destructive sm:h-8 sm:w-8" disabled={pendingAction !== null} onClick={() => void onDeleteTrack()} size="icon" title={isDeletePending ? "删除中" : "删除"} type="button" variant="ghost"><svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13" /></svg></Button></div> : null}</article>;
}

function TrackArtwork({ track }: { track: TrackMeta }) {
  return track.artworkUrl ? <img alt="" className="h-12 w-12 shrink-0 object-cover" src={track.artworkUrl} /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center bg-white/[0.06] text-[10px] text-foreground-muted">音乐</span>;
}

function getTrackSourceLabel(track: TrackMeta) {
  if (track.sourceType === "netease") return "网易云音乐";
  if (track.sourceType === "qqmusic") return "QQ 音乐";
  return "本地上传";
}
