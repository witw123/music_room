"use client";

import { useState, useRef, useCallback } from "react";
import type { Socket } from "socket.io-client";
import type { TrackMeta } from "@music-room/shared";
import {
  HeartIcon,
  ApplauseIcon,
  FlameIcon,
  SparklesIcon,
  MicIcon
} from "@/components/icons/DiscoverIcons";
import {
  dispatchLocalReaction,
  type ReactionType
} from "./RoomReactionOverlay";

type RoomReactionToolbarProps = {
  roomId: string;
  socket?: Socket | null;
  trackId?: string | null;
  variant?: "interactive" | "request" | "radio";
  currentTrack?: TrackMeta | null;
  requesterName?: string | null;
  isHost?: boolean;
  className?: string;
};

export function RoomReactionToolbar({
  roomId,
  socket,
  trackId,
  variant = "interactive",
  _currentTrack,
  requesterName,
  isHost = false,
  className = ""
}: RoomReactionToolbarProps) {
  const [activeReaction, setActiveReaction] = useState<ReactionType | null>(null);
  const throttleTimerRef = useRef<{ [key: string]: number }>({});
  const comboTrackerRef = useRef<{ [key: string]: { count: number; lastAt: number } }>({});

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

    // Instant local visual feedback
    dispatchLocalReaction({ reaction, comboCount: tracker.count });

    setActiveReaction(reaction);
    window.setTimeout(() => setActiveReaction(null), 180);

    // Throttle network socket emit to 150ms per reaction type
    const lastEmit = throttleTimerRef.current[reaction] ?? 0;
    if (now - lastEmit > 120 && socket) {
      throttleTimerRef.current[reaction] = now;
      socket.emit("room.reaction", {
        roomId,
        reaction,
        trackId: trackId ?? null
      });
    }
  }, [roomId, socket, trackId]);

  if (variant === "request") {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        {requesterName ? (
          <button
            type="button"
            onClick={() => handleSendReaction("like")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-surface/60 hover:bg-surface text-foreground transition-all active:scale-95 border border-transparent hover:border-surface-border"
          >
            <HeartIcon className="w-3.5 h-3.5 text-[#fa233b]" />
            <span>致敬点歌人 @{requesterName}</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => handleSendReaction("applause")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-surface/60 hover:bg-surface text-foreground transition-all active:scale-95 border border-transparent hover:border-surface-border"
        >
          <ApplauseIcon className="w-3.5 h-3.5 text-[#f59e0b]" />
          <span>致谢房主</span>
        </button>

        {isHost && (
          <button
            type="button"
            onClick={() => handleSendReaction("sparkle")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-accent/15 hover:bg-accent/25 text-accent transition-all active:scale-95"
          >
            <SparklesIcon className="w-3.5 h-3.5" />
            <span>房主精选点赞</span>
          </button>
        )}
      </div>
    );
  }

  if (variant === "radio") {
    return (
      <div className={`flex items-center gap-2 p-1.5 rounded-2xl bg-surface/40 backdrop-blur-xl ${className}`}>
        <button
          type="button"
          onClick={() => handleSendReaction("fire")}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-surface hover:bg-surface-hover text-foreground transition-all active:scale-95"
        >
          <MicIcon className="w-3.5 h-3.5 text-accent" />
          <span>为主理人打 Call</span>
        </button>

        <button
          type="button"
          onClick={() => handleSendReaction("like")}
          className="p-2 rounded-xl bg-surface hover:bg-surface-hover text-foreground transition-all active:scale-95"
          title="喜欢这首歌"
        >
          <HeartIcon className="w-4 h-4 text-[#fa233b]" />
        </button>

        <button
          type="button"
          onClick={() => handleSendReaction("sparkle")}
          className="p-2 rounded-xl bg-surface hover:bg-surface-hover text-foreground transition-all active:scale-95"
          title="送光芒"
        >
          <SparklesIcon className="w-4 h-4 text-[#a855f7]" />
        </button>
      </div>
    );
  }

  // Default: Interactive Room Floating Bar
  return (
    <div
      aria-label="实时房间互动"
      className={`inline-flex items-center gap-1 p-1 rounded-full bg-surface/50 backdrop-blur-xl shadow-lg transition-all ${className}`}
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
      className={`flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full transition-all duration-150 hover:bg-white/[0.08] active:scale-90 ${
        isActive ? "scale-125 bg-white/10" : ""
      }`}
    >
      {icon}
    </button>
  );
}
