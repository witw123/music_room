"use client";

import { useState } from "react";
import type { ProviderLibrarySnapshot } from "@music-room/shared";
import { Button } from "@/components/ui/button";
import {
  localPlaylistTrackId,
  toProviderTrackRecord,
  upsertLocalPlaylistTrack
} from "@/features/playlist/local-playlist";
import { musicRoomApi } from "@/lib/network/music-room-api";

type Provider = "netease" | "qqmusic";
type ImportKind = "likedTracks" | "collectedPlaylists" | "collectedAlbums" | "followedArtists";

const labels: Record<ImportKind, string> = {
  likedTracks: "喜欢的歌曲",
  collectedPlaylists: "收藏的歌单",
  collectedAlbums: "收藏的专辑",
  followedArtists: "关注的歌手"
};

export function ProviderDataImportSection() {
  const providers: Provider[] = [
    ...(process.env.NEXT_PUBLIC_NETEASE_ENABLED === "true" ? ["netease" as const] : []),
    ...(process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true" ? ["qqmusic" as const] : [])
  ];
  if (providers.length === 0) return null;
  return <div className="divide-y divide-surface-border">{providers.map((provider) => <ProviderImporter key={provider} provider={provider} />)}</div>;
}

function ProviderImporter({ provider }: { provider: Provider }) {
  const [snapshot, setSnapshot] = useState<ProviderLibrarySnapshot | null>(null);
  const [selected, setSelected] = useState<Record<ImportKind, boolean>>({
    likedTracks: true,
    collectedPlaylists: true,
    collectedAlbums: true,
    followedArtists: true
  });
  const [pending, setPending] = useState<"load" | "import" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const providerName = provider === "netease" ? "网易云音乐" : "QQ 音乐";

  async function load() {
    setPending("load");
    setMessage(null);
    try {
      setSnapshot(provider === "netease" ? await musicRoomApi.getNeteaseLibrary() : await musicRoomApi.getQqMusicLibrary());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `读取${providerName}资料失败。`);
    } finally {
      setPending(null);
    }
  }

  async function importSelected() {
    if (!snapshot) return;
    setPending("import");
    setMessage(null);
    try {
      let imported = 0;
      if (selected.likedTracks) {
        for (const track of snapshot.likedTracks) {
          await musicRoomApi.saveFavoriteTrack(track);
          imported += 1;
        }
      }
      if (selected.collectedAlbums) {
        for (const album of snapshot.collectedAlbums) {
          await musicRoomApi.saveFavoriteAlbum(album);
          imported += 1;
        }
      }
      if (selected.followedArtists) {
        for (const artist of snapshot.followedArtists) {
          await musicRoomApi.saveFavoriteArtist(artist);
          imported += 1;
        }
      }
      if (selected.collectedPlaylists) {
        const existing = await musicRoomApi.listMyPlaylists();
        const existingKeys = new Set(existing.flatMap((playlist) => playlist.tags.filter((tag) => tag.startsWith("network:"))));
        for (const summary of snapshot.collectedPlaylists) {
          const key = `network:${summary.provider}:${summary.providerPlaylistId}`;
          if (existingKeys.has(key)) continue;
          const detail = summary.provider === "netease"
            ? await musicRoomApi.getNeteasePlaylist(summary.providerPlaylistId)
            : await musicRoomApi.getQqMusicPlaylist(summary.providerPlaylistId);
          await musicRoomApi.createPlaylist({
            title: detail.title,
            description: detail.description,
            coverUrl: detail.artworkUrl ?? detail.tracks.find((track) => track.artworkUrl)?.artworkUrl ?? null,
            isCollaborative: false,
            tags: ["network", key],
            trackIds: detail.tracks.map(localPlaylistTrackId)
          });
          for (const track of detail.tracks) {
            await upsertLocalPlaylistTrack(toProviderTrackRecord(track));
          }
          existingKeys.add(key);
          imported += 1;
        }
      }
      setMessage(imported > 0 ? `已导入 ${imported} 项${providerName}资料。` : "所选资料已经存在。")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `导入${providerName}资料失败。`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{providerName}</p>
          <p className="mt-1 text-xs text-foreground-muted">平台资料不会自动写入项目。</p>
        </div>
        <Button disabled={pending !== null} onClick={() => void load()} size="sm" type="button" variant="outline">
          {pending === "load" ? "读取中" : snapshot ? "重新读取" : "查看资料"}
        </Button>
      </div>
      {snapshot ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(Object.keys(labels) as ImportKind[]).map((kind) => (
            <label className="flex cursor-pointer items-center justify-between gap-3 border border-surface-border px-3 py-2.5" key={kind}>
              <span className="text-xs text-foreground">{labels[kind]}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-foreground-muted">{snapshot[kind].length}</span>
                <input
                  aria-label={`导入${labels[kind]}`}
                  checked={selected[kind]}
                  className="h-4 w-4 accent-accent"
                  onChange={(event) => setSelected((current) => ({ ...current, [kind]: event.target.checked }))}
                  type="checkbox"
                />
              </span>
            </label>
          ))}
          <div className="flex items-center justify-end sm:col-span-2">
            <Button disabled={pending !== null || !Object.values(selected).some(Boolean)} onClick={() => void importSelected()} size="sm" type="button">
              {pending === "import" ? "正在导入" : "导入所选"}
            </Button>
          </div>
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs text-foreground-muted" role="status">{message}</p> : null}
    </div>
  );
}
