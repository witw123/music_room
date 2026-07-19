"use client";

import { useState, useTransition } from "react";
import type { AuthSession, Playlist, TrackMeta } from "@music-room/shared";
import { normalizePlaylistTitle } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type PlaylistPanelProps = {
  playlists: Playlist[];
  tracks: TrackMeta[];
  activeSession: AuthSession | null;
  canCreatePlaylist: boolean;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onUpdatePlaylistTracks: (playlistId: string, trackIds: string[]) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

export function PlaylistPanel({
  playlists,
  tracks,
  activeSession,
  canCreatePlaylist,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onUpdatePlaylistTitle,
  onUpdatePlaylistTracks,
  onDeletePlaylist
}: PlaylistPanelProps) {
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [playlistEditId, setPlaylistEditId] = useState<string | null>(null);
  const [playlistEditTitle, setPlaylistEditTitle] = useState("");
  const [, startTransition] = useTransition();
  const trackMap = new Map(tracks.map((track) => [track.id, track]));

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex items-end justify-between border-b border-surface-border pb-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Playlists
          </p>
          <h2 className="text-lg font-bold text-foreground">网络歌单</h2>
        </div>
        <span className="rounded-md border border-surface-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground-muted">
          {playlists.length} 个
        </span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground-muted">新歌单名称</span>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-surface-border bg-black/40 px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 transition-[background-color,border-color,box-shadow,color] duration-150 ease-out focus:outline-none focus:ring-1 focus:ring-accent"
            value={playlistTitle}
            onChange={(event) => setPlaylistTitle(event.target.value)}
            placeholder="例如：Tonight Selects"
          />
          <Button
            size="sm"
            disabled={!activeSession || !canCreatePlaylist}
            onClick={() =>
              startTransition(async () => {
                const nextTitle = normalizePlaylistTitle(playlistTitle);
                await onSavePlaylistFromQueue(nextTitle);
                setPlaylistTitle(nextTitle);
              })
            }
            type="button"
          >
            保存
          </Button>
        </div>
      </label>

      <div className="mt-2 flex flex-col gap-3">
        {playlists.length > 0 ? (
          playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="flex flex-col gap-3 rounded-xl border border-surface-border p-4 transition-colors hover:border-surface-hover hover:bg-surface/30"
            >
              {playlistEditId === playlist.id ? (
                <>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground-muted">重命名歌单</span>
                    <input
                      className="w-full rounded-md border border-surface-border bg-black/40 px-3 py-2 text-sm text-foreground transition-[background-color,border-color,box-shadow,color] duration-150 ease-out focus:outline-none focus:ring-1 focus:ring-accent"
                      value={playlistEditTitle}
                      onChange={(event) => setPlaylistEditTitle(event.target.value)}
                    />
                  </label>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPlaylistEditId(null);
                        setPlaylistEditTitle("");
                      }}
                      type="button"
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      disabled={!playlistEditTitle.trim()}
                      onClick={() =>
                        startTransition(async () => {
                          await onUpdatePlaylistTitle(
                            playlist.id,
                            normalizePlaylistTitle(playlistEditTitle, playlist.title)
                          );
                          setPlaylistEditId(null);
                          setPlaylistEditTitle("");
                        })
                      }
                      type="button"
                    >
                      保存
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <strong className="truncate text-sm font-semibold text-foreground">
                      {playlist.title}
                    </strong>
                    <p className="text-[10px] text-foreground-muted">
                      {playlist.trackIds.length} 首曲目 · {playlist.isCollaborative ? "协作" : "个人"}
                    </p>
                  </div>

                  {playlist.trackIds.length > 0 ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-background/40 p-3">
                      {playlist.trackIds.map((trackId) => {
                        const track = trackMap.get(trackId);
                        return (
                          <div key={`${playlist.id}:${trackId}`} className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-foreground">
                                {track?.title ?? trackId}
                              </p>
                              <p className="truncate text-[10px] text-foreground-muted">
                                {track?.artist ?? "曲目信息不可用"}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300"
                              onClick={() =>
                                startTransition(() =>
                                  void onUpdatePlaylistTracks(
                                    playlist.id,
                                    playlist.trackIds.filter((id) => id !== trackId)
                                  )
                                )
                              }
                              type="button"
                            >
                              删歌
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-surface-border px-3 py-2 text-xs text-foreground-muted">
                      这个歌单里还没有曲目。
                    </div>
                  )}

                  <div className="mt-1 flex items-center gap-2 border-t border-surface-border pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 px-2 text-xs"
                      onClick={() => startTransition(() => void onLoadPlaylistIntoRoom(playlist.id))}
                      type="button"
                    >
                      加入房间
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2 text-xs"
                      onClick={() => {
                        setPlaylistEditId(playlist.id);
                        setPlaylistEditTitle(playlist.title);
                      }}
                      type="button"
                    >
                      改名
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      onClick={() => startTransition(() => void onDeletePlaylist(playlist.id))}
                      type="button"
                    >
                      删除
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-xl border-2 border-dashed border-surface-border px-4 py-6 text-center">
            <p className="text-xs text-foreground-muted/70">
              把当前队列保存成歌单，以便之后快速重新载入房间。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
