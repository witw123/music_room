"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NeteaseTrackCandidate, ProviderAlbumDetail, ProviderAlbumFavorite, QqMusicTrackCandidate } from "@music-room/shared";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { ProviderAlbumDetailView } from "@/components/ProviderAlbumDetailView";
import { ProviderPlaylistPickerDialog, type ProviderPlaylistPickerOption } from "@/components/ProviderPlaylistPickerDialog";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { isLocalPlaylistMirror } from "@/lib/local-playlist-database";
import {
  getCachedFavorites,
  setCachedFavorites
} from "@/features/workspace/page-data-cache";
import { useLocalPlayer } from "@/features/playback/local-player-context";
import {
  hashAudioBlob,
  listMergedLocalPlaylistTracks,
  localPlaylistTrackId,
  toProviderTrackRecord
} from "@/features/playlist/local-playlist";
import { upsertLocalPlaylistTrack, type LocalPlaylistTrackRecord } from "@/lib/indexeddb";
import {
  ensureLocalAudioDirectoryWriteAccess,
  normalizeLocalAudioMimeType,
  saveAudioFileToLocalDirectory
} from "@/features/upload/local-audio-storage";
import { type AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";

type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;

export function FavoriteAlbumsPage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/favorites" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const player = useLocalPlayer();
  const [items, setItems] = useState<ProviderAlbumFavorite[]>(() =>
    activeSession ? getCachedFavorites(activeSession.userId) ?? [] : []
  );
  const [favoritesLoaded, setFavoritesLoaded] = useState(() =>
    Boolean(activeSession && getCachedFavorites(activeSession.userId))
  );
  const [detail, setDetail] = useState<ProviderAlbumDetail | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalPlaylistTrackRecord[]>([]);
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null);
  const [playlistPickerAnchor, setPlaylistPickerAnchor] = useState<AnchoredDialogAnchor | null>(null);
  const [playlistPickerOptions, setPlaylistPickerOptions] = useState<ProviderPlaylistPickerOption[]>([]);
  const [playlistPickerLoading, setPlaylistPickerLoading] = useState(false);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    if (!activeSession) return;
    const cachedItems = getCachedFavorites(activeSession.userId);
    if (cachedItems) {
      setItems(cachedItems);
      setFavoritesLoaded(true);
    }
    let cancelled = false;
    void musicRoomApi.listFavoriteAlbums()
      .then((records) => {
        if (!cancelled) {
          setCachedFavorites(activeSession.userId, records);
          setItems(records);
          setFavoritesLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFavoritesLoaded(true);
          setErrorMessage(error instanceof Error ? error.message : "收藏加载失败。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    let cancelled = false;
    void listMergedLocalPlaylistTracks().then((tracks) => {
      if (!cancelled) setLocalTracks(tracks);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  function getLocalRecord(track: Track) {
    return localTracks.find((item) => item.id === localPlaylistTrackId(track)) ?? toProviderTrackRecord(track);
  }

  function albumRecords(albumToPlay: ProviderAlbumDetail) {
    return albumToPlay.tracks.map((track) => getLocalRecord(track));
  }

  async function resolveTrackArtwork(track: Track) {
    if (track.artworkUrl) return track;
    try {
      return track.provider === "netease"
        ? await musicRoomApi.getNeteaseTrack(track.providerTrackId)
        : await musicRoomApi.getQqMusicTrack(track.providerTrackId);
    } catch {
      return track;
    }
  }

  async function downloadTrack(track: Track) {
    const existing = localTracks.find((item) => item.id === localPlaylistTrackId(track));
    if (existing?.availableOffline || pending) return;
    setPending(`download:${track.provider}:${track.providerTrackId}`);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      await ensureLocalAudioDirectoryWriteAccess();
      const response = resolvedTrack.provider === "netease"
        ? await musicRoomApi.downloadNeteaseTrack(resolvedTrack.providerTrackId)
        : await musicRoomApi.downloadQqMusicTrack(resolvedTrack.providerTrackId);
      const fileHash = await hashAudioBlob(response.blob);
      const mimeType = normalizeLocalAudioMimeType(response.contentType || response.blob.type);
      const lyricPayload = existing?.lyrics
        ? null
        : await (resolvedTrack.provider === "netease"
          ? musicRoomApi.getNeteaseLyrics(resolvedTrack.providerTrackId)
          : musicRoomApi.getQqMusicLyrics(resolvedTrack.providerTrackId)
        ).catch(() => null);
      const lyrics = existing?.lyrics ?? lyricPayload?.plainLyric ?? null;
      const saved = await saveAudioFileToLocalDirectory({
        file: response.blob,
        fileHash,
        title: resolvedTrack.title,
        mimeType,
        track: {
          artist: resolvedTrack.artist,
          album: resolvedTrack.album,
          artworkUrl: resolvedTrack.artworkUrl,
          lyrics,
          provider: resolvedTrack.provider,
          providerTrackId: resolvedTrack.providerTrackId,
          durationMs: resolvedTrack.durationMs,
          sizeBytes: response.blob.size
        }
      });
      const updatedTrack: LocalPlaylistTrackRecord = {
        ...toProviderTrackRecord(resolvedTrack, existing),
        fileHash,
        fileName: saved.fileName,
        sizeBytes: response.blob.size,
        mimeType,
        lyrics,
        availableOffline: true,
        updatedAt: new Date().toISOString()
      };
      await upsertLocalPlaylistTrack(updatedTrack);
      setLocalTracks((current) => [...current.filter((item) => item.id !== updatedTrack.id), updatedTrack]);
      setStatusMessage(`《${resolvedTrack.title}》已下载到本地目录。`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "歌曲下载失败，请稍后重试。");
    } finally {
      setPending(null);
    }
  }

  async function openPlaylistPicker(track: Track, anchor: AnchoredDialogAnchor) {
    if (pending) return;
    setPlaylistPickerTrack(track);
    setPlaylistPickerAnchor(anchor);
    setPlaylistPickerLoading(true);
    setPlaylistPickerOptions([]);
    setStatusMessage(null);
    setPending(`playlist-picker:${track.providerTrackId}`);
    try {
      const playlists = await musicRoomApi.listMyPlaylists();
      setPlaylistPickerOptions(playlists.filter((item) => !isLocalPlaylistMirror(item)).map((playlist) => ({ kind: "network" as const, playlist })));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setPlaylistPickerLoading(false);
      setPending(null);
    }
  }

  async function addTrackToPlaylist(option: ProviderPlaylistPickerOption) {
    const track = playlistPickerTrack;
    if (!track || pending) return;
    setPending(`add-playlist:${option.playlist.id}:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      const resolvedTrack = await resolveTrackArtwork(track);
      const trackId = localPlaylistTrackId(resolvedTrack);
      const record = toProviderTrackRecord(resolvedTrack, localTracks.find((item) => item.id === trackId));
      await upsertLocalPlaylistTrack(record);
      setLocalTracks((current) => [...current.filter((item) => item.id !== record.id), record]);
      if (!option.playlist.trackIds.includes(trackId)) {
        await musicRoomApi.updatePlaylist(option.playlist.id, { trackIds: [...option.playlist.trackIds, trackId] });
        setStatusMessage(`《${resolvedTrack.title}》已加入“${option.playlist.title}”。`);
      } else {
        setStatusMessage(`《${resolvedTrack.title}》已在“${option.playlist.title}”中。`);
      }
      setPlaylistPickerTrack(null);
      setPlaylistPickerAnchor(null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function openAlbum(item: ProviderAlbumFavorite) {
    if (pending) return;
    setPending(`open:${item.id}`);
    setErrorMessage(null);
    try {
      const nextDetail = item.provider === "netease"
        ? await musicRoomApi.getNeteaseAlbum(item.providerAlbumId)
        : await musicRoomApi.getQqMusicAlbum(item.providerAlbumId);
      setDetail(nextDetail);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function removeAlbum(item: ProviderAlbumFavorite) {
    if (!activeSession || pending) return;
    setPending(`remove:${item.id}`);
    setErrorMessage(null);
    try {
      await musicRoomApi.deleteFavoriteAlbum(item.provider, item.providerAlbumId);
      const nextItems = items.filter((candidate) => candidate.id !== item.id);
      setItems(nextItems);
      if (activeSession) setCachedFavorites(activeSession.userId, nextItems);
      if (detail?.provider === item.provider && detail.providerAlbumId === item.providerAlbumId) setDetail(null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setPending(null);
    }
  }

  if (!hydrated || !activeSession) return <div className="min-h-screen bg-black" />;

  const detailItem = detail
    ? items.find((item) => item.provider === detail.provider && item.providerAlbumId === detail.providerAlbumId) ?? null
    : null;

  return (
    <main className="h-screen min-h-screen overflow-y-auto hide-scrollbar bg-black pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-4 pb-12 pt-6 sm:px-7 sm:pt-10 md:px-10 md:pt-14">
        {detail && detailItem ? (
          <ProviderAlbumDetailView
            album={detail}
            isFavorite
            onBack={() => setDetail(null)}
            onToggleFavorite={() => removeAlbum(detailItem)}
            pending={pending}
            trackActions={{
              isDownloaded: (track) => getLocalRecord(track).availableOffline,
              isPlayable: (track) => player.isTrackPlayable(getLocalRecord(track)),
              isQueued: (track) => player.queue.some((item) => item.trackId === getLocalRecord(track).id),
              isDownloading: (track) => pending === `download:${track.provider}:${track.providerTrackId}`,
              onDownload: (track) => void downloadTrack(track),
              onAddToQueue: (track) => player.addToQueue(getLocalRecord(track)),
              onPlay: (track) => {
                const records = albumRecords(detail);
                const index = records.findIndex((item) => item.id === localPlaylistTrackId(track));
                if (index >= 0) void player.playTracks(records, index);
              },
              onAddToPlaylist: (track, anchor) => void openPlaylistPicker(track, anchor)
            }}
          />
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Your collection</p>
                <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">收藏</h1>
                <p className="mt-2 text-sm text-white/40">已收藏 {items.length} 张专辑</p>
              </div>
              <Link className="text-xs text-white/45 hover:text-white" href="/app/search">返回搜索</Link>
            </header>

            <section className="mt-10">
              {items.length ? (
                <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {items.map((item) => (
                    <article className="group min-w-0" key={item.id}>
                      <button className="block w-full text-left" disabled={pending !== null} onClick={() => void openAlbum(item)} type="button">
                        <AlbumArtwork alt={item.title} src={item.artworkUrl} />
                        <span className="mt-3 block truncate text-sm font-medium text-white/85">{item.title}</span>
                        <span className="mt-1 block truncate text-xs text-white/40">{item.artist}</span>
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/30">
                        <span>{item.provider === "netease" ? "网易云" : "QQ 音乐"}</span>
                        <Button aria-label={`取消收藏 ${item.title}`} disabled={pending !== null} onClick={() => void removeAlbum(item)} size="icon" title="取消收藏" variant="ghost" type="button"><HeartIcon filled /></Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : !favoritesLoaded ? (
                <div className="flex min-h-[430px] items-center justify-center rounded-2xl border border-white/[0.1] bg-black px-6 text-center text-sm text-white/40">
                  正在加载收藏…
                </div>
              ) : (
                <div className="flex min-h-[430px] flex-col items-center justify-center rounded-2xl border border-white/[0.1] bg-black px-6 text-center">
                  <HeartIcon />
                  <p className="mt-4 text-sm font-medium text-white/60">还没有收藏专辑</p>
                  <p className="mt-2 text-xs text-white/30">在搜索页打开专辑并点击收藏。</p>
                </div>
              )}
            </section>
          </>
        )}
        {statusMessage ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3 text-xs text-emerald-200" role="status">{statusMessage}</p> : null}
        {errorMessage ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}
      </div>
      {playlistPickerTrack && playlistPickerAnchor ? (
        <ProviderPlaylistPickerDialog
          anchor={playlistPickerAnchor}
          loading={playlistPickerLoading}
          options={playlistPickerOptions}
          pending={pending !== null}
          subjectLabel={`《${playlistPickerTrack.title}》 · ${playlistPickerTrack.artist}`}
          onClose={() => {
            if (!pending) {
              setPlaylistPickerTrack(null);
              setPlaylistPickerAnchor(null);
            }
          }}
          onSelect={(option) => void addTrackToPlaylist(option)}
        />
      ) : null}
    </main>
  );
}

function AlbumArtwork({ alt, src }: { alt: string; src: string | null }) {
  return src ? (
    // External provider artwork is intentionally rendered without Next image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className="aspect-square w-full rounded-2xl object-cover" loading="lazy" src={src} />
  ) : <span aria-label={alt} className="flex aspect-square w-full items-center justify-center rounded-2xl bg-black text-3xl text-white/20">♪</span>;
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return <svg aria-hidden="true" fill={filled ? "currentColor" : "none"} height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
}

function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "QQMUSIC_TRACK_NOT_FOUND") return "该歌曲没有可用的公开音频，可能受到 VIP 或版权限制，请换一首歌曲重试。";
    if (error.code === "QQMUSIC_AUTH_EXPIRED") return "QQ 音乐登录已失效，请回个人中心重新绑定。";
    return error.message;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
