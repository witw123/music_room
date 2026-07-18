"use client";

import { memo, useState } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import type { CachedLibraryTrack, UploadedTrack } from "@/features/upload/audio-utils";
import { TrackListSection } from "./TrackListSection";
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
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
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
  onImportCachedTrack,
  ...trackListProps
}: LibraryTabPanelProps) {
  const [isCleaning, setIsCleaning] = useState(false);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [pendingCachedImport, setPendingCachedImport] = useState<string | null>(null);

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

  const handleImportCachedTrack = async (track: CachedLibraryTrack) => {
    if (pendingCachedImport) return;
    setPendingCachedImport(track.fileHash);
    try {
      await onImportCachedTrack(track);
    } finally {
      setPendingCachedImport(null);
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
              ? `Music Room：${localStorageSummary.localFolderName} · cache ${localStorageSummary.localCachedFileHashes.length} 首 · saved ${localStorageSummary.localSavedFileHashes.length} 首`
              : localStorageSummary.supportsLocalFolder
                ? "尚未选择 Music Room 根文件夹"
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
              {isChoosingFolder
                ? "选择中…"
                : localStorageSummary.localFolderName
                  ? "更改根文件夹"
                  : "选择根文件夹"}
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
      <CachedLibrarySection
        cachedTracks={localStorageSummary.cachedLibraryTracks}
        roomTracks={trackListProps.tracks}
        localFolderName={localStorageSummary.localFolderName}
        onImportCachedTrack={handleImportCachedTrack}
        pendingCachedImport={pendingCachedImport}
      />
      <TrackListSection
        {...trackListProps}
        localSavedFileHashes={localStorageSummary.localSavedFileHashes}
      />
    </div>
  );
}

function CachedLibrarySection({
  cachedTracks,
  roomTracks,
  localFolderName,
  onImportCachedTrack,
  pendingCachedImport
}: {
  cachedTracks: CachedLibraryTrack[];
  roomTracks: TrackMeta[];
  localFolderName: string | null;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  pendingCachedImport: string | null;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const roomFileHashes = new Set(roomTracks.map((track) => track.fileHash));

  return (
    <section className="flex flex-col gap-3 border-b border-surface-border pb-5" data-testid="cached-library-section">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          data-testid="cached-library-toggle"
          aria-expanded={isExpanded}
          aria-controls="cached-library-content"
          onClick={() => setIsExpanded((current) => !current)}
          className="flex min-w-0 items-start gap-2 text-left"
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm text-foreground-muted transition-transform ${isExpanded ? "rotate-0" : "-rotate-90"}`}
          >
            ⌄
          </span>
          <span className="min-w-0">
          <p className="text-xs font-semibold text-foreground">本地缓存</p>
          <p className="mt-1 text-[10px] text-foreground-muted">
            {localFolderName
              ? `已从 ${localFolderName}/cache 加载 ${cachedTracks.length} 首歌曲`
              : "选择本地根文件夹后，这里会显示可导入的缓存歌曲"}
          </p>
          </span>
        </button>
        <span className="shrink-0 font-mono text-[10px] text-foreground-muted">
          {cachedTracks.length} 首
        </span>
      </div>

      {isExpanded ? (
        <div id="cached-library-content">
          {cachedTracks.length > 0 ? (
            <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
              {cachedTracks.map((track) => {
                const isInRoom = roomFileHashes.has(track.fileHash);
                const isPending = pendingCachedImport === track.fileHash;
                return (
                  <article key={track.fileHash} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                      <p className="mt-1 truncate text-[10px] text-foreground-muted">
                        {track.artist} · {formatDuration(track.durationMs)} · {track.fileHash.slice(0, 8)}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid="cached-track-import-button"
                      data-file-hash={track.fileHash}
                      disabled={isInRoom || pendingCachedImport !== null}
                      onClick={() => void onImportCachedTrack(track)}
                      className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                        isInRoom
                          ? "cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                          : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
                      }`}
                    >
                      {isInRoom ? "已在本房间" : isPending ? "导入中…" : "导入曲库"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-surface-border px-4 py-4 text-xs text-foreground-muted">
              {localFolderName
                ? "当前本地 cache 目录没有可导入歌曲。"
                : "尚未连接本地 cache 目录。"}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export const LibraryTabPanel = memo(LibraryTabPanelBase);
