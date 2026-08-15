"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
  scene: RoomType;
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
    scene: "interactive",
    soft: "rgba(0, 112, 243, 0.16)"
  },
  request: {
    accent: "#c026d3",
    border: "rgba(192, 38, 211, 0.58)",
    glow: "rgba(192, 38, 211, 0.2)",
    label: "点歌房",
    scene: "request",
    soft: "rgba(192, 38, 211, 0.15)"
  },
  radio: {
    accent: "#00a9d6",
    border: "rgba(0, 169, 214, 0.58)",
    glow: "rgba(0, 169, 214, 0.2)",
    label: "自由电台",
    scene: "radio",
    soft: "rgba(0, 169, 214, 0.15)"
  }
};

export function RoomDirectoryCard({ room: directoryItem, onOpen }: RoomDirectoryCardProps) {
  const room = directoryItem.room;
  const theme = roomCardThemes[room.roomType];
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const resetFeedbackTimer = useRef<number | null>(null);
  const cardStyle: RoomCardStyle = {
    "--room-accent": theme.accent,
    "--room-border": theme.border,
    "--room-shadow": theme.glow,
    "--room-soft": theme.soft
  };

  useEffect(() => () => {
    if (resetFeedbackTimer.current !== null) window.clearTimeout(resetFeedbackTimer.current);
  }, []);

  function showShareFeedback(message: string) {
    setShareFeedback(message);
    if (resetFeedbackTimer.current !== null) window.clearTimeout(resetFeedbackTimer.current);
    resetFeedbackTimer.current = window.setTimeout(() => setShareFeedback(null), 1800);
  }

  async function copyRoomCode() {
    try {
      if (!navigator.clipboard?.writeText) return false;
      await navigator.clipboard.writeText(room.joinCode);
      return true;
    } catch {
      return false;
    }
  }

  async function shareRoom() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: room.name,
          text: `${room.name}，房间码 ${room.joinCode}`,
          url: new URL(`/room/${room.id}`, window.location.origin).toString()
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }

    showShareFeedback(await copyRoomCode() ? "已复制房间码" : "无法分享");
  }

  return (
    <article
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--room-border)] bg-[#111114] p-4 shadow-[0_18px_44px_var(--room-shadow)] transition-[border-color,box-shadow] duration-200 hover:border-[color:var(--room-accent)] hover:shadow-[0_22px_52px_var(--room-shadow)] motion-reduce:transition-none sm:p-5"
      data-room-theme={room.roomType}
      data-room-type={room.roomType}
      data-testid="room-directory-card"
      style={cardStyle}
    >
      <header className="flex min-h-9 items-center justify-between gap-3">
        <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[color:var(--room-border)] bg-[color:var(--room-soft)] px-3 text-sm font-semibold text-foreground">
          <RoomTypeGlyph roomType={room.roomType} />
          {theme.label}
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm tabular-nums text-foreground-muted">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_10px_rgba(74,222,128,0.45)]" />
          {room.directoryOnlineMemberCount} 人在线
        </span>
      </header>

      <section
        className="relative mt-4 aspect-[49/20] overflow-hidden rounded-xl border border-white/10 bg-[#090a0e]"
        data-card-scene={theme.scene}
        data-testid="room-directory-stage"
      >
        <RoomStageScene roomType={room.roomType} />
      </section>

      <div className="pt-4">
        <h3 className="truncate text-[1.7rem] font-semibold leading-9 text-foreground">{room.name}</h3>
        <p className="mt-1 line-clamp-3 min-h-[4.125rem] break-words text-sm leading-[1.375rem] text-foreground-muted">
          {room.description?.trim() || fallbackDescription(room)}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1.45fr)_minmax(6.5rem,0.75fr)] gap-3">
        <button
          className="room-card-action room-card-action--primary inline-flex min-h-12 items-center justify-center gap-2 px-4 text-sm font-semibold text-white hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--room-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          onClick={onOpen}
          type="button"
        >
          <RoomTypeGlyph roomType={room.roomType} />
          进入房间
        </button>
        <button
          aria-label={`分享${room.name}`}
          className="room-card-action room-card-action--secondary inline-flex min-h-12 items-center justify-center gap-2 px-3 text-sm font-medium text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--room-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          data-testid="room-directory-share"
          onClick={() => void shareRoom()}
          title="分享房间"
          type="button"
        >
          <ShareGlyph />
          <span className="whitespace-nowrap">{shareFeedback ?? "分享"}</span>
        </button>
      </div>
    </article>
  );
}

function RoomStageScene({ roomType }: { roomType: RoomType }) {
  if (roomType === "request") return <RequestStageScene />;
  if (roomType === "radio") return <RadioStageScene />;
  return <InteractiveStageScene />;
}

function InteractiveStageScene() {
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
    <div className="absolute inset-x-7 top-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-white/10" />
      {[0, 1, 2, 3, 4].map((index) => <span className="relative h-5 w-5 rounded-md border border-[color:var(--room-border)] bg-[color:var(--room-soft)]" key={index}><span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--room-accent)]" /></span>)}
      <span className="h-px flex-1 bg-white/10" />
    </div>
    <div className="absolute bottom-7 left-8 right-8 flex h-14 items-end justify-between gap-2 border-b border-white/10 px-3">
      {[18, 35, 26, 49, 30, 42, 22, 36, 16].map((height, index) => <span className="w-2 rounded-t-sm bg-[color:var(--room-accent)] opacity-80" key={`${height}-${index}`} style={{ height }} />)}
    </div>
    <div className="absolute left-1/2 top-[52%] flex h-16 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-[color:var(--room-border)] bg-[#10131a] shadow-[0_0_30px_var(--room-shadow)]"><RoomTypeGlyph large roomType="interactive" /></div>
  </div>;
}

function RequestStageScene() {
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
    <div className="absolute left-7 top-7 h-16 w-[44%] -rotate-6 rounded-xl border border-white/10 bg-[#121017] opacity-70" />
    <div className="absolute left-[19%] top-5 h-16 w-[46%] rotate-3 rounded-xl border border-[color:var(--room-border)] bg-[#141018] shadow-[0_0_28px_var(--room-shadow)]"><span className="absolute left-4 top-4 h-7 w-7 rounded-md bg-[color:var(--room-soft)]" /><span className="absolute left-14 right-5 top-4 h-1.5 rounded-full bg-white/25" /><span className="absolute left-14 right-12 top-8 h-1 rounded-full bg-white/10" /></div>
    <div className="absolute bottom-6 right-7 flex h-16 w-[46%] items-center gap-3 rounded-xl border border-[color:var(--room-border)] bg-[#120f17] px-4 shadow-[0_0_30px_var(--room-shadow)]"><RoomTypeGlyph large roomType="request" /><div className="flex flex-1 items-end gap-1.5">{[13, 25, 18, 35, 23, 29].map((height, index) => <span className="w-1.5 rounded-full bg-[color:var(--room-accent)]" key={`${height}-${index}`} style={{ height }} />)}</div></div>
  </div>;
}

function RadioStageScene() {
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
    <div className="absolute inset-x-7 top-6 flex items-center gap-2 text-[9px] tabular-nums text-white/35"><span>88</span><span className="h-px flex-1 bg-white/10" /><span>96</span><span className="h-px flex-1 bg-[color:var(--room-accent)] opacity-60" /><span>104</span><span className="h-px flex-1 bg-white/10" /><span>108</span></div>
    <div className="absolute left-7 top-12 flex h-[4.5rem] w-[38%] items-center justify-center rounded-xl border border-[color:var(--room-border)] bg-[#0d1418] shadow-[0_0_30px_var(--room-shadow)]"><RoomTypeGlyph large roomType="radio" /></div>
    <div className="absolute bottom-6 right-7 flex h-[4.5rem] w-[46%] items-end justify-between gap-1.5 border-b border-white/10 px-3 pb-2">{[12, 22, 35, 25, 48, 31, 41, 20].map((height, index) => <span className="w-2 rounded-t-sm bg-[color:var(--room-accent)] opacity-85" key={`${height}-${index}`} style={{ height }} />)}</div>
  </div>;
}

function RoomTypeGlyph({ large = false, roomType }: { large?: boolean; roomType: RoomType }) {
  const sizeClass = large ? "h-8 w-9" : "h-4 w-5";
  if (roomType === "request") return <span aria-hidden="true" className={`inline-flex ${sizeClass} shrink-0 items-center justify-center font-semibold leading-none text-current`}>♪</span>;
  if (roomType === "radio") return <span aria-hidden="true" className={`relative inline-flex ${sizeClass} shrink-0 items-center justify-center`}><span className="h-[60%] w-[58%] rounded-[3px] border border-current" /><span className="absolute left-[30%] top-[42%] h-[18%] w-[18%] rounded-full bg-current" /><span className="absolute right-[25%] top-[28%] h-[3px] w-[3px] rounded-full bg-current" /></span>;
  return <span aria-hidden="true" className={`relative inline-flex ${sizeClass} shrink-0 items-center justify-center`}><span className="absolute left-[10%] top-[14%] h-[34%] w-[34%] rounded-full border border-current" /><span className="absolute right-[10%] top-[14%] h-[34%] w-[34%] rounded-full border border-current" /><span className="absolute bottom-[10%] left-[4%] h-[36%] w-[42%] rounded-t-full border border-b-0 border-current" /><span className="absolute bottom-[10%] right-[4%] h-[36%] w-[42%] rounded-t-full border border-b-0 border-current" /></span>;
}

function ShareGlyph() {
  return <span aria-hidden="true" className="relative inline-flex h-4 w-4 shrink-0"><span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full border border-current" /><span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full border border-current" /><span className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full border border-current" /><span className="absolute left-[5px] top-[5px] h-px w-2 rotate-[-28deg] bg-current" /><span className="absolute bottom-[5px] left-[5px] h-px w-2 rotate-[28deg] bg-current" /></span>;
}

function fallbackDescription(room: RoomDirectoryItem["room"]) {
  if (room.roomType === "request") return "成员提交点歌，房主审核后安排播放。";
  if (room.roomType === "radio") return "主持人策展播出，听众专注收听当前节目。";
  return "成员共同管理曲库、队列与同步播放。";
}
