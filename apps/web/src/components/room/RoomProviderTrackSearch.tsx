"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  BilibiliTrackCandidate,
  NeteaseAccountStatus,
  NeteaseTrackCandidate,
  QqMusicAccountStatus,
  QqMusicTrackCandidate,
  TrackMeta
} from "@music-room/shared";
import { SearchSuggestions, type SearchSuggestionItem } from "@/components/provider-search";
import { SearchBar } from "@/components/ui/search-bar";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { musicRoomApi } from "@/lib/network/music-room-api";

type Provider = "netease" | "qqmusic" | "bilibili";
export type ProviderTrack = NeteaseTrackCandidate | QqMusicTrackCandidate | BilibiliTrackCandidate;
type ProviderAccount = NeteaseAccountStatus | QqMusicAccountStatus;

const enabledSearchProviders: Provider[] = [
  ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
  ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : []),
  "bilibili" as const
];

const bilibiliDefaultHotWords: SearchSuggestionItem[] = [
  { label: "周杰伦", hint: "热门", provider: "bilibili" },
  { label: "二次元", hint: "推荐", provider: "bilibili" },
  { label: "纯音乐", hint: "推荐", provider: "bilibili" },
  { label: "国风", hint: "推荐", provider: "bilibili" },
  { label: "翻唱", hint: "推荐", provider: "bilibili" },
  { label: "VOCALOID", hint: "推荐", provider: "bilibili" },
  { label: "东方Project", hint: "推荐", provider: "bilibili" },
  { label: "名侦探柯南", hint: "推荐", provider: "bilibili" }
];

export type RoomProviderTrackSearchMode = "import" | "request" | "suggest";

export type BilibiliPartDetail = {
  bvid: string;
  title: string;
  rawTitle: string;
  artist: string;
  artworkUrl: string | null;
  pageCount: number;
  parts: BilibiliTrackCandidate[];
};

type RoomProviderTrackSearchProps = {
  roomTracks: TrackMeta[];
  mode: RoomProviderTrackSearchMode;
  canManageLibrary?: boolean;
  onImportNeteaseTrack?: (track: NeteaseTrackCandidate) => Promise<void>;
  onImportQqMusicTrack?: (track: QqMusicTrackCandidate) => Promise<void>;
  onImportBilibiliTrack?: (track: BilibiliTrackCandidate) => Promise<void>;
  onImportBilibiliTracks?: (tracks: BilibiliTrackCandidate[]) => Promise<void>;
  onRequestTrack?: (track: ProviderTrack) => Promise<void>;
  onRequestSubmitted?: () => void;
  hideUnavailableProvidersNotice?: boolean;
  surface?: "framed" | "plain";
  testId?: string;
};

async function enrichProviderSearchResults(provider: Provider, items: ProviderTrack[]) {
  if (provider === "bilibili") return items;
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
  onImportBilibiliTrack,
  onImportBilibiliTracks,
  onRequestTrack,
  onRequestSubmitted,
  hideUnavailableProvidersNotice = false,
  surface = "framed",
  testId = "room-provider-track-search"
}: RoomProviderTrackSearchProps) {
  const [provider, setProvider] = useState<Provider>(enabledSearchProviders[0] ?? "bilibili");
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<ProviderTrack[]>([]);
  const [bilibiliPartDetail, setBilibiliPartDetail] = useState<BilibiliPartDetail | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingTrackIds, setPendingTrackIds] = useState<Set<string>>(() => new Set());
  const pendingTrackIdsRef = useRef<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [remoteSuggestions, setRemoteSuggestions] = useState<SearchSuggestionItem[]>([]);
  const [remoteHotWords, setRemoteHotWords] = useState<SearchSuggestionItem[]>([]);
  const searchRequestRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const skipKeywordResetRef = useRef(false);
  const isInteractingWithDropdownRef = useRef(false);
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (enabledSearchProviders.length === 0) return;
    let cancelled = false;
    searchRequestRef.current += 1;
    setAccount(null);
    setResults([]);
    setBilibiliPartDetail(null);
    setErrorMessage(null);
    setSearchSuggestionsOpen(false);
    setRemoteSuggestions([]);
    setRemoteHotWords([]);

    if (provider === "bilibili") {
      setRemoteHotWords(bilibiliDefaultHotWords);
      return;
    }

    const load = provider === "netease" ? musicRoomApi.getNeteaseAccount : musicRoomApi.getQqMusicAccount;
    void load()
      .then((nextAccount) => { if (!cancelled) setAccount(nextAccount); })
      .catch((error) => { if (!cancelled) setErrorMessage(toSearchErrorMessage(error)); });
    return () => {
      cancelled = true;
      searchRequestRef.current += 1;
    };
  }, [provider]);

  const providerName = provider === "netease" ? "网易云音乐" : provider === "qqmusic" ? "QQ 音乐" : "哔哩哔哩";
  const isConnected = account?.connected === true;
  const isManagedImport = mode === "import";

  useEffect(() => {
    if (!searchSuggestionsOpen) {
      setRemoteSuggestions([]);
      if (provider !== "bilibili") setRemoteHotWords([]);
      return;
    }
    if (provider === "bilibili") {
      const query = keywords.trim().toLowerCase();
      if (query) {
        const filtered = bilibiliDefaultHotWords.filter((item) =>
          item.label.toLowerCase().includes(query)
        );
        setRemoteSuggestions(filtered);
      } else {
        setRemoteHotWords(bilibiliDefaultHotWords);
      }
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
    }, query ? 120 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [isConnected, keywords, provider, searchSuggestionsOpen]);

  const libraryTrackIds = useMemo(
    () =>
      new Set(
        roomTracks
          .filter((track) => track.sourceType === provider && track.sourceRef?.provider === provider)
          .map((track) => track.sourceRef?.trackId)
          .filter((trackId): trackId is string => !!trackId)
      ),
    [provider, roomTracks]
  );

  const searchTracks = useCallback(async (query: string) => {
    if (!query) return;
    const requestId = ++searchRequestRef.current;
    setPending("search");
    setErrorMessage(null);
    setMessage(null);
    setBilibiliPartDetail(null);
    try {
      if (provider === "bilibili") {
        const response = await musicRoomApi.searchBilibiliTracks(query, { pageSize: 10 });
        if (searchRequestRef.current !== requestId) return;
        setResults(response.items);
        if (response.items.length === 0) setMessage("没有找到匹配的 B 站音频/视频。");
      } else {
        const response = provider === "netease"
          ? await musicRoomApi.searchNeteaseTracks(query)
          : await musicRoomApi.searchQqMusicTracks(query);
        if (searchRequestRef.current !== requestId) return;
        setResults(response.items);
        void enrichProviderSearchResults(provider, response.items)
          .then((items) => { if (searchRequestRef.current === requestId) setResults(items); })
          .catch(() => undefined);
        if (response.items.length === 0) setMessage("没有找到匹配的歌曲。");
      }
    } catch (error) {
      if (searchRequestRef.current === requestId) setErrorMessage(toSearchErrorMessage(error));
    } finally {
      if (searchRequestRef.current === requestId) setPending(null);
    }
  }, [provider]);

  useEffect(() => {
    if (skipKeywordResetRef.current) {
      skipKeywordResetRef.current = false;
      return;
    }
    searchRequestRef.current += 1;
    setResults([]);
    setBilibiliPartDetail(null);
    setMessage(null);
    setPending((current) => current === "search" ? null : current);
  }, [keywords]);

  const handleOpenBilibiliParts = useCallback(async (track: ProviderTrack) => {
    const bilibiliTrack = track as BilibiliTrackCandidate;
    const bvid = bilibiliTrack.bvid || bilibiliTrack.providerTrackId.split(":")[0];
    if (!bvid) return;
    const actionKey = `parts:${bvid}`;
    setPending(actionKey);
    setErrorMessage(null);
    try {
      const detail = await musicRoomApi.getBilibiliVideoParts(bvid);
      setBilibiliPartDetail(detail);
    } catch (error) {
      setErrorMessage(toSearchErrorMessage(error));
    } finally {
      setPending((current) => (current === actionKey ? null : current));
    }
  }, []);

  const handleImportAllParts = useCallback(async (parts: BilibiliTrackCandidate[]) => {
    const unimported = parts.filter(
      (part) => !libraryTrackIds.has(part.providerTrackId) && !pendingTrackIdsRef.current.has(part.providerTrackId)
    );
    if (unimported.length === 0) {
      setMessage("所有分P单曲均已在曲库中。");
      return;
    }
    setPending("import-all-parts");
    for (const p of unimported) pendingTrackIdsRef.current.add(p.providerTrackId);
    setPendingTrackIds(new Set(pendingTrackIdsRef.current));
    setErrorMessage(null);
    setMessage(null);

    const runTask = async () => {
      try {
        if (onImportBilibiliTracks) {
          await onImportBilibiliTracks(unimported);
        } else if (onImportBilibiliTrack) {
          for (const track of unimported) {
            await onImportBilibiliTrack(track);
          }
        }
        if (mountedRef.current) setMessage(`已成功导入 ${unimported.length} 首分P单曲到曲库。`);
      } catch (error) {
        if (mountedRef.current) setErrorMessage(toSearchErrorMessage(error));
      } finally {
        if (mountedRef.current) {
          setPending((current) => (current === "import-all-parts" ? null : current));
          for (const p of unimported) pendingTrackIdsRef.current.delete(p.providerTrackId);
          setPendingTrackIds(new Set(pendingTrackIdsRef.current));
        }
      }
    };

    actionQueueRef.current = actionQueueRef.current.then(runTask, runTask);
  }, [libraryTrackIds, onImportBilibiliTrack, onImportBilibiliTracks]);

  const handleTrackAction = useCallback(async (candidate: ProviderTrack) => {
    const trackId = candidate.providerTrackId;
    if (pendingTrackIdsRef.current.has(trackId)) return;
    if (isManagedImport && !canManageLibrary) return;

    pendingTrackIdsRef.current.add(trackId);
    setPendingTrackIds(new Set(pendingTrackIdsRef.current));
    setErrorMessage(null);

    const runTask = async () => {
      try {
        if (isManagedImport) {
          if (candidate.provider === "netease") await onImportNeteaseTrack?.(candidate as NeteaseTrackCandidate);
          else if (candidate.provider === "bilibili") await onImportBilibiliTrack?.(candidate as BilibiliTrackCandidate);
          else await onImportQqMusicTrack?.(candidate as QqMusicTrackCandidate);
          if (mountedRef.current) setMessage(`《${candidate.title}》已加入曲库。`);
        } else {
          await onRequestTrack?.(candidate);
          if (mountedRef.current) setMessage(mode === "request" ? `已提交《${candidate.title}》点歌。` : "已提交点歌建议。");
          onRequestSubmitted?.();
        }
      } catch (error) {
        if (mountedRef.current) setErrorMessage(toSearchErrorMessage(error));
      } finally {
        if (mountedRef.current) {
          pendingTrackIdsRef.current.delete(trackId);
          setPendingTrackIds(new Set(pendingTrackIdsRef.current));
        }
      }
    };

    actionQueueRef.current = actionQueueRef.current.then(runTask, runTask);
  }, [canManageLibrary, isManagedImport, mode, onImportBilibiliTrack, onImportNeteaseTrack, onImportQqMusicTrack, onRequestSubmitted, onRequestTrack]);

  const actionLabel = mode === "import" ? "加入曲库" : mode === "request" ? "点歌" : "建议点歌";

  if (enabledSearchProviders.length === 0) {
    if (hideUnavailableProvidersNotice) return null;
    return <section className="flex flex-col gap-1 border-b border-surface-border pb-3" data-testid={testId}>
      <span className="text-xs text-foreground-muted">暂无已启用的音乐平台。</span>
    </section>;
  }

  const hotPills = remoteHotWords.length > 0 ? remoteHotWords.slice(0, 6) : [];

  return <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
    <div className={surface === "framed" ? "flex min-w-0 flex-col gap-2 rounded-xl border border-surface-border/60 bg-surface/40 p-2.5 backdrop-blur-md transition-all shadow-xs" : "flex min-w-0 flex-col gap-2"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-surface-border/60 bg-surface/70 p-0.5" role="tablist" aria-label="音乐平台">
          {enabledSearchProviders.map((item) => {
            const isCurrent = provider === item;
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => setProvider(item)}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                  isCurrent
                    ? "bg-accent text-white shadow-xs"
                    : "text-foreground-muted hover:bg-surface-hover/60 hover:text-foreground"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${
                  item === "netease" ? "bg-red-400" : item === "qqmusic" ? "bg-emerald-400" : "bg-pink-400"
                }`} />
                <span>{item === "netease" ? "网易云" : item === "qqmusic" ? "QQ 音乐" : "哔哩哔哩"}</span>
              </button>
            );
          })}
        </div>
        {provider === "bilibili" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pink-500/20 bg-pink-500/10 px-2 py-0.5 text-[10px] font-medium text-pink-300">
            <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
            <span>免登录 · 公开检索</span>
          </span>
        ) : isConnected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>已连接{account?.nickname ? ` · ${account.nickname}` : ""}</span>
          </span>
        ) : (
          <Link className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400/90 hover:underline hover:text-amber-300" href="/app/profile">
            <span>访客检索 · 绑定解锁完整曲库</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </Link>
        )}
      </div>

      <SearchBar
        ref={searchInputRef}
        id={`${testId}-input`}
        value={keywords}
        onChange={(val) => {
          setKeywords(val);
          setSearchSuggestionsOpen(true);
        }}
        onSubmit={(query) => {
          setSearchSuggestionsOpen(false);
          void searchTracks(query);
        }}
        onClear={() => {
          setResults([]);
          setBilibiliPartDetail(null);
          setMessage(null);
          setErrorMessage(null);
          setSearchSuggestionsOpen(false);
        }}
        onFocus={() => setSearchSuggestionsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            if (!isInteractingWithDropdownRef.current) {
              setSearchSuggestionsOpen(false);
            }
          }, 250);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setSearchSuggestionsOpen(false);
        }}
        placeholder={`搜索${providerName}歌曲、歌手或视频`}
        loading={pending === "search"}
        dropdownContent={
          searchSuggestionsOpen ? (
            <SearchSuggestions
              items={keywords.trim() ? remoteSuggestions : remoteHotWords}
              onInteractionChange={(active) => {
                isInteractingWithDropdownRef.current = active;
              }}
              onSelect={(value) => {
                skipKeywordResetRef.current = true;
                setKeywords(value);
                setSearchSuggestionsOpen(false);
                searchInputRef.current?.focus();
                void searchTracks(value);
              }}
              position="overlay"
            />
          ) : null
        }
        showSearchButton
      />

      {!keywords.trim() && hotPills.length > 0 && results.length === 0 && !bilibiliPartDetail ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-foreground-muted/60">热门搜索:</span>
          {hotPills.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => {
                skipKeywordResetRef.current = true;
                setKeywords(pill.label);
                setSearchSuggestionsOpen(false);
                void searchTracks(pill.label);
              }}
              className="rounded-full border border-surface-border/60 bg-surface/60 px-2.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
            >
              {pill.label}
            </button>
          ))}
        </div>
      ) : null}

      {errorMessage ? <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300" role="status">{errorMessage}</p> : null}
      {message ? <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300" role="status">{message}</p> : null}

      {bilibiliPartDetail ? (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border/60 bg-surface/50 p-2">
          <div className="flex items-center justify-between gap-2 border-b border-surface-border/40 pb-1.5">
            <button
              type="button"
              onClick={() => setBilibiliPartDetail(null)}
              className="inline-flex items-center gap-1 rounded-md border border-surface-border/60 bg-surface/70 px-2 py-0.5 text-xs font-medium text-foreground-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
              <span>返回搜索</span>
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <span className="truncate text-xs font-medium text-foreground" title={bilibiliPartDetail.title}>
                {bilibiliPartDetail.title}
              </span>
              <span className="shrink-0 rounded bg-pink-500/15 px-1.5 py-0.5 text-[10px] font-medium text-pink-400">
                共 {bilibiliPartDetail.parts.length} P
              </span>
              {isManagedImport && canManageLibrary && (onImportBilibiliTracks || onImportBilibiliTrack) && bilibiliPartDetail.parts.length > 1 ? (
                <button
                  type="button"
                  disabled={pending === "import-all-parts" || bilibiliPartDetail.parts.every((p) => libraryTrackIds.has(p.providerTrackId))}
                  onClick={() => void handleImportAllParts(bilibiliPartDetail.parts)}
                  className="shrink-0 rounded-md border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent hover:border-accent hover:bg-accent hover:text-white transition-all disabled:opacity-50"
                >
                  {pending === "import-all-parts" ? "导入中…" : "全部导入"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-[380px] divide-y divide-surface-border/40 overflow-y-auto rounded-md border border-surface-border/40 bg-surface/40">
            {bilibiliPartDetail.parts.map((part, index) => {
              const isInLibrary = libraryTrackIds.has(part.providerTrackId);
              const isPending = pendingTrackIds.has(part.providerTrackId);
              const disabled = isPending || pending === "import-all-parts" || (isManagedImport && (!canManageLibrary || isInLibrary));

              return (
                <article
                  key={part.providerTrackId}
                  className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-surface-hover/60"
                >
                  <span className="w-5 shrink-0 text-center font-mono text-xs tabular-nums text-foreground-muted/70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground" title={part.title}>
                      {part.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-foreground-muted/70">
                      <span className="font-mono">{formatDuration(part.durationMs)}</span>
                      <span>·</span>
                      <span className="truncate">{part.artist || bilibiliPartDetail.artist}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void handleTrackAction(part)}
                    className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold transition-all ${
                      isManagedImport && isInLibrary
                        ? "cursor-default border border-surface-border/60 bg-surface text-foreground-muted/60"
                        : isPending
                          ? "border border-accent/40 bg-accent/20 text-accent opacity-75"
                          : "border border-accent/40 bg-accent/15 text-accent hover:border-accent hover:bg-accent hover:text-white shadow-xs"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {isManagedImport && isInLibrary ? "已在曲库" : isPending ? "处理中…" : actionLabel}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ) : results.length > 0 ? (
        <div className="divide-y divide-surface-border/40 overflow-hidden rounded-lg border border-surface-border/60 bg-surface/50">
          {results.map((track) => {
            const isInLibrary = libraryTrackIds.has(track.providerTrackId);
            const isPending = pendingTrackIds.has(track.providerTrackId);
            const disabled = isPending || pending === "import-all-parts" || (isManagedImport && (!canManageLibrary || isInLibrary));
            const bilibiliTrack = track.provider === "bilibili" ? (track as BilibiliTrackCandidate) : null;
            const isMultiPart =
              bilibiliTrack &&
              (Boolean(typeof bilibiliTrack.pageCount === "number" && bilibiliTrack.pageCount > 1) ||
                /(?:全|\s)?(\d+)\s*[pP篇首集]|合集|精选|收录|教学/i.test(track.title) ||
                track.durationMs > 600000);
            const isPartsPending = Boolean(bilibiliTrack && pending === `parts:${bilibiliTrack.bvid || track.providerTrackId.split(":")[0]}`);

            return <article key={`${track.provider}:${track.providerTrackId}`} className="flex min-w-0 items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-surface-hover/60">
              {track.artworkUrl ? (
                <img
                  src={track.artworkUrl}
                  referrerPolicy="no-referrer"
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md border border-surface-border/60 object-cover shadow-xs"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-border/60 bg-surface text-[10px] text-foreground-muted">音乐</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground" title={track.title}>{track.title}</p>
                  {isMultiPart ? (
                    <button
                      type="button"
                      disabled={isPartsPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleOpenBilibiliParts(track);
                      }}
                      title="点击展开分P列表"
                      className="inline-flex shrink-0 items-center gap-1 rounded bg-pink-500/15 px-1.5 py-0.5 text-[10px] font-medium text-pink-400 hover:bg-pink-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <span>
                        {typeof bilibiliTrack.pageCount === "number" && bilibiliTrack.pageCount > 1
                          ? `共 ${bilibiliTrack.pageCount} P`
                          : "分P"}
                      </span>
                      <svg className="h-2.5 w-2.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-foreground-muted" title={`${track.artist}${track.album ? ` · ${track.album}` : ""}`}>
                  {track.artist}{track.album ? ` · ${track.album}` : ""}
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-foreground-muted/70">
                  <span className="font-mono">{formatDuration(track.durationMs)}</span>
                  <span>·</span>
                  <span className="capitalize">{track.provider === "netease" ? "网易云" : track.provider === "qqmusic" ? "QQ 音乐" : "哔哩哔哩"}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {bilibiliTrack ? (
                  <button
                    type="button"
                    disabled={isPartsPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleOpenBilibiliParts(track);
                    }}
                    title="查看分P列表"
                    className="shrink-0 rounded-md border border-surface-border/60 bg-surface/80 px-2 py-1 text-xs font-medium text-foreground-muted hover:border-pink-500/40 hover:bg-pink-500/10 hover:text-pink-400 transition-all disabled:opacity-50"
                  >
                    {isPartsPending ? (
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pink-400 border-t-transparent align-middle" />
                    ) : (
                      "分P"
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void handleTrackAction(track)}
                  className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                    isManagedImport && isInLibrary
                      ? "cursor-default border border-surface-border/60 bg-surface text-foreground-muted/60"
                      : isPending
                        ? "border border-accent/40 bg-accent/20 text-accent opacity-75"
                        : "border border-accent/40 bg-accent/15 text-accent hover:border-accent hover:bg-accent hover:text-white shadow-xs"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {isManagedImport && isInLibrary ? "已在曲库" : isPending ? "处理中…" : actionLabel}
                </button>
              </div>
            </article>;
          })}
        </div>
      ) : null}
    </div>
  </section>;
}

function toSearchErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "音乐平台暂时不可用，请稍后重试。";
}
