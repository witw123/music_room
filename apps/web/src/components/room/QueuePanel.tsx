"use client";

import { useMemo, useState, useTransition } from "react";
import type { AuthSession, QueueItem, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type QueuePanelProps = {
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentQueueItemId: string | null;
  activeSession: AuthSession | null;
  hostId: string;
  canControlPlayback: boolean;
  canReorderQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (itemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
};

export function QueuePanel({
  queue,
  tracks,
  currentQueueItemId,
  activeSession,
  hostId,
  canControlPlayback,
  canReorderQueue,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  onAddToQueue
}: QueuePanelProps) {
  const [draggingQueueItemId, setDraggingQueueItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const quickQueueTracks = useMemo(
    () => tracks.filter((track) => !queue.some((item) => item.trackId === track.id)).slice(0, 3),
    [queue, tracks]
  );

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

  return (
    <section className="relative flex h-full w-full flex-col gap-6 pb-10">
      {queue.length > 0 ? (
        <div className="flex flex-col gap-3 pt-2">
          {queue.map((item, index) => {
            const track = tracks.find((entry) => entry.id === item.trackId);
            const isCurrent = currentQueueItemId === item.id;
            const canRemoveQueueItem =
              !!activeSession &&
              (hostId === activeSession.userId || item.requestedById === activeSession.userId);

            return (
              <article
                key={item.id}
                className={`flex flex-col gap-4 rounded-2xl border p-4 transition-all sm:flex-row sm:items-center ${
                  isCurrent
                    ? "border-accent/30 bg-accent/10 shadow-[0_0_15px_rgba(139,92,246,0.1)]"
                    : "border-surface-border bg-surface/50 hover:border-surface-hover hover:bg-surface"
                } ${draggingQueueItemId === item.id ? "scale-95 opacity-40" : ""}`}
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
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <span
                    className={`hidden w-6 text-sm font-mono font-bold sm:block ${
                      isCurrent ? "text-accent" : "text-foreground-muted/50"
                    }`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <strong className={`truncate text-sm font-semibold ${isCurrent ? "text-accent" : "text-foreground"}`}>
                      {track?.title ?? "未知曲目"}
                    </strong>
                    <p className="truncate text-xs text-foreground-muted">
                      {track?.artist ?? "本地音乐"} · {formatDuration(track?.durationMs ?? 0)}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-foreground-muted/60">
                      由 {item.requestedBy} 加入队列
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={isCurrent ? "pointer-events-none opacity-0" : ""}
                    disabled={!canControlPlayback || isCurrent}
                    onClick={() => startTransition(() => void onPlayQueueItem(item.id))}
                    type="button"
                  >
                    播放
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-foreground-muted hover:bg-red-500/10 hover:text-red-400"
                    disabled={!canRemoveQueueItem}
                    onClick={() => startTransition(() => void onRemoveQueueItem(item.id))}
                    type="button"
                  >
                    移出队列
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-5 pt-3">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-border bg-surface/30 px-4 py-10 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-surface-border bg-surface text-foreground-muted">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <p className="text-sm text-foreground-muted">队列还是空的，先加入几首歌把房间转起来。</p>
          </div>

          {quickQueueTracks.length > 0 ? (
            <div className="hide-scrollbar flex w-full gap-2 overflow-x-auto pb-2">
              {quickQueueTracks.map((track) => (
                <Button
                  key={track.id}
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 justify-start bg-surface/50 px-3 text-xs"
                  onClick={() => startTransition(() => void onAddToQueue(track.id))}
                  type="button"
                >
                  <span className="block max-w-[11rem] truncate">加入：{track.title}</span>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {isPending ? (
        <div className="animate-fade-in absolute left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 py-1.5 shadow-lg backdrop-blur-md">
          <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
          <span className="text-xs text-foreground">同步队列中...</span>
        </div>
      ) : null}
    </section>
  );
}
