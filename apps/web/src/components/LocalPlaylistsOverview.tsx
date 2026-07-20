"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import {
  ensureDefaultLocalPlaylist,
  flushLocalPlaylistPersistence,
  getDefaultLocalPlaylistTrackIds,
  listMergedLocalPlaylistTracks,
  mergeLocalPlaylists,
  restoreLocalPlaylistsFromRepository,
  syncSelectedLocalDirectoryTracks,
  type LocalPlaylistRecord
} from "@/features/playlist/local-playlist";
import { getLocalAudioStorageState } from "@/features/upload/local-audio-storage";
import type { LocalPlaylistTrackRecord } from "@/lib/indexeddb";
import { LocalPlaylistCard } from "@/components/PlaylistsWorkspacePage";

const localPlaylistsHref = "/app/profile/playlists" as Route;

export function LocalPlaylistsOverview() {
  const router = useRouter();
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await flushLocalPlaylistPersistence();
      const [tracks, restoredPlaylists, storage] = await Promise.all([
        listMergedLocalPlaylistTracks(),
        restoreLocalPlaylistsFromRepository(),
        getLocalAudioStorageState()
      ]);
      mergeLocalPlaylists(restoredPlaylists);
      const playlists = ensureDefaultLocalPlaylist({
        trackIds: getDefaultLocalPlaylistTrackIds(
          tracks,
          new Set(storage.savedFileHashes)
        ),
        sourceDirectoryName: storage.directoryName
      });
      setLocalTracks(tracks);
      setLocalPlaylists(playlists);
      setLoading(false);

      void syncSelectedLocalDirectoryTracks()
        .then(async () => {
          const [syncedTracks, syncedStorage] = await Promise.all([
            listMergedLocalPlaylistTracks(),
            getLocalAudioStorageState()
          ]);
          const syncedPlaylists = ensureDefaultLocalPlaylist({
            trackIds: getDefaultLocalPlaylistTrackIds(
              syncedTracks,
              new Set(syncedStorage.savedFileHashes)
            ),
            sourceDirectoryName: syncedStorage.directoryName
          });
          setLocalTracks(syncedTracks);
          setLocalPlaylists(syncedPlaylists);
        })
        .catch(() => undefined);
    } catch {
      setError("本地歌单加载失败，请稍后重试。");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tracksById = new Map(localTracks.map((track) => [track.id, track]));
  const openPlaylistManager = useCallback(() => {
    router.push(localPlaylistsHref);
  }, [router]);

  return (
    <section className="mt-8 border-b border-surface-border pb-8" data-testid="local-playlists-overview">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">本地歌单</h2>
          <p className="mt-1 text-xs text-foreground-muted">你的本地歌单会直接显示在这里。</p>
        </div>
        <Link className="shrink-0" href={localPlaylistsHref}>
          <Button size="sm" type="button" variant="outline">
            管理本地歌单
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div className="aspect-square animate-pulse rounded-2xl bg-surface/60" key={index} />
          ))}
        </div>
      ) : localPlaylists.length ? (
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {localPlaylists.map((playlist) => (
            <LocalPlaylistCard
              key={playlist.id}
              onOpen={openPlaylistManager}
              playlist={playlist}
              tracks={playlist.trackIds
                .map((trackId) => tracksById.get(trackId))
                .filter((track): track is LocalPlaylistTrackRecord => Boolean(track))}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-surface-border px-6 py-8 text-center text-sm text-foreground-muted">
          暂无本地歌单。
        </div>
      )}
      {error ? <p className="mt-4 text-xs text-red-300" role="alert">{error}</p> : null}
    </section>
  );
}
