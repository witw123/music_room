"use client";
/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react";
import type { RoomDirectoryItem, RoomType } from "@music-room/shared";
import { ArtisticRoomStageScene } from "./ArtisticRoomStageScene";

import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

type RoomDirectoryCardProps = {
  room: RoomDirectoryItem;
  onOpen: () => void;
};

type RoomCardTheme = {
  accent: string;
  border: string;
  glow: string;
  label: string;
  soft: string;
};

type RoomCardStyle = CSSProperties & {
  "--room-accent": string;
  "--room-border": string;
  "--room-shadow": string;
  "--room-soft": string;
};

const roomCardThemes: Record<RoomType, RoomCardTheme> = {
  interactive: {
    accent: "#0070f3",
    border: "rgba(0, 112, 243, 0.45)",
    glow: "rgba(0, 112, 243, 0.28)",
    label: "多人互动",
    soft: "rgba(0, 112, 243, 0.14)"
  },
  request: {
    accent: "#c026d3",
    border: "rgba(192, 38, 211, 0.45)",
    glow: "rgba(192, 38, 211, 0.25)",
    label: "点歌房",
    soft: "rgba(192, 38, 211, 0.14)"
  },
  radio: {
    accent: "#00a9d6",
    border: "rgba(0, 169, 214, 0.45)",
    glow: "rgba(0, 169, 214, 0.26)",
    label: "自由电台",
    soft: "rgba(0, 169, 214, 0.14)"
  }
};

export function RoomDirectoryCard({ room: directoryItem, onOpen }: RoomDirectoryCardProps) {
  const room = directoryItem.room;
  const theme = roomCardThemes[room.roomType];
  const nowPlaying = room.directoryNowPlaying;
  const cardStyle: RoomCardStyle = {
    "--room-accent": theme.accent,
    "--room-border": theme.border,
    "--room-shadow": theme.glow,
    "--room-soft": theme.soft
  };

  return (
    <article
      className="group relative flex h-fit min-w-0 self-start flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#141418] p-3.5 sm:p-4 shadow-sm transition-all duration-200 hover:border-white/[0.14] hover:bg-[#18181e] focus-within:border-[color:var(--room-accent)] focus-within:ring-1 focus-within:ring-[color:var(--room-accent)] motion-reduce:transition-none"
      data-room-theme={room.roomType}
      data-room-type={room.roomType}
      data-testid="room-directory-card"
      style={cardStyle}
    >
      <button
        aria-label={`查看 ${room.name} 的房间详情`}
        className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] focus:outline-none"
        data-testid="room-directory-open"
        onClick={onOpen}
        type="button"
      />
      <header className="flex min-h-7 items-center justify-between gap-2">
        <span className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.04] px-2.5 text-[11px] font-medium text-foreground-muted">
          <RoomTypeGlyph roomType={room.roomType} />
          {theme.label}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-foreground-muted font-mono">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {room.directoryOnlineMemberCount} 人在线
        </span>
      </header>

      {/* Room Visual Scene: Dynamic Album Artwork with surrounding soundwave effects when playing, fallback to artistic scene */}
      <section
        className="relative mt-3 aspect-[2.6/1] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07090e] shadow-inner"
        data-card-scene={room.roomType}
        data-testid="room-directory-stage"
      >
        {nowPlaying?.title ? (
          <RoomNowPlayingStageScene
            accentColor={theme.accent}
            nowPlaying={nowPlaying}
          />
        ) : (
          <ArtisticRoomStageScene roomType={room.roomType} />
        )}
      </section>

      <div className="pt-3.5">
        <h3 className="truncate text-base sm:text-lg font-bold tracking-tight text-white group-hover:text-white transition-colors">
          {room.name}
        </h3>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] break-words text-xs leading-relaxed text-foreground-muted/80">
          {room.description?.trim() || fallbackDescription(room)}
        </p>
      </div>
    </article>
  );
}

function RoomNowPlayingStageScene({
  nowPlaying,
  accentColor
}: {
  nowPlaying: NonNullable<RoomDirectoryItem["room"]["directoryNowPlaying"]>;
  accentColor: string;
}) {
  const artworkSrc = nowPlaying.artworkUrl ? getArtworkSourceUrl(nowPlaying.artworkUrl) : null;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden select-none">
      {/* Blurred Album Artwork Background */}
      {artworkSrc ? (
        <div
          aria-hidden="true"
          className="absolute -inset-3 bg-cover bg-center opacity-30 blur-lg scale-110 transition-transform duration-700 group-hover:scale-125"
          style={{ backgroundImage: `url("${artworkSrc}")` }}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-[#07090e]/50 to-black/30" />

      {/* Surrounding Acoustic Rings & Breathing Halo */}
      <div className="relative flex items-center justify-center">
        {/* Outer breathing halo */}
        <div
          className="absolute -inset-5 rounded-full blur-xl opacity-35 animate-pulse"
          style={{ backgroundColor: accentColor }}
        />
        {/* Expanding acoustic wave rings */}
        <div
          className="absolute -inset-3 rounded-2xl border border-white/25 opacity-30 animate-ping"
          style={{ animationDuration: "2.8s" }}
        />
        <div
          className="absolute -inset-1.5 rounded-xl border opacity-50"
          style={{ borderColor: accentColor }}
        />

        {/* Central Album Artwork Cover */}
        <div className="relative z-10 h-14 w-14 sm:h-16 sm:w-16 shrink-0 overflow-hidden rounded-xl border border-white/25 bg-black/60 shadow-[0_8px_24px_rgba(0,0,0,0.6)] transition-transform duration-300 group-hover:scale-105">
          {artworkSrc ? (
            <img
              alt={nowPlaying.title}
              className="h-full w-full object-cover"
              decoding="async"
              loading="lazy"
              src={artworkSrc}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/50">
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Track Meta & Equalizer Pill */}
      <div className="absolute bottom-1.5 inset-x-2.5 z-20 flex items-center justify-between gap-1.5 rounded-lg border border-white/10 bg-black/60 px-2 py-1 backdrop-blur-md">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
          <div className="flex items-end gap-0.5 h-2.5 shrink-0 text-white/80">
            <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="w-0.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-0.5 h-1 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
          <span className="truncate text-[10px] sm:text-[11px] font-medium text-white">
            {nowPlaying.title}
          </span>
          <span className="text-white/30 text-[10px]">·</span>
          <span className="truncate text-[10px] text-white/60">
            {nowPlaying.artist}
          </span>
        </div>
      </div>
    </div>
  );
}

function RoomTypeGlyph({ large = false, roomType }: { large?: boolean; roomType: RoomType }) {
  const sizeClass = large ? "h-6 w-6" : "h-3.5 w-3.5";
  if (roomType === "request") {
    return (
      <svg className={`${sizeClass} shrink-0 text-current`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    );
  }
  if (roomType === "radio") {
    return (
      <svg className={`${sizeClass} shrink-0 text-current`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="2" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
      </svg>
    );
  }
  return (
    <svg className={`${sizeClass} shrink-0 text-current`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function fallbackDescription(room: RoomDirectoryItem["room"]) {
  if (room.roomType === "request") return "成员自由点歌互动，沉浸式品鉴优质音乐。";
  if (room.roomType === "radio") return "主理人广播策展，探索多维声波流动。";
  return "多人协作曲库与队列，尽享实时同步聆听。";
}
