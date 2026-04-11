"use client";

import { memo, useTransition } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import type { UploadedTrack } from "@/features/upload/audio-utils";

type TrackListSectionProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  cachedLibraryFileHashes: string[];
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
};

function TrackListSectionBase({
  tracks,
  uploadedTracks,
  cachedLibraryFileHashes,
  canControlPlayback,
  activeSession,
  onFilesSelected,
  onAddToQueue,
  onDeleteTrack,
  onPlayTrack
}: TrackListSectionProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="relative flex w-full flex-col gap-8">
      <label className="group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-accent/20 bg-accent/5 p-8 text-center transition-all hover:border-accent/40 hover:bg-accent/10 sm:p-12">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-surface-border bg-surface text-accent shadow-lg shadow-accent/10 transition-all duration-300 group-hover:scale-110 group-hover:bg-accent group-hover:text-white">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <span className="mb-1 text-base font-semibold text-foreground">导入本地音频</span>
        <span className="text-sm text-foreground-muted">点击选择文件，或直接拖拽到这里</span>
        <input
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(event) => startTransition(() => void onFilesSelected(event.target.files))}
        />
      </label>

      <div className="mt-4 flex flex-col gap-2">
        {tracks.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {tracks.map((track) => {
              const isMine = track.ownerSessionId === activeSession?.userId;
              const uploadedTrack = uploadedTracks[track.id] ?? null;
              const isUploadedLocally = !!uploadedTrack;
              const isInCacheLibrary = cachedLibraryFileHashes.includes(track.fileHash);

              return (
                <article
                  key={track.id}
                  className="group flex flex-col justify-between gap-4 rounded-2xl border border-surface-border bg-surface p-4 transition-all duration-300 hover:bg-surface-hover hover:shadow-md"
                >
                  <div className="min-w-0 space-y-1">
                    <h3 className="truncate font-semibold text-foreground">{track.title}</h3>
                    <p className="truncate text-xs text-foreground-muted">
                      {track.artist}  {formatDuration(track.durationMs)}
                    </p>
                    <p className="mt-1 text-[10px] text-foreground-muted/60">
                      <span
                        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                          isUploadedLocally
                            ? "bg-green-500"
                            : isInCacheLibrary
                              ? "bg-emerald-500"
                            : "bg-blue-500"
                        }`}
                      />
                      {isUploadedLocally
                        ? "本地上传源可直接播放"
                        : isInCacheLibrary
                          ? "已缓存到个人库"
                        : "房间可用"}{" "}
                      {track.ownerNickname} 上传
                    </p>
                  </div>

                  <div
                    className={`mt-auto grid items-center gap-2 ${
                      isMine
                        ? "grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                        : "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]"
                    }`}
                  >
                    {isMine ? (
                      <Button
                        variant="ghost"
                        className="h-10 shrink-0 whitespace-nowrap px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => startTransition(() => void onDeleteTrack(track.id))}
                        type="button"
                      >
                        删除
                      </Button>
                    ) : null}

                    <Button
                      variant="outline"
                      className="h-10 min-w-0 w-full justify-center whitespace-nowrap bg-background/50 px-4"
                      onClick={() => startTransition(() => void onAddToQueue(track.id))}
                      type="button"
                    >
                      加入队列
                    </Button>

                    <Button
                      variant="ghost"
                      className="h-10 w-full shrink-0 px-0 hover:bg-accent/10 hover:text-accent sm:w-12"
                      disabled={!canControlPlayback}
                      onClick={() => void onPlayTrack(track.id)}
                      type="button"
                      title="立即播放"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-surface-border bg-surface/30 px-6 py-12 text-center">
            <p className="mx-auto max-w-sm text-sm text-foreground-muted">
              还没有曲目。先导入本地音乐，之后就可以在队列里协作播放。
            </p>
          </div>
        )}
      </div>

      {isPending ? (
        <div className="animate-fade-in absolute left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 py-1.5 shadow-lg backdrop-blur-md">
          <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
          <span className="text-xs text-foreground">处理中...</span>
        </div>
      ) : null}
    </section>
  );
}

export const TrackListSection = memo(TrackListSectionBase);
