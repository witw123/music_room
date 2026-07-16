"use client";

import { useMemo, useState, useTransition } from "react";
import type { QueueItem, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type PlayerQueueDrawerProps = {
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentQueueItemId: string | null;
  activeSessionId?: string;
  canControlPlayback: boolean;
  canReorderQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
};

export function PlayerQueueDrawer({
  queue,
  tracks,
  currentQueueItemId,
  activeSessionId,
  canControlPlayback,
  canReorderQueue,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue
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

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className={`relative ${isOpen ? 'bg-accent/20 text-accent' : 'text-foreground-muted hover:text-foreground'}`}
        onClick={toggleDrawer}
        aria-expanded={isOpen}
        title="播放队列"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        {queue.length > 0 && (
          <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {queue.length}
          </span>
        )}
      </Button>

      {isOpen ? (
        <aside className="absolute bottom-full right-0 mb-4 w-[360px] max-h-[60vh] flex flex-col glass-panel rounded-2xl border border-surface-border shadow-2xl z-50 overflow-hidden animate-slide-up origin-bottom-right">
          <div className="flex items-center justify-between p-4 border-b border-surface-border bg-surface/50">
            <div>
               <p className="text-[10px] font-bold text-foreground-muted tracking-[0.2em] uppercase mb-0.5">Queue</p>
               <h3 className="text-base font-semibold text-foreground">当前播放队列</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={toggleDrawer} className="h-8 text-xs">
              关闭
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto hide-scrollbar p-2 flex flex-col gap-1 relative">
            {queueWithTracks.length ? (
              queueWithTracks.map(({ item, track }, index) => {
                const canRemove = !!activeSessionId && canReorderQueue;
                const isCurrent = currentQueueItemId === item.id;

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-3 rounded-xl group transition-all ${
                      isCurrent ? "bg-accent/10 border border-accent/20" : "hover:bg-surface border border-transparent"
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
                    <span className={`text-xs font-mono font-bold w-4 text-center ${isCurrent ? "text-accent" : "text-foreground-muted/50"}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="flex-1 min-w-0 pr-2">
                       <strong className={`block truncate text-sm font-semibold ${isCurrent ? "text-accent" : "text-foreground"}`}>
                         {track?.title ?? "未知曲目"}
                       </strong>
                       <p className="block truncate text-xs text-foreground-muted">
                         {track?.artist ?? "本地上传"} · {formatDuration(track?.durationMs ?? 0)}
                       </p>
                    </div>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 hover:text-accent"
                        disabled={!canControlPlayback || isCurrent}
                        onClick={() => void onPlayQueueItem(item.id)}
                        title="播放"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-foreground-muted hover:text-red-400 hover:bg-red-500/10"
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
              <div className="py-10 text-center text-sm text-foreground-muted">
                 队列空空如也。
              </div>
            )}
            
            {isPending ? (
              <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-10">
                 <div className="bg-surface border border-surface-border rounded-full px-4 py-1.5 flex items-center gap-2 shadow-lg">
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
