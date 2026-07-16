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
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [credentialsJson, setCredentialsJson] = useState("");
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [results, setResults] = useState<SpotifyTrackCandidate[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setAccount(null);
      setIsConfiguring(false);
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

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingAction || !clientId.trim() || !clientSecret.trim() || !credentialsJson.trim()) {
      return;
    }
    setPendingAction("save-account");
    setErrorMessage(null);
    try {
      const nextAccount = await musicRoomApi.saveSpotifyAccount({
        clientId,
        clientSecret,
        credentialsJson
      });
      setAccount(nextAccount);
      setClientSecret("");
      setCredentialsJson("");
      setIsConfiguring(false);
      setResults([]);
    } catch (error) {
      setErrorMessage(toSpotifyErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const disconnect = async () => {
    if (pendingAction) return;
    setPendingAction("disconnect-account");
    setErrorMessage(null);
    try {
      await musicRoomApi.disconnectSpotifyAccount();
      setAccount(null);
      setClientId("");
      setClientSecret("");
      setCredentialsJson("");
      setIsConfiguring(false);
      setResults([]);
    } catch (error) {
      setErrorMessage(toSpotifyErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const readCredentialsFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setCredentialsJson(await file.text());
      setErrorMessage(null);
    } catch {
      setErrorMessage("无法读取 credentials.json。 ");
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface/30 p-4 sm:p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Spotify</h2>
          <p className="mt-1 text-xs text-foreground-muted">当前用户的 Spotify 配置</p>
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

      {!account?.connected || isConfiguring ? (
        <form className="flex flex-col gap-3 rounded-lg border border-surface-border bg-black/20 p-3" onSubmit={saveAccount}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              Client ID
              <input
                autoComplete="off"
                className="rounded-lg border border-white/15 bg-[#111113] px-3 py-2 text-sm text-zinc-100 caret-white outline-none placeholder:text-zinc-500 focus:border-accent focus:ring-2 focus:ring-accent/25"
                onChange={(event) => setClientId(event.target.value)}
                placeholder="Spotify Client ID"
                value={clientId}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-foreground-muted">
              Client Secret
              <input
                autoComplete="new-password"
                className="rounded-lg border border-white/15 bg-[#111113] px-3 py-2 text-sm text-zinc-100 caret-white outline-none placeholder:text-zinc-500 focus:border-accent focus:ring-2 focus:ring-accent/25"
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder="Spotify Client Secret"
                type="password"
                value={clientSecret}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-foreground-muted">
            credentials.json
            <input
              accept="application/json,.json"
              className="rounded-lg border border-white/15 bg-[#111113] px-3 py-2 text-sm text-zinc-200 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-xs file:text-zinc-100"
              style={{ colorScheme: "dark" }}
              onChange={(event) => void readCredentialsFile(event.target.files?.[0])}
              type="file"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-foreground-muted">
              {credentialsJson ? "credentials.json 已读取" : "请选择 credentials.json"}
            </span>
            <div className="flex flex-wrap gap-2">
              {isConfiguring ? (
                <Button
                  disabled={pendingAction !== null}
                  onClick={() => setIsConfiguring(false)}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
              ) : null}
              <Button
                disabled={pendingAction !== null || !clientId.trim() || !clientSecret.trim() || !credentialsJson.trim()}
                type="submit"
              >
                {pendingAction === "save-account" ? "保存中…" : "保存并连接"}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
          <span className="text-xs text-emerald-200">配置已保存，密钥不会回显。</span>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pendingAction !== null}
              onClick={() => setIsConfiguring(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              修改配置
            </Button>
            <Button
              disabled={pendingAction !== null}
              onClick={() => void disconnect()}
              size="sm"
              type="button"
              variant="outline"
            >
              {pendingAction === "disconnect-account" ? "删除中…" : "删除配置"}
            </Button>
          </div>
        </div>
      )}

      {!account?.connected || isConfiguring ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-200">
          {account?.message ?? "正在检查服务端 Spotify 配置…"}
        </div>
      ) : (
        <>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={searchTracks}>
            <input
              aria-label="搜索 Spotify"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-[#111113] px-3 py-2 text-sm text-zinc-100 caret-white outline-none placeholder:text-zinc-500 focus:border-accent focus:ring-2 focus:ring-accent/25"
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
    if (error.code === "SPOTIFY_ACCOUNT_REQUIRED") return "请先配置 Spotify 凭证。";
    if (error.code === "SPOTIFY_AUTH_EXPIRED") return "Spotify 凭证已失效，请重新生成。";
    if (error.code === "SPOTIFY_DISABLED") return "Spotify 功能当前未启用。";
    if (error.code === "SPOTIFY_DOWNLOAD_FAILED") return "Spotify 音频下载失败，请重试。";
    if (error.code === "SPOTIFY_IMPORT_TOO_LARGE") return "歌曲文件过大，无法导入。";
    return error.message;
  }
  return error instanceof Error ? error.message : "Spotify 操作失败，请稍后重试。";
}
