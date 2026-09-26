"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import type { QueueItem, RoomMember, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/domain/music-room-ui";
import { Button } from "@/components/ui/button";
import { useBackHandler } from "@/lib/desktop/use-back-handler";
import { getArtworkSourceUrl } from "./artwork-colors";
import { TrackDistributionBadge } from "@/components/room/TrackDistributionBadge";

export type PlayerQueueListProps = {
  roomId?: string | null;
  queue: QueueItem[];
  tracks: TrackMeta[];
  members?: Array<Pick<RoomMember, "id" | "presenceState">> | null;
  currentSessionId?: string | null;
  currentQueueItemId: string | null;
  nextQueueItemId: string | null;
  canControlPlayback: boolean;
  canReorderQueue: boolean;
  canRemoveQueue: boolean;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onPlayNextQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
  accentColor?: string;
  className?: string;
};

type PlayerQueueDrawerProps = Omit<PlayerQueueListProps, "className"> & {
  accentSoft?: string;
  compactMobile?: boolean;
  testId?: string;
};

type TouchReorderState = {
  itemId: string;
  pointerId: number;
  startX: number;
  startY: number;
  targetItemId: string | null;
  active: boolean;
  targetElement: HTMLElement | null;
};

const touchReorderDelayMs = 420;
const touchReorderMoveTolerancePx = 10;

export function PlayerQueueDrawer({
  roomId,
  queue,
  tracks,
  members,
  currentSessionId,
  currentQueueItemId,
  nextQueueItemId,
  canControlPlayback,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onPlayNextQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  accentColor = "rgb(0 148 255)",
  accentSoft = "rgba(0, 148, 255, 0.16)",
  compactMobile = false,
  testId = "player-queue-button"
}: PlayerQueueDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleDrawer = () => setIsOpen((current) => !current);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useBackHandler(() => setIsOpen(false), isOpen);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        data-testid={testId}
        className={compactMobile ? "relative h-11 w-11 rounded-full text-white/80 transition-[transform,color] hover:text-white active:scale-95" : "relative h-10 w-10 text-foreground-muted transition-colors hover:text-foreground sm:h-10 sm:w-10"}
        style={compactMobile ? undefined : { color: accentColor, ...(isOpen ? { backgroundColor: accentSoft } : {}) }}
        onClick={toggleDrawer}
        aria-expanded={isOpen}
        aria-label="歌曲队列"
        title="歌曲队列"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h12" /><path d="M4 12h16" /><path d="M4 18h12" /><path d="m18 4 2 2-2 2" /></svg>
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
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm sm:hidden"
            onClick={() => setIsOpen(false)}
          />
          <aside
            aria-label="播放队列"
            data-testid="player-queue-drawer"
            className="light-player-queue absolute bottom-full right-0 z-50 mb-4 flex max-h-[60vh] w-[min(520px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-surface-border bg-[#17181c] text-white shadow-[0_20px_60px_rgba(0,0,0,0.65)] animate-slide-up origin-bottom-right max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:z-[100] max-sm:mb-0 max-sm:w-full max-sm:max-h-[calc(75*var(--app-dvh))] max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:border-x-0 max-sm:border-b-0 max-sm:border-t max-sm:border-surface-border max-sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex shrink-0 items-center justify-center pt-2.5 pb-1 sm:hidden">
              <div className="h-1 w-10 rounded-full bg-white/25" />
            </div>
            <PlayerQueueList
              roomId={roomId}
              accentColor={accentColor}
              canControlPlayback={canControlPlayback}
              canRemoveQueue={canRemoveQueue}
              canReorderQueue={canReorderQueue}
              currentQueueItemId={currentQueueItemId}
              nextQueueItemId={nextQueueItemId}
              onPlayNextQueueItem={onPlayNextQueueItem}
              onPlayQueueItem={onPlayQueueItem}
              onRemoveQueueItem={onRemoveQueueItem}
              onReorderQueue={onReorderQueue}
              queue={queue}
              tracks={tracks}
              members={members}
              currentSessionId={currentSessionId}
            />
          </aside>
        </>
      ) : null}
    </div>
  );
}

export function PlayerQueueList({
  roomId,
  queue,
  tracks,
  members,
  currentSessionId,
  currentQueueItemId,
  nextQueueItemId,
  canControlPlayback,
  canReorderQueue,
  canRemoveQueue,
  onPlayQueueItem,
  onPlayNextQueueItem,
  onRemoveQueueItem,
  onReorderQueue,
  accentColor = "rgb(0 148 255)",
  className = ""
}: PlayerQueueListProps) {
  const [draggingQueueItemId, setDraggingQueueItemId] = useState<string | null>(null);
  const [dragOverQueueItemId, setDragOverQueueItemId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const touchReorderRef = useRef<TouchReorderState | null>(null);
  const touchReorderTimerRef = useRef<number | null>(null);

  const queueWithTracks = useMemo(
    () =>
      queue.map((item) => ({
        item,
        track: tracks.find((track) => track.id === item.trackId) ?? null
      })),
    [queue, tracks]
  );

  useEffect(() => {
    return () => {
      if (touchReorderTimerRef.current !== null) {
        window.clearTimeout(touchReorderTimerRef.current);
      }
    };
  }, []);

  function cancelTouchReorderTimer() {
    if (touchReorderTimerRef.current !== null) {
      window.clearTimeout(touchReorderTimerRef.current);
      touchReorderTimerRef.current = null;
    }
  }

  function reorderQueueItem(sourceItemId: string, targetItemId: string) {
    if (sourceItemId === targetItemId || isPending) return;
    const reorderedIds = queue.map((item) => item.id);
    const fromIndex = reorderedIds.indexOf(sourceItemId);
    const toIndex = reorderedIds.indexOf(targetItemId);
    if (fromIndex < 0 || toIndex < 0) return;

    reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(toIndex, 0, sourceItemId);
    void onReorderQueue(reorderedIds);
  }

  function handleTouchReorderStart(event: ReactPointerEvent<HTMLDivElement>, itemId: string) {
    if (!canReorderQueue || (event.pointerType !== "touch" && event.pointerType !== "pen")) {
      return;
    }
    if ((event.target as HTMLElement).closest("button")) return;

    cancelTouchReorderTimer();
    const targetElement = event.currentTarget;
    touchReorderRef.current = {
      itemId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      targetItemId: itemId,
      active: false,
      targetElement
    };
    touchReorderTimerRef.current = window.setTimeout(() => {
      const current = touchReorderRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.active = true;
      setDraggingQueueItemId(current.itemId);
      setDragOverQueueItemId(current.itemId);
      current.targetElement?.setPointerCapture(current.pointerId);
    }, touchReorderDelayMs);
  }

  function handleTouchReorderMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = touchReorderRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    if (!current.active) {
      const movedDistance = Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY
      );
      if (movedDistance > touchReorderMoveTolerancePx) {
        cancelTouchReorderTimer();
        touchReorderRef.current = null;
      }
      return;
    }

    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-queue-item-id]");
    const targetItemId = target?.dataset.queueItemId ?? current.itemId;
    current.targetItemId = targetItemId;
    setDragOverQueueItemId(targetItemId);
  }

  function finishTouchReorder(event: ReactPointerEvent<HTMLDivElement>) {
    const current = touchReorderRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    cancelTouchReorderTimer();
    if (current.active) {
      event.preventDefault();
      reorderQueueItem(current.itemId, current.targetItemId ?? current.itemId);
      if (current.targetElement?.hasPointerCapture(current.pointerId)) {
        current.targetElement.releasePointerCapture(current.pointerId);
      }
    }
    touchReorderRef.current = null;
    setDraggingQueueItemId(null);
    setDragOverQueueItemId(null);
  }

  async function handleDrop(targetQueueItemId: string) {
    if (!draggingQueueItemId || draggingQueueItemId === targetQueueItemId || !canReorderQueue) {
      setDraggingQueueItemId(null);
      setDragOverQueueItemId(null);
      return;
    }

    const reorderedIds = [...queue.map((item) => item.id)];
    const fromIndex = reorderedIds.indexOf(draggingQueueItemId);
    const toIndex = reorderedIds.indexOf(targetQueueItemId);

    if (fromIndex < 0 || toIndex < 0) {
      setDraggingQueueItemId(null);
      setDragOverQueueItemId(null);
      return;
    }

    reorderedIds.splice(fromIndex, 1);
    reorderedIds.splice(toIndex, 0, draggingQueueItemId);
    setDraggingQueueItemId(null);
    setDragOverQueueItemId(null);
    await onReorderQueue(reorderedIds);
  }

  return (
    <div className={`light-player-queue-content relative min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-2 hide-scrollbar ${className}`}>
            {queueWithTracks.length ? (
              queueWithTracks.map(({ item, track }, index) => {
                const canRemove = canRemoveQueue;
                const isCurrent = currentQueueItemId === item.id;
                const isNext = nextQueueItemId === item.id;
                const title = track?.title ?? "未知曲目";
                const artistName = track?.artist?.trim() || "未知歌手";
                const albumName = track?.album?.trim() || "未知专辑";
                const memberName = track?.ownerNickname?.trim() || item.requestedBy?.trim() || "成员";

                return (
                  <div
                    key={item.id}
                    data-testid="queue-item"
                    className={`group flex items-center gap-2 sm:gap-2.5 rounded-lg px-2 py-1.5 sm:px-2.5 sm:py-1.5 transition-all ${
                      isCurrent
                        ? "border border-accent/35 bg-accent/10"
                        : "border border-transparent hover:bg-surface-hover/60 hover:border-surface-border/40"
                    } ${draggingQueueItemId === item.id ? "scale-95 touch-none opacity-50" : "touch-pan-y"} ${dragOverQueueItemId === item.id && draggingQueueItemId !== item.id ? "border-accent/60 bg-accent/10" : ""}`}
                    data-queue-item-id={item.id}
                    draggable={canReorderQueue}
                    onDragStart={() => {
                      setDraggingQueueItemId(item.id);
                      setDragOverQueueItemId(item.id);
                    }}
                    onDragOver={(event) => {
                      if (canReorderQueue) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleDrop(item.id);
                    }}
                    onDragEnd={() => {
                      setDraggingQueueItemId(null);
                      setDragOverQueueItemId(null);
                    }}
                    onPointerCancel={finishTouchReorder}
                    onPointerDown={(event) => handleTouchReorderStart(event, item.id)}
                    onPointerMove={handleTouchReorderMove}
                    onPointerUp={finishTouchReorder}
                  >
                    <span className={`w-5 text-center font-mono text-xs font-semibold tabular-nums ${isCurrent ? "text-accent font-bold" : "text-foreground-muted"}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="relative shrink-0">
                      <QueueArtwork artworkUrl={track?.artworkUrl ?? null} title={title} />
                      <TrackDistributionBadge
                        roomId={roomId}
                        track={track}
                        members={members}
                        currentSessionId={currentSessionId}
                      />
                    </div>
                    <div className="min-w-0 flex-1 pr-2">
                       <strong className={`block truncate text-xs sm:text-sm ${isCurrent ? "text-accent font-bold" : "text-foreground font-semibold"}`}>
                         {title}
                       </strong>
                       <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-muted">
                         <span className="min-w-0 truncate">{artistName}</span>
                         <span aria-hidden="true" className="shrink-0 opacity-40">·</span>
                         <span className="min-w-0 truncate">{albumName}</span>
                       </p>
                       <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-foreground-muted/70">
                         <span className="shrink-0 tabular-nums">{formatDuration(track?.durationMs ?? 0)}</span>
                         <span aria-hidden="true" className="shrink-0 opacity-30">·</span>
                         <span className="min-w-0 truncate">{memberName}上传</span>
                       </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      {canControlPlayback ? (
                        <Button
                          aria-label={`将《${title}》设为下一首播放`}
                          aria-pressed={isNext}
                          className={`h-7 w-7 disabled:opacity-100 sm:h-7 sm:w-7 ${
                            isNext
                              ? "bg-accent/15 text-accent hover:bg-accent/25"
                              : "text-foreground-muted hover:bg-surface-hover/60 hover:text-foreground"
                          }`}
                          data-testid="queue-item-next-button"
                          disabled={isCurrent || isPending}
                          onClick={() => void onPlayNextQueueItem(item.id)}
                          title="下一首播放"
                          type="button"
                          variant="ghost"
                        >
                          <svg
                            aria-hidden="true"
                            className="block shrink-0"
                            data-testid="queue-item-next-icon"
                            fill="currentColor"
                            height="15"
                            style={{ color: isNext ? accentColor : "currentColor" }}
                            viewBox="0 0 24 24"
                            width="15"
                          >
                            <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
                          </svg>
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid="queue-item-play-button"
                        className="h-7 w-7 text-foreground-muted hover:bg-surface-hover/60 hover:text-foreground sm:h-7 sm:w-7"
                        disabled={!canControlPlayback || isCurrent}
                        onClick={() => void onPlayQueueItem(item.id)}
                        title="播放"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-foreground-muted hover:bg-red-500/15 hover:text-red-400 sm:h-7 sm:w-7"
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
                 <div className="light-player-queue-pending-pill flex items-center gap-2 rounded-full border border-surface-border bg-[#252832] px-4 py-1.5 shadow-lg">
                    <div className="w-2 h-2 rounded-full bg-accent animate-ping" />
                    <span className="text-xs text-foreground">更新队列中...</span>
                 </div>
              </div>
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
      className="light-player-queue-artwork flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-surface-border bg-[#252832] text-xs font-semibold text-white/45"
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
