"use client";

import { useTransition } from "react";
import type { TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

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
    <section className="flex flex-col gap-8 relative w-full">
      <div className="flex items-end justify-between border-b border-surface-border pb-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Library</p>
          <h2 className="text-xl md:text-2xl font-bold text-foreground">本地音乐与曲库</h2>
        </div>
        <span className="text-sm font-semibold text-foreground-muted bg-surface border border-surface-border px-3 py-1 rounded-full">
          {tracks.length} 首在库
        </span>
      </div>

      <label className="relative group flex flex-col items-center justify-center p-12 border-2 border-dashed border-accent/20 rounded-2xl bg-accent/5 hover:bg-accent/10 hover:border-accent/40 transition-all cursor-pointer overflow-hidden">
        <div className="w-16 h-16 rounded-full bg-surface border border-surface-border flex items-center justify-center mb-4 text-accent shadow-lg shadow-accent/10 group-hover:scale-110 group-hover:bg-accent group-hover:text-white transition-all duration-300">
           <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        </div>
        <span className="text-base font-semibold text-foreground mb-1">导入本地音频</span>
        <span className="text-sm text-foreground-muted">点击选择或将文件拖至此处</span>
        <input
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(event) => startTransition(() => void onFilesSelected(event.target.files))}
        />
      </label>

      <div className="flex flex-col gap-2 mt-4">
        {tracks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tracks.map((track) => (
              <article key={track.id} className="group bg-surface hover:bg-surface-hover border border-surface-border rounded-2xl p-4 flex flex-col justify-between gap-4 transition-all duration-300 hover:shadow-md">
                <div className="flex flex-col gap-1 min-w-0">
                  <h3 className="font-semibold text-foreground truncate">{track.title}</h3>
                  <p className="text-xs text-foreground-muted truncate">
                    {track.artist} · {formatDuration(track.durationMs)}
                  </p>
                  <p className="text-[10px] text-foreground-muted/60 mt-1">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${uploadedTracks[track.id] ? "bg-green-500" : "bg-blue-500"}`} />
                    {uploadedTracks[track.id] ? "已缓存并准备推送" : "房间可用"} · {track.ownerNickname} 上传
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-auto">
                  <Button
                    variant="outline"
                    className="flex-1 bg-background/50"
                    onClick={() => startTransition(() => void onAddToQueue(track.id))}
                    type="button"
                  >
                    加入队列
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-12 h-10 px-0 hover:bg-accent/10 hover:text-accent"
                    disabled={!canControlPlayback}
                    onClick={() => startTransition(() => void onPlayTrack(track.id))}
                    type="button"
                    title="立即播放"
                  >
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="py-12 px-6 text-center bg-surface/30 rounded-2xl border border-surface-border">
            <p className="text-sm text-foreground-muted max-w-sm mx-auto">还没有曲目在库中。先导入本地音乐，之后可在队列中协作。</p>
          </div>
        )}
      </div>

      {isPending ? (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-surface backdrop-blur-md rounded-full px-4 py-1.5 border border-surface-border shadow-lg flex items-center gap-2 z-50 animate-fade-in">
           <div className="w-2 h-2 rounded-full bg-accent animate-ping" />
           <span className="text-xs text-foreground">处理曲目中...</span>
        </div>
      ) : null}
    </section>
  );
}
