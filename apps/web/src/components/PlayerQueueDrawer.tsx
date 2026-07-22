"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { QueueItem, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

type PlayerQueueDrawerProps = {
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentQueueItemId: string | null;
  canControlPlayback: boolean;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  accentColor?: string;
  accentSoft?: string;
};

export function PlayerQueueDrawer({
  queue,
  tracks,
  currentQueueItemId,
  canControlPlayback,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  accentColor = "rgb(0 148 255)",
  accentSoft = "rgba(0, 148, 255, 0.16)"
}: PlayerQueueDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draggingQueueItemId, setDraggingQueueItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const queueWithTracks = useMemo(
    () =>
      queue.map((item) => ({
        item,
        track: tracks.find((track) => track.id === item.trackId) ?? null
      })),
    [queue, tracks]
  );

  const toggleDrawer = () => setIsOpen((current) => !current);

  async function handleDrop(targetQueueItemId: string) {
    if (!draggingQueueItemId || draggingQueueItemId === targetQueueItemId || !canReorderQueue) {
      setDraggingQueueItemId(null);
      return;
    }

    const reorderedIds = [...queue.map((item) => item.id)];
    const fromIndex = reorderedIds.indexOf(draggingQueueItemId);
    const toIndex = reorderedIds.indexOf(targetQueueItemId);

    if (fromIndex < 0 || toIndex < 0) {
      setDraggingQueueItemId(null);
      return;
    }

    reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(toIndex, 0, draggingQueueItemId);
    setDraggingQueueItemId(null);
    await onReorderQueue(reorderedIds);
  }

  async function moveQueueItem(queueItemId: string, direction: -1 | 1) {
    if (!canReorderQueue) return;
    const currentIndex = queue.findIndex((item) => item.id === queueItemId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= queue.length) return;

    const reorderedIds = queue.map((item) => item.id);
    [reorderedIds[currentIndex], reorderedIds[targetIndex]] = [
      reorderedIds[targetIndex],
      reorderedIds[currentIndex]
    ];
    await onReorderQueue(reorderedIds);
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        data-testid="player-queue-button"
        className="relative h-10 w-10 text-foreground-muted transition-colors hover:text-foreground sm:h-10 sm:w-10"
        style={{ color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) }}
        onClick={toggleDrawer}
        aria-expanded={isOpen}
        title="播放队列"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        {queue.length > 0 && (
          <span
            className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white transition-[background-color,box-shadow] duration-500"
            style={{ backgroundColor: accentColor, boxShadow: `0 0 8px ${accentColor}` }}
          >
            {queue.length}
          </span>
        )}
      </Button>

      {isOpen ? (
        <aside aria-label="播放队列" data-testid="player-queue-drawer" className="light-player-queue absolute bottom-full right-0 z-50 mb-4 flex max-h-[60vh] w-[min(520px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#17181c] text-white shadow-[0_20px_60px_rgba(0,0,0,0.65)] animate-slide-up origin-bottom-right max-sm:fixed max-sm:bottom-[calc(10.5rem+env(safe-area-inset-bottom))] max-sm:left-2 max-sm:right-2 max-sm:mb-0 max-sm:w-auto max-sm:max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-12rem)]">
          <div className="light-player-queue-content relative flex-1 overflow-y-auto bg-[#111216] p-2 hide-scrollbar">
            {queueWithTracks.length ? (
              queueWithTracks.map(({ item, track }, index) => {
                const canRemove = canRemoveQueue;
                const isCurrent = currentQueueItemId === item.id;
                const title = track?.title ?? "未知曲目";
                const artistName = track?.artist?.trim() || "未知歌手";
                const albumName = track?.album?.trim() || "未知专辑";
                const memberName = track?.ownerNickname?.trim() || item.requestedBy?.trim() || "成员";

                return (
                  <div
                    key={item.id}
                    data-testid="queue-item"
                    className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${
                      isCurrent ? "border-accent/50 bg-accent/20" : "border-transparent hover:border-white/10 hover:bg-white/[0.07]"
                    } ${draggingQueueItemId === item.id ? "opacity-50 scale-95" : ""}`}
                    draggable={canReorderQueue}
                    onDragStart={() => setDraggingQueueItemId(item.id)}
                    onDragOver={(event) => {
                      if (canReorderQueue) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleDrop(item.id);
                    }}
                    onDragEnd={() => setDraggingQueueItemId(null)}
                  >
                    <span className={`w-4 text-center font-mono text-xs font-bold ${isCurrent ? "text-sky-300" : "text-zinc-400"}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <QueueArtwork artworkUrl={track?.artworkUrl ?? null} title={title} />
                    <div className="min-w-0 flex-1 pr-2">
                       <strong className={`block truncate text-sm font-semibold ${isCurrent ? "text-sky-200" : "text-white"}`}>
                         {title}
                       </strong>
                       <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-300">
                         <span className="min-w-0 truncate">{artistName}</span>
                         <span aria-hidden="true" className="shrink-0 text-white/30">·</span>
                         <span className="min-w-0 truncate">{albumName}</span>
                       </p>
                       <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
                         <span className="shrink-0 tabular-nums">{formatDuration(track?.durationMs ?? 0)}</span>
                         <span aria-hidden="true" className="shrink-0 text-white/25">·</span>
                         <span className="min-w-0 truncate">{memberName}上传</span>
                       </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      {canReorderQueue ? (
                        <div className="flex items-center gap-0.5 sm:hidden">
                          <Button
                            aria-label={`上移《${title}》`}
                            className="h-10 w-10 text-zinc-300 hover:bg-white/10 hover:text-sky-300"
                            disabled={index === 0 || isPending}
                            onClick={() => void moveQueueItem(item.id, -1)}
                            size="icon"
                            title="上移"
                            type="button"
                            variant="ghost"
                          >
                            <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="m6 14 6-6 6 6" /></svg>
                          </Button>
                          <Button
                            aria-label={`下移《${title}》`}
                            className="h-10 w-10 text-zinc-300 hover:bg-white/10 hover:text-sky-300"
                            disabled={index === queue.length - 1 || isPending}
                            onClick={() => void moveQueueItem(item.id, 1)}
                            size="icon"
                            title="下移"
                            type="button"
                            variant="ghost"
                          >
                            <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d="m6 10 6 6 6-6" /></svg>
                          </Button>
                        </div>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid="queue-item-play-button"
                        className="h-10 w-10 text-zinc-300 hover:bg-white/10 hover:text-sky-300 sm:h-8 sm:w-8"
                        disabled={!canControlPlayback || isCurrent}
                        onClick={() => void onPlayQueueItem(item.id)}
                        title="播放"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-zinc-300 hover:bg-red-500/15 hover:text-red-300 sm:h-8 sm:w-8"
                        disabled={!canRemove}
                        onClick={() => startTransition(() => void onRemoveQueueItem(item.id))}
                        title="移除"
                      >
                         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-10 text-center text-sm text-zinc-300">
                 队列空空如也。
              </div>
            )}
            
            {isPending ? (
              <div className="light-player-queue-pending absolute inset-0 z-10 flex items-center justify-center bg-[#111216]/90 backdrop-blur-sm">
                 <div className="light-player-queue-pending-pill flex items-center gap-2 rounded-full border border-white/15 bg-[#252832] px-4 py-1.5 shadow-lg">
                    <div className="w-2 h-2 rounded-full bg-accent animate-ping" />
                    <span className="text-xs text-foreground">更新队列中...</span>
                 </div>
              </div>
            ) : null}
          </div>

        </aside>
      ) : null}
    </div>
  );
}

function QueueArtwork({ artworkUrl, title }: { artworkUrl: string | null; title: string }) {
  const source = artworkUrl?.trim() ? getArtworkSourceUrl(artworkUrl) : null;
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [source]);

  return (
    <div
      aria-label={`${title} 封面`}
      className="light-player-queue-artwork flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#252832] text-sm font-semibold text-white/45"
      data-testid="queue-item-artwork"
    >
      {source && !hasError ? (
        // External provider artwork is intentionally rendered without Next image optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          draggable={false}
          loading="lazy"
          onError={() => setHasError(true)}
          src={source}
        />
      ) : (
        <span aria-hidden="true">{title.slice(0, 1).toUpperCase() || "♪"}</span>
      )}
    </div>
  );
}
