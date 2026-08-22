"use client";

import { useState } from "react";
import {
  SparklesIcon,
  CheckIcon,
  MusicIcon,
  HeadphonesIcon,
  CloseIcon,
  MicIcon,
  ZapIcon,
  CoffeeIcon,
  MoonIcon,
  LaptopIcon,
  FlameIcon,
  RadioIcon,
  SlidersIcon,
  ActivityIcon,
  HeartIcon,
  VolumeIcon,
  SakuraIcon,
  LandmarkIcon
} from "@/components/icons/DiscoverIcons";
import { Button } from "@/components/ui/button";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";

type OptionItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const genreOptions: OptionItem[] = [
  { label: "流行", icon: MicIcon },
  { label: "独立摇滚", icon: VolumeIcon },
  { label: "电子", icon: ZapIcon },
  { label: "ACG", icon: SakuraIcon },
  { label: "R&B", icon: HeartIcon },
  { label: "民谣", icon: MusicIcon },
  { label: "爵士", icon: RadioIcon },
  { label: "国风", icon: LandmarkIcon },
  { label: "City-Pop", icon: SlidersIcon },
  { label: "说唱", icon: MicIcon },
  { label: "轻音乐", icon: CoffeeIcon }
];

const sceneOptions: OptionItem[] = [
  { label: "专注", icon: LaptopIcon },
  { label: "夜听", icon: MoonIcon },
  { label: "放松", icon: CoffeeIcon },
  { label: "运动", icon: ActivityIcon },
  { label: "派对", icon: FlameIcon }
];


const popularArtists = [
  "周杰伦",
  "YOASOBI",
  "Coldplay",
  "Taylor Swift",
  "落日飞车",
  "米津玄師",
  "林俊杰",
  "Aimer",
  "NewJeans",
  "五月天",
  "万能青年旅店",
  "The Weeknd"
];

export function TasteColdStartDialog({
  isOpen,
  onClose,
  onCompleted
}: {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>(["流行"]);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? (prev.length > 1 ? prev.filter((l) => l !== label) : prev) : [...prev, label].slice(0, 6)
    );
  };

  const toggleArtist = (artist: string) => {
    setSelectedArtists((prev) =>
      prev.includes(artist) ? prev.filter((a) => a !== artist) : [...prev, artist].slice(0, 5)
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
      window.dispatchEvent(new Event(personalizationChangedEvent));
      onCompleted();
      onClose();
    } catch {
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl p-6 sm:p-8 rounded-3xl bg-[#1c1c1e] border border-white/[0.1] shadow-2xl shadow-black/80 text-white overflow-hidden">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3.5">
            <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-[#fa233b] text-white shadow-lg shadow-red-950/40">
              <SparklesIcon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">打造你的专属音乐雷达</h2>
              <p className="text-xs sm:text-sm text-neutral-400">选择 1-5 个你常听的风格或场景，3 秒生成 Music Room 专属推荐</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white rounded-full hover:bg-white/[0.08] transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {/* Genre selection */}
          <div>
            <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              <MusicIcon className="w-4 h-4 text-[#fa233b]" /> 喜好曲风 (点击选择)
            </div>
            <div className="flex flex-wrap gap-2">
              {genreOptions.map(({ label, icon: IconComponent }) => {
                const active = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? "bg-[#fa233b] text-white shadow-sm font-semibold border-transparent"
                        : "bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 border border-white/[0.08]"
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
            <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              <HeadphonesIcon className="w-4 h-4 text-[#fa233b]" /> 常听场景
            </div>
            <div className="flex flex-wrap gap-2">
              {sceneOptions.map(({ label, icon: IconComponent }) => {
                const active = selectedLabels.includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? "bg-[#fa233b] text-white shadow-sm font-semibold border-transparent"
                        : "bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 border border-white/[0.08]"
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
            <div className="flex items-center gap-2 mb-2.5 text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              <LandmarkIcon className="w-4 h-4 text-[#fa233b]" /> 常听艺人 (可选)
            </div>
            <div className="flex flex-wrap gap-2">
              {popularArtists.map((artist) => {
                const active = selectedArtists.includes(artist);
                return (
                  <button
                    key={artist}
                    type="button"
                    onClick={() => toggleArtist(artist)}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      active
                        ? "bg-white/[0.15] text-white border border-white/[0.25]"
                        : "bg-white/[0.04] hover:bg-white/[0.08] text-neutral-400 border border-white/[0.06]"
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

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 pt-6 mt-6 border-t border-white/[0.08]">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="text-neutral-400 hover:text-white"
          >
            稍后再说
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selectedLabels.length === 0}
            className="px-6 rounded-xl bg-[#fa233b] hover:bg-[#e01e34] text-white font-semibold shadow-lg shadow-red-950/40"
          >
            <SparklesIcon className="w-4 h-4 mr-2" />
            {submitting ? "正在生成专属推荐..." : "开启我的音乐雷达"}
          </Button>
        </div>
      </div>
    </div>
  );
}

