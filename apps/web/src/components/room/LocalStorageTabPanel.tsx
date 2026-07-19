"use client";

import { memo, useEffect, useState } from "react";
import type { AuthSession, Playlist, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";
import { Button } from "@/components/ui/button";
import { PlaylistPanel } from "./PlaylistPanel";

type LocalStorageTabPanelProps = {
  tracks: TrackMeta[];
  playlists: Playlist[];
  activeSession: AuthSession | null;
  localStorageSummary: LocalStorageSummary;
  onCleanLocalStorage: () => Promise<void>;
  onChooseLocalFolder: () => Promise<void>;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

function formatBytes(value: number | null) {
  if (value === null) return "不可用";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function LocalStorageTabPanelBase({
  tracks,
  playlists,
  activeSession,
  localStorageSummary,
  onCleanLocalStorage,
  onChooseLocalFolder,
  onImportCachedTrack,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist
}: LocalStorageTabPanelProps) {
  const [isCleaning, setIsCleaning] = useState(false);
  const [isChoosingFolder, setIsChoosingFolder] = useState(false);
  const [pendingCachedImport, setPendingCachedImport] = useState<string | null>(null);
  const [playlistTab, setPlaylistTab] = useState<"local" | "network">("local");

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
    <div className="animate-fade-in flex w-full flex-col gap-5">
      <div className="flex flex-col gap-3 border-b border-surface-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">本地音乐</p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted" title={localStorageSummary.localFolderName ?? undefined}>
            本地目录 {formatBytes(localStorageSummary.usageBytes)} · {localStorageSummary.cachedTrackCount} 首记录
          </p>
          <p className="mt-1 truncate text-[10px] text-foreground-muted/70">
            {localStorageSummary.localFolderName
              ? `Music Room：${localStorageSummary.localFolderName} · 已合并 ${localStorageSummary.localCachedFileHashes.length + localStorageSummary.localSavedFileHashes.length} 首`
              : localStorageSummary.supportsLocalFolder
                ? "尚未选择 Music Room 根文件夹"
                : "当前浏览器保存时将使用下载"}
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
      <div className="flex w-full max-w-xl gap-1 rounded-xl border border-surface-border bg-surface/40 p-1" role="tablist" aria-label="歌单类型">
        <button
          aria-selected={playlistTab === "local"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "local" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("local")}
          role="tab"
          type="button"
        >
          本地歌单
        </button>
        <button
          aria-selected={playlistTab === "network"}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${playlistTab === "network" ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          onClick={() => setPlaylistTab("network")}
          role="tab"
          type="button"
        >
          网络歌单
        </button>
      </div>
      {playlistTab === "local" ? <section className="flex flex-col gap-3" data-testid="local-playlist-section">
        <div className="border-b border-surface-border pb-3">
          <p className="text-sm font-semibold text-foreground">本地歌单</p>
          <p className="mt-1 text-xs text-foreground-muted">本地目录中的下载歌曲、缓存歌曲和已保存歌曲。</p>
        </div>
        <LocalPlaylistSection
          localTracks={localStorageSummary.localPlaylistTracks}
          fallbackTracks={localStorageSummary.cachedLibraryTracks}
          roomTracks={tracks}
          localFolderName={localStorageSummary.localFolderName}
          onImportCachedTrack={handleImportCachedTrack}
          pendingCachedImport={pendingCachedImport}
        />
      </section> : null}
      {playlistTab === "network" ? <section className="flex flex-col gap-3" data-testid="network-playlist-section">
        <PlaylistPanel
          activeSession={activeSession}
          canCreatePlaylist={!!activeSession}
          onDeletePlaylist={onDeletePlaylist}
          onLoadPlaylistIntoRoom={onLoadPlaylistIntoRoom}
          onSavePlaylistFromQueue={onSavePlaylistFromQueue}
          onUpdatePlaylistTitle={onUpdatePlaylistTitle}
          onUpdatePlaylistTracks={onUpdatePlaylistTracks}
          playlists={playlists}
        />
      </section> : null}
    </div>
  );
}

function LocalPlaylistSection({
  localTracks,
  fallbackTracks,
  roomTracks,
  localFolderName,
  onImportCachedTrack,
  pendingCachedImport
}: {
  localTracks: LocalPlaylistTrackRecord[];
  fallbackTracks: CachedLibraryTrack[];
  roomTracks: TrackMeta[];
  localFolderName: string | null;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  pendingCachedImport: string | null;
}) {
  const importable = localTracks
    .filter((track) => track.availableOffline && track.fileHash)
    .map((track) => ({
      fileHash: track.fileHash!,
      title: track.title,
      artist: track.artist,
      mimeType: track.mimeType,
      durationMs: track.durationMs,
      sizeBytes: track.sizeBytes,
      cachedAt: track.updatedAt,
      sourceTrackIds: track.providerTrackId ? [track.providerTrackId] : [],
      sourceRoomIds: [],
      lastSourceTrackId: track.providerTrackId,
      lastSourceRoomId: null,
      lastOwnerNickname: null
    } satisfies CachedLibraryTrack));
  const byHash = new Map<string, CachedLibraryTrack>();
  for (const track of [...importable, ...fallbackTracks]) {
    if (!byHash.has(track.fileHash)) {
      byHash.set(track.fileHash, track);
    }
  }
  const visibleImportable = [...byHash.values()];
  const metadataOnly = localTracks.filter((track) => !track.availableOffline || !track.fileHash);

  return (
    <div className="flex flex-col gap-4">
      <CachedLibrarySection
        cachedTracks={visibleImportable}
        roomTracks={roomTracks}
        localFolderName={localFolderName}
        onImportCachedTrack={onImportCachedTrack}
        pendingCachedImport={pendingCachedImport}
      />
      {metadataOnly.length > 0 ? (
        <div className="rounded-lg border border-dashed border-surface-border px-3 py-3">
          <p className="text-xs font-semibold text-foreground">待下载歌曲</p>
          <div className="mt-2 divide-y divide-surface-border">
            {metadataOnly.map((track) => (
              <div className="flex items-center justify-between gap-3 py-2" key={track.id}>
                <div className="min-w-0"><p className="truncate text-xs text-foreground">{track.title}</p><p className="truncate text-[10px] text-foreground-muted">{track.artist} · 尚未下载音频</p></div>
                <span className="shrink-0 text-[10px] text-foreground-muted">请先下载</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
  const [selectedFileHashes, setSelectedFileHashes] = useState<string[]>([]);
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const roomFileHashes = new Set(roomTracks.map((track) => track.fileHash));
  const selectableTracks = cachedTracks.filter((track) => !roomFileHashes.has(track.fileHash));
  const selectedTracks = cachedTracks.filter((track) => selectedFileHashes.includes(track.fileHash));
  const allSelectableSelected =
    selectableTracks.length > 0 && selectableTracks.every((track) => selectedFileHashes.includes(track.fileHash));

  useEffect(() => {
    const currentRoomFileHashes = new Set(roomTracks.map((track) => track.fileHash));
    const availableHashes = new Set(
      cachedTracks
        .filter((track) => !currentRoomFileHashes.has(track.fileHash))
        .map((track) => track.fileHash)
    );
    setSelectedFileHashes((current) => {
      const next = current.filter((fileHash) => availableHashes.has(fileHash));
      return next.length === current.length ? current : next;
    });
  }, [cachedTracks, roomTracks]);

  const toggleTrackSelection = (fileHash: string) => {
    setSelectedFileHashes((current) =>
      current.includes(fileHash)
        ? current.filter((item) => item !== fileHash)
        : [...current, fileHash]
    );
  };

  const toggleSelectAll = () => {
    setSelectedFileHashes(allSelectableSelected
      ? []
      : selectableTracks.map((track) => track.fileHash));
  };

  const importSelectedTracks = async () => {
    if (isBatchImporting || selectedTracks.length === 0) return;
    setIsBatchImporting(true);
    try {
      for (const track of selectedTracks) {
        if (!roomFileHashes.has(track.fileHash)) {
          await onImportCachedTrack(track);
        }
      }
      setSelectedFileHashes([]);
    } finally {
      setIsBatchImporting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="cached-library-section">
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
            <p className="text-xs font-semibold text-foreground">本地歌曲</p>
            <p className="mt-1 text-[10px] text-foreground-muted">
              {localFolderName
                ? `已从 ${localFolderName} 加载 ${cachedTracks.length} 首歌曲`
                : "选择本地根文件夹后，这里会显示本地歌曲"}
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface/40 px-3 py-2">
                <label className="flex min-w-0 cursor-pointer items-center gap-2 text-[11px] text-foreground-muted">
                  <input
                    type="checkbox"
                    data-testid="cached-track-select-all"
                    checked={allSelectableSelected}
                    disabled={selectableTracks.length === 0 || isBatchImporting || pendingCachedImport !== null}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 accent-accent"
                  />
                  <span>{allSelectableSelected ? "取消全选" : "全选未导入歌曲"}</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-foreground-muted">
                    已选择 {selectedTracks.length} 首
                  </span>
                  <button
                    type="button"
                    data-testid="cached-track-batch-import-button"
                    disabled={selectedTracks.length === 0 || isBatchImporting || pendingCachedImport !== null}
                    onClick={() => void importSelectedTracks()}
                    className="rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBatchImporting ? "批量导入中…" : "导入所选歌曲"}
                  </button>
                </div>
              </div>
              <div className="divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border bg-surface/40">
                {cachedTracks.map((track) => {
                  const isInRoom = roomFileHashes.has(track.fileHash);
                  const isPending = pendingCachedImport === track.fileHash;
                  return (
                    <article key={track.fileHash} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          data-testid="cached-track-select-checkbox"
                          data-file-hash={track.fileHash}
                          checked={selectedFileHashes.includes(track.fileHash)}
                          disabled={isInRoom || isBatchImporting || pendingCachedImport !== null}
                          onChange={() => toggleTrackSelection(track.fileHash)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                          aria-label={`选择《${track.title}》`}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                          <p className="mt-1 truncate text-[10px] text-foreground-muted">
                            {track.artist} · {formatDuration(track.durationMs)} · {track.fileHash.slice(0, 8)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="cached-track-import-button"
                        data-file-hash={track.fileHash}
                        disabled={isInRoom || isBatchImporting || pendingCachedImport !== null}
                        onClick={() => void onImportCachedTrack(track)}
                        className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                          isInRoom
                            ? "cursor-default border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                            : "border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"}`}
                      >
                        {isInRoom ? "已在本房间" : isPending ? "导入中…" : "导入曲库"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-surface-border px-4 py-4 text-xs text-foreground-muted">
              {localFolderName ? "当前本地目录没有歌曲。" : "尚未选择本地目录。"}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export const LocalStorageTabPanel = memo(LocalStorageTabPanelBase);
