"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Socket } from "socket.io-client";
import {
  HeartIcon,
  ApplauseIcon,
  FlameIcon,
  SparklesIcon,
  MusicIcon,
  UsersIcon,
  ChevronDownIcon
} from "@/components/icons/DiscoverIcons";
import {
  dispatchLocalReaction,
  type ReactionType
} from "./RoomReactionOverlay";

export type ReactionTargetSong = {
  id: string;
  title: string;
  artist?: string;
  requesterName?: string | null;
};

export type ReactionTargetMember = {
  id: string;
  nickname: string;
  isHost?: boolean;
  avatarUrl?: string | null;
};

type RoomReactionToolbarProps = {
  roomId: string;
  socket?: Socket | null;
  variant?: "interactive" | "request" | "radio";
  targetSongs?: ReactionTargetSong[];
  activeSongId?: string | null;
  targetMembers?: ReactionTargetMember[];
  activeMemberId?: string | null;
  className?: string;
};

export function RoomReactionToolbar({
  roomId,
  socket,
  variant = "interactive",
  targetSongs = [],
  activeSongId,
  targetMembers = [],
  activeMemberId,
  className = ""
}: RoomReactionToolbarProps) {
  const [activeReaction, setActiveReaction] = useState<ReactionType | null>(null);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(activeSongId ?? (targetSongs[0]?.id ?? null));
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(activeMemberId ?? (targetMembers[0]?.id ?? null));
  const [showSelector, setShowSelector] = useState(false);

  const throttleTimerRef = useRef<{ [key: string]: number }>({});
  const comboTrackerRef = useRef<{ [key: string]: { count: number; lastAt: number } }>({});
  const containerRef = useRef<HTMLDivElement>(null);

  // Synchronize target song if activeSongId changes
  useEffect(() => {
    if (activeSongId) {
      setSelectedSongId(activeSongId);
    } else if (targetSongs.length > 0 && !selectedSongId) {
      setSelectedSongId(targetSongs[0].id);
    }
  }, [activeSongId, targetSongs, selectedSongId]);

  // Synchronize target member if activeMemberId changes
  useEffect(() => {
    if (activeMemberId) {
      setSelectedMemberId(activeMemberId);
    } else if (targetMembers.length > 0 && !selectedMemberId) {
      setSelectedMemberId(targetMembers[0].id);
    }
  }, [activeMemberId, targetMembers, selectedMemberId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showSelector) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSelector(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSelector]);

  const selectedSong = targetSongs.find((s) => s.id === selectedSongId) ?? targetSongs[0] ?? null;
  const selectedMember = targetMembers.find((m) => m.id === selectedMemberId) ?? targetMembers[0] ?? null;

  const handleSendReaction = useCallback((reaction: ReactionType) => {
    const now = Date.now();
    const tracker = comboTrackerRef.current[reaction] ?? { count: 0, lastAt: 0 };
    if (now - tracker.lastAt < 1200) {
      tracker.count += 1;
    } else {
      tracker.count = 1;
    }
    tracker.lastAt = now;
    comboTrackerRef.current[reaction] = tracker;

    let targetLabel: string | undefined;
    let targetType: "member" | "track" | undefined;

    if (variant === "request" && selectedSong) {
      targetLabel = `《${selectedSong.title}》`;
      targetType = "track";
    } else if (variant === "radio" && selectedMember) {
      targetLabel = `@${selectedMember.nickname}`;
      targetType = "member";
    }

    // Instant local visual feedback
    dispatchLocalReaction({
      reaction,
      targetLabel,
      targetType,
      comboCount: tracker.count
    });

    setActiveReaction(reaction);
    window.setTimeout(() => setActiveReaction(null), 180);

    // Throttle network socket emit to 120ms per reaction type
    const lastEmit = throttleTimerRef.current[reaction] ?? 0;
    if (now - lastEmit > 120 && socket) {
      throttleTimerRef.current[reaction] = now;
      socket.emit("room.reaction", {
        roomId,
        reaction,
        trackId: selectedSong?.id ?? null
      });
    }
  }, [roomId, socket, variant, selectedSong, selectedMember]);

  // Variant: Request Room (点歌房 - 可选择歌曲互动)
  if (variant === "request") {
    return (
      <div ref={containerRef} className={`relative inline-flex items-center gap-1.5 p-1 rounded-2xl bg-surface/50 backdrop-blur-xl ${className}`}>
        {/* Song Selector Trigger */}
        {targetSongs.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowSelector((prev) => !prev)}
            className="flex items-center gap-1.5 max-w-[160px] sm:max-w-[200px] px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs text-foreground transition-all active:scale-95"
            title="选择要互动的歌曲"
          >
            <MusicIcon className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate font-medium">{selectedSong ? selectedSong.title : "选择歌曲"}</span>
            <ChevronDownIcon className={`w-3 h-3 text-foreground-muted transition-transform shrink-0 ${showSelector ? "rotate-180" : ""}`} />
          </button>
        ) : null}

        {/* Dropdown Menu for choosing songs */}
        {showSelector && targetSongs.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-64 max-h-56 overflow-y-auto overscroll-contain rounded-2xl p-1.5 bg-background/95 backdrop-blur-2xl border border-surface-border shadow-2xl z-50 animate-fade-in hide-scrollbar">
            <p className="px-2.5 py-1 text-[11px] font-semibold text-foreground-muted">选择互动曲目</p>
            <div className="space-y-1 mt-1">
              {targetSongs.map((song) => {
                const isSelected = song.id === selectedSong?.id;
                return (
                  <button
                    key={song.id}
                    type="button"
                    onClick={() => {
                      setSelectedSongId(song.id);
                      setShowSelector(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs text-left transition-all ${
                      isSelected ? "bg-accent text-white font-semibold" : "hover:bg-white/[0.06] text-foreground"
                    }`}
                  >
                    <span className="truncate">《{song.title}》</span>
                    {song.requesterName && (
                      <span className={`text-[10px] shrink-0 ${isSelected ? "text-white/80" : "text-foreground-muted"}`}>
                        @{song.requesterName}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Pure SVG Reaction Buttons */}
        <div className="flex items-center gap-0.5">
          <ReactionButton
            icon={<HeartIcon className="w-4 h-4 text-[#fa233b]" />}
            isActive={activeReaction === "like"}
            label="心动"
            onClick={() => handleSendReaction("like")}
          />
          <ReactionButton
            icon={<ApplauseIcon className="w-4 h-4 text-[#f59e0b]" />}
            isActive={activeReaction === "applause"}
            label="欢呼"
            onClick={() => handleSendReaction("applause")}
          />
          <ReactionButton
            icon={<FlameIcon className="w-4 h-4 text-[#ff5722]" />}
            isActive={activeReaction === "fire"}
            label="燃点"
            onClick={() => handleSendReaction("fire")}
          />
          <ReactionButton
            icon={<SparklesIcon className="w-4 h-4 text-[#a855f7]" />}
            isActive={activeReaction === "sparkle"}
            label="赞美"
            onClick={() => handleSendReaction("sparkle")}
          />
        </div>
      </div>
    );
  }

  // Variant: Radio Room (电台房 - 可选择成员互动)
  if (variant === "radio") {
    return (
      <div ref={containerRef} className={`relative flex items-center justify-between gap-2 p-1.5 rounded-2xl bg-surface/40 backdrop-blur-xl ${className}`}>
        {/* Target Member Selector Trigger */}
        {targetMembers.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowSelector((prev) => !prev)}
            className="flex items-center gap-1.5 max-w-[150px] sm:max-w-[180px] px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs text-foreground transition-all active:scale-95"
            title="选择要互动的成员"
          >
            <UsersIcon className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="truncate font-medium">
              {selectedMember?.isHost ? `👑 @${selectedMember.nickname}` : `@${selectedMember?.nickname ?? "成员"}`}
            </span>
            <ChevronDownIcon className={`w-3 h-3 text-foreground-muted transition-transform shrink-0 ${showSelector ? "rotate-180" : ""}`} />
          </button>
        ) : null}

        {/* Dropdown Menu for choosing members */}
        {showSelector && targetMembers.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-56 max-h-56 overflow-y-auto overscroll-contain rounded-2xl p-1.5 bg-background/95 backdrop-blur-2xl border border-surface-border shadow-2xl z-50 animate-fade-in hide-scrollbar">
            <p className="px-2.5 py-1 text-[11px] font-semibold text-foreground-muted">选择互动成员</p>
            <div className="space-y-1 mt-1">
              {targetMembers.map((member) => {
                const isSelected = member.id === selectedMember?.id;
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      setSelectedMemberId(member.id);
                      setShowSelector(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl text-xs text-left transition-all ${
                      isSelected ? "bg-accent text-white font-semibold" : "hover:bg-white/[0.06] text-foreground"
                    }`}
                  >
                    <span className="truncate">@{member.nickname}</span>
                    {member.isHost && (
                      <span className={`text-[10px] shrink-0 px-1.5 py-0.5 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-accent/15 text-accent"}`}>
                        主理人
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Pure SVG Reaction Buttons */}
        <div className="flex items-center gap-1">
          <ReactionButton
            icon={<HeartIcon className="w-4 h-4 text-[#fa233b]" />}
            isActive={activeReaction === "like"}
            label="心动"
            onClick={() => handleSendReaction("like")}
          />
          <ReactionButton
            icon={<ApplauseIcon className="w-4 h-4 text-[#f59e0b]" />}
            isActive={activeReaction === "applause"}
            label="欢呼"
            onClick={() => handleSendReaction("applause")}
          />
          <ReactionButton
            icon={<FlameIcon className="w-4 h-4 text-[#ff5722]" />}
            isActive={activeReaction === "fire"}
            label="燃点"
            onClick={() => handleSendReaction("fire")}
          />
          <ReactionButton
            icon={<SparklesIcon className="w-4 h-4 text-[#a855f7]" />}
            isActive={activeReaction === "sparkle"}
            label="赞美"
            onClick={() => handleSendReaction("sparkle")}
          />
        </div>
      </div>
    );
  }

  // Default: Interactive Room Floating Bar (多人互动房)
  return (
    <div
      aria-label="实时房间互动"
      className={`inline-flex items-center gap-1 p-1 rounded-full bg-surface/50 backdrop-blur-xl transition-all ${className}`}
    >
      <ReactionButton
        icon={<HeartIcon className="w-4 h-4 text-[#fa233b]" />}
        isActive={activeReaction === "like"}
        label="心动"
        onClick={() => handleSendReaction("like")}
      />
      <ReactionButton
        icon={<ApplauseIcon className="w-4 h-4 text-[#f59e0b]" />}
        isActive={activeReaction === "applause"}
        label="欢呼"
        onClick={() => handleSendReaction("applause")}
      />
      <ReactionButton
        icon={<FlameIcon className="w-4 h-4 text-[#ff5722]" />}
        isActive={activeReaction === "fire"}
        label="燃点"
        onClick={() => handleSendReaction("fire")}
      />
      <ReactionButton
        icon={<SparklesIcon className="w-4 h-4 text-[#a855f7]" />}
        isActive={activeReaction === "sparkle"}
        label="赞美"
        onClick={() => handleSendReaction("sparkle")}
      />
    </div>
  );
}

function ReactionButton({
  icon,
  label,
  isActive,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl transition-all duration-150 hover:bg-white/[0.08] active:scale-90 ${
        isActive ? "scale-125 bg-white/15" : ""
      }`}
    >
      {icon}
    </button>
  );
}
