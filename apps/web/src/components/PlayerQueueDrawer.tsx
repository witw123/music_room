"use client";

import { useMemo, useState, useTransition } from "react";
import type { QueueItem, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";

type PlayerQueueDrawerProps = {
  queue: QueueItem[];
  tracks: TrackMeta[];
  currentTrackId: string | null;
  activeSessionId?: string;
  hostId?: string;
  canControlPlayback: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
};

export function PlayerQueueDrawer({
  queue,
  tracks,
  currentTrackId,
  activeSessionId,
  hostId,
  canControlPlayback,
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
    if (!draggingQueueItemId || draggingQueueItemId === targetQueueItemId || !canControlPlayback) {
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
    <div className={`player-queue${isOpen ? " open" : ""}`}>
      <button
        type="button"
        className="bp-btn ghost-action inverse player-queue-toggle"
        onClick={toggleDrawer}
        aria-expanded={isOpen}
        aria-controls="player-queue-drawer"
        title="播放队列"
      >
        队列
        <span className="player-queue-count">{queue.length}</span>
      </button>

      {isOpen ? (
        <aside id="player-queue-drawer" className="player-queue-drawer">
          <div className="player-queue-header">
            <div>
              <p className="player-caption">播放队列</p>
              <h3>共享播放顺序</h3>
            </div>
            <button type="button" className="ghost-action" onClick={toggleDrawer}>
              收起
            </button>
          </div>

          <div className="player-queue-list">
            {queueWithTracks.length ? (
              queueWithTracks.map(({ item, track }, index) => {
                const canRemove =
                  !!activeSessionId &&
                  (hostId === activeSessionId || item.requestedById === activeSessionId);
                const isCurrent = currentTrackId === item.trackId;

                return (
                  <div
                    key={item.id}
                    className={`player-queue-row${isCurrent ? " is-current" : ""}${
                      draggingQueueItemId === item.id ? " is-dragging" : ""
                    }`}
                    draggable={canControlPlayback}
                    onDragStart={() => setDraggingQueueItemId(item.id)}
                    onDragOver={(event) => {
                      if (canControlPlayback) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleDrop(item.id);
                    }}
                    onDragEnd={() => setDraggingQueueItemId(null)}
                  >
                    <span className="player-queue-index">{String(index + 1).padStart(2, "0")}</span>
                    <div className="player-queue-copy">
                      <strong>{track?.title ?? "未知曲目"}</strong>
                      <p>
                        {track?.artist ?? "本地上传"} · {formatDuration(track?.durationMs ?? 0)} · 点歌人{" "}
                        {item.requestedBy}
                      </p>
                    </div>
                    <div className="player-queue-actions">
                      <button
                        type="button"
                        className="ghost-action"
                        disabled={!canControlPlayback}
                        onClick={() => startTransition(() => void onPlayQueueItem(item.id))}
                      >
                        播放
                      </button>
                      <button
                        type="button"
                        className="queue-remove"
                        disabled={!canRemove}
                        onClick={() => startTransition(() => void onRemoveQueueItem(item.id))}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="placeholder-copy">播放队列还是空的，先从曲库里挑几首歌。</p>
            )}
          </div>

          {isPending ? <div className="pending-indicator">正在同步队列…</div> : null}
        </aside>
      ) : null}
    </div>
  );
}
