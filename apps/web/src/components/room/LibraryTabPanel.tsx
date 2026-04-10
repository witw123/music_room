"use client";

import { memo } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { TrackListSection } from "./TrackListSection";
import type { UploadedTrack } from "@/features/upload/audio-utils";

type LibraryTabPanelProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
};

function LibraryTabPanelBase(props: LibraryTabPanelProps) {
  return (
    <div className="animate-fade-in flex w-full flex-col gap-8">
      <TrackListSection {...props} />
    </div>
  );
}

export const LibraryTabPanel = memo(LibraryTabPanelBase);
