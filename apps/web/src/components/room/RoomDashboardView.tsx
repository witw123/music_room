"use client";

import type {
  GuestSession,
  Playlist,
  RoomMediaConnectionState,
  RoomMember,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { RoomStage } from "./RoomStage";
import { TrackListSection } from "./TrackListSection";
import { PlaylistPanel } from "./PlaylistPanel";
import { MembersPanel } from "./MembersPanel";
import { MeshStatusPanel } from "./MeshStatusPanel";
import type { AvailabilityEntry } from "./MeshStatusPanel";

type RoomDashboardViewProps = {
  roomSnapshot: RoomSnapshot;
  currentTrack: TrackMeta | null;
  currentTrackDuration: number;
  isPlaying: boolean;
  activeSession: GuestSession | null;
  host: RoomMember | undefined;
  canControlPlayback: boolean;
  canDeleteRoom: boolean;
  currentSourceOwnerNickname: string | null;
  uploadedTracks: Record<string, { objectUrl: string }>;
  connectedPeersCount: number;
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  cachedTrackCount: number;
  playlists: Playlist[];
  availabilitySummary: AvailabilityEntry[];
  onCopyJoinCode: () => Promise<void>;
  onLeaveRoom: () => void;
  onDeleteRoom: () => void;
  onFilesSelected: (files: FileList | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
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
  currentSourceOwnerNickname,
  uploadedTracks,
  connectedPeersCount,
  mediaConnectionState,
  mediaConnectedPeersCount,
  cachedTrackCount,
  playlists,
  availabilitySummary,
  onCopyJoinCode,
  onLeaveRoom,
  onDeleteRoom,
  onFilesSelected,
  onAddToQueue,
  onPlayTrack,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onUpdatePlaylistTitle,
  onDeletePlaylist
}: RoomDashboardViewProps) {
  const canCreatePlaylist = roomSnapshot.queue.length > 0;

  return (
    <div className="room-dashboard">
      <RoomStage
        roomSnapshot={roomSnapshot}
        currentTrack={currentTrack}
        currentTrackDuration={currentTrackDuration}
        isPlaying={isPlaying}
        activeSession={activeSession}
        host={host}
        canDeleteRoom={canDeleteRoom}
        currentSourceOwnerNickname={currentSourceOwnerNickname}
        mediaConnectionState={mediaConnectionState}
        mediaConnectedPeersCount={mediaConnectedPeersCount}
        onCopyJoinCode={onCopyJoinCode}
        onLeaveRoom={onLeaveRoom}
        onDeleteRoom={onDeleteRoom}
      />

      <div className="room-workbench">
        <div className="room-workbench-main">
          <TrackListSection
            tracks={roomSnapshot.tracks}
            uploadedTracks={uploadedTracks}
            canControlPlayback={canControlPlayback}
            onFilesSelected={onFilesSelected}
            onAddToQueue={onAddToQueue}
            onPlayTrack={onPlayTrack}
          />
        </div>

        <div className="room-workbench-side">
          <PlaylistPanel
            playlists={playlists}
            activeSession={activeSession}
            canCreatePlaylist={canCreatePlaylist}
            onSavePlaylistFromQueue={onSavePlaylistFromQueue}
            onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
            onUpdatePlaylistTitle={onUpdatePlaylistTitle}
            onDeletePlaylist={onDeletePlaylist}
          />

          <MembersPanel members={roomSnapshot.room.members} />

          <MeshStatusPanel
            availabilitySummary={availabilitySummary}
            connectedPeersCount={connectedPeersCount}
            cachedTrackCount={cachedTrackCount}
          />
        </div>
      </div>
    </div>
  );
}
