"use client";

import { memo, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  AuthSession,
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  Playlist,
  QqMusicAccountStatus,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import type { CachedLibraryTrack } from "@/features/upload/audio-utils";
import type { LocalStorageSummary } from "@/features/upload/use-track-uploads";
import {
  hashAudioBlob,
  toLocalPlaylistTrackInput
} from "@/features/playlist/local-playlist";
import {
  ensureLocalAudioDirectoryWriteAccess,
  saveAudioFileToLocalDirectory
} from "@/features/upload/local-audio-storage";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { upsertLocalPlaylistTrack, type LocalPlaylistTrackRecord } from "@/lib/indexeddb";
import { PlaylistPanel } from "./PlaylistPanel";

type Provider = "netease" | "qqmusic";
type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;

const enabledSearchProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

type LocalStorageTabPanelProps = {
  roomId: string;
  tracks: TrackMeta[];
  playlists: Playlist[];
  activeSession: AuthSession | null;
  localStorageSummary: LocalStorageSummary;
  onCleanLocalStorage: () => Promise<void>;
  onChooseLocalFolder: () => Promise<void>;
  onRefreshLocalStorage: () => Promise<void>;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onImportNeteaseTrack: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack: (track: QqMusicTrackCandidate) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

function LocalStorageTabPanelBase({
  roomId,
  tracks,
  playlists,
  activeSession,
  localStorageSummary,
  onChooseLocalFolder,
  onImportCachedTrack,
  onRefreshLocalStorage,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist
}: LocalStorageTabPanelProps) {
  const [pendingCachedImport, setPendingCachedImport] = useState<string | null>(null);
  const [playlistTab, setPlaylistTab] = useState<"local" | "network">("local");

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
        <LocalPlaylistSearch
          roomId={roomId}
          hasLocalFolder={!!localStorageSummary.localFolderName}
          localTracks={localStorageSummary.localPlaylistTracks}
          onChooseLocalFolder={onChooseLocalFolder}
          onRefreshLocalStorage={onRefreshLocalStorage}
        />
        <LocalPlaylistSection
          localTracks={localStorageSummary.localPlaylistTracks}
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
          onImportNeteaseTrack={onImportNeteaseTrack}
          onImportQqMusicTrack={onImportQqMusicTrack}
          onSavePlaylistFromQueue={onSavePlaylistFromQueue}
          onUpdatePlaylistTitle={onUpdatePlaylistTitle}
          onUpdatePlaylistTracks={onUpdatePlaylistTracks}
          playlists={playlists}
          tracks={tracks}
        />
      </section> : null}
    </div>
  );
}

type ProviderAccount = NeteaseAccountStatus | QqMusicAccountStatus;

function LocalPlaylistSearch({
  roomId,
  hasLocalFolder,
  localTracks,
  onChooseLocalFolder,
  onRefreshLocalStorage
}: {
  roomId: string;
  hasLocalFolder: boolean;
  localTracks: LocalPlaylistTrackRecord[];
  onChooseLocalFolder: () => Promise<void>;
  onRefreshLocalStorage: () => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [provider, setProvider] = useState<Provider>(enabledSearchProviders[0] ?? "netease");
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<ProviderTrack[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded || enabledSearchProviders.length === 0) return;
    let cancelled = false;
    setAccount(null);
    setResults([]);
    setErrorMessage(null);
    const load = provider === "netease"
      ? musicRoomApi.getNeteaseAccount
      : musicRoomApi.getQqMusicAccount;
    void load()
      .then((nextAccount) => {
        if (!cancelled) setAccount(nextAccount);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(toLocalSearchErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, provider]);

  if (enabledSearchProviders.length === 0) {
    return (
      <section className="flex flex-col gap-1 border-b border-surface-border pb-3" data-testid="local-playlist-search">
        <span className="text-sm font-semibold text-foreground">搜索歌曲并下载</span>
        <span className="text-xs text-foreground-muted">网易云音乐和 QQ 音乐当前未启用，请先在服务端配置对应平台。</span>
      </section>
    );
  }

  const providerName = provider === "netease" ? "网易云音乐" : "QQ 音乐";
  const isConnected = account?.connected === true;
  const importedTrackIds = new Set(
    localTracks
      .filter((track) => track.provider === provider && track.providerTrackId)
      .map((track) => track.providerTrackId)
  );

  const searchTracks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pending || !isConnected) return;
    setPending("search");
    setErrorMessage(null);
    setMessage(null);
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(query)
        : await musicRoomApi.searchQqMusicTracks(query);
      setResults(await enrichSearchResults(response.items));
      if (response.items.length === 0) setMessage("没有找到匹配的歌曲。");
    } catch (error) {
      setErrorMessage(toLocalSearchErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const downloadTrack = async (candidate: ProviderTrack) => {
    if (pending) return;
    setPending(`download:${candidate.providerTrackId}`);
    setErrorMessage(null);
    setMessage(null);
    try {
      let hasWriteAccess = hasLocalFolder && await ensureLocalAudioDirectoryWriteAccess();
      if (!hasWriteAccess) {
        await onChooseLocalFolder();
        hasWriteAccess = await ensureLocalAudioDirectoryWriteAccess();
      }
      if (!hasWriteAccess) {
        throw new Error("请先选择本地歌曲保存位置。");
      }

      const detail = await (candidate.provider === "netease"
        ? musicRoomApi.getNeteaseTrack(candidate.providerTrackId)
        : musicRoomApi.getQqMusicTrack(candidate.providerTrackId)
      ).catch(() => null);
      const track = detail
        ? {
            ...candidate,
            ...detail,
            artworkUrl: detail.artworkUrl ?? candidate.artworkUrl
          }
        : candidate;
      const source = candidate.provider === "netease"
        ? await musicRoomApi.downloadNeteaseTrack(candidate.providerTrackId, "exhigh", undefined, roomId)
        : await musicRoomApi.downloadQqMusicTrack(candidate.providerTrackId, "exhigh", undefined, roomId);
      const fileHash = await hashAudioBlob(source.blob);
      const mimeType = normalizeLocalDownloadMimeType(source.contentType || source.blob.type);
      const lyrics = await getProviderLyrics(track);
      const saved = await saveAudioFileToLocalDirectory({
        file: source.blob,
        fileHash,
        title: track.title,
        mimeType
      });
      await upsertLocalPlaylistTrack(toLocalPlaylistTrackInput({
        track,
        lyrics,
        fileHash,
        fileName: saved.fileName,
        sizeBytes: source.blob.size,
        mimeType,
        availableOffline: true
      }));
      await onRefreshLocalStorage();
      setMessage(`《${track.title}》已下载到本地歌单。`);
    } catch (error) {
      setErrorMessage(toLocalSearchErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  async function getProviderLyrics(track: ProviderTrack) {
    try {
      return track.provider === "netease"
        ? await musicRoomApi.getNeteaseLyrics(track.providerTrackId)
        : await musicRoomApi.getQqMusicLyrics(track.providerTrackId);
    } catch {
      return null;
    }
  }

  async function enrichSearchResults(items: ProviderTrack[]) {
    const missingArtwork = items.filter((track) => !track.artworkUrl);
    const albumIds = [...new Set(
      missingArtwork
        .map((track) => track.providerAlbumId)
        .filter((albumId): albumId is string => !!albumId)
    )].slice(0, 12);
    const artworkByAlbumId = new Map<string, string>();

    await Promise.all(albumIds.map(async (albumId) => {
      try {
        const album = provider === "netease"
          ? await musicRoomApi.getNeteaseAlbum(albumId)
          : await musicRoomApi.getQqMusicAlbum(albumId);
        if (album.artworkUrl) artworkByAlbumId.set(albumId, album.artworkUrl);
      } catch {
        // Search results remain usable when a provider album endpoint is unavailable.
      }
    }));

    const tracksWithoutAlbum = missingArtwork
      .filter((track) => !track.providerAlbumId)
      .slice(0, 6);
    const artworkByTrackId = new Map<string, string>();
    await Promise.all(tracksWithoutAlbum.map(async (track) => {
      try {
        const detail = track.provider === "netease"
          ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
          : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
        if (detail.artworkUrl) artworkByTrackId.set(track.providerTrackId, detail.artworkUrl);
      } catch {
        // Keep the search candidate when detail lookup fails.
      }
    }));

    return items.map((track) => ({
      ...track,
      artworkUrl: track.artworkUrl
        ?? (track.providerAlbumId ? artworkByAlbumId.get(track.providerAlbumId) : undefined)
        ?? artworkByTrackId.get(track.providerTrackId)
        ?? null
    }));
  }

  return (
    <section className="flex flex-col gap-3 border-b border-surface-border pb-3" data-testid="local-playlist-search">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-foreground">搜索歌曲并下载</span>
          <span className="mt-1 block text-xs text-foreground-muted">从网易云音乐或 QQ 音乐下载到本地目录</span>
        </span>
        <span className={`shrink-0 text-xs text-foreground-muted transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
      </button>

      {isExpanded ? (
        <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface/35 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1" role="tablist" aria-label="下载平台">
              {enabledSearchProviders.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={provider === item}
                  onClick={() => setProvider(item)}
                  className={`px-2.5 py-1.5 text-xs font-semibold transition ${provider === item ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
                >
                  {item === "netease" ? "网易云" : "QQ 音乐"}
                </button>
              ))}
            </div>
            {isConnected ? (
              <span className="text-[11px] text-emerald-300">已连接{account?.nickname ? ` · ${account.nickname}` : ""}</span>
            ) : (
              <Link className="text-[11px] text-accent hover:text-accent/80" href="/app/profile">前往个人中心绑定</Link>
            )}
          </div>

          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchTracks(event)}>
            <label className="sr-only" htmlFor="local-playlist-search-input">搜索歌曲</label>
            <input
              id="local-playlist-search-input"
              className="min-w-0 flex-1 border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              disabled={!isConnected || pending !== null}
              maxLength={100}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder={`搜索${providerName}歌曲、歌手或专辑`}
              type="search"
              value={keywords}
            />
            <button
              type="submit"
              disabled={!isConnected || !keywords.trim() || pending !== null}
              className="border border-accent/35 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === "search" ? "搜索中…" : "搜索"}
            </button>
          </form>

          {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
          {message ? <p className="text-xs text-emerald-300">{message}</p> : null}

          {results.length > 0 ? (
            <div className="divide-y divide-surface-border border border-surface-border bg-background/40">
              {results.map((track) => {
                const isDownloaded = importedTrackIds.has(track.providerTrackId);
                const isPending = pending === `download:${track.providerTrackId}`;
                return (
                  <article key={`${track.provider}:${track.providerTrackId}`} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
                    {track.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={track.artworkUrl} alt="" className="h-9 w-9 shrink-0 object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-surface text-[10px] text-foreground-muted">音乐</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                      <p className="mt-0.5 truncate text-[10px] text-foreground-muted">{track.artist}{track.album ? ` · ${track.album}` : ""} · {formatDuration(track.durationMs)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={pending !== null || isDownloaded}
                      onClick={() => void downloadTrack(track)}
                      className="shrink-0 border border-accent/35 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDownloaded ? "已下载" : isPending ? "下载中…" : "下载"}
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function normalizeLocalDownloadMimeType(value: string) {
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return type === "audio/flac" || type === "audio/x-flac" ? "audio/flac" : "audio/mpeg";
}

function toLocalSearchErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError && error.code === "ROOM_DOWNLOAD_BUSY") {
    return "房间内已有成员正在下载，请稍后再试。";
  }
  if (error instanceof Error && error.message) return error.message;
  return "音乐平台暂时不可用，请稍后重试。";
}

function LocalPlaylistSection({
  localTracks,
  roomTracks,
  localFolderName,
  onImportCachedTrack,
  pendingCachedImport
}: {
  localTracks: LocalPlaylistTrackRecord[];
  roomTracks: TrackMeta[];
  localFolderName: string | null;
  onImportCachedTrack: (track: CachedLibraryTrack) => Promise<void>;
  pendingCachedImport: string | null;
}) {
  const importable = localTracks
    .filter((track) =>
      track.availableOffline &&
      !!track.fileHash
    )
    .map((track) => ({
      fileHash: track.fileHash!,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      lyrics: track.lyrics,
      provider: track.provider,
      providerTrackId: track.providerTrackId,
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
  return (
    <div className="flex flex-col gap-4">
      <CachedLibrarySection
        cachedTracks={importable}
        roomTracks={roomTracks}
        localFolderName={localFolderName}
        onImportCachedTrack={onImportCachedTrack}
        pendingCachedImport={pendingCachedImport}
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
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-surface/40 px-2.5 py-2 sm:px-3">
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
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-[10px] text-foreground-muted">
                    已选择 {selectedTracks.length} 首
                  </span>
                  <button
                    type="button"
                    data-testid="cached-track-batch-import-button"
                    disabled={selectedTracks.length === 0 || isBatchImporting || pendingCachedImport !== null}
                    onClick={() => void importSelectedTracks()}
                    className="shrink-0 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3"
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
