"use client";

import { useTransition } from "react";
import type { QueueItem, TrackMeta } from "@music-room/shared";

type QueuePanelProps = {
  queue: QueueItem[];
  tracks: TrackMeta[];
  activeSession: { id: string; nickname: string } | null;
  hostId: string;
  onRemoveQueueItem: (itemId: string) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
};

export function QueuePanel({
  queue,
  tracks,
  activeSession,
  hostId,
  onRemoveQueueItem,
  onAddToQueue
}: QueuePanelProps) {
  const [isPending, startTransition] = useTransition();

  const quickQueueTracks = tracks
    .filter((track) => !queue.some((item) => item.trackId === track.id))
    .slice(0, 3);

  return (
    <section className="workspace-block room-block">
      <div className="block-heading">
        <div>
          <p className="block-kicker">队列</p>
          <h2>共享播放顺序</h2>
        </div>
        <span>{queue.length} 首在队列</span>
      </div>

      <div className="queue-stack">
        {queue.length ? (
          queue.map((item, index) => {
            const track = tracks.find((entry) => entry.id === item.trackId);
            const canRemoveQueueItem =
              !!activeSession &&
              (hostId === activeSession.id || item.requestedById === activeSession.id);

            return (
              <div key={item.id} className="queue-line">
                <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="queue-copy">
                  <strong>{track?.title ?? "未知曲目"}</strong>
                  <p>点歌人：{item.requestedBy}</p>
                </div>
                <button
                  className="queue-remove"
                  disabled={!canRemoveQueueItem}
                  onClick={() => startTransition(() => void onRemoveQueueItem(item.id))}
                >
                  移除
                </button>
              </div>
            );
          })
        ) : (
          <div className="queue-empty-state">
            <p className="placeholder-copy">队列还是空的。先挑几首歌进队，房间才会真正开始转起来。</p>
            {quickQueueTracks.length ? (
              <div className="queue-empty-actions">
                {quickQueueTracks.map((track) => (
                  <button
                    key={track.id}
                    className="ghost-action queue-suggestion"
                    onClick={() => startTransition(() => void onAddToQueue(track.id))}
                  >
                    {track.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
