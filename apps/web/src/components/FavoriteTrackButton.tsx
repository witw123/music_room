"use client";

import type { ProviderTrackCandidate } from "@music-room/shared";

type FavoriteTrackButtonProps = {
  track: ProviderTrackCandidate | null;
  isFavorite: boolean;
  pending?: boolean;
  onToggle: () => void | Promise<void>;
  size?: "compact" | "large";
  className?: string;
};

export function FavoriteTrackButton({
  track,
  isFavorite,
  pending = false,
  onToggle,
  size = "compact",
  className = ""
}: FavoriteTrackButtonProps) {
  if (!track) return null;
  const dimension = size === "large" ? "h-11 w-11" : "h-9 w-9";
  const iconSize = size === "large" ? 21 : 17;

  return (
    <button
      aria-label={isFavorite ? `取消收藏《${track.title}》` : `收藏《${track.title}》`}
      aria-pressed={isFavorite}
      className={`inline-flex ${dimension} shrink-0 items-center justify-center rounded-full text-foreground-muted transition-[background-color,color,transform] duration-200 hover:bg-surface-hover hover:text-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50 ${className} ${isFavorite ? "text-accent" : ""}`}
      disabled={pending}
      onClick={() => void onToggle()}
      title={isFavorite ? "取消收藏歌曲" : "收藏歌曲"}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill={isFavorite ? "currentColor" : "none"}
        height={iconSize}
        viewBox="0 0 24 24"
        width={iconSize}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      >
        <path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" />
      </svg>
    </button>
  );
}
