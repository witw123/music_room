"use client";

import type { CSSProperties } from "react";
import type { RoomDirectoryItem, RoomType } from "@music-room/shared";
import { ArtisticRoomStageScene } from "./ArtisticRoomStageScene";

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

      {/* Artistic Room Visual Scene (Starfield, Radial Wave, or Vinyl Nebula) */}
      <section
        className="relative mt-3 aspect-[2.6/1] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#07090e] shadow-inner"
        data-card-scene={room.roomType}
        data-testid="room-directory-stage"
      >
        <ArtisticRoomStageScene roomType={room.roomType} />
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
