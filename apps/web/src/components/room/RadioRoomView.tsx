"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { BilibiliTrackCandidate, NeteaseTrackCandidate, QqMusicTrackCandidate } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { PlayerQueueList } from "@/components/bottom-player";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { RoomControlHeader } from "./RoomControlHeader";
import type { RoomDashboardViewProps } from "./RoomDashboardView";
import { useRadioAutopilot, type RadioAutopilotNextTrack } from "./hooks/use-radio-autopilot";
import {
  FolderIcon,
  ListMusicIcon,
  MessageSquareIcon,
  RadioIcon,
  SearchIcon,
  UsersIcon
} from "@/components/icons/DiscoverIcons";
import { useProgressiveRoomLoading } from "./hooks/use-progressive-room-loading";
import { RoomPanelSkeleton } from "./RoomPanelSkeleton";

const MembersPanel = dynamic(() => import("./MembersPanel").then((m) => m.MembersPanel));
const RoomChatPanel = dynamic(() => import("./RoomChatOverlay").then((m) => m.RoomChatPanel));
const RoomProviderTrackSearch = dynamic(() => import("./RoomProviderTrackSearch").then((m) => m.RoomProviderTrackSearch));
const RoomReactionToolbar = dynamic(() => import("./RoomReactionToolbar").then((m) => m.RoomReactionToolbar));
const LocalAudioImport = dynamic(() => import("./LocalAudioImport").then((m) => m.LocalAudioImport));
const LocalStorageTabPanel = dynamic(() => import("./LocalStorageTabPanel").then((m) => m.LocalStorageTabPanel));
const LibraryTabPanel = dynamic(() => import("./LibraryTabPanel").then((m) => m.LibraryTabPanel));

type ProviderCandidate = NeteaseTrackCandidate | QqMusicTrackCandidate | BilibiliTrackCandidate;

type HostLeftTab = "queue" | "desk" | "library";
type ListenerLeftTab = "queue" | "library";
type RadioLeftTab = HostLeftTab | ListenerLeftTab;
type RadioRightTab = "chat" | "members";
type RadioMobileTab = "queue" | "desk" | "chat" | "library" | "members";

export function RadioRoomView(props: RoomDashboardViewProps) {
  const { panelsReady } = useProgressiveRoomLoading();
  const [membershipNow, setMembershipNow] = useState(() => Date.now());
  const isHost = props.roomSnapshot.room.hostId === props.activeSession?.userId;

  const [leftTab, setLeftTab] = useState<RadioLeftTab>("queue");
  const [rightTab, setRightTab] = useState<RadioRightTab>("chat");
  const [mobileTab, setMobileTab] = useState<RadioMobileTab>("queue");

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

  const queueCount = props.roomSnapshot.queue.length;
  const memberCount = props.roomSnapshot.room.members.length;

  const hostLeftTabs = useMemo(() => [
    { id: "queue" as const, label: `节目单 (${queueCount})`, icon: ListMusicIcon },
    { id: "desk" as const, label: "搜歌添加", icon: SearchIcon },
    { id: "library" as const, label: "曲库", icon: FolderIcon }
  ], [queueCount]);

  const listenerLeftTabs = useMemo(() => [
    { id: "queue" as const, label: `节目单 (${queueCount})`, icon: ListMusicIcon },
    { id: "library" as const, label: "曲库", icon: FolderIcon }
  ], [queueCount]);

  const rightTabs = useMemo(() => [
    { id: "chat" as const, label: "互动聊天", icon: MessageSquareIcon },
    { id: "members" as const, label: `在场听众 (${memberCount})`, icon: UsersIcon }
  ], [memberCount]);

  const mobileTabs = useMemo(() => {
    const base: Array<{ id: RadioMobileTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
      { id: "queue", label: `节目单 (${queueCount})`, icon: ListMusicIcon }
    ];
    if (isHost) {
      base.push({ id: "desk", label: "搜歌", icon: SearchIcon });
    }
    base.push(
      { id: "chat", label: "聊天", icon: MessageSquareIcon },
      { id: "library", label: "曲库", icon: FolderIcon },
      { id: "members", label: `听众 (${memberCount})`, icon: UsersIcon }
    );
    return base;
  }, [isHost, queueCount, memberCount]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background" data-room-view="radio">
      {/* Mobile Top Room Control Header */}
      <div className="relative z-30 shrink-0 px-3 pt-[calc(0.45rem+env(safe-area-inset-top,0px))] pb-2 lg:hidden">
        <RoomControlHeader
          isMobile
          roomSnapshot={props.roomSnapshot}
          mediaConnectionState={props.mediaConnectionState}
          currentTrack={props.currentTrack}
          host={props.host}
          canDeleteRoom={props.canDeleteRoom}
          canDisbandRoom={props.canDisbandRoom}
          onCopyJoinCode={props.onCopyJoinCode}
          onShareRoom={props.onShareRoom}
          onAwayRoom={props.onAwayRoom}
          onLeaveRoom={props.onLeaveRoom}
          onDeleteRoom={props.onDeleteRoom}
          onUpdateRoom={props.onUpdateRoom}
        />
      </div>

      {/* Desktop Unified Header Bar */}
      <div className="relative z-30 hidden lg:block shrink-0 border-b border-surface-border/50 bg-surface/40 px-3 sm:px-4 backdrop-blur-xl">
        <RoomControlHeader
          roomSnapshot={props.roomSnapshot}
          mediaConnectionState={props.mediaConnectionState}
          currentTrack={props.currentTrack}
          host={props.host}
          canDeleteRoom={props.canDeleteRoom}
          canDisbandRoom={props.canDisbandRoom}
          onCopyJoinCode={props.onCopyJoinCode}
          onShareRoom={props.onShareRoom}
          onAwayRoom={props.onAwayRoom}
          onLeaveRoom={props.onLeaveRoom}
          onDeleteRoom={props.onDeleteRoom}
          onUpdateRoom={props.onUpdateRoom}
        />
      </div>

      {/* Desktop Balanced Split Layout */}
      <div className="hidden lg:grid flex-1 min-h-0 w-full lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.9fr)] divide-x divide-surface-border/40 overflow-hidden">
        {/* Left Column: Broadcast & Content Hub */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <RadioWorkspaceTabs
            activeTab={leftTab}
            ariaLabel="电台内容"
            panelPrefix="radio-left"
            onChange={(tab) => setLeftTab(tab)}
            tabs={isHost ? hostLeftTabs : listenerLeftTabs}
          />
          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
            {panelsReady ? (
              leftTab === "queue" ? (
                <div className="flex h-full min-h-0 flex-col p-2 sm:p-2.5 gap-2" data-testid="radio-queue-panel">
                  {/* Autopilot section placed directly at top of queue */}
                  <RadioAutopilotSection props={props} isHost={isHost} />
                  <div className="flex-1 min-h-0 overflow-y-auto">
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
                      members={props.roomSnapshot.room.members}
                      currentSessionId={props.activeSession?.userId ?? null}
                    />
                  </div>
                </div>
              ) : leftTab === "desk" && isHost ? (
                <HostBroadcastDesk {...props} />
              ) : (
                <RadioLibraryList isHost={isHost} props={props} />
              )
            ) : (
              <RoomPanelSkeleton />
            )}
          </div>
        </div>

        {/* Right Column: Interaction & Audience Hub */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <RadioWorkspaceTabs
            activeTab={rightTab}
            ariaLabel="房间信息"
            panelPrefix="radio-right"
            onChange={setRightTab}
            tabs={rightTabs}
          />
          <div
            aria-labelledby={`radio-right-tab-${rightTab}`}
            className="hide-scrollbar flex min-h-0 flex-1 flex-col overflow-hidden"
            id={`radio-right-panel-${rightTab}`}
            role="tabpanel"
          >
            {panelsReady ? (
              rightTab === "chat" ? (
                <RoomChatPanel
                  activeSession={props.activeSession}
                  isHost={isHost}
                  roomId={props.roomSnapshot.room.id}
                  scrollEnabled
                  socket={props.socket}
                />
              ) : (
                <RadioMembersPanel {...props} membershipNow={membershipNow} />
              )
            ) : (
              <RoomPanelSkeleton />
            )}
          </div>

          {/* Radio Dedicated Member Interaction Bar */}
          <div className="shrink-0 px-2.5 py-1.5 border-t border-surface-border/40 bg-surface/80 backdrop-blur-xl">
            <RoomReactionToolbar
              roomId={props.roomSnapshot.room.id}
              socket={props.socket}
              variant="radio"
              targetMembers={targetMembers}
              activeMemberId={props.roomSnapshot.room.hostId}
            />
          </div>
        </div>
      </div>

      {/* Mobile Streamlined View */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden lg:hidden pt-1">
        <div className="material-surface-header shrink-0 px-2 pb-1 pt-0">
          <div
            aria-label="电台功能"
            className="flex items-center gap-0.5 rounded-lg bg-surface/70 p-0.5 border border-surface-border/40 backdrop-blur-md overflow-x-auto hide-scrollbar"
            role="tablist"
          >
            {mobileTabs.map((tab) => {
              const isActive = mobileTab === tab.id;
              const IconComp = tab.icon;
              return (
                <button
                  key={tab.id}
                  aria-selected={isActive}
                  className={`flex-1 flex min-h-7 min-w-fit items-center justify-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? "bg-accent text-white shadow-xs"
                      : "text-foreground-muted hover:text-foreground hover:bg-surface-hover/60"
                  }`}
                  onClick={() => setMobileTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <IconComp className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto">
          {panelsReady ? (
            mobileTab === "queue" ? (
              <div className="flex h-full min-h-0 flex-col p-2 gap-2">
                <RadioAutopilotSection props={props} isHost={isHost} />
                <div className="flex-1 min-h-0 overflow-y-auto">
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
                    members={props.roomSnapshot.room.members}
                    currentSessionId={props.activeSession?.userId ?? null}
                  />
                </div>
              </div>
            ) : mobileTab === "desk" && isHost ? (
              <HostBroadcastDesk {...props} />
            ) : mobileTab === "chat" ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <RoomChatPanel
                    activeSession={props.activeSession}
                    isHost={isHost}
                    roomId={props.roomSnapshot.room.id}
                    scrollEnabled
                    socket={props.socket}
                  />
                </div>
                <div className="shrink-0 px-2 py-1 border-t border-surface-border/40 bg-surface/80 backdrop-blur-xl">
                  <RoomReactionToolbar
                    roomId={props.roomSnapshot.room.id}
                    socket={props.socket}
                    variant="radio"
                    targetMembers={targetMembers}
                    activeMemberId={props.roomSnapshot.room.hostId}
                  />
                </div>
              </div>
            ) : mobileTab === "library" ? (
              <RadioLibraryList isHost={isHost} props={props} />
            ) : (
              <RadioMembersPanel {...props} membershipNow={membershipNow} />
            )
          ) : (
            <RoomPanelSkeleton />
          )}
        </div>
      </div>
    </div>
  );
}

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
    <div className="material-surface-header shrink-0 px-2.5 py-1 sm:px-3 sm:py-1.5">
      <div
        aria-label={ariaLabel}
        className="flex items-center gap-0.5 rounded-lg bg-surface/70 p-0.5 border border-surface-border/40 backdrop-blur-md"
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
              className={`flex-1 flex min-h-7 sm:min-h-7.5 items-center justify-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition-all duration-150 ${
                isActive
                  ? "bg-accent text-white shadow-xs"
                  : "text-foreground-muted hover:text-foreground hover:bg-surface-hover/60"
              }`}
              onClick={() => onChange(tab.id)}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {IconComp && <IconComp className="w-3.5 h-3.5 shrink-0" />}
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
  return (
    <div className="flex h-full min-h-0 flex-col p-2 sm:p-2.5">
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
        members={props.roomSnapshot.room.members}
        uploadedTracks={props.uploadedTracks}
      />
    </div>
  );
}

function RadioMembersPanel(props: RoomDashboardViewProps & { membershipNow: number }) {
  return (
    <section className="flex h-full min-h-0 flex-1 min-w-0 flex-col overflow-hidden rounded-xl bg-background lg:rounded-none" data-testid="radio-members-panel">
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-2 sm:p-2.5">
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

function RadioAutopilotSection({
  props,
  isHost
}: {
  props: RoomDashboardViewProps;
  isHost: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
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
    <section className="shrink-0 rounded-xl border border-surface-border/60 bg-surface/50 p-2.5 sm:p-3 shadow-xs backdrop-blur-xl" data-testid="radio-autopilot">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isAutopilotEnabled ? "bg-emerald-400 animate-pulse" : "bg-foreground-muted/30"}`} />
          <h3 className="text-xs sm:text-sm font-bold text-foreground truncate">智能续播流</h3>
          <span className="text-[10px] sm:text-[11px] font-medium text-foreground-muted px-1.5 py-0.5 rounded-full bg-surface border border-surface-border/60 shrink-0">
            {isAutopilotEnabled ? "已启用个性化推荐" : "已暂停"}
          </span>
        </div>
        {isHost ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              disabled={!isAutopilotEnabled && !canRefillNext}
              onClick={() => void toggleAutopilot()}
              size="sm"
              type="button"
              className={`h-6 sm:h-7 rounded-md text-xs font-medium border px-2 ${
                isAutopilotEnabled
                  ? "bg-surface hover:bg-surface-hover text-foreground border-surface-border"
                  : "bg-accent hover:bg-accent-hover text-white shadow-xs border-accent"
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
              className="h-6 sm:h-7 rounded-md text-xs bg-surface hover:bg-surface-hover text-foreground border-surface-border px-2"
            >
              {autopilot.state.kind === "refilling" ? "补充中…" : "补充下一首"}
            </Button>
          </div>
        ) : null}
      </div>

      {currentProviderTrack ? (
        <p className="mt-1 truncate text-[11px] text-foreground-muted">
          当前种子: {currentProviderTrack.title} · {currentProviderTrack.artist}
        </p>
      ) : null}

      {autopilot.nextTrack ? <RadioAutopilotNextTrackCard track={autopilot.nextTrack} /> : null}

      {message || autopilot.state.message ? (
        <p className={`mt-1.5 text-[11px] leading-relaxed ${autopilot.state.kind === "paused" ? "text-amber-400" : "text-foreground-muted"}`} role="status">
          {message || autopilot.state.message}
        </p>
      ) : null}
    </section>
  );
}

function HostBroadcastDesk(props: RoomDashboardViewProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<"local" | "playlists">("local");

  const handleImportTrack = async (candidate: ProviderCandidate) => {
    setMessage(null);
    try {
      if (candidate.provider === "netease") {
        await props.onImportNeteaseTrack(candidate);
      } else if (candidate.provider === "bilibili") {
        await props.onImportBilibiliTrack?.(candidate);
      } else {
        await props.onImportQqMusicTrack(candidate);
      }
      setMessage(`已将《${candidate.title}》加入曲库。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入歌曲失败。请稍后重试。");
    }
  };

  return (
    <aside className="min-w-0 px-2.5 py-2.5 sm:px-3.5 sm:py-3" data-testid="radio-host-console">
      <div className="flex items-center justify-between pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface text-foreground-muted border border-surface-border">
            <RadioIcon className="w-3.5 h-3.5" />
          </span>
          <h2 className="text-xs sm:text-sm font-bold text-foreground tracking-tight">电台搜歌与曲目导入</h2>
        </div>
        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
          LIVE ON AIR
        </span>
      </div>

      <div className="mt-2.5">
        <RoomProviderTrackSearch
          canManageLibrary
          hideUnavailableProvidersNotice
          mode="import"
          onImportNeteaseTrack={handleImportTrack}
          onImportQqMusicTrack={handleImportTrack}
          onImportBilibiliTrack={handleImportTrack}
          roomTracks={props.roomSnapshot.tracks}
          surface="plain"
          testId="radio-room-program"
        />
      </div>

      <section className="mt-3 pt-2" data-testid="radio-room-imports">
        <h3 className="text-xs sm:text-sm font-bold text-foreground mb-1.5">导入电台曲目</h3>
        <div aria-label="导入歌曲方式" className="grid grid-cols-2 rounded-lg border border-surface-border/40 p-0.5 bg-surface/70" role="tablist">
          <button
            aria-controls="radio-import-local"
            aria-selected={importTab === "local"}
            className={`min-h-7 sm:min-h-7.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
              importTab === "local" ? "bg-accent text-white shadow-xs" : "text-foreground-muted hover:text-foreground hover:bg-surface-hover/60"
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
            className={`min-h-7 sm:min-h-7.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
              importTab === "playlists" ? "bg-accent text-white shadow-xs" : "text-foreground-muted hover:text-foreground hover:bg-surface-hover/60"
            }`}
            onClick={() => setImportTab("playlists")}
            role="tab"
            type="button"
          >
            我的歌单
          </button>
        </div>
        <div className="mt-2">
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
      {message ? <p className="mt-2 text-xs text-foreground-muted" role="status">{message}</p> : null}
    </aside>
  );
}

function RadioAutopilotNextTrackCard({ track }: { track: RadioAutopilotNextTrack }) {
  return (
    <article className="mt-1.5 flex min-w-0 items-center gap-2 rounded-lg border border-surface-border/60 bg-surface/60 p-2 shadow-xs" data-testid="radio-autopilot-next-track">
      {track.artworkUrl ? (
        <img alt="" className="h-9 w-9 shrink-0 rounded-md border border-surface-border/60 object-cover shadow-xs" src={track.artworkUrl} />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-border/60 bg-surface text-[10px] text-foreground-muted">音乐</span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider">下一首自动续播</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-foreground" title={track.title}>{track.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={`${track.artist} · ${track.album ?? "未标注专辑"}`}>
          {track.artist} · {track.album ?? "未标注专辑"}
        </p>
        <p className="text-[10px] text-foreground-muted/70">{formatDuration(track.durationMs)} · {track.provider === "netease" ? "网易云音乐" : "QQ 音乐"}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold border ${track.preloadStatus === "ready" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" : "border-surface-border bg-surface text-foreground-muted"}`}>
        {track.preloadStatus === "ready" ? "已预加载" : "预加载中"}
      </span>
    </article>
  );
}
