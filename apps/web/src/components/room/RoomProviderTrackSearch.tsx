"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  QqMusicAccountStatus,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { SearchSuggestions, type SearchSuggestionItem } from "@/components/ProviderSearchSuggestions";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";

type Provider = "netease" | "qqmusic";
type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate;
type ProviderAccount = NeteaseAccountStatus | QqMusicAccountStatus;

const enabledSearchProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
];

export type RoomProviderTrackSearchMode = "import" | "program" | "request" | "suggest";

type RoomProviderTrackSearchProps = {
  roomTracks: TrackMeta[];
  mode: RoomProviderTrackSearchMode;
  canManageLibrary?: boolean;
  onImportNeteaseTrack?: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack?: (track: QqMusicTrackCandidate) => Promise<void>;
  onRequestTrack?: (track: ProviderTrack) => Promise<void>;
  onRequestSubmitted?: () => void;
  hideUnavailableProvidersNotice?: boolean;
  surface?: "framed" | "plain";
  testId?: string;
};

async function enrichProviderSearchResults(provider: Provider, items: ProviderTrack[]) {
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
      // A missing artwork detail must not make the provider search unusable.
    }
  }));

  const tracksWithoutAlbum = missingArtwork.filter((track) => !track.providerAlbumId).slice(0, 6);
  const artworkByTrackId = new Map<string, string>();
  await Promise.all(tracksWithoutAlbum.map(async (track) => {
    try {
      const detail = track.provider === "netease"
        ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
        : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
      if (detail.artworkUrl) artworkByTrackId.set(track.providerTrackId, detail.artworkUrl);
    } catch {
      // Keep the result available when a provider detail endpoint fails.
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

export function RoomProviderTrackSearch({
  roomTracks,
  mode,
  canManageLibrary = false,
  onImportNeteaseTrack,
  onImportQqMusicTrack,
  onRequestTrack,
  onRequestSubmitted,
  hideUnavailableProvidersNotice = false,
  surface = "framed",
  testId = "room-provider-track-search"
}: RoomProviderTrackSearchProps) {
  const [provider, setProvider] = useState<Provider>(enabledSearchProviders[0] ?? "netease");
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<ProviderTrack[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<SearchSuggestionItem[]>([]);
  const [remoteHotWords, setRemoteHotWords] = useState<SearchSuggestionItem[]>([]);
  const searchRequestRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (enabledSearchProviders.length === 0) return;
    let cancelled = false;
    searchRequestRef.current += 1;
    setAccount(null);
    setResults([]);
    setErrorMessage(null);
    setSearchSuggestionsOpen(false);
    setRemoteSuggestions([]);
    setRemoteHotWords([]);
    const load = provider === "netease" ? musicRoomApi.getNeteaseAccount : musicRoomApi.getQqMusicAccount;
    void load()
      .then((nextAccount) => { if (!cancelled) setAccount(nextAccount); })
      .catch((error) => { if (!cancelled) setErrorMessage(toSearchErrorMessage(error)); });
    return () => {
      cancelled = true;
      searchRequestRef.current += 1;
    };
  }, [provider]);

  const providerName = provider === "netease" ? "网易云音乐" : "QQ 音乐";
  const isConnected = account?.connected === true;
  const isProgramMode = mode === "program";
  const isManagedImport = mode === "import" || isProgramMode;

  useEffect(() => {
    if (!isConnected || !searchSuggestionsOpen) {
      setRemoteSuggestions([]);
      setRemoteHotWords([]);
      return;
    }
    let cancelled = false;
    const query = keywords.trim();
    const timerId = window.setTimeout(async () => {
      try {
        const response = query
          ? provider === "netease"
            ? await musicRoomApi.searchNeteaseSuggestions(query)
            : await musicRoomApi.searchQqMusicSuggestions(query)
          : provider === "netease"
            ? await musicRoomApi.getNeteaseSearchHot()
            : await musicRoomApi.getQqMusicSearchHot();
        if (cancelled) return;
        const items = response.items.map((item) => ({
          label: item.label,
          hint: item.hint ?? (query ? "联想" : "热词"),
          provider: item.provider
        }));
        if (query) setRemoteSuggestions(items);
        else setRemoteHotWords(items);
      } catch {
        if (cancelled) return;
        if (query) setRemoteSuggestions([]);
        else setRemoteHotWords([]);
      }
    }, query ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [isConnected, keywords, provider, searchSuggestionsOpen]);

  const libraryTrackIds = new Set(
    roomTracks
      .filter((track) => track.sourceType === provider && track.sourceRef?.provider === provider)
      .map((track) => track.sourceRef?.trackId)
      .filter((trackId): trackId is string => !!trackId)
  );

  const searchTracks = useCallback(async (query: string, requestId: number) => {
    if (!query || !isConnected || searchRequestRef.current !== requestId) return;
    setPending("search");
    setErrorMessage(null);
    setMessage(null);
    try {
      const response = provider === "netease"
        ? await musicRoomApi.searchNeteaseTracks(query)
        : await musicRoomApi.searchQqMusicTracks(query);
      if (searchRequestRef.current !== requestId) return;
      setResults(response.items);
      void enrichProviderSearchResults(provider, response.items)
        .then((items) => { if (searchRequestRef.current === requestId) setResults(items); })
        .catch(() => undefined);
      if (response.items.length === 0) setMessage("没有找到匹配的歌曲。");
    } catch (error) {
      if (searchRequestRef.current === requestId) setErrorMessage(toSearchErrorMessage(error));
    } finally {
      if (searchRequestRef.current === requestId) setPending(null);
    }
  }, [isConnected, provider]);

  useEffect(() => {
    searchRequestRef.current += 1;
    setResults([]);
    setMessage(null);
    setPending((current) => current === "search" ? null : current);
  }, [keywords]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || !isConnected) return;
    const requestId = ++searchRequestRef.current;
    void searchTracks(query, requestId);
  };

  const handleTrackAction = async (candidate: ProviderTrack) => {
    const actionKey = `${mode}:${candidate.providerTrackId}`;
    if (pending) return;
    if (isManagedImport && !canManageLibrary) return;
    setPending(actionKey);
    setErrorMessage(null);
    setMessage(null);
    try {
      if (isManagedImport) {
        if (candidate.provider === "netease") await onImportNeteaseTrack?.(candidate);
        else await onImportQqMusicTrack?.(candidate);
        setMessage(isProgramMode ? `《${candidate.title}》已加入节目单。` : `《${candidate.title}》已导入曲库。`);
      } else {
        await onRequestTrack?.(candidate);
        setMessage(mode === "request" ? "已提交点歌。" : "已提交点歌建议。");
        onRequestSubmitted?.();
      }
    } catch (error) {
      setErrorMessage(toSearchErrorMessage(error));
    } finally {
      setPending(null);
    }
  };

  const actionLabel = isProgramMode ? "加入节目单" : mode === "import" ? "导入曲库" : mode === "request" ? "点歌" : "建议点歌";

  if (enabledSearchProviders.length === 0) {
    if (hideUnavailableProvidersNotice) return null;
    return <section className="flex flex-col gap-1 border-b border-surface-border pb-3" data-testid={testId}>
      <span className="text-xs text-foreground-muted">网易云音乐和 QQ 音乐当前未启用。</span>
    </section>;
  }

  return <section className="flex min-w-0 flex-col gap-3" data-testid={testId}>
    <div className={surface === "framed" ? "flex min-w-0 flex-col gap-3 rounded-lg border border-surface-border bg-surface/35 p-3" : "flex min-w-0 flex-col gap-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="音乐平台">
          {enabledSearchProviders.map((item) => <button
            key={item}
            type="button"
            role="tab"
            aria-selected={provider === item}
            onClick={() => setProvider(item)}
            className={`px-2.5 py-1.5 text-xs font-semibold transition ${provider === item ? "bg-accent text-white" : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"}`}
          >{item === "netease" ? "网易云" : "QQ 音乐"}</button>)}
        </div>
        {isConnected ? <span className="text-[11px] text-emerald-300">已连接{account?.nickname ? ` · ${account.nickname}` : ""}</span> : <Link className="text-[11px] text-accent hover:text-accent/80" href="/app/profile">前往我的绑定</Link>}
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSearchSubmit}>
        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor={`${testId}-input`}>搜索歌曲</label>
          <input
            ref={searchInputRef}
            id={`${testId}-input`}
            className="w-full min-w-0 border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
            disabled={!isConnected}
            maxLength={100}
            onBlur={() => window.setTimeout(() => setSearchSuggestionsOpen(false), 120)}
            onChange={(event) => { setKeywords(event.target.value); if (isConnected) setSearchSuggestionsOpen(true); }}
            onFocus={() => { if (isConnected) setSearchSuggestionsOpen(true); }}
            onKeyDown={(event) => { if (event.key === "Escape") setSearchSuggestionsOpen(false); }}
            placeholder={`搜索${providerName}歌曲、歌手或专辑`}
            type="search"
            value={keywords}
          />
          {searchSuggestionsOpen ? <SearchSuggestions
            items={keywords.trim() ? remoteSuggestions : remoteHotWords}
            onSelect={(value) => { setKeywords(value); setSearchSuggestionsOpen(false); searchInputRef.current?.focus(); }}
          /> : null}
        </div>
        <button type="submit" disabled={!isConnected || !keywords.trim()} className="border border-accent/35 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50">
          {pending === "search" ? "搜索中…" : "搜索"}
        </button>
      </form>

      {errorMessage ? <p className="text-xs text-red-300">{errorMessage}</p> : null}
      {message ? <p className="text-xs text-emerald-300">{message}</p> : null}

      {results.length > 0 ? <div className="divide-y divide-surface-border border border-surface-border bg-background/40">
        {results.map((track) => {
          const isInLibrary = libraryTrackIds.has(track.providerTrackId);
          const isPending = pending === `${mode}:${track.providerTrackId}`;
          const disabled = pending !== null || (isManagedImport && (!canManageLibrary || isInLibrary));
          return <article key={`${track.provider}:${track.providerTrackId}`} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            {track.artworkUrl ? <img src={track.artworkUrl} alt="" className="h-9 w-9 shrink-0 object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-surface text-[10px] text-foreground-muted">音乐</span>}
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-foreground">{track.title}</p><p className="mt-0.5 truncate text-[10px] text-foreground-muted">{track.artist}{track.album ? ` · ${track.album}` : ""} · {formatDuration(track.durationMs)}</p></div>
            <button type="button" disabled={disabled} onClick={() => void handleTrackAction(track)} className="shrink-0 border border-accent/35 bg-accent/10 px-2.5 py-1.5 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60">
              {isManagedImport && isInLibrary ? isProgramMode ? "已在节目单" : "已在曲库" : isPending ? "处理中…" : actionLabel}
            </button>
          </article>;
        })}
      </div> : null}
    </div>
  </section>;
}

function toSearchErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "音乐平台暂时不可用，请稍后重试。";
}
