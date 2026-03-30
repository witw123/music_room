"use client";

import { useState, useTransition } from "react";
import type { AuthSession, Playlist } from "@music-room/shared";
import { normalizePlaylistTitle } from "@/lib/music-room-ui";
import { Button } from "@/components/ui/button";

type PlaylistPanelProps = {
  playlists: Playlist[];
  activeSession: AuthSession | null;
  canCreatePlaylist: boolean;
  onSavePlaylistFromQueue: (title: string) => Promise<void>;
  onLoadPlaylistIntoRoom: (playlistId: string) => Promise<void>;
  onUpdatePlaylistTitle: (playlistId: string, title: string) => Promise<void>;
  onDeletePlaylist: (playlistId: string) => Promise<void>;
};

export function PlaylistPanel({
  playlists,
  activeSession,
  canCreatePlaylist,
  onSavePlaylistFromQueue,
  onLoadPlaylistIntoRoom,
  onUpdatePlaylistTitle,
  onDeletePlaylist
}: PlaylistPanelProps) {
  const [playlistTitle, setPlaylistTitle] = useState("Tonight Selects");
  const [playlistEditId, setPlaylistEditId] = useState<string | null>(null);
  const [playlistEditTitle, setPlaylistEditTitle] = useState("");
  const [, startTransition] = useTransition();

  return (
    <section className="flex flex-col gap-6 w-full">
      <div className="flex items-end justify-between border-b border-white/5 pb-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-foreground-muted uppercase mb-1">Playlists</p>
          <h2 className="text-lg font-bold text-foreground">歌单馆</h2>
        </div>
        <span className="text-xs font-medium text-foreground-muted bg-surface border border-surface-border px-2 py-0.5 rounded-md">
          {playlists.length} 个
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground-muted">新歌单名称</span>
          <div className="flex gap-2">
            <input
              className="flex-1 w-0 bg-black/40 border border-surface-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted/50 focus:outline-none focus:ring-1 focus:ring-accent transition-all"
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
      </div>

      <div className="flex flex-col gap-3 mt-2">
        {playlists.length > 0 ? (
          playlists.map((playlist) => (
            <div key={playlist.id} className="flex flex-col gap-3 p-4 rounded-xl border border-surface-border hover:border-surface-hover hover:bg-surface/30 transition-colors">
              {playlistEditId === playlist.id ? (
                <>
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground-muted">重命名歌单</span>
                    <input
                      className="w-full bg-black/40 border border-surface-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent transition-all"
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
                    <strong className="text-sm font-semibold text-foreground truncate">{playlist.title}</strong>
                    <p className="text-[10px] text-foreground-muted">
                      {playlist.trackIds.length} 首曲目 · {playlist.isCollaborative ? "协作" : "个人"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-1 border-t border-surface-border pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs px-2 h-7"
                      onClick={() => startTransition(() => void onLoadPlaylistIntoRoom(playlist.id))}
                      type="button"
                    >
                      加入房间
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs px-2 h-7"
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
                      className="text-xs px-2 h-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
          <div className="py-6 px-4 text-center border-2 border-dashed border-surface-border rounded-xl">
             <p className="text-xs text-foreground-muted/70">把当前队列保存成歌单以便日后复用。</p>
          </div>
        )}
      </div>
    </section>
  );
}
