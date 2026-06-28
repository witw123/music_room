"use client";

import { memo, useMemo } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { TrackListSection } from "./TrackListSection";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";

type LibraryTabPanelProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  cacheLibraryTracks: CachedLibraryTrack[];
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
};

function LibraryTabPanelBase(props: LibraryTabPanelProps) {
  const cachedLibraryFileHashes = useMemo(
    () => props.cacheLibraryTracks.map((track) => track.fileHash),
    [props.cacheLibraryTracks]
  );

  return (
    <div className="animate-fade-in flex w-full flex-col gap-8">
      <TrackListSection
        {...props}
        cachedLibraryFileHashes={cachedLibraryFileHashes}
      />
    </div>
  );
}

export const LibraryTabPanel = memo(LibraryTabPanelBase);
