"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProviderAlbumDetail, ProviderAlbumFavorite } from "@music-room/shared";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { ProviderAlbumDetailView } from "@/components/ProviderAlbumDetailView";
import { useSessionIdentity } from "@/features/session/use-session-identity";
import { buildWorkspaceAuthHref } from "@/lib/client-shell";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";

export function FavoriteAlbumsPage() {
  const router = useRouter();
  const authEntryHref = buildWorkspaceAuthHref({ redirectTo: "/app/favorites" });
  const { activeSession, hydrated } = useSessionIdentity({
    sessionStorageKey: "music-room-session",
    initialStatusMessage: ""
  });
  const [items, setItems] = useState<ProviderAlbumFavorite[]>([]);
  const [detail, setDetail] = useState<ProviderAlbumDetail | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !activeSession) router.replace(authEntryHref as Route);
  }, [activeSession, authEntryHref, hydrated, router]);

  useEffect(() => {
    if (!activeSession) return;
    let cancelled = false;
    void musicRoomApi.listFavoriteAlbums()
      .then((records) => {
        if (!cancelled) setItems(records);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : "收藏加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

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
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
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
        {errorMessage ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}
      </div>
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
  if (error instanceof MusicRoomApiError) return error.message;
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
