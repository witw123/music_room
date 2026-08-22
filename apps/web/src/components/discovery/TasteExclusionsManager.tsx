"use client";

import { useEffect, useState } from "react";
import type { PersonalizationExclusion } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { Button } from "@/components/ui/button";
import {
  ShieldCheckIcon,
  RotateCcwIcon,
  SparklesIcon,
  MusicIcon,
  LandmarkIcon,
  TrashIcon
} from "@/components/icons/DiscoverIcons";

export function TasteExclusionsManager({
  onOpenColdStart
}: {
  onOpenColdStart: () => void;
}) {
  const [exclusions, setExclusions] = useState<PersonalizationExclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadExclusions = async () => {
    try {
      setLoading(true);
      const items = await musicRoomApi.listPersonalizationExclusions();
      setExclusions(items);
      setErrorMessage(null);
    } catch {
      setErrorMessage("加载屏蔽记录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExclusions();
    const handleEvent = () => void loadExclusions();
    window.addEventListener(personalizationChangedEvent, handleEvent);
    return () => window.removeEventListener(personalizationChangedEvent, handleEvent);
  }, []);

  const handleRestore = async (kind: "track" | "artist", key: string) => {
    const itemKey = `${kind}:${key}`;
    setRemovingKey(itemKey);
    try {
      await musicRoomApi.removePersonalizationExclusion(kind, key);
      setExclusions((prev) => prev.filter((item) => !(item.kind === kind && item.key === key)));
      window.dispatchEvent(new Event(personalizationChangedEvent));
    } catch {
      setErrorMessage("恢复失败，请稍后重试。");
    } finally {
      setRemovingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cold Start / Taste Tuning Banner */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 p-5 sm:p-6 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#fa233b] uppercase tracking-wider">
              <SparklesIcon className="w-3.5 h-3.5" />
              <span>品味画像定制</span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
              重新调整你的音乐雷达偏好
            </h3>
            <p className="text-xs sm:text-sm text-neutral-400 max-w-xl">
              无论是想尝试全新曲风，还是调整专注/夜听场景，随时重置你的 3 秒品味种子。
            </p>
          </div>
          <Button
            type="button"
            onClick={onOpenColdStart}
            className="rounded-xl px-5 py-2.5 bg-[#fa233b] hover:bg-[#e01e34] text-white font-semibold shadow-md shadow-red-950/30 transition-all shrink-0"
          >
            <SparklesIcon className="w-4 h-4 mr-2" />
            定制偏好
          </Button>
        </div>
      </section>

      {/* Exclusions List */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e]/80 p-5 sm:p-6 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-800 text-neutral-300">
              <ShieldCheckIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">负反馈与屏蔽清单</h3>
              <p className="text-xs text-neutral-400">已从推荐流与品味画像中排除的曲目或艺人</p>
            </div>
          </div>
          <span className="text-xs tabular-nums text-neutral-400 bg-neutral-800/80 px-2.5 py-1 rounded-full border border-white/[0.06]">
            共 {exclusions.length} 项
          </span>
        </div>

        {errorMessage && (
          <p className="mb-4 text-xs text-red-400 bg-red-950/30 border border-red-800/40 px-3 py-2 rounded-lg">
            {errorMessage}
          </p>
        )}

        {loading ? (
          <div className="space-y-2 py-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-14 rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : exclusions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-dashed border-white/[0.06] bg-white/[0.01]">
            <ShieldCheckIcon className="w-8 h-8 text-neutral-500 mb-2" />
            <p className="text-sm font-medium text-neutral-300">暂无屏蔽项目</p>
            <p className="text-xs text-neutral-500 mt-1">
              在发现页对歌曲点击「不再推荐」或「不计入品味」后，可以在这里随时恢复。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {exclusions.map((item) => {
              const itemKey = `${item.kind}:${item.key}`;
              const isRemoving = removingKey === itemKey;
              return (
                <div
                  key={itemKey}
                  className="flex items-center justify-between gap-3 py-3 px-2 rounded-xl transition-colors hover:bg-white/[0.02]"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-lg bg-neutral-800/90 text-neutral-400">
                      {item.kind === "artist" ? (
                        <LandmarkIcon className="w-4 h-4" />
                      ) : (
                        <MusicIcon className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {item.label || item.key}
                        </span>
                        <span
                          className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium border ${
                            item.action === "not-interested"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-neutral-800 text-neutral-400 border-white/[0.06]"
                          }`}
                        >
                          {item.action === "not-interested" ? "不再推荐" : "不计入画像"}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-500 mt-0.5">
                        {item.kind === "artist" ? "艺人" : "单曲"} · 屏蔽于 {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isRemoving}
                    onClick={() => handleRestore(item.kind, item.key)}
                    className="shrink-0 h-8 px-3 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/[0.08] border border-white/[0.08]"
                  >
                    <RotateCcwIcon className="w-3.5 h-3.5 mr-1.5" />
                    {isRemoving ? "恢复中..." : "恢复推荐"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
