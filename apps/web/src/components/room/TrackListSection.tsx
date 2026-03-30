"use client";

import { useTransition } from "react";
import type { TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";

type TrackListSectionProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, { objectUrl: string }>;
  canControlPlayback: boolean;
  onFilesSelected: (files: FileList | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
};

export function TrackListSection({
  tracks,
  uploadedTracks,
  canControlPlayback,
  onFilesSelected,
  onAddToQueue,
  onPlayTrack
}: TrackListSectionProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="workspace-block room-block">
      <div className="block-heading">
        <div>
          <p className="block-kicker">曲库</p>
          <h2>导入本地音乐</h2>
        </div>
        <span>{tracks.length} 首曲目</span>
      </div>

      <label className="drop-zone room-drop-zone">
        <span>拖放音频文件到这里，或点击从设备中选择。</span>
        <input
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(event) => startTransition(() => void onFilesSelected(event.target.files))}
        />
      </label>

      <div className="track-list">
        {tracks.length ? (
          tracks.map((track) => (
            <article key={track.id} className="track-row">
              <div className="track-row-copy">
                <h3>{track.title}</h3>
                <p>
                  {track.artist} · {formatDuration(track.durationMs)} ·{" "}
                  {uploadedTracks[track.id] ? "已缓存" : "房间可用"} · 上传者 {track.ownerNickname}
                </p>
              </div>
              <div className="track-row-actions">
                <button
                  className="ghost-action"
                  onClick={() => startTransition(() => void onAddToQueue(track.id))}
                >
                  入队
                </button>
                <button
                  className="solid-action compact"
                  disabled={!canControlPlayback}
                  onClick={() => startTransition(() => void onPlayTrack(track.id))}
                >
                  立即播放
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="placeholder-copy">
            还没有曲目。先导入本地音频，队列和歌单才会联动起来。
          </p>
        )}
      </div>

      {isPending ? <div className="pending-indicator">正在处理曲库操作…</div> : null}
    </section>
  );
}
