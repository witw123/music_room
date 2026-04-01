"use client";

import { useState } from "react";
import type {
  AuthSession,
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  Playlist,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { RoomStage } from "./RoomStage";
import { TrackListSection } from "./TrackListSection";
import { QueuePanel } from "./QueuePanel";
import { PlaylistPanel } from "./PlaylistPanel";
import { MembersPanel } from "./MembersPanel";
import type { MemberTransferSummary } from "./MembersPanel";
import { MeshStatusPanel } from "./MeshStatusPanel";
import type { AvailabilityEntry } from "./MeshStatusPanel";

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
  uploadedTracks: Record<string, { objectUrl: string }>;
  connectedPeersCount: number;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  playlists: Playlist[];
  tracks: TrackMeta[];
  availabilitySummary: AvailabilityEntry[];
  memberTransferSummaries: MemberTransferSummary[];
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
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
  socket: any;
  onTabChange?: (tab: TabId) => void;
};

type TabId = "queue" | "library" | "members";

const tabLabels: Record<TabId, string> = {
  queue: "共享队列",
  library: "曲库与歌单",
  members: "成员与诊断"
};

export function RoomDashboardView({
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
  playlists,
  tracks,
  availabilitySummary,
  memberTransferSummaries,
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
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist,
  socket,
  onTabChange
}: RoomDashboardViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("queue");
  const canCreatePlaylist = roomSnapshot.queue.length > 0;

  function handleTabChange(tab: TabId) {
    setActiveTab(tab);
    onTabChange?.(tab);
  }

  return (
    <div className="relative flex min-h-[calc(100dvh-112px)] w-full flex-col overflow-visible lg:h-[calc(100vh-140px)] lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {isPlaying ? (
          <div className="absolute left-1/2 top-24 h-[58vw] w-[58vw] -translate-x-1/2 rounded-full bg-accent/6 blur-[110px] sm:h-[46vw] sm:w-[46vw] lg:left-1/4 lg:top-1/4 lg:translate-x-0" />
        ) : null}
      </div>

      <div className="relative z-10 flex min-h-[min(54svh,34rem)] w-full shrink-0 flex-col lg:h-full lg:w-[55%] xl:w-[60%]">
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
          onCopyJoinCode={onCopyJoinCode}
          onLeaveRoom={onLeaveRoom}
          onDeleteRoom={onDeleteRoom}
          socket={socket}
        />
      </div>

      <div className="relative z-20 flex w-full min-h-0 flex-1 flex-col rounded-t-[28px] border-t border-white/8 bg-[#050505]/92 backdrop-blur-2xl lg:min-h-0 lg:rounded-none lg:rounded-tl-[28px] lg:border-l lg:border-t-0 lg:shadow-[-20px_0_50px_rgba(0,0,0,0.5)]">
        <div className="sticky top-0 z-30 shrink-0 border-b border-white/5 bg-gradient-to-b from-[#050505] via-[#050505]/98 to-[#050505]/70 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
            {(["queue", "library", "members"] as TabId[]).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
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
            <div className="animate-fade-in flex w-full flex-col gap-8">
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
            <div className="animate-fade-in flex w-full flex-col gap-8">
              <TrackListSection
                tracks={roomSnapshot.tracks}
                uploadedTracks={uploadedTracks}
                canControlPlayback={canControlPlayback}
                activeSession={activeSession}
                onFilesSelected={onFilesSelected}
                onAddToQueue={onAddToQueue}
                onDeleteTrack={onDeleteTrack}
                onPlayTrack={onPlayTrack}
              />

              <div className="h-px w-full shrink-0 bg-white/5" />

              <PlaylistPanel
                playlists={playlists}
                tracks={tracks}
                activeSession={activeSession}
                canCreatePlaylist={canCreatePlaylist}
                onSavePlaylistFromQueue={onSavePlaylistFromQueue}
                onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
                onUpdatePlaylistTitle={onUpdatePlaylistTitle}
                onUpdatePlaylistTracks={onUpdatePlaylistTracks}
                onDeletePlaylist={onDeletePlaylist}
              />
            </div>
          ) : null}

          {activeTab === "members" ? (
            <div className="animate-fade-in flex w-full flex-col gap-8">
              <MembersPanel
                members={roomSnapshot.room.members}
                memberTransferSummaries={memberTransferSummaries}
              />

              <div className="h-px w-full shrink-0 bg-white/5" />

              <MeshStatusPanel
                availabilitySummary={availabilitySummary}
                connectedPeersCount={connectedPeersCount}
                mediaConnectedPeersCount={mediaConnectedPeersCount}
                cachedTrackCount={cachedTrackCount}
                peerDiagnostics={peerDiagnostics}
                recentEvents={peerRecentEvents}
                iceConfigSource={iceConfigSource}
                iceConfigStatus={iceConfigStatus}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
