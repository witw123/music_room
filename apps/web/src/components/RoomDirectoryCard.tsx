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

function RoomStageScene({ roomType }: { roomType: RoomType }) {
  if (roomType === "request") return <RequestStageScene />;
  if (roomType === "radio") return <RadioStageScene />;
  return <InteractiveStageScene />;
}

function InteractiveStageScene() {
  const bulbs = [8, 18, 28, 39, 50, 61, 73, 84, 94];
  const buildings = [31, 44, 25, 51, 35, 61, 42, 29, 54, 37, 47, 30];
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_72%_22%,rgba(232,108,191,0.58),transparent_25%),radial-gradient(circle_at_48%_56%,rgba(42,113,255,0.42),transparent_45%),linear-gradient(180deg,#08113c_0%,#14235d_47%,#14122c_100%)]">
    <div className="absolute -left-[8%] right-[-8%] top-[20%] h-px -rotate-[5deg] bg-black/80" />
    {bulbs.map((left, index) => <span className="absolute top-[17%] h-2 w-2 rounded-full bg-amber-200 shadow-[0_0_8px_rgba(255,205,111,0.95)]" key={left} style={{ left: `${left}%`, transform: `translateY(${index % 2 ? 5 : 0}px)` }} />)}
    <span className="absolute left-[17%] top-[36%] h-6 w-8 rounded-[45%] bg-blue-400/15 blur-sm" />
    <span className="absolute right-[21%] top-[28%] h-7 w-7 rounded-full bg-fuchsia-300/20 blur-sm" />
    <div className="absolute inset-x-0 bottom-0 flex h-[47%] items-end gap-px opacity-80">
      {buildings.map((height, index) => <span className="relative flex-1 bg-[#080c25]/80" key={`${height}-${index}`} style={{ height: `${height}%` }}><span className="absolute inset-x-[34%] top-[20%] h-px bg-blue-100/35" /><span className="absolute inset-x-[34%] top-[48%] h-px bg-blue-100/20" /></span>)}
    </div>
    <div className="absolute bottom-[-6%] left-[53%] flex -translate-x-1/2 items-end gap-1.5">
      {[27, 33, 30, 38, 31].map((height, index) => <span className="relative w-4" key={`${height}-${index}`} style={{ height }}><span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[#11132a]" /><span className="absolute bottom-0 left-1/2 h-[70%] w-full -translate-x-1/2 rounded-t-[0.7rem] bg-[#101126]" /></span>)}
    </div>
    <span className="absolute right-[29%] top-[30%] h-7 w-7 rounded-full bg-blue-400/20 blur-[1px]" />
    <span className="absolute right-[27.5%] top-[27%] text-2xl font-light text-cyan-200/90 drop-shadow-[0_0_8px_rgba(66,198,255,0.8)]">♪</span>
    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,5,20,0.28),transparent_60%),linear-gradient(0deg,rgba(2,4,15,0.55),transparent_52%)]" />
  </div>;
}

function RequestStageScene() {
  const bokeh = [
    [12, 23, 0.55], [26, 58, 0.42], [39, 18, 0.5], [54, 71, 0.38], [69, 30, 0.58], [82, 62, 0.44], [94, 21, 0.48]
  ] as const;
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_58%_34%,rgba(225,94,255,0.58),transparent_34%),radial-gradient(circle_at_84%_56%,rgba(106,35,229,0.78),transparent_39%),linear-gradient(130deg,#15062c_0%,#3e0a6e_46%,#120522_100%)]">
    <div className="absolute -left-[18%] top-[-55%] h-[160%] w-[34%] rotate-[25deg] bg-fuchsia-200/10 blur-sm" />
    <div className="absolute left-[20%] top-[-60%] h-[150%] w-[18%] rotate-[25deg] bg-violet-100/10 blur-sm" />
    {bokeh.map(([left, top, opacity], index) => <span className="absolute h-3.5 w-3.5 rounded-full bg-fuchsia-200 blur-[1px]" key={index} style={{ left: `${left}%`, opacity, top: `${top}%` }} />)}
    <div className="absolute -right-[8%] bottom-[-36%] aspect-square w-[49%] rounded-full border border-fuchsia-100/20 bg-[repeating-radial-gradient(circle_at_center,#13041f_0_5%,#2a0750_5.5%_7%,#100419_7.5%_10%)] shadow-[0_0_24px_rgba(216,70,255,0.62)]">
      <span className="absolute left-1/2 top-1/2 h-[28%] w-[28%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-fuchsia-100/30 bg-fuchsia-500/45" />
    </div>
    <div className="absolute left-[53%] top-[53%] h-[77%] w-[14%] -translate-x-1/2 -translate-y-1/2 rotate-[26deg]">
      <span className="absolute left-1/2 top-0 h-[44%] w-full -translate-x-1/2 rounded-[50%] border border-fuchsia-100/35 bg-[linear-gradient(110deg,#12111c,#5a1672_45%,#0f0e18)] shadow-[0_0_16px_rgba(235,113,255,0.55)]" />
      <span className="absolute left-1/2 top-[34%] h-[54%] w-[20%] -translate-x-1/2 rounded-full bg-[#11101a] shadow-[0_0_0_1px_rgba(255,220,255,0.25)]" />
      <span className="absolute left-[27%] top-[48%] h-[8%] w-[46%] rounded-full bg-fuchsia-300/40" />
    </div>
    <span className="absolute left-[23%] top-[23%] text-3xl font-light text-fuchsia-100/95 drop-shadow-[0_0_10px_rgba(244,114,255,0.9)]">♪</span>
    <span className="absolute left-[39%] bottom-[17%] text-xl font-light text-fuchsia-200/70">♪</span>
    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(20,3,36,0.35),transparent_63%),linear-gradient(0deg,rgba(7,2,17,0.44),transparent_60%)]" />
  </div>;
}

function RadioStageScene() {
  const waveform = [20, 36, 27, 53, 38, 64, 32, 48, 25, 40, 58, 30];
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_83%_20%,rgba(255,190,107,0.55),transparent_24%),radial-gradient(circle_at_58%_42%,rgba(18,183,177,0.26),transparent_38%),linear-gradient(125deg,#022d30_0%,#073c40_47%,#1f170f_100%)]">
    <span className="absolute right-[7%] top-[14%] h-8 w-8 rounded-t-[1.25rem] bg-amber-100/85 shadow-[0_0_18px_rgba(255,188,105,0.82)]" />
    <span className="absolute right-[15%] top-[44%] h-[44%] w-px bg-amber-100/55" />
    <div className="absolute bottom-[20%] left-[7%] right-[7%] flex h-[23%] items-end gap-1 opacity-70">
      {waveform.map((height, index) => <span className="flex-1 rounded-t-sm bg-teal-300/75" key={`${height}-${index}`} style={{ height: `${height}%` }} />)}
    </div>
    <div className="absolute bottom-[10%] left-[48%] h-[70%] w-[37%] -translate-x-1/2 rounded-[0.45rem] border border-amber-200/35 bg-[linear-gradient(135deg,#1c130f,#5a3921_44%,#21130d)] shadow-[0_10px_22px_rgba(0,0,0,0.44)]">
      <span className="absolute inset-x-[13%] top-[20%] h-[34%] rounded-[0.2rem] border border-amber-100/20 bg-[repeating-linear-gradient(90deg,rgba(13,10,9,0.86)_0_3px,rgba(71,49,30,0.5)_3px_5px)]" />
      <span className="absolute right-[14%] top-[20%] h-[34%] w-[24%] rounded-[0.2rem] border border-amber-100/20 bg-amber-200/15" />
      <span className="absolute bottom-[16%] left-[16%] h-[18%] w-[18%] rounded-full border border-amber-100/35 bg-[#160d09]" />
      <span className="absolute bottom-[16%] right-[16%] h-[18%] w-[18%] rounded-full border border-amber-100/35 bg-[#160d09]" />
      <span className="absolute bottom-[17%] left-1/2 h-px w-[18%] -translate-x-1/2 bg-amber-100/50" />
    </div>
    <span className="absolute left-[24%] top-[27%] text-2xl font-light text-teal-200/90 drop-shadow-[0_0_8px_rgba(65,255,230,0.7)]">♪</span>
    <span className="absolute left-[36%] top-[18%] text-lg font-light text-teal-200/60">♪</span>
    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,25,26,0.4),transparent_62%),linear-gradient(0deg,rgba(4,11,12,0.48),transparent_58%)]" />
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
