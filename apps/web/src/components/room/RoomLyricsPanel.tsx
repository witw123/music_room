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
      className="pointer-events-auto relative z-20 w-[min(86vw,30rem)] max-w-full overflow-hidden rounded-2xl border border-white/[0.1] bg-black/35 px-4 py-3 shadow-2xl shadow-black/20 backdrop-blur-xl animate-fade-in sm:px-5"
      data-testid="room-lyrics-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] pb-2">
        <h3 className="text-xs font-semibold tracking-[0.16em] text-white/80">歌词</h3>
        {status === "loading" ? (
          <span className="text-[10px] text-white/45">加载中…</span>
        ) : null}
      </div>

      <div className="hide-scrollbar mt-2 max-h-36 overflow-y-auto pr-1 sm:max-h-44" data-testid="room-lyrics-lines">
        {status === "loading" ? (
          <p className="py-6 text-center text-xs text-white/45">正在获取歌词…</p>
        ) : lines.length > 0 ? (
          <div className="flex flex-col gap-2 py-2 text-center">
            {lines.map((line, index) => {
              const isActive = index === activeIndex;
              return (
                <p
                  key={line.id}
                  ref={isActive ? activeLineRef : undefined}
                  className={`text-xs leading-5 transition-[color,transform,opacity] duration-300 sm:text-sm ${
                    isActive
                      ? "scale-[1.02] font-semibold text-white"
                      : "text-white/45"
                  }`}
                >
                  {line.text}
                </p>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-white/45">
            {status === "error" ? "歌词暂时不可用" : "暂无歌词"}
          </p>
        )}
      </div>
    </section>
  );
}
