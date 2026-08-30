"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { Button } from "@/components/ui/button";
import {
  SparklesIcon,
  CloseIcon,
  CheckIcon,
  MicIcon,
  VolumeIcon,
  ZapIcon,
  SakuraIcon,
  LaptopIcon,
  MoonIcon,
  LandmarkIcon,
  CoffeeIcon,
  FlameIcon,
  MusicIcon,
  HeadphonesIcon
} from "@/components/icons/DiscoverIcons";

const genreOptions = [
  { label: "流行", icon: MicIcon },
  { label: "摇滚", icon: VolumeIcon },
  { label: "电子", icon: ZapIcon },
  { label: "ACG / 二次元", icon: SakuraIcon },
  { label: "国风 / 古风", icon: LandmarkIcon },
  { label: "说唱 / 嘻哈", icon: FlameIcon },
  { label: "R&B / 灵魂乐", icon: CoffeeIcon },
  { label: "民谣 / 独立", icon: MusicIcon },
  { label: "轻音乐 / 纯音乐", icon: LaptopIcon },
  { label: "古典 / 交响", icon: LandmarkIcon }
];

const sceneOptions = [
  { label: "夜听 / 晚安", icon: MoonIcon },
  { label: "专注 / 学习工作", icon: LaptopIcon },
  { label: "运动 / 燃脂", icon: FlameIcon },
  { label: "通勤 / 散步", icon: HeadphonesIcon },
  { label: "咖啡馆 / 放松", icon: CoffeeIcon },
  { label: "驾车 / 巡航", icon: ZapIcon },
  { label: "治愈 / 冥想", icon: SparklesIcon }
];

const popularArtists = [
  "周杰伦", "林俊杰", "陈奕迅", "Taylor Swift", "米津玄师",
  "YOASOBI", "薛之谦", "邓紫棋", "陶喆", "RADWIMPS",
  "告五人", "草东没有派对", "Bruno Mars", "Billie Eilish"
];

export function TasteColdStartDialog({
  isOpen,
  onClose,
  onCompleted
}: {
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>(["流行", "夜听 / 晚安"]);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const toggleArtist = (artist: string) => {
    setSelectedArtists((prev) =>
      prev.includes(artist) ? prev.filter((item) => item !== artist) : [...prev, artist]
    );
  };

  const handleSubmit = async () => {
    if (selectedLabels.length === 0) return;
    setSubmitting(true);
    try {
      await musicRoomApi.bootstrapColdStartProfile({
        selectedLabels,
        initialArtists: selectedArtists
      });
      onCompleted?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      {/* z-[80] matches the app's modal convention (RoomsHomePage dialogs,
          AnchoredDialog): at z-50 the fixed bottom player (z-60/80) and the
          mobile bottom navigation (z-70) paint over the dialog footer and the
          primary CTA becomes untappable on phones. */}
      <div
        className="relative w-full max-w-xl p-4 sm:p-6 md:p-8 rounded-3xl bg-background-secondary border border-surface-border shadow-2xl text-foreground overflow-hidden max-h-[90dvh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 mb-4 sm:mb-6 shrink-0">
          <div className="flex items-center gap-3 sm:gap-3.5">
            <div className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] shrink-0">
              <SparklesIcon className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">打造你的专属音乐雷达</h2>
              <p className="text-xs sm:text-sm text-foreground-muted">选择 1-5 个你常听的风格或场景，3 秒生成 Music Room 专属推荐</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-foreground-muted hover:text-foreground rounded-full hover:bg-surface-hover transition-colors shrink-0"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 flex-1 min-h-0 overflow-y-auto pr-1 hide-scrollbar touch-pan-y">
          {/* Genre selection */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-foreground-muted uppercase tracking-wider">
              <MusicIcon className="w-4 h-4 text-accent" /> 喜好曲风 (点击选择)
            </div>
            <div className="flex flex-wrap gap-2">
              {genreOptions.map(({ label, icon: IconComponent }) => {
                const active = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 sm:py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] font-semibold border-transparent"
                        : "bg-surface hover:bg-surface-hover text-foreground-muted hover:text-foreground border border-surface-border"
                    }`}
                  >
                    <IconComponent className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                    {active && <CheckIcon className="w-3.5 h-3.5 ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scene selection */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-foreground-muted uppercase tracking-wider">
              <HeadphonesIcon className="w-4 h-4 text-accent" /> 常听场景
            </div>
            <div className="flex flex-wrap gap-2">
              {sceneOptions.map(({ label, icon: IconComponent }) => {
                const active = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 sm:py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? "bg-accent text-white shadow-[0_4px_16px_var(--accent-glow)] font-semibold border-transparent"
                        : "bg-surface hover:bg-surface-hover text-foreground-muted hover:text-foreground border border-surface-border"
                    }`}
                  >
                    <IconComponent className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                    {active && <CheckIcon className="w-3.5 h-3.5 ml-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Artist selection */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-foreground-muted uppercase tracking-wider">
              <LandmarkIcon className="w-4 h-4 text-accent" /> 常听艺人 (可选)
            </div>
            <div className="flex flex-wrap gap-2">
              {popularArtists.map((artist) => {
                const active = selectedArtists.includes(artist);
                return (
                  <button
                    key={artist}
                    type="button"
                    onClick={() => toggleArtist(artist)}
                    className={`inline-flex items-center gap-1 whitespace-nowrap px-3 py-2 sm:py-1 rounded-lg text-xs font-medium transition-all ${
                      active
                        ? "bg-accent/15 text-accent border border-accent/30 font-semibold"
                        : "bg-surface hover:bg-surface-hover text-foreground-muted hover:text-foreground border border-surface-border"
                    }`}
                  >
                    <span>{artist}</span>
                    {active && <CheckIcon className="w-3 h-3" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer actions. Stacked full-width on phones so the primary CTA
            stays reachable; the shrink-0 keeps the footer pinned while the
            pill list scrolls above it. */}
        <div className="flex shrink-0 flex-col-reverse items-stretch gap-2 border-t border-surface-border pt-4 mt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pt-6 sm:mt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground"
          >
            稍后再说
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selectedLabels.length === 0}
            className="px-6 rounded-xl bg-accent hover:bg-accent-hover text-white font-semibold shadow-[0_4px_16px_var(--accent-glow)]"
          >
            <SparklesIcon className="w-4 h-4 mr-2" />
            {submitting ? "正在生成专属推荐..." : "开启我的音乐雷达"}
          </Button>
        </div>
        </div>
      </div>,
      document.body
  );
}
