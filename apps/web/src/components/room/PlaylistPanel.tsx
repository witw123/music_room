"use client";

import { useState, useTransition } from "react";
import type { Playlist } from "@music-room/shared";
import { normalizePlaylistTitle } from "@/lib/music-room-ui";

type PlaylistPanelProps = {
  playlists: Playlist[];
  activeSession: { id: string; nickname: string } | null;
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
    <section className="workspace-block room-block room-block-compact playlist-panel">
      <div className="block-heading">
        <div>
          <p className="block-kicker">歌单</p>
          <h2>保存今晚的歌</h2>
        </div>
        <span>{playlists.length} 个歌单</span>
      </div>

      <div className="playlist-create">
        <label className="field-stack">
          <span className="field-label">歌单名称</span>
          <input
            className="hero-input subtle"
            value={playlistTitle}
            onChange={(event) => setPlaylistTitle(event.target.value)}
            placeholder="例如：今晚精选"
          />
        </label>
        <button
          className="solid-action"
          disabled={!activeSession || !canCreatePlaylist}
          onClick={() =>
            startTransition(async () => {
              const nextTitle = normalizePlaylistTitle(playlistTitle);
              await onSavePlaylistFromQueue(nextTitle);
              setPlaylistTitle(nextTitle);
            })
          }
        >
          保存当前队列为歌单
        </button>
      </div>

      <div className="playlist-list">
        {playlists.length ? (
          playlists.map((playlist) => (
            <div key={playlist.id} className="playlist-line">
              {playlistEditId === playlist.id ? (
                <>
                  <label className="field-stack">
                    <span className="field-label">重命名歌单</span>
                    <input
                      className="hero-input subtle"
                      value={playlistEditTitle}
                      onChange={(event) => setPlaylistEditTitle(event.target.value)}
                    />
                  </label>
                  <div className="track-row-actions">
                    <button
                      className="solid-action compact"
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
                    >
                      保存
                    </button>
                    <button
                      className="ghost-action"
                      onClick={() => {
                        setPlaylistEditId(null);
                        setPlaylistEditTitle("");
                      }}
                    >
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <strong>{playlist.title}</strong>
                    <p>
                      {playlist.trackIds.length} 首曲目 · {playlist.isCollaborative ? "协作" : "个人"}
                    </p>
                  </div>
                  <div className="track-row-actions">
                    <button
                      className="solid-action compact"
                      onClick={() =>
                        startTransition(() => void onLoadPlaylistIntoRoom(playlist.id))
                      }
                    >
                      加载到房间
                    </button>
                    <button
                      className="ghost-action"
                      onClick={() => {
                        setPlaylistEditId(playlist.id);
                        setPlaylistEditTitle(playlist.title);
                      }}
                    >
                      重命名
                    </button>
                    <button
                      className="queue-remove"
                      onClick={() => startTransition(() => void onDeletePlaylist(playlist.id))}
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <p className="placeholder-copy">把当前队列保存成歌单，之后可以一键重新加载回房间。</p>
        )}
      </div>
    </section>
  );
}
