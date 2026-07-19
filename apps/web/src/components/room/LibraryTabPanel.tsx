"use client";

import { memo } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { TrackListSection } from "./TrackListSection";

type LibraryTabPanelProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  localSavedFileHashes: string[];
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
  onSaveTrackToLocal: (track: TrackMeta) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
};

function LibraryTabPanelBase({
  tracks,
  uploadedTracks,
  localSavedFileHashes,
  canControlPlayback,
  activeSession,
  onFilesSelected,
  onAddToQueue,
  onSaveTrackToLocal,
  onDeleteTrack,
  onPlayTrack
}: LibraryTabPanelProps) {
  return (
    <div className="animate-fade-in flex w-full flex-col gap-4">
      <TrackListSection
        tracks={tracks}
        uploadedTracks={uploadedTracks}
        localSavedFileHashes={localSavedFileHashes}
        canControlPlayback={canControlPlayback}
        activeSession={activeSession}
        onFilesSelected={onFilesSelected}
        onAddToQueue={onAddToQueue}
        onSaveTrackToLocal={onSaveTrackToLocal}
        onDeleteTrack={onDeleteTrack}
        onPlayTrack={onPlayTrack}
      />
    </div>
  );
}

export const LibraryTabPanel = memo(LibraryTabPanelBase);
