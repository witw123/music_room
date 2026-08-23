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
        setMessage(mode === "request" ? `已提交《${candidate.title}》点歌。` : "已提交点歌建议。");
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

  const hotPills = remoteHotWords.length > 0 ? remoteHotWords.slice(0, 5) : [];

  return <section className="flex min-w-0 flex-col gap-3" data-testid={testId}>
    <div className={surface === "framed" ? "flex min-w-0 flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-md transition-all shadow-sm" : "flex min-w-0 flex-col gap-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1" role="tablist" aria-label="音乐平台">
          {enabledSearchProviders.map((item) => {
            const isCurrent = provider === item;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => setProvider(item)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  isCurrent
                    ? "bg-accent text-white shadow-sm"
                    : "text-foreground-muted hover:bg-white/10 hover:text-foreground"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${item === "netease" ? "bg-red-400" : "bg-emerald-400"}`} />
                <span>{item === "netease" ? "网易云" : "QQ 音乐"}</span>
              </button>
            );
          })}
        </div>
        {isConnected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>已连接{account?.nickname ? ` · ${account.nickname}` : ""}</span>
          </span>
        ) : (
          <Link className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline hover:text-accent-hover" href="/app/profile">
            <span>前往绑定账号</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </Link>
        )}
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSearchSubmit}>
        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor={`${testId}-input`}>搜索歌曲</label>
          <div className="relative flex items-center">
            <svg
              className="pointer-events-none absolute left-3 h-4 w-4 text-foreground-muted/60"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              id={`${testId}-input`}
              className="w-full min-w-0 rounded-xl border border-white/10 bg-black/40 py-2.5 pl-9 pr-8 text-sm text-foreground outline-none transition-all placeholder:text-foreground-muted/40 focus:border-accent focus:bg-black/60 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
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
            {keywords.trim() ? (
              <button
                type="button"
                onClick={() => {
                  setKeywords("");
                  setResults([]);
                  setMessage(null);
                  setErrorMessage(null);
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-foreground-muted/60 hover:bg-white/10 hover:text-foreground"
                aria-label="清空搜索"
              >
                ×
              </button>
            ) : null}
          </div>
          {searchSuggestionsOpen ? <SearchSuggestions
            items={keywords.trim() ? remoteSuggestions : remoteHotWords}
            onSelect={(value) => { setKeywords(value); setSearchSuggestionsOpen(false); searchInputRef.current?.focus(); }}
            position={mode === "request" ? "flow" : "overlay"}
          /> : null}
        </div>
        <button
          type="submit"
          disabled={!isConnected || !keywords.trim() || pending === "search"}
          className="inline-flex min-h-[2.5rem] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-accent-hover hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending === "search" ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12"/></svg>
              <span>搜索中…</span>
            </>
          ) : (
            <span>搜索</span>
          )}
        </button>
      </form>

      {!keywords.trim() && isConnected && hotPills.length > 0 && results.length === 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-foreground-muted/60">热门搜索:</span>
          {hotPills.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => {
                setKeywords(pill.label);
                const reqId = ++searchRequestRef.current;
                void searchTracks(pill.label, reqId);
              }}
              className="rounded-full border border-white/5 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
            >
              {pill.label}
            </button>
          ))}
        </div>
      ) : null}

      {errorMessage ? <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="status">{errorMessage}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">{message}</p> : null}

      {results.length > 0 ? <div className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-inner">
        {results.map((track) => {
          const isInLibrary = libraryTrackIds.has(track.providerTrackId);
          const isPending = pending === `${mode}:${track.providerTrackId}`;
          const disabled = pending !== null || (isManagedImport && (!canManageLibrary || isInLibrary));
          return <article key={`${track.provider}:${track.providerTrackId}`} className="flex min-w-0 items-center gap-3 p-3 transition-colors hover:bg-white/[0.03]">
            {track.artworkUrl ? (
              <img src={track.artworkUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg border border-white/10 object-cover shadow-sm" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[10px] text-foreground-muted">音乐</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground" title={track.title}>{track.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={`${track.artist}${track.album ? ` · ${track.album}` : ""}`}>
                {track.artist}{track.album ? ` · ${track.album}` : ""}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-foreground-muted/70">
                <span className="font-mono">{formatDuration(track.durationMs)}</span>
                <span>·</span>
                <span className="capitalize">{track.provider === "netease" ? "网易云" : "QQ 音乐"}</span>
              </div>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void handleTrackAction(track)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                isManagedImport && isInLibrary
                  ? "cursor-default border border-white/10 bg-white/5 text-foreground-muted/60"
                  : isPending
                    ? "border border-accent/40 bg-accent/20 text-accent opacity-75"
                    : "border border-accent/40 bg-accent/15 text-accent hover:border-accent hover:bg-accent hover:text-white shadow-sm"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isManagedImport && isInLibrary ? (isProgramMode ? "已在节目单" : "已在曲库") : isPending ? "处理中…" : actionLabel}
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
