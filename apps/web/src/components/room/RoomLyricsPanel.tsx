"use client";

import { useEffect, useMemo, useRef } from "react";
import { getActiveRoomLyricIndex, parseRoomLyrics } from "./room-lyrics";

type RoomLyricsPanelProps = {
  lyrics: string | null;
  status: "idle" | "loading" | "ready" | "error";
  positionMs: number;
  isPlaying: boolean;
};

export function RoomLyricsPanel({
  lyrics,
  status,
  positionMs,
  isPlaying
}: RoomLyricsPanelProps) {
  const lines = useMemo(() => parseRoomLyrics(lyrics), [lyrics]);
  const activeIndex = getActiveRoomLyricIndex(lines, positionMs);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const activeLine = activeLineRef.current;
    if (!activeLine || !isPlaying || activeIndex < 0) return;
    activeLine.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [activeIndex, isPlaying]);

  return (
    <section
      aria-label="歌词"
      className="pointer-events-auto relative z-20 flex min-h-0 w-full max-w-[min(100%,34rem)] flex-1 flex-col overflow-hidden px-3 animate-fade-in sm:px-6"
      data-testid="room-lyrics-panel"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="room-lyrics-lines">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-background/90 to-transparent" />
        <div className="hide-scrollbar h-full overflow-y-auto px-1 sm:px-2">
        {status === "loading" ? (
          <p className="flex h-full items-center justify-center text-sm text-white/45">正在获取歌词…</p>
        ) : lines.length > 0 ? (
          <div className="flex min-h-full flex-col justify-center gap-3 py-6 text-left sm:gap-4 sm:py-8">
            {lines.map((line, index) => {
              const isActive = index === activeIndex;
              return (
                <p
                  key={line.id}
                  ref={isActive ? activeLineRef : undefined}
                  className={`max-w-[30rem] leading-tight transition-[color,opacity,transform,font-size] duration-300 ${
                    isActive
                      ? "scale-[1.01] text-[1.35rem] font-bold text-white sm:text-[1.7rem]"
                      : "text-[0.9rem] font-medium text-white/35 sm:text-base"
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
