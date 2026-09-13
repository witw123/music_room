"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ColdStartTasteDimension } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { personalizationChangedEvent } from "@/features/personalization/use-personalization-reporter";
import { Button } from "@/components/ui/button";
import {
  SlidersIcon,
  SparklesIcon,
  CloseIcon,
  CheckIcon,
  MusicIcon,
  LandmarkIcon,
  HeadphonesIcon
} from "@/components/icons/DiscoverIcons";
import {
  TASTE_DIMENSION_GROUPS,
  TASTE_POPULAR_ARTISTS,
  TASTE_SELECTION_LIMIT,
  TASTE_ARTIST_LIMIT
} from "./taste-taxonomy";

const dimensionGroupIcons: Record<ColdStartTasteDimension, React.ComponentType<{ className?: string }>> = {
  genre: MusicIcon,
  language: LandmarkIcon,
  region: LandmarkIcon,
  scene: HeadphonesIcon,
  era: SparklesIcon
};

export function TasteColdStartDialog({
  isOpen,
  onClose,
  onCompleted
}: {
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hydrationNotice, setHydrationNotice] = useState<string | null>(null);
  // Current selections are loaded once per open; a user who already toggled a
  // chip before the profile response arrives keeps their own edits.
  const userEditedRef = useRef(false);
  const dialogOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      userEditedRef.current = false;
      dialogOpenRef.current = false;
      return;
    }
    if (dialogOpenRef.current) return;
    dialogOpenRef.current = true;

    let cancelled = false;
    void musicRoomApi.getPersonalizationProfile()
      .then((profile) => {
        if (cancelled || userEditedRef.current) return;
        const effectiveLabels = new Set<string>();
        for (const group of profile.tasteGroups) {
          for (const tag of group.tags) {
            effectiveLabels.add(tag.label);
          }
        }
        const preselected: string[] = [];
        for (const group of TASTE_DIMENSION_GROUPS) {
          for (const option of group.options) {
            if (effectiveLabels.has(option.label) && !preselected.includes(option.label)) {
              preselected.push(option.label);
            }
          }
        }
        const favoriteArtists = profile.topArtists
          .map((artist) => artist.name)
          .filter((name) => TASTE_POPULAR_ARTISTS.includes(name))
          .slice(0, TASTE_ARTIST_LIMIT);
        setSelectedLabels(preselected.slice(0, TASTE_SELECTION_LIMIT));
        setSelectedArtists(favoriteArtists);
        if (preselected.length === 0) {
          setHydrationNotice("还没有生效的偏好标签，选择后保存即可生效。");
        }
      })
      .catch(() => {
        if (!cancelled) setHydrationNotice("暂时无法读取当前偏好，可以直接勾选新的标签。");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleLabel = (label: string) => {
    userEditedRef.current = true;
    setHydrationNotice(null);
    setSelectedLabels((prev) => {
      if (prev.includes(label)) {
        return prev.filter((item) => item !== label);
      }
      if (prev.length >= TASTE_SELECTION_LIMIT) {
        return prev;
      }
      return [...prev, label];
    });
  };

  const toggleArtist = (artist: string) => {
    userEditedRef.current = true;
    setSelectedArtists((prev) => {
      if (prev.includes(artist)) {
        return prev.filter((item) => item !== artist);
      }
      if (prev.length >= TASTE_ARTIST_LIMIT) {
        return prev;
      }
      return [...prev, artist];
    });
  };

  const atSelectionCap = selectedLabels.length >= TASTE_SELECTION_LIMIT;

  const handleSubmit = async () => {
    if (selectedLabels.length === 0) return;
    setSubmitting(true);
    try {
      await musicRoomApi.bootstrapColdStartProfile({
        selections: TASTE_DIMENSION_GROUPS.flatMap((group) =>
          group.options
            .filter((option) => selectedLabels.includes(option.label))
            .map((option) => ({ label: option.label, dimension: group.id }))
        ),
        initialArtists: selectedArtists
      });
      // 发现页与个人页都监听该事件：缓存失效并即刻重新拉取推荐，调整立即生效。
      window.dispatchEvent(new Event(personalizationChangedEvent));
      onCompleted?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-md"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      {/* z-[var(--z-modal)] matches the app's modal convention (RoomsHomePage dialogs,
          AnchoredDialog): at z-50 the fixed bottom player (z-60/80) and the
          mobile bottom navigation (z-70) paint over the dialog footer and the
          primary CTA becomes untappable on phones. */}
      <div
        className="relative w-full max-w-2xl p-4 sm:p-6 md:p-8 rounded-2xl bg-background-secondary border border-surface-border shadow-2xl text-foreground overflow-hidden max-h-[90dvh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 mb-4 sm:mb-5 shrink-0">
          <div className="flex items-center gap-3 sm:gap-3.5">
            <div className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-surface border border-surface-border text-foreground shrink-0">
              <SlidersIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-foreground tracking-tight">调整偏好</h2>
              <p className="text-xs sm:text-sm text-foreground-muted">勾选常听的分类，保存后发现页推荐立即按新偏好刷新</p>
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
          {TASTE_DIMENSION_GROUPS.map((group) => {
            const GroupIcon = dimensionGroupIcons[group.id];
            return (
              <div key={group.id}>
                <div className="flex items-baseline gap-2 mb-2.5">
                  <GroupIcon className="w-4 h-4 text-accent shrink-0 self-center" />
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{group.label}</span>
                  <span className="text-[11px] text-foreground-muted/70 truncate">{group.description}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((option) => {
                    const active = selectedLabels.includes(option.label);
                    const selectable = active || !atSelectionCap;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => toggleLabel(option.label)}
                        disabled={!selectable}
                        title={option.hint ? `${option.label} · ${option.hint}` : option.label}
                        className={`inline-flex items-center gap-1 whitespace-nowrap px-3.5 py-2 sm:py-1.5 rounded-full text-xs font-medium transition-all ${
                          active
                            ? "bg-accent text-white shadow-xs font-semibold border-transparent"
                            : selectable
                              ? "bg-surface hover:bg-surface-hover text-foreground-muted hover:text-foreground border border-surface-border cursor-pointer"
                              : "bg-surface/50 text-foreground-muted/40 border border-surface-border/50 cursor-not-allowed"
                        }`}
                      >
                        <span>{option.label}</span>
                        {active && <CheckIcon className="w-3.5 h-3.5 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Optional Artist selection */}
          <div>
            <div className="flex items-baseline gap-2 mb-2.5">
              <LandmarkIcon className="w-4 h-4 text-accent shrink-0 self-center" />
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">常听艺人</span>
              <span className="text-[11px] text-foreground-muted/70">可选，最多 {TASTE_ARTIST_LIMIT} 位</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TASTE_POPULAR_ARTISTS.map((artist) => {
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

        {/* Footer actions */}
        <div className="shrink-0 flex flex-col-reverse items-stretch gap-2 border-t border-surface-border pt-4 mt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pt-5 sm:mt-5">
          <div className="flex items-center gap-3 text-[11px] text-foreground-muted">
            <span className={atSelectionCap ? "text-amber-400" : ""}>已选 {selectedLabels.length}/{TASTE_SELECTION_LIMIT}</span>
            {hydrationNotice ? <span className="truncate">{hydrationNotice}</span> : <span className="hidden sm:inline">每个分类都对应可搜索的曲库，必然有歌曲</span>}
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || selectedLabels.length === 0}
              className="px-6 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium shadow-sm transition-all active:scale-95"
            >
              <CheckIcon className="w-4 h-4 mr-2" />
              {submitting ? "正在保存..." : "保存并生效"}
            </Button>
          </div>
        </div>
        </div>
      </div>,
      document.body
  );
}
