"use client";

import { memo, useState } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import type { UploadedTrack } from "@/features/upload/audio-utils";

type TrackListSectionProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  localSavedFileHashes: string[];
  canControlPlayback: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<void>;
  onSaveTrackToLocal: (track: TrackMeta) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onPlayTrack: (trackId: string) => Promise<void>;
};

export type LibraryTrackFilter = "all" | "mine" | "others";

export function filterLibraryTracks<T extends Pick<TrackMeta, "ownerSessionId">>(
  tracks: T[],
  activeSessionUserId: string | null | undefined,
  filter: LibraryTrackFilter
) {
  if (filter === "all") return tracks;

  return tracks.filter((track) =>
    filter === "mine"
      ? track.ownerSessionId === activeSessionUserId
      : track.ownerSessionId !== activeSessionUserId
  );
}

function TrackListSectionBase({
  tracks,
  uploadedTracks,
  localSavedFileHashes,
  canControlPlayback,
  activeSession,
  onFilesSelected,
  onAddToQueue,
  onSaveTrackToLocal,
  onDeleteTrack,
  onPlayTrack
}: TrackListSectionProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [trackFilter, setTrackFilter] = useState<LibraryTrackFilter>("all");
  const activeSessionUserId = activeSession?.userId;
  const ownTrackCount = tracks.filter((track) => track.ownerSessionId === activeSessionUserId).length;
  const otherTrackCount = tracks.length - ownTrackCount;
  const visibleTracks = filterLibraryTracks(tracks, activeSessionUserId, trackFilter);
  const runAction = async (key: string, action: () => Promise<void>) => {
    if (pendingAction) return;
    setPendingAction(key);
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  };
  return (
    <section className="relative flex w-full flex-col gap-8">
      <label className="group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-accent/20 bg-accent/5 p-8 text-center transition-[background-color,border-color,box-shadow] duration-200 ease-out hover:border-accent/40 hover:bg-accent/10 sm:p-12">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-surface-border bg-surface text-accent shadow-lg shadow-accent/10 transition-[background-color,color,transform] duration-200 ease-out group-hover:scale-105 group-hover:bg-accent group-hover:text-white">
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
          data-testid="track-upload-input"
          type="file"
          accept=".flac,.wav,.mp3,audio/flac,audio/wav,audio/x-wav,audio/mpeg,audio/mp3"
          multiple
          className="hidden"
          disabled={pendingAction !== null}
          onChange={(event) => void runAction("upload", () => onFilesSelected(event.target.files))}
        />
      </label>

      <div className="flex flex-col gap-3 border-b border-surface-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">曲库来源</p>
          <p className="mt-1 text-[10px] text-foreground-muted">按上传成员筛选房间里的歌曲</p>
        </div>
        <div
          aria-label="曲库来源筛选"
          className="grid grid-cols-3 gap-1 rounded-lg border border-surface-border bg-surface/60 p-1 sm:min-w-[330px]"
          role="group"
        >
          {[
            { value: "all" as const, label: "全部歌曲", count: tracks.length },
            { value: "mine" as const, label: "本人上传", count: ownTrackCount },
            { value: "others" as const, label: "其他成员", count: otherTrackCount }
          ].map((option) => (
            <button
              key={option.value}
              aria-pressed={trackFilter === option.value}
              data-testid={`library-filter-${option.value}`}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[11px] font-semibold transition-colors sm:px-3 ${
                trackFilter === option.value
                  ? "bg-accent text-white shadow-sm"
                  : "text-foreground-muted hover:bg-surface-hover hover:text-foreground"
              }`}
              onClick={() => setTrackFilter(option.value)}
              type="button"
            >
              <span className="truncate">{option.label}</span>
              <span
                className={`font-mono text-[10px] ${
                  trackFilter === option.value ? "text-white/75" : "text-foreground-muted/70"
                }`}
              >
                {option.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {visibleTracks.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-surface-border bg-surface">
            {visibleTracks.map((track) => {
              const canDeleteTrack = canDeleteLibraryTrack({
                track,
                activeSessionUserId: activeSession?.userId
              });
              const uploadedTrack = uploadedTracks[track.id] ?? null;
              const isUploadedLocally = !!uploadedTrack;
              const isSavedLocally = localSavedFileHashes.includes(track.fileHash);
              const canSaveLocalTrack = track.ownerSessionId === activeSession?.userId || isSavedLocally;

              return (
                <article
                  key={track.id}
                  data-testid="track-card"
                  data-track-id={track.id}
                  className="group grid gap-4 border-b border-surface-border px-4 py-4 transition-colors last:border-b-0 hover:bg-surface-hover lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_auto] lg:items-center"
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
                            : "bg-blue-500"
                        }`}
                      />
                      {isSavedLocally
                        ? "已保存到本地文件夹"
                        : isUploadedLocally
                          ? "浏览器已缓存源文件"
                        : "房间可用"}{" "}
                      {track.ownerNickname} 上传
                    </p>
                  </div>

                  <div className="min-w-0 text-xs text-foreground-muted">
                    <p className="truncate">
                      {isUploadedLocally ? "本机上传源" : "房间歌曲"}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-foreground-muted/70">
                      仅保存本人上传歌曲
                    </p>
                  </div>

                  <div
                    className="flex flex-wrap items-center justify-end gap-2"
                  >
                    {canDeleteTrack ? (
                      <Button
                        data-testid="track-delete-button"
                        data-track-id={track.id}
                        variant="ghost"
                        className="h-9 shrink-0 whitespace-nowrap px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={pendingAction !== null}
                        onClick={() =>
                          void runAction(`delete:${track.id}`, () => onDeleteTrack(track.id))
                        }
                        type="button"
                      >
                        删除
                      </Button>
                    ) : null}

                    {canSaveLocalTrack ? (
                      <Button
                        data-testid="track-save-local-button"
                        data-track-id={track.id}
                        variant={isSavedLocally ? "ghost" : "outline"}
                        className="h-9 shrink-0 whitespace-nowrap px-3"
                        disabled={pendingAction !== null}
                        onClick={() => void runAction(`save:${track.id}`, () => onSaveTrackToLocal(track))}
                        type="button"
                      >
                        {isSavedLocally ? "已保存" : "保存到本地"}
                      </Button>
                    ) : null}

                    <Button
                      data-testid="track-add-queue-button"
                      data-track-id={track.id}
                      variant="outline"
                      className="h-9 shrink-0 justify-center whitespace-nowrap bg-background/50 px-3"
                      disabled={pendingAction !== null}
                      onClick={() => void runAction(`queue:${track.id}`, () => onAddToQueue(track.id))}
                      type="button"
                    >
                      加入队列
                    </Button>

                    <Button
                      data-testid="track-play-button"
                      data-track-id={track.id}
                      variant="ghost"
                      className="h-9 w-9 shrink-0 px-0 hover:bg-accent/10 hover:text-accent"
                      disabled={!canControlPlayback || pendingAction !== null}
                      onClick={() => void runAction(`play:${track.id}`, () => onPlayTrack(track.id))}
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
              {tracks.length === 0
                ? "还没有曲目。先导入本地音乐，之后就可以在队列里协作播放。"
                : trackFilter === "mine"
                  ? "你还没有上传歌曲。导入本地音乐后，它会出现在这里。"
                  : "暂无其他成员上传的歌曲。"
              }
            </p>
          </div>
        )}
      </div>

      {pendingAction ? (
        <div className="animate-fade-in absolute left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-surface-border bg-surface px-4 py-1.5 shadow-lg backdrop-blur-md">
          <div className="h-2 w-2 animate-ping rounded-full bg-accent" />
          <span className="text-xs text-foreground">处理中...</span>
        </div>
      ) : null}
    </section>
  );
}

export const TrackListSection = memo(TrackListSectionBase);

export function canDeleteLibraryTrack(input: {
  track: Pick<TrackMeta, "ownerSessionId">;
  activeSessionUserId: string | null | undefined;
}) {
  return !!(
    input.activeSessionUserId && input.track.ownerSessionId === input.activeSessionUserId
  );
}
