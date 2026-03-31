"use client";

import { useMemo, useState, useTransition } from "react";
import type { AuthSession, QueueItem, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type QueuePanelProps = {
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentTrackId: string | null;
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
  currentTrackId,
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
    <section className="flex flex-col gap-6 relative w-full h-full pb-10">
      <div className="flex items-end justify-between rounded-b-xl border-b border-white/5 bg-surface/90 px-2 pb-2 pt-2 backdrop-blur-md">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Shared Queue</p>
          <h2 className="text-lg font-bold text-foreground">共享播放顺序</h2>
        </div>
        <span className="text-xs font-semibold text-accent px-2 py-1 bg-accent/10 rounded-md border border-accent/20">
          {queue.length} 待播
        </span>
      </div>

      {queue.length > 0 ? (
        <div className="flex flex-col gap-3 pt-2">
          {queue.map((item, index) => {
            const track = tracks.find((entry) => entry.id === item.trackId);
            const isCurrent = currentTrackId === item.trackId;
            const canRemoveQueueItem =
              !!activeSession &&
              (hostId === activeSession.id || item.requestedById === activeSession.id);

            return (
              <article
                key={item.id}
                className={`flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-2xl border transition-all ${
                  isCurrent 
                    ? "bg-accent/10 border-accent/30 shadow-[0_0_15px_rgba(139,92,246,0.1)]" 
                    : "bg-surface/50 border-surface-border hover:bg-surface hover:border-surface-hover"
                } ${draggingQueueItemId === item.id ? "opacity-40 scale-95" : ""}`}
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
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <span className={`text-sm font-mono font-bold w-6 hidden sm:block ${isCurrent ? "text-accent" : "text-foreground-muted/50"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <strong className={`font-semibold truncate text-sm ${isCurrent ? "text-accent" : "text-foreground"}`}>
                      {track?.title ?? "未知曲目"}
                    </strong>
                    <p className="text-xs text-foreground-muted truncate">
                      {track?.artist ?? "本地音乐"} · {formatDuration(track?.durationMs ?? 0)}
                    </p>
                    <p className="text-[10px] text-foreground-muted/60 truncate mt-0.5">
                      由 {item.requestedBy} 追加点入
                    </p>
                  </div>
                </div>

                <div className="flex items-center sm:justify-end gap-2 shrink-0">
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
             <div className="w-10 h-10 rounded-full bg-surface border border-surface-border flex items-center justify-center mb-3 text-foreground-muted">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
             </div>
             <p className="text-foreground-muted text-sm">队列还是空的。让房间运转起来吧。</p>
           </div>
           
          {quickQueueTracks.length > 0 && (
            <div className="flex gap-2 w-full overflow-x-auto hide-scrollbar pb-2">
              {quickQueueTracks.map((track) => (
                <Button
                  key={track.id}
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-xs bg-surface/50 max-w-[140px] truncate block"
                  onClick={() => startTransition(() => void onAddToQueue(track.id))}
                  type="button"
                >
                  加入：{track.title}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {isPending ? (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-surface backdrop-blur-md rounded-full px-4 py-1.5 border border-surface-border shadow-lg flex items-center gap-2 z-50 animate-fade-in">
           <div className="w-2 h-2 rounded-full bg-accent animate-ping" />
           <span className="text-xs text-foreground">同步队列中...</span>
        </div>
      ) : null}
    </section>
  );
}
