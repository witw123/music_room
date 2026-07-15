"use client";

import { memo, useState } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { TrackListSection } from "./TrackListSection";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import { Button } from "@/components/ui/button";
import { NeteaseSourcePanel } from "./NeteaseSourcePanel";
import type { NeteaseTrackCandidate } from "@music-room/shared";

type LibraryTabPanelProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  localStorageSummary: LocalStorageSummary;
  onCleanLocalStorage: () => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
};

function formatBytes(value: number | null) {
  if (value === null) return "不可用";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function LibraryTabPanelBase({
  localStorageSummary,
  onCleanLocalStorage,
  ...trackListProps
}: LibraryTabPanelProps) {
  const [isCleaning, setIsCleaning] = useState(false);

  const handleClean = async () => {
    if (isCleaning) return;
    setIsCleaning(true);
    try {
      await onCleanLocalStorage();
    } catch {
      // The room status surface reports the cleanup failure.
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="animate-fade-in flex w-full flex-col gap-8">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border pb-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">本机存储</p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted">
            {formatBytes(localStorageSummary.usageBytes)} · {localStorageSummary.cachedTrackCount} 首本地上传
          </p>
        </div>
        <Button
          data-testid="clean-local-storage-button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          disabled={isCleaning}
          onClick={() => void handleClean()}
          title="清理当前房间之外和已失效的本机音频数据"
          type="button"
        >
          {isCleaning ? "清理中…" : "清理无效存储"}
        </Button>
      </div>
      {process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? (
        <NeteaseSourcePanel
          activeSession={trackListProps.activeSession}
          onImportTrack={trackListProps.onImportNeteaseTrack}
        />
      ) : null}
      <TrackListSection
        {...trackListProps}
      />
    </div>
  );
}

export const LibraryTabPanel = memo(LibraryTabPanelBase);
