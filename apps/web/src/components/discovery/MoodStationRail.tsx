import React from "react";
import { DiscoverSection } from "./DiscoverSection";
import {
  MoonIcon,
  LaptopIcon,
  ZapIcon,
  MicIcon,
  SakuraIcon,
  LandmarkIcon,
  PlayIcon
} from "@/components/icons/DiscoverIcons";

export const moodStations = [
  {
    id: "night",
    title: "深夜私享",
    subtitle: "慢调 R&B · 治愈微醺",
    keywords: ["夜听", "深夜", "治愈", "r&b", "soul", "放空"],
    gradient: "from-indigo-950/70 via-purple-950/80 to-[#0b0c14]",
    border: "border-purple-500/20",
    badge: "#a855f7",
    icon: MoonIcon
  },
  {
    id: "focus",
    title: "深度专注",
    subtitle: "Lo-Fi 器乐 · 静谧流淌",
    keywords: ["专注", "学习", "工作", "轻音乐", "纯音乐", "lo-fi", "chill", "钢琴"],
    gradient: "from-blue-950/70 via-slate-900/80 to-[#0b0c14]",
    border: "border-sky-500/20",
    badge: "#38bdf8",
    icon: LaptopIcon
  },
  {
    id: "energy",
    title: "律动充能",
    subtitle: "电子节拍 · 摇滚能量",
    keywords: ["电子", "edm", "摇滚", "rock", "舞曲", "能量"],
    gradient: "from-rose-950/70 via-orange-950/80 to-[#0b0c14]",
    border: "border-rose-500/20",
    badge: "#f43f5e",
    icon: ZapIcon
  },
  {
    id: "morning",
    title: "清新晨光",
    subtitle: "不插电民谣 · 元气苏醒",
    keywords: ["民谣", "清新", "吉他", "流行", "晨光"],
    gradient: "from-emerald-950/70 via-teal-950/80 to-[#0b0c14]",
    border: "border-emerald-500/20",
    badge: "#10b981",
    icon: MicIcon
  },
  {
    id: "acg",
    title: "次元幻想",
    subtitle: "ACG 燃曲 · 异次元羁绊",
    keywords: ["acg", "anime", "二次元", "动漫", "游戏", "j-pop"],
    gradient: "from-fuchsia-950/70 via-pink-950/80 to-[#0b0c14]",
    border: "border-fuchsia-500/20",
    badge: "#ec4899",
    icon: SakuraIcon
  },
  {
    id: "guofeng",
    title: "华夏国韵",
    subtitle: "丝竹戏腔 · 仙侠古意",
    keywords: ["国风", "古风", "仙侠", "华语", "戏腔", "新中式"],
    gradient: "from-amber-950/70 via-red-950/80 to-[#0b0c14]",
    border: "border-amber-500/20",
    badge: "#f59e0b",
    icon: LandmarkIcon
  }
];

export function MoodStationRail({
  onPlayStation,
  pending
}: {
  onPlayStation: (station: (typeof moodStations)[0]) => Promise<void>;
  pending: string | null;
}) {
  return (
    <DiscoverSection
      title="全天候情境与情绪电台"
      subtitle="随时随刻，一键切入当前心情与氛围的最佳节拍"
      icon={<ZapIcon className="w-5 h-5 text-accent" />}
    >
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        {moodStations.map((station) => {
          const IconComp = station.icon;
          const isPending = pending === `mood:${station.id}`;
          return (
            <button
              key={station.id}
              type="button"
              disabled={pending !== null}
              onClick={() => void onPlayStation(station)}
              className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border ${station.border} bg-gradient-to-br ${station.gradient} p-4 text-left transition-all duration-200 hover:-translate-y-1 hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-h-[110px] shadow-sm`}
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] backdrop-blur-md border border-white/10"
                  style={{ color: station.badge }}
                >
                  <IconComp className="w-4 h-4" />
                </div>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white opacity-80 group-hover:bg-accent group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
                  {isPending ? (
                    <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <PlayIcon className="w-3.5 h-3.5 ml-0.5" />
                  )}
                </span>
              </div>
              <div className="mt-3">
                <p className="text-sm font-bold text-white group-hover:text-accent transition-colors">
                  {station.title}
                </p>
                <p className="mt-0.5 text-[11px] text-foreground-muted truncate">
                  {station.subtitle}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </DiscoverSection>
  );
}
