"use client";

import { useEffect, useMemo, useRef } from "react";
import { getActiveRoomLyricIndex, parseRoomLyrics } from "./room-lyrics";

type RoomLyricsPanelProps = {
  lyrics: string | null;
  status: "idle" | "loading" | "ready" | "error";
  positionMs: number;
  isPlaying: boolean;
  className?: string;
  visibleLines?: number;
};

export function RoomLyricsPanel({
  lyrics,
  status,
  positionMs,
  isPlaying,
  className,
  visibleLines = 3
}: RoomLyricsPanelProps) {
  const lines = useMemo(() => parseRoomLyrics(lyrics), [lyrics]);
  const activeIndex = getActiveRoomLyricIndex(lines, positionMs);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isFiveLineView = visibleLines === 5;
  const isSevenLineView = visibleLines === 7;

  useEffect(() => {
    const activeLine = activeLineRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!activeLine || !scrollContainer || activeIndex < 0) return;
    const targetTop = activeLine.offsetTop - (scrollContainer.clientHeight - activeLine.offsetHeight) / 2;
    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: isPlaying ? "smooth" : "auto"
    });
  }, [activeIndex, isPlaying, lines.length]);

  return (
    <section
      aria-label="歌词"
      className={`pointer-events-auto relative z-20 flex w-full max-w-[min(100%,34rem)] flex-none flex-col overflow-hidden px-3 animate-fade-in sm:px-6 ${isSevenLineView ? "h-[min(42svh,24rem)] max-h-[24rem] min-h-[14rem]" : isFiveLineView ? "h-64 max-h-64 min-h-64 sm:h-[20.5rem] sm:max-h-[20.5rem] sm:min-h-[20.5rem]" : "h-[min(34svh,18rem)] max-h-[18rem] min-h-[8rem]"} ${className ?? ""}`}
      data-testid="room-lyrics-panel"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="room-lyrics-lines">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background/90 to-transparent" />
        <div ref={scrollContainerRef} className="hide-scrollbar h-full overflow-y-auto px-1 sm:px-2">
        {status === "loading" ? (
          <p className="flex h-full items-center justify-center text-sm text-white/45">正在获取歌词…</p>
        ) : lines.length > 0 ? (
          <div className={`flex min-h-full flex-col justify-center text-left ${isSevenLineView ? "gap-0 py-1 sm:gap-0.5 sm:py-2" : isFiveLineView ? "gap-0 py-2 sm:gap-1 sm:py-4" : "gap-2 py-6 sm:gap-3 sm:py-8"}`}>
            {lines.map((line, index) => {
              const isActive = index === activeIndex;
              return (
                <p
                  key={line.id}
                  ref={isActive ? activeLineRef : undefined}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex ${isSevenLineView ? "h-10 sm:h-11" : "h-12 sm:h-14"} shrink-0 max-w-[30rem] items-center overflow-hidden break-words leading-snug transition-[color,opacity] duration-300 ${
                    isActive
                      ? `line-clamp-2 font-bold text-white ${isSevenLineView ? "text-[1.1rem] sm:text-[1.4rem]" : "text-[1.3rem] sm:text-[1.65rem]"}`
                      : `line-clamp-2 font-medium text-white/35 ${isSevenLineView ? "text-[0.8rem] sm:text-[0.95rem]" : "text-[0.9rem] sm:text-base"}`
                  }`}
                >
                  {line.text}
                </p>
              );
            })}
          </div>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-white/45">
            {status === "error" ? "歌词暂时不可用" : "暂无歌词"}
          </p>
        )}
        </div>
      </div>
    </section>
  );
}
