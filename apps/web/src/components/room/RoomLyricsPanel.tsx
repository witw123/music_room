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
  const isThreeLineView = visibleLines === 3;
  const isFiveLineView = visibleLines === 5;

  useEffect(() => {
    const activeLine = activeLineRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!activeLine || !scrollContainer || activeIndex < 0) return;
    const targetTop = activeLine.offsetTop - (scrollContainer.clientHeight - activeLine.offsetHeight) / 2;
    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: isPlaying ? "smooth" : "auto"
    });
  }, [activeIndex, isPlaying, lines.length, visibleLines]);

  return (
    <section
      aria-label="歌词"
      className={`pointer-events-auto relative z-20 flex w-full max-w-[min(100%,34rem)] flex-none flex-col overflow-hidden px-3 animate-fade-in sm:px-6 ${isFiveLineView ? "h-[clamp(14rem,34vh,20.5rem)] max-h-[20.5rem] min-h-[14rem] sm:min-h-[18rem]" : isThreeLineView ? "h-[clamp(8rem,18vh,10rem)] max-h-[10rem] min-h-[8rem]" : "h-[clamp(8rem,18vh,10rem)] max-h-[10rem] min-h-[8rem]"} ${className ?? ""}`}
      data-testid="room-lyrics-panel"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="room-lyrics-lines">
        <div ref={scrollContainerRef} className="hide-scrollbar h-full overflow-y-auto px-1 py-3 sm:px-2 sm:py-4">
        {status === "loading" ? (
          <p className="flex h-full items-center justify-center text-sm text-white/45">正在获取歌词…</p>
        ) : lines.length > 0 ? (
          <div className={`flex min-h-full flex-col justify-center text-left ${isFiveLineView ? "gap-0 py-1 sm:gap-0.5 sm:py-2" : "gap-0.5 py-1 sm:gap-1 sm:py-2"}`}>
            {lines.map((line, index) => {
              const isActive = index === activeIndex;
              return (
                <p
                  key={line.id}
                  ref={isActive ? activeLineRef : undefined}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex ${isActive ? (isFiveLineView ? "min-h-[4rem] sm:min-h-[4.5rem]" : "min-h-[3rem] sm:min-h-[3.5rem]") : (isFiveLineView ? "min-h-[2.5rem] sm:min-h-[3rem]" : "min-h-[2rem] sm:min-h-[2.25rem]")} shrink-0 max-w-[30rem] items-center break-words leading-[1.35] transition-[color,opacity] duration-300 ${
                    isActive
                      ? `font-bold text-white ${isFiveLineView ? "text-[1.15rem] sm:text-[1.4rem]" : "text-[1.05rem] sm:text-[1.25rem]"}`
                      : `font-medium text-white/35 ${isFiveLineView ? "text-[0.8rem] sm:text-[0.95rem]" : "text-[0.78rem] sm:text-[0.9rem]"}`
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
