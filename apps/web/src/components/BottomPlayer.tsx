"use client";

import { useTransition } from "react";
import type { GuestSession, RoomSnapshot, TrackMeta } from "@music-room/shared";

type BottomPlayerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  progressMs: number;
  seekDraft: number | null;
  setSeekDraft: (v: number | null) => void;
  audioDurationMs: number;
  volume: number;
  setVolume: (v: number) => void;
  syncProgressFromAudio: () => void;
  syncDurationFromAudio: () => void;
  roomSnapshot: RoomSnapshot | null;
  activeSession: GuestSession | null;
  uploadedTracks: Record<string, { objectUrl: string }>;
  currentTrack: TrackMeta | null;
  currentTrackAvailability: {
    localChunkCount: number;
    totalChunks: number;
  } | null;
  onPlay: () => void;
  onPause: (positionMs: number) => void;
  onSeek: (positionMs: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
};

function formatDuration(durationMs: number) {
  if (!durationMs) return "0:00";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function BottomPlayer({
  audioRef,
  progressMs,
  seekDraft,
  setSeekDraft,
  audioDurationMs,
  volume,
  setVolume,
  syncProgressFromAudio,
  syncDurationFromAudio,
  roomSnapshot,
  activeSession,
  uploadedTracks,
  currentTrackAvailability,
  onPlay,
  onPause,
  onSeek,
  onPrev,
  onNext,
  onEnded
}: BottomPlayerProps) {
  const [isPending, startTransition] = useTransition();

  const playback = roomSnapshot?.room.playback;
  const currentTrackId = playback?.currentTrackId;
  const currentTrack = roomSnapshot?.tracks.find((t) => t.id === currentTrackId) ?? null;
  const canControlPlayback = !!activeSession && roomSnapshot?.room.hostId === activeSession.id;
  const isPlaying = playback?.status === "playing";
  const effectiveProgressMs = seekDraft ?? progressMs;
  const currentTrackDuration = audioDurationMs;
  const progressRatio =
    currentTrackDuration > 0
      ? Math.min(effectiveProgressMs / currentTrackDuration, 1)
      : 0;

  return (
    <footer className={`bottom-player${isPlaying ? " playing" : ""}`}>
      <div className="bottom-progress-rail" aria-hidden="true">
        <div
          className="bottom-progress-fill"
          style={{ width: `${progressRatio * 100}%` }}
        />
      </div>

      {/* Track info */}
      <div className="bp-track-info">
        <div className={`bp-artwork${currentTrack?.artworkUrl ? "" : " is-placeholder"}`}>
          {currentTrack?.artworkUrl ? (
            <img src={currentTrack.artworkUrl} alt="" className="bp-artwork-image" />
          ) : (
            <div className="bp-artwork-fallback" aria-hidden="true">
              <span className="bp-artwork-disc" />
              <span className="bp-artwork-note">♪</span>
            </div>
          )}
        </div>
        <div className="bp-track-copy">
          <p className="player-caption">正在播放</p>
          <h3 className="bp-track-title">{currentTrack?.title ?? "等待播放"}</h3>
          <p className="bp-track-artist">{currentTrack?.artist ?? "从曲库或队列选择曲目"}</p>
        </div>
      </div>

      {/* Playback controls */}
      <div className="bp-controls">
        <button
          className="bp-btn ghost-action inverse"
          disabled={!canControlPlayback || !playback?.currentTrackId}
          onClick={() => startTransition(() => void onPrev())}
          title="前一首"
        >
          ⏮
        </button>
        <button
          className={`bp-btn bp-btn-main ${isPlaying ? "bp-btn-playing" : "bp-btn-paused"}`}
          disabled={!canControlPlayback}
          onClick={() =>
            startTransition(() => void (isPlaying ? onPause(Math.round((audioRef.current?.currentTime ?? 0) * 1000)) : onPlay()))
          }
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <button
          className="bp-btn ghost-action inverse"
          disabled={!canControlPlayback || !playback?.currentTrackId}
          onClick={() => startTransition(() => void onNext())}
          title="下一首"
        >
          ⏭
        </button>
      </div>

      {/* Progress bar */}
      <div className="bp-progress-area">
        <span className="bp-time">{formatDuration(effectiveProgressMs)}</span>
        <div className="progress-shell bp-progress-shell">
          <div className="progress-track-gray" />
          <div
            className="progress-fill"
            style={{ width: `${progressRatio * 100}%` }}
          />
        </div>
        <input
          type="range"
          min={0}
          max={currentTrackDuration || 1}
          step={1000}
          value={effectiveProgressMs}
          className="progress-slider bp-slider"
          disabled={!currentTrackDuration || !canControlPlayback}
          onChange={(e) => setSeekDraft(Number(e.target.value))}
          onMouseUp={() => {
            if (seekDraft !== null && canControlPlayback) {
              startTransition(() => void onSeek(seekDraft));
              setSeekDraft(null);
            }
          }}
          onTouchEnd={() => {
            if (seekDraft !== null && canControlPlayback) {
              startTransition(() => void onSeek(seekDraft));
              setSeekDraft(null);
            }
          }}
        />
        <span className="bp-time">{formatDuration(currentTrackDuration)}</span>
      </div>

      {/* Status notes */}
      <div className="bp-status">
        {!canControlPlayback && roomSnapshot && (
          <span className="bp-note">仅房主可控制播放</span>
        )}
        {!uploadedTracks[currentTrack?.id ?? ""] && currentTrack && (
          <span className="bp-note">本地无文件 · P2P传输中</span>
        )}
        {!uploadedTracks[currentTrack?.id ?? ""] && currentTrackAvailability ? (
          <span className="bp-note">
            缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0} 分片
          </span>
        ) : null}
        <label className="bp-volume" aria-label="音量">
          <span className="bp-volume-icon">🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
      </div>

      <audio
        ref={audioRef}
        className="player-audio hidden"
        onEnded={() => void onEnded()}
        onTimeUpdate={syncProgressFromAudio}
        onLoadedMetadata={(event) => {
          syncDurationFromAudio();
          syncProgressFromAudio();
        }}
        onDurationChange={syncDurationFromAudio}
        onPlay={syncProgressFromAudio}
        onPause={syncProgressFromAudio}
        onSeeked={syncProgressFromAudio}
      />

      {isPending ? <div className="pending-indicator">正在同步房间状态...</div> : null}
    </footer>
  );
}
