"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProviderAlbumDetail, ProviderAlbumFavorite } from "@music-room/shared";
import { useRouter } from "next/navigation";
import type { Route } from "next";
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

  if (!hydrated || !activeSession) return <div className="min-h-screen bg-[#111214]" />;

  return (
    <main className="min-h-screen bg-[#111214] pb-[calc(12rem+env(safe-area-inset-bottom))] text-foreground md:pl-60 lg:pb-28">
      <div className="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-4 pb-12 pt-8 sm:px-7 sm:pt-10 md:px-10 md:pt-14">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Your collection</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">收藏</h1><p className="mt-2 text-sm text-white/40">已收藏 {items.length} 张专辑</p></div>
          <Link className="text-xs text-white/45 hover:text-white" href="/app/search">返回搜索</Link>
        </header>

        <div className="mt-9 grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {items.length ? items.map((item) => (
              <article className="min-w-0" key={item.id}>
                <button className="block w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] text-left transition hover:border-accent/50 hover:bg-white/[0.06]" disabled={pending !== null} onClick={() => void openAlbum(item)} type="button">
                  <Artwork alt={item.title} src={item.artworkUrl} />
                  <span className="block truncate px-3 pt-3 text-sm font-medium text-white/85">{item.title}</span>
                  <span className="block truncate px-3 pb-4 pt-1 text-xs text-white/40">{item.artist}</span>
                </button>
                <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-white/30"><span>{item.provider === "netease" ? "网易云" : "QQ 音乐"}</span><button className="text-white/40 hover:text-white" disabled={pending !== null} onClick={() => void removeAlbum(item)} type="button">{pending === `remove:${item.id}` ? "处理中" : "移除"}</button></div>
              </article>
            )) : <div className="col-span-full flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.12] px-6 text-center"><span className="text-3xl text-white/20">♡</span><p className="mt-4 text-sm text-white/55">还没有收藏专辑</p><p className="mt-2 text-xs text-white/30">在搜索页打开专辑并点击收藏。</p></div>}
          </section>

          <aside className="min-h-[320px] rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
            {detail ? <><div className="flex items-start gap-3"><Artwork alt={detail.title} src={detail.artworkUrl} /><div className="min-w-0"><h2 className="truncate text-base font-semibold text-white/90">{detail.title}</h2><p className="mt-1 text-xs text-white/40">{detail.artist} · {detail.tracks.length} 首</p></div></div><p className="mt-4 text-xs leading-6 text-white/40">{detail.description || "暂无简介"}</p><div className="mt-5 max-h-[32rem] overflow-y-auto divide-y divide-white/[0.07]">{detail.tracks.map((track, index) => <p className="py-2 text-xs text-white/55" key={track.providerTrackId}>{String(index + 1).padStart(2, "0")}　{track.title} · {track.artist}</p>)}</div></> : <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center"><p className="text-sm text-white/55">选择专辑查看详情</p><p className="mt-2 text-xs text-white/30">专辑歌曲会显示在这里。</p></div>}
          </aside>
        </div>
        {errorMessage ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-xs text-red-200" role="alert">{errorMessage}</p> : null}
      </div>
    </main>
  );
}

function Artwork({ alt, src }: { alt: string; src: string | null }) {
  return src ? <img alt={alt} className="aspect-square w-full object-cover" loading="lazy" src={src} /> : <span aria-label={alt} className="flex aspect-square w-full items-center justify-center bg-[linear-gradient(135deg,#252a32,#15171b)] text-3xl text-white/20">♪</span>;
}

function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) return error.message;
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
