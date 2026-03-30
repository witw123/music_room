"use client";

import { useTransition } from "react";
import type {
  GuestSession,
  RoomMediaConnectionState,
  RoomSnapshot,
  TrackMeta
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { PlayerQueueDrawer } from "@/components/PlayerQueueDrawer";

type BottomPlayerProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
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
  mediaConnectionState: RoomMediaConnectionState;
  mediaConnectedPeersCount: number;
  canReorderQueue: boolean;
  onPlay: () => void;
  onPause: (positionMs: number) => void;
  onSeek: (positionMs: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
  onLocalPlaybackReady: () => void;
  onRemotePlaying: () => void;
  onRemoteWaiting: () => void;
  onRemotePause: () => void;
  onRemoteError: () => void;
  onPlayQueueItem: (queueItemId: string) => Promise<void>;
  onRemoveQueueItem: (queueItemId: string) => Promise<void>;
  onReorderQueue: (queueItemIds: string[]) => Promise<void>;
};

function getMediaStatusLabel(state: RoomMediaConnectionState) {
  switch (state) {
    case "connecting":
      return "正在连接房间音频";
    case "buffering":
      return "正在缓冲直播音频";
    case "live":
      return "已连接直播音频";
    case "reconnecting":
      return "连接中断，正在重试";
    case "failed":
      return "音频连接失败";
    default:
      return "等待房间开始播放";
  }
}

export function BottomPlayer({
  audioRef,
  remoteAudioRef,
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
  currentTrack,
  currentTrackAvailability,
  mediaConnectionState,
  mediaConnectedPeersCount,
  canReorderQueue,
  onPlay,
  onPause,
  onSeek,
  onPrev,
  onNext,
  onEnded,
  onLocalPlaybackReady,
  onRemotePlaying,
  onRemoteWaiting,
  onRemotePause,
  onRemoteError,
  onPlayQueueItem,
  onRemoveQueueItem,
  onReorderQueue
}: BottomPlayerProps) {
  const [isPending, startTransition] = useTransition();
  const playback = roomSnapshot?.room.playback;
  const canControlPlayback = !!activeSession && !!roomSnapshot;
  const isPlaying = playback?.status === "playing";
  const effectiveProgressMs = seekDraft ?? progressMs;
  const currentTrackDuration = audioDurationMs;
  const progressRatio =
    currentTrackDuration > 0 ? Math.min(effectiveProgressMs / currentTrackDuration, 1) : 0;
  const localTrackAvailable = !!uploadedTracks[currentTrack?.id ?? ""];
  const mediaStatusLabel = getMediaStatusLabel(mediaConnectionState);

  return (
    <footer className={`bottom-player${isPlaying ? " playing" : ""}`}>
      <div className="bottom-progress-rail" aria-hidden="true">
        <div className="bottom-progress-fill" style={{ width: `${progressRatio * 100}%` }} />
      </div>

      <div className="bp-track-info">
        <div
          className={`bp-artwork${currentTrack?.artworkUrl ? "" : " is-placeholder"}${
            isPlaying ? " is-rotating" : ""
          }`}
        >
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
          <p className="bp-track-artist">
            {currentTrack?.artist ?? "从曲库或队列里选择一首歌"}
          </p>
        </div>
      </div>

      <div className="bp-controls">
        <button
          className="bp-btn ghost-action inverse"
          disabled={!canControlPlayback || !playback?.currentTrackId}
          onClick={() => startTransition(() => void onPrev())}
          title="上一首"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button
          className={`bp-btn bp-btn-main ${isPlaying ? "bp-btn-playing" : "bp-btn-paused"}`}
          disabled={!canControlPlayback}
          onClick={() =>
            startTransition(() =>
              void (
                isPlaying
                  ? onPause(Math.round((audioRef.current?.currentTime ?? 0) * 1000))
                  : onPlay()
              )
            )
          }
          title={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6zm8-14v14h4V5z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          className="bp-btn ghost-action inverse"
          disabled={!canControlPlayback || !playback?.currentTrackId}
          onClick={() => startTransition(() => void onNext())}
          title="下一首"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6zm10-12v12h2V6z" />
          </svg>
        </button>
      </div>

      <div className="bp-progress-area">
        <span className="bp-time">{formatDuration(effectiveProgressMs)}</span>
        <div className="progress-shell bp-progress-shell">
          <div className="progress-track-gray" />
          <div className="progress-fill" style={{ width: `${progressRatio * 100}%` }} />
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

      <div className="bp-status">
        {!canControlPlayback && roomSnapshot ? <span className="bp-note">{mediaStatusLabel}</span> : null}
        {roomSnapshot?.room.playback.sourceSessionId === activeSession?.id ? (
          <span className="bp-note">正在向 {mediaConnectedPeersCount} 位成员发送音频</span>
        ) : null}
        {!canControlPlayback && !localTrackAvailable && currentTrack ? (
          <span className="bp-note">成员端优先收听房间直播音频</span>
        ) : null}
        {!localTrackAvailable && currentTrackAvailability ? (
          <span className="bp-note">
            缓存 {currentTrackAvailability.localChunkCount}/{currentTrackAvailability.totalChunks || 0} 分片
          </span>
        ) : null}
        <label className="bp-volume" aria-label="音量">
          <span className="bp-volume-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.14v7.72A4.49 4.49 0 0016.5 12zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
            </svg>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        <PlayerQueueDrawer
          queue={roomSnapshot?.queue ?? []}
          tracks={roomSnapshot?.tracks ?? []}
          currentTrackId={roomSnapshot?.room.playback.currentTrackId ?? null}
          activeSessionId={activeSession?.id}
          hostId={roomSnapshot?.room.hostId}
          canControlPlayback={canControlPlayback}
          canReorderQueue={canReorderQueue}
          onPlayQueueItem={onPlayQueueItem}
          onRemoveQueueItem={onRemoveQueueItem}
          onReorderQueue={onReorderQueue}
        />
      </div>

      <audio
        ref={audioRef}
        className="player-audio hidden"
        onEnded={() => void onEnded()}
        onTimeUpdate={syncProgressFromAudio}
        onLoadedMetadata={() => {
          syncDurationFromAudio();
          syncProgressFromAudio();
          onLocalPlaybackReady();
        }}
        onDurationChange={syncDurationFromAudio}
        onPlay={() => {
          syncProgressFromAudio();
          onLocalPlaybackReady();
        }}
        onPause={syncProgressFromAudio}
        onSeeked={syncProgressFromAudio}
      />

      <audio
        ref={remoteAudioRef}
        className="player-audio hidden"
        autoPlay
        playsInline
        onPlaying={onRemotePlaying}
        onWaiting={onRemoteWaiting}
        onPause={onRemotePause}
        onError={onRemoteError}
      />

      {isPending ? <div className="pending-indicator">正在同步房间状态…</div> : null}
    </footer>
  );
}
