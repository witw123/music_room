"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  AuthSession,
  SpotifyAccountStatus,
  SpotifyTrackCandidate
} from "@music-room/shared";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/music-room-ui";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";

type SpotifySourcePanelProps = {
  activeSession: AuthSession | null;
  onImportTrack: (track: SpotifyTrackCandidate) => Promise<void>;
};

export function SpotifySourcePanel({
  activeSession,
  onImportTrack
}: SpotifySourcePanelProps) {
  const [account, setAccount] = useState<SpotifyAccountStatus | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<SpotifyTrackCandidate[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setAccount(null);
      return;
    }

    let cancelled = false;
    void musicRoomApi
      .getSpotifyAccount()
      .then((nextAccount) => {
        if (!cancelled) {
          setAccount(nextAccount);
          setErrorMessage(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(toSpotifyErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  if (!activeSession) {
    return null;
  }

  const searchTracks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pendingAction || !account?.connected) return;
    setPendingAction("search");
    setErrorMessage(null);
    try {
      const response = await musicRoomApi.searchSpotifyTracks(query);
      setResults(response.items);
    } catch (error) {
      setErrorMessage(toSpotifyErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const importTrack = async (track: SpotifyTrackCandidate) => {
    if (pendingAction) return;
    setPendingAction(`import:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      await onImportTrack(track);
    } catch (error) {
      setErrorMessage(toSpotifyErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface/30 p-4 sm:p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Spotify</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            服务端使用已配置的 Spotify 凭证下载完整音频。
          </p>
        </div>
        <span
          className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-medium ${
            account?.connected
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-amber-400/10 text-amber-300"
          }`}
        >
          {account?.connected ? "已连接" : "未就绪"}
        </span>
      </div>

      {!account?.connected ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-200">
          {account?.message ?? "正在检查服务端 Spotify 配置…"}
        </div>
      ) : (
        <>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={searchTracks}>
            <input
              aria-label="搜索 Spotify"
              className="min-w-0 flex-1 rounded-lg border border-surface-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-accent"
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="搜索歌曲、艺人或专辑"
              value={keywords}
            />
            <Button disabled={pendingAction !== null || !keywords.trim()} type="submit">
              {pendingAction === "search" ? "搜索中…" : "搜索"}
            </Button>
          </form>

          {results.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-surface-border">
              <div className="flex items-center justify-between border-b border-surface-border px-3 py-2 text-xs text-foreground-muted">
                <span>搜索结果</span>
                <span className="font-mono tabular-nums">{results.length} 首</span>
              </div>
              <div className="flex max-h-[min(32rem,58dvh)] flex-col divide-y divide-surface-border overflow-y-auto">
                {results.map((track) => {
                  const isImporting = pendingAction === `import:${track.providerTrackId}`;
                  return (
                    <article
                      className="flex min-h-[76px] flex-col gap-3 bg-background/40 px-3 py-3 transition-colors hover:bg-surface-hover/60 sm:flex-row sm:items-center sm:justify-between"
                      data-testid="spotify-search-result"
                      data-track-id={track.providerTrackId}
                      key={track.providerTrackId}
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium text-foreground">
                          {track.title}
                        </h3>
                        <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
                          <span className="min-w-0 truncate">
                            {track.artist} · {track.album ?? "未知专辑"}
                          </span>
                          <span className="shrink-0 font-mono tabular-nums text-foreground/70">
                            {formatDuration(track.durationMs)}
                          </span>
                        </p>
                        <p className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-medium text-foreground-muted">
                          <span className="rounded bg-white/[0.06] px-1.5 py-0.5">
                            {track.quality ?? "标准"}
                          </span>
                          {track.explicit ? (
                            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-300">
                              显式
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <Button
                        className="shrink-0 self-start sm:self-auto"
                        disabled={pendingAction !== null}
                        onClick={() => void importTrack(track)}
                        size="sm"
                        type="button"
                      >
                        {isImporting ? "导入中…" : "导入曲库"}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}

      {errorMessage ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}

function toSpotifyErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "SPOTIFY_ACCOUNT_REQUIRED") return "请先在服务端配置 Spotify 凭证。";
    if (error.code === "SPOTIFY_AUTH_EXPIRED") return "Spotify 凭证已失效，请重新生成。";
    if (error.code === "SPOTIFY_DISABLED") return "Spotify 功能当前未启用。";
    if (error.code === "SPOTIFY_DOWNLOAD_FAILED") return "Spotify 音频下载失败，请重试。";
    if (error.code === "SPOTIFY_IMPORT_TOO_LARGE") return "歌曲文件过大，无法导入。";
    return error.message;
  }
  return error instanceof Error ? error.message : "Spotify 操作失败，请稍后重试。";
}
