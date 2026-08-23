"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { alignRoomLyricLines, getActiveRoomLyricIndex, getRoomLyricDisplayWords, getRoomLyricWordProgress, parseRoomLyrics } from "@/features/playback/lyrics";

type RoomLyricsPanelProps = {
  lyrics: string | null;
  translatedLyrics?: string | null;
  romanizedLyrics?: string | null;
  status: "idle" | "loading" | "ready" | "error";
  positionMs: number;
  isPlaying: boolean;
  frozen?: boolean;
  className?: string;
  visibleLines?: number;
  fontScale?: "small" | "medium" | "large";
  align?: "center" | "left";
  immersive?: boolean;
  mobile?: boolean;
  showControls: boolean;
  showTranslation: boolean;
  showRomanized: boolean;
  onToggleTranslation?: () => void;
  onToggleRomanized?: () => void;
  onSeek?: (positionMs: number) => void;
};

export function RoomLyricsPanel({
  lyrics,
  translatedLyrics = null,
  romanizedLyrics = null,
  status,
  positionMs,
  isPlaying,
  frozen = false,
  className,
  visibleLines = 3,
  fontScale = "medium",
  align = "center",
  immersive = false,
  mobile = false,
  showControls,
  showTranslation,
  showRomanized,
  onToggleTranslation,
  onToggleRomanized,
  onSeek
}: RoomLyricsPanelProps) {
  const isChineseLyrics = hasChineseLyrics(lyrics);
  const activeLyrics = lyrics?.trim() || translatedLyrics?.trim() || null;
  const lines = useMemo(() => parseRoomLyrics(activeLyrics), [activeLyrics]);
  const translatedLines = useMemo(
    () => (isChineseLyrics ? [] : parseRoomLyrics(translatedLyrics)),
    [isChineseLyrics, translatedLyrics]
  );
  const romanizedLines = useMemo(
    () => (isChineseLyrics ? [] : parseRoomLyrics(romanizedLyrics)),
    [isChineseLyrics, romanizedLyrics]
  );
  const translatedLinesByPrimary = useMemo(
    () => alignRoomLyricLines(lines, translatedLines),
    [lines, translatedLines]
  );
  const romanizedLinesByPrimary = useMemo(
    () => alignRoomLyricLines(lines, romanizedLines),
    [lines, romanizedLines]
  );
  const displayWordsByLine = useMemo(
    () => lines.map((_line, index) => getRoomLyricDisplayWords(lines, index)),
    [lines]
  );

  // High precision position interpolation with requestAnimationFrame
  const [smoothPositionMs, setSmoothPositionMs] = useState(positionMs);
  const anchorRef = useRef({ baseMs: positionMs, receivedAt: typeof performance !== "undefined" ? performance.now() : Date.now() });

  useEffect(() => {
    anchorRef.current = {
      baseMs: positionMs,
      receivedAt: typeof performance !== "undefined" ? performance.now() : Date.now()
    };
    setSmoothPositionMs(positionMs);
  }, [positionMs]);

  useEffect(() => {
    if (!isPlaying || frozen) {
      setSmoothPositionMs(positionMs);
      return;
    }

    let animationFrameId: number;
    const tick = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = Math.max(0, now - anchorRef.current.receivedAt);
      setSmoothPositionMs(anchorRef.current.baseMs + elapsed);
      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isPlaying, frozen, positionMs]);

  const activeIndex = getActiveRoomLyricIndex(lines, smoothPositionMs);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextLineActivationRef = useRef(false);
  const [isSelectingPosition, setIsSelectingPosition] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const isThreeLineView = visibleLines === 3;
  const isFiveLineView = visibleLines === 5;
  const isSevenLineView = visibleLines === 7;
  const alignmentClass = align === "left" ? "text-left" : "text-center";
  const lineAlignmentClass = align === "left" ? "ml-0 mr-auto justify-start text-left" : "mx-auto justify-center text-center";
  const canToggleTranslation = translatedLines.length > 0 && Boolean(onToggleTranslation);
  const canToggleRomanized = romanizedLines.length > 0 && Boolean(onToggleRomanized);
  const lyricScrollPaddingClass = showControls
    ? mobile
      ? "px-12"
      : "px-1 pr-12 sm:px-2 sm:pr-14"
    : "px-1 sm:px-2";
  const panelHeightClass = immersive || mobile
    ? "h-full min-h-0 max-h-none"
    : isSevenLineView
      ? "h-[clamp(17rem,40vh,23rem)] max-h-[23rem] min-h-[17rem] sm:h-[clamp(20rem,46vh,26rem)] sm:max-h-[26rem] sm:min-h-[20rem]"
      : isFiveLineView
        ? "h-[clamp(12rem,29vh,20.5rem)] max-h-[20.5rem] min-h-[12rem] sm:h-[clamp(14rem,34vh,20.5rem)] sm:min-h-[18rem]"
        : isThreeLineView
          ? "h-[clamp(8rem,18vh,10rem)] max-h-[10rem] min-h-[8rem]"
          : "h-[clamp(8rem,18vh,10rem)] max-h-[10rem] min-h-[8rem]";

  useEffect(() => {
    const activeLine = activeLineRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!activeLine || !scrollContainer || activeIndex < 0 || isSelectingPosition) return;
    const containerRect = scrollContainer.getBoundingClientRect();
    const activeLineRect = activeLine.getBoundingClientRect();
    const targetTop = scrollContainer.scrollTop +
      activeLineRect.top -
      containerRect.top -
      (scrollContainer.clientHeight - activeLineRect.height) / 2;
    scrollContainer.scrollTo({
      top: Math.max(0, targetTop),
      behavior: isPlaying && !frozen ? "smooth" : "auto"
    });
  }, [activeIndex, frozen, isPlaying, isSelectingPosition, lines.length, visibleLines]);

  useEffect(() => {
    setIsSelectingPosition(false);
    setSelectedLineId(null);
  }, [lyrics]);

  const handleLyricsPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleLyricsPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart) return;
    if (Math.abs(event.clientX - dragStart.x) > 6 || Math.abs(event.clientY - dragStart.y) > 6) {
      suppressNextLineActivationRef.current = true;
    }
  };

  const handleLyricsPointerEnd = () => {
    dragStartRef.current = null;
    if (suppressNextLineActivationRef.current) {
      window.setTimeout(() => {
        suppressNextLineActivationRef.current = false;
      }, 0);
    }
  };

  const handleLineActivation = (lineId: string, timeMs: number | null) => {
    if (suppressNextLineActivationRef.current) {
      suppressNextLineActivationRef.current = false;
      return;
    }
    if (timeMs === null || !onSeek) return;
    if (!isSelectingPosition) {
      setIsSelectingPosition(true);
      setSelectedLineId(lineId);
      return;
    }
    setIsSelectingPosition(false);
    setSelectedLineId(null);
    onSeek(timeMs);
  };

  return (
    <section
      aria-label="歌词"
      className={`pointer-events-auto relative z-20 mx-auto flex w-full ${immersive || mobile ? "max-w-none" : "max-w-[min(100%,34rem)]"} ${immersive || mobile ? "flex-1 self-stretch" : "flex-none"} flex-col overflow-hidden px-3 ${frozen ? "" : "animate-fade-in"} sm:px-6 ${panelHeightClass} ${className ?? ""}`}
      data-testid="room-lyrics-panel"
    >
      {showControls && !isChineseLyrics ? (
        <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 sm:right-2">
          <button
            aria-label={showTranslation ? "关闭翻译" : "开启翻译"}
            aria-pressed={showTranslation}
            className={`flex h-10 w-10 items-center justify-center rounded-full border text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-30 ${
              showTranslation ? "border-white/75 text-white" : "border-white/15 text-white/40 hover:border-white/35 hover:text-white/70"
            }`}
            disabled={!canToggleTranslation}
            onClick={onToggleTranslation}
            title={canToggleTranslation ? (showTranslation ? "关闭翻译" : "开启翻译") : "暂无翻译"}
            type="button"
          >
            译
          </button>
          <button
            aria-label={showRomanized ? "关闭罗马音" : "开启罗马音"}
            aria-pressed={showRomanized}
            className={`flex h-10 w-10 items-center justify-center rounded-full border text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-30 ${
              showRomanized ? "border-white/75 text-white" : "border-white/15 text-white/40 hover:border-white/35 hover:text-white/70"
            }`}
            disabled={!canToggleRomanized}
            onClick={onToggleRomanized}
            title={canToggleRomanized ? (showRomanized ? "关闭罗马音" : "开启罗马音") : "暂无罗马音"}
            type="button"
          >
            音
          </button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="room-lyrics-lines">
        <div
          ref={scrollContainerRef}
          className={`hide-scrollbar h-full touch-pan-y overflow-y-auto py-3 sm:py-4 ${lyricScrollPaddingClass}`}
          onPointerCancel={handleLyricsPointerEnd}
          onPointerDown={handleLyricsPointerDown}
          onPointerMove={handleLyricsPointerMove}
          onPointerUp={handleLyricsPointerEnd}
        >
        {status === "loading" ? (
          <p className="flex h-full items-center justify-center text-sm text-white/45">正在获取歌词…</p>
        ) : lines.length > 0 ? (
          <div className={`mx-auto flex min-h-full w-full flex-col justify-center ${alignmentClass} ${isFiveLineView || isSevenLineView ? "gap-0 py-1 sm:gap-0.5 sm:py-2" : "gap-0.5 py-1 sm:gap-1 sm:py-2"}`}>
            {lines.map((line, index) => {
              const isActive = index === activeIndex;
              const isSelected = line.id === selectedLineId;
              const canSeekLine = line.timeMs !== null && Boolean(onSeek);
              const displayWords = displayWordsByLine[index] ?? [];
              const translatedLine = translatedLinesByPrimary[index]?.text ?? null;
              const romanizedLine = romanizedLinesByPrimary[index]?.text ?? null;
              return (
                <p
                  key={line.id}
                  ref={isActive ? activeLineRef : undefined}
                  aria-current={isActive ? "true" : undefined}
                  onClick={canSeekLine ? () => handleLineActivation(line.id, line.timeMs) : undefined}
                  onKeyDown={canSeekLine ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleLineActivation(line.id, line.timeMs);
                    }
                  } : undefined}
                  role={canSeekLine ? "button" : undefined}
                  tabIndex={canSeekLine ? 0 : undefined}
                  data-testid="room-lyrics-line"
                  style={{ fontSize: `${getLyricFontSize({ isActive, visibleLines, fontScale })}rem` }}
                  className={`${lineAlignmentClass} flex w-full ${canSeekLine ? "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70" : ""} ${isActive ? (isSevenLineView ? "min-h-[3.5rem] sm:min-h-[4rem]" : isFiveLineView ? "min-h-[4rem] sm:min-h-[4.5rem]" : "min-h-[3rem] sm:min-h-[3.5rem]") : (isSevenLineView ? "min-h-[2.25rem] sm:min-h-[2.5rem]" : isFiveLineView ? "min-h-[2.5rem] sm:min-h-[3rem]" : "min-h-[2rem] sm:min-h-[2.25rem]")} shrink-0 ${mobile ? "max-w-none px-1 [overflow-wrap:anywhere]" : "max-w-[30rem]"} items-center break-words leading-[1.35] ${frozen ? "" : "transition-[color,opacity] duration-300"} ${isSelected ? "text-accent" : ""} ${
                    isActive
                      ? `font-bold text-white ${isSevenLineView ? "text-[1.05rem] sm:text-[1.25rem]" : isFiveLineView ? "text-[1.15rem] sm:text-[1.4rem]" : "text-[1.05rem] sm:text-[1.25rem]"}`
                      : `font-medium text-white/35 ${isSevenLineView ? "text-[0.75rem] sm:text-[0.9rem]" : isFiveLineView ? "text-[0.8rem] sm:text-[0.95rem]" : "text-[0.78rem] sm:text-[0.9rem]"}`
                  }`}
                >
                  <span className="block w-full">
                    {displayWords.length > 0 ? displayWords.map((word, wordIndex) => {
                      if (!isActive) {
                        return <span key={`${line.id}:word:${wordIndex}`}>{word.text}</span>;
                      }

                      const progress = getRoomLyricWordProgress(word, smoothPositionMs);
                      if (progress >= 1) {
                        return (
                          <span key={`${line.id}:word:${wordIndex}`} className="text-white">
                            {word.text}
                          </span>
                        );
                      }
                      if (progress <= 0) {
                        return (
                          <span key={`${line.id}:word:${wordIndex}`} className="text-white/45">
                            {word.text}
                          </span>
                        );
                      }

                      return (
                        <span
                          className="text-transparent inline will-change-[background-image]"
                          key={`${line.id}:word:${wordIndex}`}
                          style={{
                            backgroundImage: `linear-gradient(to right, rgb(255 255 255) 0%, rgb(255 255 255) ${(progress * 100).toFixed(1)}%, rgb(255 255 255 / 0.45) ${(progress * 100).toFixed(1)}%, rgb(255 255 255 / 0.45) 100%)`,
                            backgroundClip: "text",
                            WebkitBackgroundClip: "text"
                          }}
                        >
                          {word.text}
                        </span>
                      );
                    }) : line.text}
                    {!isChineseLyrics && showTranslation && translatedLine && translatedLine !== line.text ? (
                      <span className={`mt-1 block text-[0.72em] font-medium leading-[1.35] ${isActive ? "text-white/72" : "text-white/30"}`}>
                        {translatedLine}
                      </span>
                    ) : null}
                    {!isChineseLyrics && showRomanized && romanizedLine && romanizedLine !== line.text ? (
                      <span className={`mt-1 block text-[0.68em] font-medium leading-[1.35] ${isActive ? "text-white/50" : "text-white/22"}`}>
                        {romanizedLine}
                      </span>
                    ) : null}
                  </span>
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

function hasChineseLyrics(value: string | null | undefined) {
  if (!value?.trim()) return false;
  const content = value
    .replace(/^\[[^\]]+\]/gm, "")
    .replace(/\(\d+,\d+(?:,\d+)?\)/g, "")
    .replace(/\s/g, "");
  if (!content) return false;

  const hasJapaneseKana = /[\u3040-\u30ff]/.test(content);
  const hasHangul = /[\uac00-\ud7af]/.test(content);
  if (hasJapaneseKana || hasHangul) return false;

  const hanCount = (content.match(/[\u3400-\u9fff]/g) ?? []).length;
  const letterCount = (content.match(/[\p{L}]/gu) ?? []).length;
  return hanCount > 0 && (letterCount === 0 || hanCount / letterCount >= 0.5);
}

function getLyricFontSize(input: {
  isActive: boolean;
  visibleLines: number;
  fontScale: "small" | "medium" | "large";
}) {
  const base = input.isActive
    ? input.visibleLines === 7 ? 1.25 : input.visibleLines === 5 ? 1.4 : 1.25
    : input.visibleLines === 7 ? 0.9 : input.visibleLines === 5 ? 0.95 : 0.9;
  const factor = input.fontScale === "small" ? 0.86 : input.fontScale === "large" ? 1.14 : 1;
  return base * factor;
}
