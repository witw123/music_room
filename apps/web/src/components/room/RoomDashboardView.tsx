"use client";

import { memo, useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type {
  AuthSession,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { RoomStage } from "./RoomStage";
import { QueuePanel } from "./QueuePanel";
import { RoomChatOverlay } from "./RoomChatOverlay";
import type { LocalMemberPanelState, MemberTransferSummary } from "./MembersPanel";
import type { AvailabilityEntry } from "./MeshStatusPanel";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";
import type { ManualCacheTask } from "@/features/upload/use-track-uploads";

type TabId = "queue" | "library" | "cache" | "members";

type RoomDashboardViewProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: AuthSession | null;
  host: RoomMember | undefined;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  canDisbandRoom: boolean;
  canReorderQueue: boolean;
  currentSourceOwnerNickname: string | null;
  uploadedTracks: Record<string, UploadedTrack>;
  connectedPeersCount: number;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  cacheLibraryTracks: CachedLibraryTrack[];
  manualCacheTasks: Record<string, ManualCacheTask>;
  availabilitySummary: AvailabilityEntry[];
  memberTransferSummaries: MemberTransferSummary[];
  localMemberState: LocalMemberPanelState | null;
  peerDiagnostics: PeerDiagnosticsSnapshot[];
  peerRecentEvents: PeerRecentEvent[];
  iceConfigSource: string;
  iceConfigStatus: string;
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  onStartManualCacheDownload: (trackId: string) => Promise<void>;
  onPauseManualCacheDownload: (trackId: string) => void;
  onAddCachedLibraryTrackToLibrary: (fileHash: string) => Promise<void>;
  onExportCachedLibraryTrack: (fileHash: string) => Promise<void>;
  onDeleteCachedLibraryTrack: (fileHash: string) => Promise<void>;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  socket: any;
  onTabChange?: (tab: TabId) => void;
  onDiagnosticsVisibilityChange?: (open: boolean) => void;
};

const tabLabels: Record<TabId, string> = {
  queue: "队列",
  library: "曲库",
  cache: "缓存",
  members: "成员"
};

const LibraryTabPanel = dynamic(
  () => import("./LibraryTabPanel").then((mod) => mod.LibraryTabPanel),
  {
    loading: () => (
      <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
        正在加载曲库…
      </div>
    )
  }
);

const MembersTabPanel = dynamic(
  () => import("./MembersTabPanel").then((mod) => mod.MembersTabPanel),
  {
    loading: () => (
      <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
        正在加载成员视图…
      </div>
    )
  }
);

const CacheTabPanel = dynamic(
  () => import("./CacheTabPanel").then((mod) => mod.CacheTabPanel),
  {
    loading: () => (
      <div className="animate-fade-in rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center text-sm text-foreground-muted">
        正在加载缓存页…
      </div>
    )
  }
);

function RoomDashboardViewBase({
  roomSnapshot,
  currentTrack,
  currentTrackDuration,
  isPlaying,
  activeSession,
  host,
  canControlPlayback,
  canDeleteRoom,
  canDisbandRoom,
  canReorderQueue,
  currentSourceOwnerNickname,
  uploadedTracks,
  connectedPeersCount,
  mediaConnectionState,
  mediaConnectedPeersCount,
  cachedTrackCount,
  cacheLibraryTracks,
  manualCacheTasks,
  availabilitySummary,
  memberTransferSummaries,
  localMemberState,
  peerDiagnostics,
  peerRecentEvents,
  iceConfigSource,
  iceConfigStatus,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom,
  onFilesSelected,
  onAddToQueue,
  onDeleteTrack,
  onPlayTrack,
  onStartManualCacheDownload,
  onPauseManualCacheDownload,
  onAddCachedLibraryTrackToLibrary,
  onExportCachedLibraryTrack,
  onDeleteCachedLibraryTrack,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  socket,
  onTabChange,
  onDiagnosticsVisibilityChange
}: RoomDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("queue");

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setActiveTab((prev) => (prev === "queue" ? "library" : prev));
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTabChange = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      if (tab !== "members") {
        onDiagnosticsVisibilityChange?.(false);
      }
      onTabChange?.(tab);
    },
    [onDiagnosticsVisibilityChange, onTabChange]
  );

  return (
    <div className="relative flex min-h-[calc(100dvh-112px)] w-full flex-col overflow-visible lg:h-[calc(100dvh-80px)] lg:min-h-0 lg:flex-row lg:gap-0 lg:overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {isPlaying ? (
          <div className="absolute left-1/2 top-24 h-[58vw] w-[58vw] -translate-x-1/2 rounded-full bg-accent/6 blur-[110px] sm:h-[46vw] sm:w-[46vw] lg:left-[28%] lg:top-1/4" />
        ) : null}
      </div>

      {/* ══════ LEFT: Immersive Stage ══════ */}
      <div className="relative z-10 flex min-h-[min(38svh,25rem)] w-full shrink-0 flex-col sm:min-h-[min(50svh,32rem)] lg:h-full lg:min-h-0 lg:flex-[3] lg:min-w-0 lg:overflow-hidden">

        {/* Vinyl + Track Info */}
        <div className="lg:flex-[2] lg:min-h-0">
          <RoomStage
            roomSnapshot={roomSnapshot}
            currentTrack={currentTrack}
            currentTrackDuration={currentTrackDuration}
            isPlaying={isPlaying}
            activeSession={activeSession}
            host={host}
            canDeleteRoom={canDeleteRoom}
            canDisbandRoom={canDisbandRoom}
            currentSourceOwnerNickname={currentSourceOwnerNickname}
            mediaConnectionState={mediaConnectionState}
            mediaConnectedPeersCount={mediaConnectedPeersCount}
            iceConfigSource={iceConfigSource}
            onCopyJoinCode={onCopyJoinCode}
            onLeaveRoom={onLeaveRoom}
            onDeleteRoom={onDeleteRoom}
            socket={socket}
            hideChat
          />
        </div>

        {/* Inline Queue — desktop only */}
        <div className="hidden lg:flex lg:flex-[1] lg:min-h-[120px] flex-col border-t border-white/[0.06] overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-6 py-3 xl:px-8">
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider">播放队列</h3>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/30">{roomSnapshot.queue.length} 首</span>
          </div>
          <div className="hide-scrollbar flex-1 min-h-0 overflow-y-auto px-5 pb-4 xl:px-7">
            <QueuePanel
              queue={roomSnapshot.queue}
              tracks={roomSnapshot.tracks}
              currentQueueItemId={roomSnapshot.room.playback.currentQueueItemId ?? null}
              activeSession={activeSession}
              hostId={roomSnapshot.room.hostId}
              canControlPlayback={canControlPlayback}
              canReorderQueue={canReorderQueue}
              onPlayQueueItem={onPlayQueueItem}
              onRemoveQueueItem={onRemoveQueueItem}
              onReorderQueue={onReorderQueue}
              onAddToQueue={onAddToQueue}
            />
          </div>
        </div>

        {/* Chat — desktop only, pinned at bottom */}
        <div className="hidden lg:block shrink-0 border-t border-white/[0.06] px-6 py-3 xl:px-8">
          <RoomChatOverlay
            roomId={roomSnapshot.room.id}
            activeSession={activeSession}
            socket={socket}
            compact
          />
        </div>
      </div>

      {/* ══════ RIGHT: Management Panel ══════ */}
      <div className="relative z-20 flex w-full min-h-0 flex-1 flex-col rounded-t-[24px] border-t border-white/[0.06] bg-[#050505]/94 backdrop-blur-2xl lg:min-h-0 lg:flex-[2] lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-[-20px_0_50px_rgba(0,0,0,0.5)]">
        <div className="sticky top-0 z-30 shrink-0 border-b border-white/5 bg-gradient-to-b from-[#050505] via-[#050505]/98 to-[#050505]/72 px-4 pb-3 pt-3 sm:px-6 sm:pt-5">
          <div className="mb-3 hidden grid-cols-3 gap-2 text-[10px] font-medium text-foreground-muted lg:grid">
            <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-2">
              <span className="block font-mono uppercase tracking-[0.16em] text-white/[0.35]">Audio</span>
              <strong className="mt-1 block truncate text-xs font-semibold text-white">
                {localMemberState?.playbackStatus.label ?? mediaConnectionState}
              </strong>
            </div>
            <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-2">
              <span className="block font-mono uppercase tracking-[0.16em] text-white/[0.35]">Peers</span>
              <strong className="mt-1 block truncate text-xs font-semibold text-white">
                Data {connectedPeersCount} / Media {mediaConnectedPeersCount}
              </strong>
            </div>
            <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2.5 py-2">
              <span className="block font-mono uppercase tracking-[0.16em] text-white/[0.35]">ICE</span>
              <strong className="mt-1 block truncate text-xs font-semibold text-white">
                {iceConfigSource}
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
            {(["queue", "library", "cache", "members"] as TabId[]).map((tab) => (
              <button
                key={tab}
                data-testid={`room-tab-${tab}`}
                onClick={() => handleTabChange(tab)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
                  tab === "queue" ? "lg:hidden " : ""
                }${
                  activeTab === tab
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-white/50 hover:bg-white/5 hover:text-white/80"
                }`}
                type="button"
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>
        </div>

        <div className="hide-scrollbar flex-1 overflow-y-auto px-4 pb-44 pt-5 sm:px-6 lg:pb-32">
          {activeTab === "queue" ? (
            <div className="animate-fade-in flex w-full flex-col gap-8 lg:hidden">
              <QueuePanel
                queue={roomSnapshot.queue}
                tracks={roomSnapshot.tracks}
                currentQueueItemId={roomSnapshot.room.playback.currentQueueItemId ?? null}
                activeSession={activeSession}
                hostId={roomSnapshot.room.hostId}
                canControlPlayback={canControlPlayback}
                canReorderQueue={canReorderQueue}
                onPlayQueueItem={onPlayQueueItem}
                onRemoveQueueItem={onRemoveQueueItem}
                onReorderQueue={onReorderQueue}
                onAddToQueue={onAddToQueue}
              />
            </div>
          ) : null}

          {activeTab === "library" ? (
            <LibraryTabPanel
              tracks={roomSnapshot.tracks}
              uploadedTracks={uploadedTracks}
              cacheLibraryTracks={cacheLibraryTracks}
              canControlPlayback={canControlPlayback}
              activeSession={activeSession}
              onFilesSelected={onFilesSelected}
              onAddToQueue={onAddToQueue}
              onDeleteTrack={onDeleteTrack}
              onPlayTrack={onPlayTrack}
            />
          ) : null}

          {activeTab === "cache" ? (
            <CacheTabPanel
              tracks={roomSnapshot.tracks}
              availabilitySummary={availabilitySummary}
              activeSession={activeSession}
              cacheLibraryTracks={cacheLibraryTracks}
              manualCacheTasks={manualCacheTasks}
              onStartManualCacheDownload={onStartManualCacheDownload}
              onPauseManualCacheDownload={onPauseManualCacheDownload}
              onAddCachedLibraryTrackToLibrary={onAddCachedLibraryTrackToLibrary}
              onExportCachedLibraryTrack={onExportCachedLibraryTrack}
              onDeleteCachedLibraryTrack={onDeleteCachedLibraryTrack}
            />
          ) : null}

          {activeTab === "members" ? (
            <MembersTabPanel
              members={roomSnapshot.room.members}
              memberTransferSummaries={memberTransferSummaries}
              localMemberState={localMemberState}
              availabilitySummary={availabilitySummary}
              connectedPeersCount={connectedPeersCount}
              mediaConnectedPeersCount={mediaConnectedPeersCount}
              cachedTrackCount={cachedTrackCount}
              peerDiagnostics={peerDiagnostics}
              peerRecentEvents={peerRecentEvents}
              iceConfigSource={iceConfigSource}
              iceConfigStatus={iceConfigStatus}
              onDiagnosticsVisibilityChange={onDiagnosticsVisibilityChange}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const RoomDashboardView = memo(RoomDashboardViewBase);
