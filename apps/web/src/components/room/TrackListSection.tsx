"use client";

import { memo, useEffect, useState } from "react";
import type { AuthSession, TrackMeta } from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { listRoomPlaylistTrackIndex, providerTrackKey } from "@/features/playlist/local-playlist";

type TrackListSectionProps = {
  tracks: TrackMeta[];
  uploadedTracks: Record<string, UploadedTrack>;
  localSavedFileHashes: string[];
  canControlPlayback: boolean;
  canManageAllTracks?: boolean;
  activeSession: AuthSession | null;
  onFilesSelected: (files: FileList | File[] | null) => Promise<void>;
  onAddToQueue: (trackId: string) => Promise<unknown>;
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
  canManageAllTracks,
  activeSession,
  onFilesSelected,
  onAddToQueue,
  onSaveTrackToLocal,
  onDeleteTrack,
  onPlayTrack
}: TrackListSectionProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [trackFilter, setTrackFilter] = useState<LibraryTrackFilter>("all");
  const [cachedArtworkByTrackId, setCachedArtworkByTrackId] = useState<Map<string, string>>(new Map());
  const activeSessionUserId = activeSession?.userId;
  const ownTrackCount = tracks.filter((track) => track.ownerSessionId === activeSessionUserId).length;
  const otherTrackCount = tracks.length - ownTrackCount;
  const visibleTracks = filterLibraryTracks(tracks, activeSessionUserId, trackFilter);

  useEffect(() => {
    let cancelled = false;
    void listRoomPlaylistTrackIndex()
      .then((index) => {
        if (cancelled) return;
        const artworkByTrackId = new Map<string, string>();
        for (const [trackId, record] of index) {
          if (record.artworkUrl) artworkByTrackId.set(trackId, record.artworkUrl);
          if (record.providerTrackId && (record.provider === "netease" || record.provider === "qqmusic") && record.artworkUrl) {
            artworkByTrackId.set(providerTrackKey(record.provider, record.providerTrackId), record.artworkUrl);
          }
        }
        setCachedArtworkByTrackId(artworkByTrackId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const runAction = async (key: string, action: () => Promise<unknown>) => {
    if (pendingAction) return;
    setPendingAction(key);
    try {
      await action();
    } finally {
      setPendingAction(null);
    }
  };
  return (
    <section className="relative flex w-full flex-col gap-3">
      <label className="group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-accent/20 bg-accent/5 p-4 text-center transition-[background-color,border-color,box-shadow] duration-200 ease-out hover:border-accent/40 hover:bg-accent/10 sm:p-5">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface text-accent shadow-lg shadow-accent/10 transition-[background-color,color,transform] duration-200 ease-out group-hover:scale-105 group-hover:bg-accent group-hover:text-white">
          <svg
            width="21"
            height="21"
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
        <span className="mb-1 text-sm font-semibold text-foreground">导入本地音频</span>
        <span className="text-xs text-foreground-muted">点击选择文件，或直接拖拽到这里</span>
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

      <div className="border-b border-surface-border pb-1">
        <div
          aria-label="曲库来源筛选"
          className="grid w-full grid-cols-3 gap-1 rounded-lg border border-surface-border bg-surface/60 p-1"
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
              className={`flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition-colors sm:px-2.5 ${
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

      <div className="flex flex-col gap-1.5">
        {visibleTracks.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-surface-border bg-surface">
            {visibleTracks.map((track) => {
              const canDeleteTrack = canDeleteLibraryTrack({
                track,
                activeSessionUserId: activeSession?.userId,
                isHost: canManageAllTracks
              });
              const uploadedTrack = uploadedTracks[track.id] ?? null;
              const isUploadedLocally = !!uploadedTrack;
              const isSavedLocally = localSavedFileHashes.includes(track.fileHash);
              const canSaveLocalTrack = !!activeSession && (
                track.ownerSessionId === activeSession.userId ||
                (track.sourceType !== "local_upload" && !!track.sourceRef)
              );
              const cachedArtworkKey = track.sourceRef
                ? providerTrackKey(track.sourceRef.provider, track.sourceRef.trackId)
                : track.id;
              const artworkUrl = track.artworkUrl ?? cachedArtworkByTrackId.get(cachedArtworkKey) ?? null;

              return (
                <article
                  key={track.id}
                  data-testid="track-card"
                  data-track-id={track.id}
                  className="group grid grid-cols-[2.75rem_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-2 gap-y-0.5 border-b border-surface-border px-2.5 py-2.5 transition-colors last:border-b-0 hover:bg-surface-hover sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-x-3 sm:px-3.5"
                >
                  <div className="row-span-2">
                    <TrackArtwork artworkUrl={artworkUrl} title={track.title} />
                  </div>

                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-foreground">{track.title}</h3>
                  </div>

                  <div className="col-start-3 row-span-2 flex min-w-max self-center justify-self-end flex-nowrap items-center justify-end gap-0.5 sm:gap-1">
                    <Button
                      data-testid="track-play-button"
                      data-track-id={track.id}
                      variant="ghost"
                      className="h-8 w-7 shrink-0 !rounded-none bg-transparent p-0 !text-accent hover:bg-transparent hover:!text-accent disabled:opacity-100 disabled:!text-accent/45 sm:w-8"
                      disabled={!canControlPlayback || pendingAction !== null}
                      onClick={() => void runAction(`play:${track.id}`, () => onPlayTrack(track.id))}
                      type="button"
                      aria-label={`播放《${track.title}》`}
                      title="立即播放"
                      size="icon"
                    >
                      <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
                        <path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10-6.8a1.1 1.1 0 0 0 0-1.8l-10-6.8C8.9 3.9 8 4.4 8 5.2Z" />
                      </svg>
                    </Button>

                    {canDeleteTrack ? (
                      <Button
                        data-testid="track-delete-button"
                        data-track-id={track.id}
                        variant="ghost"
                        className="h-8 w-7 shrink-0 !rounded-none bg-transparent p-0 text-destructive hover:bg-transparent hover:text-destructive sm:w-8"
                        disabled={pendingAction !== null}
                        onClick={() =>
                          void runAction(`delete:${track.id}`, () => onDeleteTrack(track.id))
                        }
                        aria-label={`删除《${track.title}》`}
                        title="删除"
                        type="button"
                        size="icon"
                      >
                        <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                      </Button>
                    ) : null}

                    {canSaveLocalTrack ? (
                      <Button
                        data-testid="track-save-local-button"
                        data-track-id={track.id}
                        variant="ghost"
                        className={`h-8 w-7 shrink-0 !rounded-none bg-transparent p-0 hover:bg-transparent sm:w-8 ${isSavedLocally ? "text-accent hover:text-accent" : ""}`}
                        disabled={pendingAction !== null}
                        onClick={() => void runAction(`save:${track.id}`, () => onSaveTrackToLocal(track))}
                        aria-label={isSavedLocally ? `《${track.title}》已保存到本地` : `保存《${track.title}》到本地`}
                        title={isSavedLocally ? "已保存到本地" : "保存到本地"}
                        type="button"
                        size="icon"
                      >
                        {isSavedLocally ? (
                          <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="m5 12 4 4L19 6" /></svg>
                        ) : (
                          <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h8V4" /><path d="M8 20v-5h8v5" /></svg>
                        )}
                      </Button>
                    ) : null}

                    <Button
                      data-testid="track-add-queue-button"
                      data-track-id={track.id}
                      variant="ghost"
                      className="h-8 w-7 shrink-0 !rounded-none bg-transparent p-0 hover:bg-transparent hover:text-foreground sm:w-8"
                      disabled={pendingAction !== null}
                      onClick={() => void runAction(`queue:${track.id}`, () => onAddToQueue(track.id))}
                      aria-label={`将《${track.title}》加入队列`}
                      title="加入队列"
                      type="button"
                      size="icon"
                    >
                      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16"><path d="M12 5v14M5 12h14" /></svg>
                    </Button>

                  </div>

                  <div className="col-start-2 col-end-3 min-w-0 space-y-0.5">
                    <p className="flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
                      <span className="min-w-0 max-w-[40%] truncate">{track.artist}</span>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 max-w-[45%] truncate">{track.album ?? "未知专辑"}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0 tabular-nums">{formatDuration(track.durationMs)}</span>
                    </p>
                    <p className="truncate text-[10px] text-foreground-muted/60">
                      <span
                        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                          isUploadedLocally
                            ? "bg-green-500"
                            : "bg-blue-500"
                        }`}
                      />
                      {track.ownerNickname} 上传
                    </p>
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

function TrackArtwork({ artworkUrl, title }: { artworkUrl: string | null; title: string }) {
  return (
    <div
      aria-label={`${title} 封面`}
      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-surface-border bg-background text-sm font-semibold text-foreground-muted"
      style={artworkUrl ? { backgroundImage: `url(${artworkUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
    >
      {!artworkUrl ? title.slice(0, 1).toUpperCase() : null}
    </div>
  );
}

export function canDeleteLibraryTrack(input: {
  track: Pick<TrackMeta, "ownerSessionId">;
  activeSessionUserId: string | null | undefined;
  isHost?: boolean;
}) {
  return !!(
    input.activeSessionUserId &&
    (input.isHost || input.track.ownerSessionId === input.activeSessionUserId)
  );
}
