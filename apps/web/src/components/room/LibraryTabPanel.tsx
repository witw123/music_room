"use client";

import { memo, useState } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { TrackListSection } from "./TrackListSection";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import { Button } from "@/components/ui/button";

type LibraryTabPanelProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onSaveTrackToLocal: (track: TrackMeta) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
  localStorageSummary: LocalStorageSummary;
  onCleanLocalStorage: () => Promise<void>;
  onChooseLocalFolder: () => Promise<void>;
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
  onChooseLocalFolder,
  ...trackListProps
}: LibraryTabPanelProps) {
  const [isCleaning, setIsCleaning] = useState(false);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);

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

  const handleChooseFolder = async () => {
    if (isChoosingFolder) return;
    setIsChoosingFolder(true);
    try {
      await onChooseLocalFolder();
    } catch {
      // The room status surface reports the folder selection failure.
    } finally {
      setIsChoosingFolder(false);
    }
  };

  return (
    <div className="animate-fade-in flex w-full flex-col gap-8">
      <div className="flex flex-col gap-3 border-b border-surface-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">本机存储</p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted" title={localStorageSummary.localFolderName ?? undefined}>
            浏览器缓存 {formatBytes(localStorageSummary.usageBytes)} · {localStorageSummary.cachedTrackCount} 首记录
          </p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted/70">
            {localStorageSummary.localFolderName
              ? `本地文件夹：${localStorageSummary.localFolderName} · 已保存 ${localStorageSummary.localSavedFileHashes.length} 首`
              : localStorageSummary.supportsLocalFolder
                ? "尚未选择本地文件夹"
                : "当前浏览器保存时将使用下载"
            }
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {localStorageSummary.supportsLocalFolder ? (
            <Button
              data-testid="choose-local-folder-button"
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={isChoosingFolder}
              onClick={() => void handleChooseFolder()}
              type="button"
            >
              {isChoosingFolder ? "选择中…" : localStorageSummary.localFolderName ? "更改文件夹" : "选择文件夹"}
            </Button>
          ) : null}
          <Button
            data-testid="clean-local-storage-button"
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={isCleaning}
            onClick={() => void handleClean()}
            title="清理当前房间之外和已失效的本机音频数据"
            type="button"
          >
            {isCleaning ? "清理中…" : "清理无效存储"}
          </Button>
        </div>
      </div>
      <TrackListSection
        {...trackListProps}
        localSavedFileHashes={localStorageSummary.localSavedFileHashes}
      />
    </div>
  );
}

export const LibraryTabPanel = memo(LibraryTabPanelBase);
