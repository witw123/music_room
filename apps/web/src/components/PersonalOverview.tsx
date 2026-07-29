"use client";

import type { AuthSession } from "@music-room/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { isLocalPlaylistMirror } from "@/lib/local-playlist-database";
import { musicRoomApi } from "@/lib/music-room-api";
import {
  listLocalPlaylists,
  listMergedLocalPlaylistTracks,
  restoreLocalPlaylistsFromRepository
} from "@/features/playlist/local-playlist";
import {
  getCachedFavorites,
  getCachedPlaylistData,
  setCachedFavorites,
  setCachedPlaylistData
} from "@/features/workspace/page-data-cache";

type ProfileStats = {
  localPlaylistCount: number | null;
  localTrackCount: number | null;
  networkPlaylistCount: number | null;
  favoriteTrackCount: number | null;
  favoriteAlbumCount: number | null;
};

type StatDefinition = {
  key: keyof ProfileStats;
  label: string;
};

const statDefinitions: StatDefinition[] = [
  { key: "localPlaylistCount", label: "本地歌单" },
  { key: "localTrackCount", label: "本地歌曲" },
  { key: "networkPlaylistCount", label: "网络歌单" },
  { key: "favoriteTrackCount", label: "收藏歌曲" },
  { key: "favoriteAlbumCount", label: "收藏专辑" }
];

export function PersonalOverview({ activeSession }: { activeSession: AuthSession }) {
  const [stats, setStats] = useState<ProfileStats>(() => getInitialStats(activeSession.userId));
  const [statsLoading, setStatsLoading] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      const [localResult, networkResult, favoriteTracksResult, favoriteAlbumsResult] = await Promise.all([
        loadLocalStats(activeSession.userId),
        musicRoomApi.listMyPlaylists()
          .then((playlists) => {
            const networkPlaylists = playlists.filter((playlist) => !isLocalPlaylistMirror(playlist));
            setCachedPlaylistData(activeSession.userId, {
              networkPlaylists,
              networkLoaded: true
            });
            return networkPlaylists.length;
          })
          .catch(() => null),
        musicRoomApi.listFavoriteTracks()
          .then((tracks) => tracks.length)
          .catch(() => null),
        musicRoomApi.listFavoriteAlbums()
          .then((albums) => {
            setCachedFavorites(activeSession.userId, albums);
            return albums.length;
          })
          .catch(() => null)
      ]);

      if (cancelled) return;
      setStats({
        localPlaylistCount: localResult?.localPlaylistCount ?? null,
        localTrackCount: localResult?.localTrackCount ?? null,
        networkPlaylistCount: networkResult,
        favoriteTrackCount: favoriteTracksResult,
        favoriteAlbumCount: favoriteAlbumsResult
      });
      setStatsLoading(false);
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [activeSession.userId]);

  async function copyUserId() {
    try {
      await navigator.clipboard.writeText(activeSession.userId);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("idle");
    }
  }

  return (
    <section aria-labelledby="personal-overview-title" className="border-b border-surface-border pb-8">
      <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.6fr)] lg:items-stretch">
        <div className="workspace-surface flex min-w-0 flex-col justify-between gap-6 p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <div aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-semibold text-white shadow-[0_8px_24px_var(--accent-glow)] sm:h-[4.5rem] sm:w-[4.5rem] sm:text-2xl">
              {getInitials(activeSession.nickname)}
            </div>
            <div className="min-w-0">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-accent">Music Room 用户</p>
              <h2 className="mt-1 truncate text-xl font-semibold text-foreground" id="personal-overview-title">{activeSession.nickname}</h2>
              <p className="mt-1 truncate text-sm text-foreground-muted">@{activeSession.username}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs text-foreground-muted">
            <div className="flex min-w-0 items-center gap-x-3">
              <span className="truncate" title={activeSession.userId}>ID {activeSession.userId.slice(0, 12)}</span>
              <span aria-hidden="true" className="text-surface-border">·</span>
              <button
                className="shrink-0 font-medium text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                onClick={() => void copyUserId()}
                type="button"
              >
                {copyState === "copied" ? "已复制" : "复制 ID"}
              </button>
            </div>
            <Link className="shrink-0 font-medium text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" href="/app/settings">
              账户设置 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Music Room 概览</h2>
              <p className="mt-1 text-xs text-foreground-muted">你的音乐库和收藏</p>
            </div>
            <span aria-live="polite" className="shrink-0 text-[0.6875rem] text-foreground-muted">
              {statsLoading ? "同步中" : "已同步"}
            </span>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-surface-border bg-surface/40 sm:grid-cols-5">
            {statDefinitions.map((definition) => (
              <StatTile
                key={definition.key}
                label={definition.label}
                loading={statsLoading && stats[definition.key] === null}
                value={stats[definition.key]}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatTile({ label, loading, value }: { label: string; loading: boolean; value: number | null }) {
  return (
    <div className="min-w-0 border-b border-surface-border px-4 py-4 last:border-b-0 even:border-l sm:border-b-0 sm:border-l sm:first:border-l-0">
      {loading ? <span aria-label={`${label}加载中`} className="block h-7 w-10 animate-pulse rounded-md bg-surface-hover" /> : <strong className="block text-2xl font-semibold tabular-nums text-foreground">{value ?? "—"}</strong>}
      <span className="mt-1 block truncate text-xs text-foreground-muted">{label}</span>
    </div>
  );
}

async function loadLocalStats(userId: string) {
  const cached = getCachedPlaylistData(userId);
  try {
    const [restoredPlaylists, tracks] = await Promise.all([
      restoreLocalPlaylistsFromRepository(),
      listMergedLocalPlaylistTracks()
    ]);
    const localPlaylists = restoredPlaylists.length > 0 ? restoredPlaylists : listLocalPlaylists();
    setCachedPlaylistData(userId, {
      localPlaylists,
      localTracks: tracks,
      localLoaded: true
    });
    return {
      localPlaylistCount: localPlaylists.length,
      localTrackCount: tracks.length
    };
  } catch {
    if (!cached) return null;
    return {
      localPlaylistCount: cached.localPlaylists.length,
      localTrackCount: cached.localTracks.length
    };
  }
}

function getInitialStats(userId: string): ProfileStats {
  const cachedPlaylistData = getCachedPlaylistData(userId);
  const cachedFavorites = getCachedFavorites(userId);
  return {
    localPlaylistCount: cachedPlaylistData?.localLoaded ? cachedPlaylistData.localPlaylists.length : null,
    localTrackCount: cachedPlaylistData?.localLoaded ? cachedPlaylistData.localTracks.length : null,
    networkPlaylistCount: cachedPlaylistData?.networkLoaded
      ? cachedPlaylistData.networkPlaylists.filter((playlist) => !isLocalPlaylistMirror(playlist)).length
      : null,
    favoriteTrackCount: null,
    favoriteAlbumCount: cachedFavorites?.length ?? null
  };
}

function getInitials(value: string) {
  const normalized = value.trim();
  if (!normalized) return "M";
  const characters = Array.from(normalized);
  return characters.length > 1 ? `${characters[0]}${characters[characters.length - 1]}` : characters[0];
}
