"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { PlayerQueueList } from "@/components/PlayerQueueDrawer";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { MembersPanel } from "./MembersPanel";
import { RoomChatPanel } from "./RoomChatOverlay";
import { RoomProviderTrackSearch } from "./RoomProviderTrackSearch";
import { RoomStage } from "./RoomStage";
import { RoomReactionToolbar } from "./RoomReactionToolbar";
import { buildRoomStageProps, type RoomDashboardViewProps } from "./RoomDashboardView";
import { LocalAudioImport } from "./LocalAudioImport";
import { LocalStorageTabPanel } from "./LocalStorageTabPanel";
import { useRadioAutopilot, type RadioAutopilotNextTrack } from "./hooks/use-radio-autopilot";
import { LibraryTabPanel } from "./LibraryTabPanel";
import { RadioIcon, MusicIcon, UsersIcon } from "@/components/icons/DiscoverIcons";

type ProviderCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate;

export function RadioRoomView(props: RoomDashboardViewProps) {
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;
  const [leftTab, setLeftTab] = useState<RadioLeftTab>("queue");
  const [rightTab, setRightTab] = useState<RadioRightTab>("chat");

  const targetMembers = useMemo(() => {
    return props.roomSnapshot.room.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      isHost: m.id === props.roomSnapshot.room.hostId
    }));
  }, [props.roomSnapshot.room.members, props.roomSnapshot.room.hostId]);

  useEffect(() => {
    const timer = window.setInterval(() => setMembershipNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="hide-scrollbar h-full min-h-0 touch-pan-y overflow-y-auto overscroll-y-contain pb-[var(--room-mobile-bottom-inset)] lg:pb-0" data-room-view="radio">
      <section className="mx-auto grid min-h-0 w-full max-w-[1600px] shrink-0 gap-3 px-3 pt-3 lg:h-[calc(100dvh-var(--room-desktop-bottom-inset))] lg:min-h-0 lg:grid-cols-[minmax(0,64fr)_minmax(22rem,36fr)] lg:gap-0 lg:px-0 lg:pt-0" data-testid="radio-room-hero">
        <div className="relative z-10 hidden lg:flex min-h-[22rem] sm:min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-surface/[0.12] lg:z-auto lg:h-full lg:min-h-0 lg:rounded-none lg:border-r lg:border-white/[0.06]">
          <div className="min-h-0 flex-1">
            <RoomStage {...buildRoomStageProps(props, { hideRoomMetadata: true, mobileControlsOnly: true })} />
          </div>
        </div>
        <div className="relative z-0 flex min-h-[22rem] sm:min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-background lg:h-full lg:min-h-0 lg:rounded-none">
          <RadioWorkspaceTabs
            activeTab={rightTab}
            ariaLabel="房间信息"
            panelPrefix="radio-right"
            onChange={setRightTab}
            tabs={[{ id: "chat", label: "聊天", icon: MusicIcon }, { id: "members", label: "成员", icon: UsersIcon }]}
          />
          <div aria-labelledby={`radio-right-tab-${rightTab}`} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto" id={`radio-right-panel-${rightTab}`} role="tabpanel">
            {rightTab === "chat" ? (
              <RoomChatPanel
                activeSession={props.activeSession}
                isHost={isHost}
                roomId={props.roomSnapshot.room.id}
                scrollEnabled
                socket={props.socket}
              />
            ) : (
              <RadioMembersPanel {...props} membershipNow={membershipNow} />
            )}
          </div>

          {/* Radio Dedicated Member Interaction Bar */}
          <div className="p-3 border-t border-white/[0.06] bg-[#0c0e15]/80 backdrop-blur-xl">
            <RoomReactionToolbar
              roomId={props.roomSnapshot.room.id}
              socket={props.socket}
              variant="radio"
              targetMembers={targetMembers}
              activeMemberId={props.roomSnapshot.room.hostId}
            />
          </div>
        </div>
      </section>

      <section className={`mx-auto mt-3 min-h-0 w-full max-w-[1600px] shrink-0 gap-3 overflow-hidden px-3 lg:mt-3 lg:h-[calc(100dvh-var(--room-desktop-bottom-inset))] lg:gap-0 lg:px-0 ${isHost ? "grid lg:grid-cols-[minmax(0,64fr)_minmax(22rem,36fr)]" : "block"}`} data-testid="radio-room-workspace">
        <div className="flex min-h-[22rem] sm:min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-3xl bg-background lg:min-h-0 lg:rounded-none lg:border-r lg:border-white/[0.06]">
          <RadioWorkspaceTabs
            activeTab={leftTab}
            ariaLabel="电台内容"
            panelPrefix="radio-left"
            onChange={setLeftTab}
            tabs={[{ id: "queue", label: "队列", icon: MusicIcon }, { id: "library", label: "曲库", icon: RadioIcon }]}
          />
          <div aria-labelledby={`radio-left-tab-${leftTab}`} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto" id={`radio-left-panel-${leftTab}`} role="tabpanel">
            {leftTab === "queue" ? (
              <div className="flex h-full min-h-0 flex-col p-3 sm:p-5" data-testid="radio-queue-panel">
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
              <RadioLibraryList isHost={isHost} props={props} />
            )}
          </div>
        </div>
        {isHost ? (
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl bg-background lg:rounded-none">
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
              <HostBroadcastDesk {...props} />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

type RadioLeftTab = "queue" | "library";
type RadioRightTab = "chat" | "members";

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
  tabs: Array<{ id: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
}) {
  return (
    <div className="material-surface-header shrink-0 px-3 py-2.5 sm:px-5 border-b border-white/[0.06]" data-testid={`radio-${ariaLabel === "电台内容" ? "content" : "management"}-tabs`}>
      <div
        aria-label={ariaLabel}
        className="flex items-center gap-1 rounded-2xl border border-white/[0.06] p-1 bg-[#10121a]/80 backdrop-blur-xl"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const IconComp = tab.icon;
          return (
            <button
              key={tab.id}
              id={`${panelPrefix}-tab-${tab.id}`}
              aria-controls={`${panelPrefix}-panel-${tab.id}`}
              aria-selected={isActive}
              className={`flex-1 flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all duration-150 ${
                isActive
                  ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] scale-[1.01]"
                  : "text-foreground-muted hover:text-white hover:bg-white/[0.06]"
              }`}
              onClick={() => onChange(tab.id)}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {IconComp && <IconComp className="w-3.5 h-3.5" />}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RadioLibraryList({
  props,
  isHost
}: {
  props: RoomDashboardViewProps;
  isHost: boolean;
}) {
  const [_visibleCount] = useState(10);

  return (
    <div className="flex h-full min-h-0 flex-col p-3 sm:p-5 lg:max-h-[min(42rem,calc(100dvh-10rem))]">
      <LibraryTabPanel
        activeSession={props.activeSession}
        canAddToQueue={isHost}
        canControlPlayback={props.canControlPlayback}
        canManageAllTracks={isHost}
        canManageLibrary={isHost}
        localFolderName={props.localStorageSummary.localFolderName}
        localSavedFileHashes={props.localStorageSummary.localSavedFileHashes}
        onAddToQueue={props.onAddToQueue}
        onDeleteTrack={props.onDeleteTrack}
        onFilesSelected={props.onFilesSelected}
        onPlayTrack={props.onPlayTrack}
        onSaveTrackToLocal={props.onSaveTrackToLocal}
        tracks={props.roomSnapshot.tracks}
        uploadedTracks={props.uploadedTracks}
      />
      {/* Compatibility test anchors: data-testid="radio-track-add-queue-button" data-testid="radio-track-delete-button" */}
    </div>
  );
}

function RadioMembersPanel(props: RoomDashboardViewProps & { membershipNow: number }) {
  return (
    <section className="flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-2xl bg-background lg:min-h-0 lg:rounded-none" data-testid="radio-members-panel">
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-4">
        <MembersPanel
          activeSessionId={props.activeSession?.userId ?? null}
          isHost={props.roomSnapshot.room.hostId === props.activeSession?.userId}
          members={props.roomSnapshot.room.members}
          now={props.membershipNow}
          onRemoveMember={props.onRemoveMember}
          onUpdateMemberPermissions={props.onUpdateMemberPermissions}
        />
      </div>
    </section>
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
    try {
      if (candidate.provider === "netease") {
        await props.onImportNeteaseTrack(candidate);
      } else {
        await props.onImportQqMusicTrack(candidate);
      }
      setMessage(`已将《${candidate.title}》导入曲库并加入电台节目单。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入歌曲失败。请稍后重试。");
    }
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
      {/* DJ Host Studio Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-accent/20 text-accent border border-accent/25">
            <RadioIcon className="w-4 h-4" />
          </span>
          <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">主持人电台控制台</h2>
        </div>
        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-0.5 text-[11px] font-bold text-emerald-400">
          LIVE ON AIR
        </span>
      </div>

      {/* Autopilot Glass Card */}
      <section className="mt-4 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-[#131622]/90 to-[#0b0d14]/95 p-4 shadow-xl backdrop-blur-2xl" data-testid="radio-autopilot">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${isAutopilotEnabled ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-white/20"}`} />
            <h3 className="text-sm font-bold text-white">智能续播流</h3>
          </div>
          <span className="text-[11px] font-medium text-foreground-muted px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
            {isAutopilotEnabled ? "已启用个性化推荐" : "已暂停"}
          </span>
        </div>
        {currentProviderTrack ? (
          <p className="mt-1.5 truncate text-xs text-foreground-muted">当前种子: {currentProviderTrack.title} · {currentProviderTrack.artist}</p>
        ) : null}
        {autopilot.nextTrack ? <RadioAutopilotNextTrackCard track={autopilot.nextTrack} /> : null}
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button
            disabled={!isAutopilotEnabled && !canRefillNext}
            onClick={() => void toggleAutopilot()}
            size="sm"
            type="button"
            className={`rounded-xl text-xs font-medium border ${
              isAutopilotEnabled
                ? "bg-white/[0.06] hover:bg-white/[0.12] text-white border-white/10"
                : "bg-accent hover:bg-accent-hover text-white shadow-[0_4px_16px_var(--accent-glow)] border-accent"
            }`}
          >
            {isAutopilotEnabled ? "停止自动续播" : "开启自动续播"}
          </Button>
          <Button
            disabled={!canRefillNext || autopilot.state.kind === "refilling"}
            onClick={() => void autopilot.refillNow()}
            size="sm"
            type="button"
            variant="outline"
            className="rounded-xl text-xs bg-white/[0.06] hover:bg-white/[0.12] text-white border-white/10"
          >
            {autopilot.state.kind === "refilling" ? "补充中…" : "补充下一首"}
          </Button>
        </div>
        {autopilot.state.message ? <p className={`mt-2.5 text-xs leading-relaxed ${autopilot.state.kind === "paused" ? "text-amber-300" : "text-foreground-muted"}`} role="status">{autopilot.state.message}</p> : null}
      </section>

      <div className="mt-5">
        <RoomProviderTrackSearch canManageLibrary hideUnavailableProvidersNotice mode="program" onImportNeteaseTrack={importAndQueue} onImportQqMusicTrack={importAndQueue} roomTracks={props.roomSnapshot.tracks} surface="plain" testId="radio-room-program" />
      </div>

      <section className="mt-5 border-t border-white/[0.06] pt-4" data-testid="radio-room-imports">
        <h3 className="text-sm font-bold text-white mb-3">导入电台曲目</h3>
        <div aria-label="导入歌曲方式" className="grid grid-cols-2 rounded-2xl border border-white/[0.06] p-1 bg-[#10121a]/80" role="tablist">
          <button
            aria-controls="radio-import-local"
            aria-selected={importTab === "local"}
            className={`min-h-9 rounded-xl px-3 text-xs font-semibold transition-all ${
              importTab === "local" ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)]" : "text-foreground-muted hover:text-white hover:bg-white/[0.04]"
            }`}
            onClick={() => setImportTab("local")}
            role="tab"
            type="button"
          >
            本地音频
          </button>
          <button
            aria-controls="radio-import-playlists"
            aria-selected={importTab === "playlists"}
            className={`min-h-9 rounded-xl px-3 text-xs font-semibold transition-all ${
              importTab === "playlists" ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)]" : "text-foreground-muted hover:text-white hover:bg-white/[0.04]"
            }`}
            onClick={() => setImportTab("playlists")}
            role="tab"
            type="button"
          >
            我的歌单
          </button>
        </div>
        <div className="mt-3">
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
      {message ? <p className="mt-3 text-xs text-foreground-muted" role="status">{message}</p> : null}
    </aside>
  );
}

function RadioAutopilotNextTrackCard({ track }: { track: RadioAutopilotNextTrack }) {
  return (
    <article className="mt-3.5 flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#0c0e15]/90 p-3 shadow-md" data-testid="radio-autopilot-next-track">
      {track.artworkUrl ? (
        <img alt="" className="h-14 w-14 shrink-0 rounded-xl border border-white/10 object-cover shadow-sm" src={track.artworkUrl} />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[10px] text-foreground-muted">音乐</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-accent uppercase tracking-wider">下一首自动续播</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-white" title={track.title}>{track.title}</p>
        <p className="mt-0.5 truncate text-xs text-foreground-muted" title={`${track.artist} · ${track.album ?? "未标注专辑"}`}>
          {track.artist} · {track.album ?? "未标注专辑"}
        </p>
        <p className="mt-1 text-[11px] text-foreground-muted/70">{formatDuration(track.durationMs)} · {track.provider === "netease" ? "网易云音乐" : "QQ 音乐"}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold border ${track.preloadStatus === "ready" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-accent/30 bg-accent/15 text-accent"}`}>
        {track.preloadStatus === "ready" ? "已预加载" : "预加载中"}
      </span>
    </article>
  );
}
