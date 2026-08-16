"use client";

import type { CSSProperties } from "react";
import type { RoomDirectoryItem, RoomType } from "@music-room/shared";

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
    border: "rgba(0, 112, 243, 0.58)",
    glow: "rgba(0, 112, 243, 0.22)",
    label: "多人互动",
    soft: "rgba(0, 112, 243, 0.16)"
  },
  request: {
    accent: "#c026d3",
    border: "rgba(192, 38, 211, 0.58)",
    glow: "rgba(192, 38, 211, 0.2)",
    label: "点歌房",
    soft: "rgba(192, 38, 211, 0.15)"
  },
  radio: {
    accent: "#00a9d6",
    border: "rgba(0, 169, 214, 0.58)",
    glow: "rgba(0, 169, 214, 0.2)",
    label: "自由电台",
    soft: "rgba(0, 169, 214, 0.15)"
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
      className="group relative flex h-fit min-w-0 self-start flex-col overflow-hidden rounded-2xl border border-[color:var(--room-border)] bg-[#111114] p-3.5 shadow-[0_14px_34px_var(--room-shadow)] transition-[border-color,box-shadow] duration-200 hover:border-[color:var(--room-accent)] hover:shadow-[0_18px_40px_var(--room-shadow)] focus-within:border-[color:var(--room-accent)] focus-within:ring-2 focus-within:ring-[color:var(--room-accent)] focus-within:ring-offset-2 focus-within:ring-offset-background motion-reduce:transition-none sm:p-4"
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
      <header className="flex min-h-8 items-center justify-between gap-2.5">
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-[color:var(--room-border)] bg-[color:var(--room-soft)] px-2.5 text-xs font-semibold text-foreground">
          <RoomTypeGlyph roomType={room.roomType} />
          {theme.label}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-foreground-muted">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_10px_rgba(74,222,128,0.45)]" />
          {room.directoryOnlineMemberCount} 人在线
        </span>
      </header>

      <section
        className="relative mt-3 aspect-[3/1] overflow-hidden rounded-xl border border-white/10 bg-[#090a0e]"
        data-card-scene={room.roomType}
        data-testid="room-directory-stage"
      >
        <RoomStageScene roomType={room.roomType} />
      </section>

      <div className="pt-3">
        <h3 className="truncate text-xl font-semibold leading-7 text-foreground sm:text-[1.35rem]">{room.name}</h3>
        <p className="mt-1 line-clamp-3 min-h-[3.75rem] break-words text-sm leading-5 text-foreground-muted">
          {room.description?.trim() || fallbackDescription(room)}
        </p>
      </div>
    </article>
  );
}

const roomCoverScenes: Record<RoomType, { overlayClassName: string; position: string }> = {
  interactive: {
    overlayClassName: "bg-[linear-gradient(90deg,rgba(3,9,32,0.42),transparent_60%),linear-gradient(0deg,rgba(2,5,16,0.34),transparent_65%)]",
    position: "right 5%"
  },
  request: {
    overlayClassName: "bg-[linear-gradient(90deg,rgba(26,4,43,0.42),transparent_62%),linear-gradient(0deg,rgba(8,3,18,0.32),transparent_65%)]",
    position: "right 53%"
  },
  radio: {
    overlayClassName: "bg-[linear-gradient(90deg,rgba(0,35,37,0.42),transparent_62%),linear-gradient(0deg,rgba(3,12,13,0.34),transparent_65%)]",
    position: "right 97%"
  }
};

function RoomStageScene({ roomType }: { roomType: RoomType }) {
  const scene = roomCoverScenes[roomType];
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
    <div
      className="absolute inset-0 bg-no-repeat transition-transform duration-500 ease-out group-hover:scale-[1.03]"
      style={{
        backgroundImage: "url('/room-covers/room-type-scenes.png')",
        backgroundPosition: scene.position,
        backgroundSize: "auto 330%"
      }}
    />
    <div className={`absolute inset-0 ${scene.overlayClassName}`} />
  </div>;
}

function RoomTypeGlyph({ large = false, roomType }: { large?: boolean; roomType: RoomType }) {
  const sizeClass = large ? "h-8 w-9" : "h-4 w-5";
  if (roomType === "request") return <span aria-hidden="true" className={`inline-flex ${sizeClass} shrink-0 items-center justify-center font-semibold leading-none text-current`}>♪</span>;
  if (roomType === "radio") return <span aria-hidden="true" className={`relative inline-flex ${sizeClass} shrink-0 items-center justify-center`}><span className="h-[60%] w-[58%] rounded-[3px] border border-current" /><span className="absolute left-[30%] top-[42%] h-[18%] w-[18%] rounded-full bg-current" /><span className="absolute right-[25%] top-[28%] h-[3px] w-[3px] rounded-full bg-current" /></span>;
  return <span aria-hidden="true" className={`relative inline-flex ${sizeClass} shrink-0 items-center justify-center`}><span className="absolute left-[10%] top-[14%] h-[34%] w-[34%] rounded-full border border-current" /><span className="absolute right-[10%] top-[14%] h-[34%] w-[34%] rounded-full border border-current" /><span className="absolute bottom-[10%] left-[4%] h-[36%] w-[42%] rounded-t-full border border-b-0 border-current" /><span className="absolute bottom-[10%] right-[4%] h-[36%] w-[42%] rounded-t-full border border-b-0 border-current" /></span>;
}

function fallbackDescription(room: RoomDirectoryItem["room"]) {
  if (room.roomType === "request") return "成员提交点歌，房主审核后安排播放。";
  if (room.roomType === "radio") return "主持人策展播出，听众专注收听当前节目。";
  return "成员共同管理曲库、队列与同步播放。";
}
