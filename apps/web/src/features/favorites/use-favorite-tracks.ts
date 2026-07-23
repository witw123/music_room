"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ProviderTrackCandidate, ProviderTrackFavorite } from "@music-room/shared";
import { musicRoomApi } from "@/lib/music-room-api";

type FavoriteTracksSnapshot = {
  tracks: ProviderTrackFavorite[];
  loading: boolean;
  loadPromise: Promise<void> | null;
  error: string | null;
  pendingKey: string | null;
};

type FavoriteTracksEntry = {
  records: ProviderTrackFavorite[] | null;
  loading: boolean;
  error: string | null;
  pendingKey: string | null;
  snapshot: FavoriteTracksSnapshot;
  listeners: Set<() => void>;
};

const entries = new Map<string, FavoriteTracksEntry>();
const emptySnapshot: FavoriteTracksSnapshot = {
  tracks: [],
  loading: false,
  error: null,
  pendingKey: null
};

function getEntry(userId: string) {
  const existing = entries.get(userId);
  if (existing) return existing;

  const entry: FavoriteTracksEntry = {
    records: null,
    loading: false,
    loadPromise: null,
    error: null,
    pendingKey: null,
    snapshot: emptySnapshot,
    listeners: new Set()
  };
  entries.set(userId, entry);
  return entry;
}

function refreshSnapshot(entry: FavoriteTracksEntry) {
  entry.snapshot = {
    tracks: entry.records ?? [],
    loading: entry.loading,
    error: entry.error,
    pendingKey: entry.pendingKey
  };
  for (const listener of entry.listeners) listener();
}

function trackKey(track: Pick<ProviderTrackCandidate, "provider" | "providerTrackId">) {
  return `${track.provider}:${track.providerTrackId}`;
}

function subscribe(entry: FavoriteTracksEntry, listener: () => void) {
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

async function ensureLoaded(entry: FavoriteTracksEntry) {
  if (entry.records) return;
  if (entry.loadPromise) return entry.loadPromise;
  entry.loading = true;
  entry.error = null;
  refreshSnapshot(entry);
  entry.loadPromise = (async () => {
    try {
      entry.records = await musicRoomApi.listFavoriteTracks();
    } catch (error) {
      entry.error = error instanceof Error ? error.message : "歌曲收藏加载失败。";
    } finally {
      entry.loading = false;
      entry.loadPromise = null;
      refreshSnapshot(entry);
    }
  })();
  return entry.loadPromise;
}

export function favoriteTrackToCandidate(track: ProviderTrackFavorite): ProviderTrackCandidate {
  return {
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    access: track.access,
    quality: track.quality,
    title: track.title,
    artist: track.artist,
    album: track.album,
    ...(track.providerAlbumId ? { providerAlbumId: track.providerAlbumId } : {}),
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl
  } as ProviderTrackCandidate;
}

export function useFavoriteTracks(userId: string | null | undefined) {
  const entry = useMemo(() => (userId ? getEntry(userId) : null), [userId]);
  const subscribeToEntry = useCallback(
    (listener: () => void) => (entry ? subscribe(entry, listener) : () => undefined),
    [entry]
  );
  const getEntrySnapshot = useCallback(() => entry?.snapshot ?? emptySnapshot, [entry]);
  const snapshot = useSyncExternalStore(subscribeToEntry, getEntrySnapshot, () => emptySnapshot);

  useEffect(() => {
    if (entry) void ensureLoaded(entry);
  }, [entry]);

  const isFavorite = useCallback(
    (track: Pick<ProviderTrackCandidate, "provider" | "providerTrackId">) =>
      snapshot.tracks.some((item) => trackKey(item) === trackKey(track)),
    [snapshot.tracks]
  );

  const toggleFavorite = useCallback(
    async (track: ProviderTrackCandidate) => {
      if (!entry) return;
      await ensureLoaded(entry);
      const key = trackKey(track);
      if (entry.pendingKey) return;
      const previousRecords = entry.records ?? [];
      const wasFavorite = previousRecords.some((item) => trackKey(item) === key);
      entry.pendingKey = key;
      entry.error = null;
      entry.records = wasFavorite
        ? previousRecords.filter((item) => trackKey(item) !== key)
        : [
            {
              id: `pending:${key}`,
              ...track,
              providerAlbumId: track.providerAlbumId ?? null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ];
      refreshSnapshot(entry);

      try {
        if (wasFavorite) {
          await musicRoomApi.deleteFavoriteTrack(track.provider, track.providerTrackId);
        } else {
          const saved = await musicRoomApi.saveFavoriteTrack(track);
          entry.records = (entry.records ?? []).map((item) => (trackKey(item) === key ? saved : item));
        }
      } catch (error) {
        entry.records = previousRecords;
        entry.error = error instanceof Error ? error.message : "更新歌曲收藏失败。";
        throw error;
      } finally {
        entry.pendingKey = null;
        refreshSnapshot(entry);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("music-room-favorite-tracks-changed"));
        }
      }
    },
    [entry]
  );

  return {
    favoriteTracks: snapshot.tracks,
    isFavorite,
    loading: snapshot.loading,
    error: snapshot.error,
    pendingFavoriteKey: snapshot.pendingKey,
    toggleFavorite
  };
}
