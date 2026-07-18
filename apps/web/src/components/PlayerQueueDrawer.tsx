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
        data-testid="player-queue-button"
        className={`relative h-8 w-8 sm:h-10 sm:w-10 ${isOpen ? 'bg-accent/20 text-accent' : 'text-foreground-muted hover:text-foreground'}`}
        onClick={toggleDrawer}
        aria-expanded={isOpen}
        title="播放队列"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
        {queue.length > 0 && (
          <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {queue.length}
          </span>
        )}
      </Button>

      {isOpen ? (
        <aside data-testid="player-queue-drawer" className="absolute bottom-full right-0 z-50 mb-4 flex max-h-[60vh] w-[min(520px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#17181c] text-white shadow-[0_20px_60px_rgba(0,0,0,0.65)] animate-slide-up origin-bottom-right max-sm:fixed max-sm:bottom-[10.5rem] max-sm:left-[-4px] max-sm:right-[-4px] max-sm:mb-0 max-sm:w-auto">
          <div className="flex items-center justify-between border-b border-white/15 bg-[#202228] px-4 py-3">
            <div>
               <h3 className="text-base font-semibold text-white">当前播放队列</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={toggleDrawer} className="h-8 text-xs text-zinc-200 hover:bg-white/10 hover:text-white">
              关闭
            </Button>
          </div>

          <div className="relative flex-1 overflow-y-auto bg-[#111216] p-2 hide-scrollbar">
            {queueWithTracks.length ? (
              queueWithTracks.map(({ item, track }, index) => {
                const canRemove = !!activeSessionId && canReorderQueue;
                const isCurrent = currentQueueItemId === item.id;
                const artistName = track?.artist?.trim() || "未知歌手";
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
                    <div className="flex-1 min-w-0 pr-2">
                       <strong className={`block truncate text-sm font-semibold ${isCurrent ? "text-sky-200" : "text-white"}`}>
                         {track?.title ?? "未知曲目"}
                       </strong>
                       <p className="flex min-w-0 items-center gap-2 text-xs text-zinc-300">
                         <span className="min-w-0 truncate">{artistName}</span>
                         <span className="shrink-0 tabular-nums">{formatDuration(track?.durationMs ?? 0)}</span>
                         <span className="min-w-0 truncate">{memberName}上传</span>
                       </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid="queue-item-play-button"
                        className="h-8 w-8 text-zinc-300 hover:bg-white/10 hover:text-sky-300"
                        disabled={!canControlPlayback || isCurrent}
                        onClick={() => void onPlayQueueItem(item.id)}
                        title="播放"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-zinc-300 hover:bg-red-500/15 hover:text-red-300"
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
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#111216]/90 backdrop-blur-sm">
                 <div className="flex items-center gap-2 rounded-full border border-white/15 bg-[#252832] px-4 py-1.5 shadow-lg">
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
