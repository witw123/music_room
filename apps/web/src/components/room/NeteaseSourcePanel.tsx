"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import type {
  AuthSession,
  NeteaseAccountStatus,
  NeteaseTrackCandidate
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import {
  MusicRoomApiError,
  musicRoomApi
} from "@/lib/music-room-api";
import { Button } from "@/components/ui/button";

type NeteaseSourcePanelProps = {
  activeSession: AuthSession | null;
  onImportTrack: (track: NeteaseTrackCandidate) => Promise<void>;
};

export function NeteaseSourcePanel({
  activeSession,
  onImportTrack
}: NeteaseSourcePanelProps) {
  const [account, setAccount] = useState<NeteaseAccountStatus | null>(null);
  const [qrSession, setQrSession] = useState<{
    attemptId: string;
    qrimg: string;
    expiresAt: string;
  } | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<NeteaseTrackCandidate[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setAccount(null);
      return;
    }

    let cancelled = false;
    void musicRoomApi.getNeteaseAccount()
      .then((nextAccount) => {
        if (!cancelled) {
          setAccount(nextAccount);
          setErrorMessage(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(toProviderErrorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  useEffect(() => {
    if (!qrSession) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const status = await musicRoomApi.getNeteaseQrStatus(qrSession.attemptId);
        if (cancelled) return;
        if (status.status === "connected" && status.account) {
          setAccount(status.account);
          setQrSession(null);
          setErrorMessage(null);
          setPendingAction(null);
          return;
        }
        if (status.status === "expired" || status.status === "failed") {
          setQrSession(null);
          setPendingAction(null);
          setErrorMessage(status.message ?? "二维码已失效，请重新生成。");
          return;
        }
        setErrorMessage(null);
        timer = setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(toProviderErrorMessage(error));
          if (shouldStopQrPolling(error)) {
            setQrSession(null);
            setPendingAction(null);
            return;
          }
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [qrSession]);

  if (!activeSession) {
    return null;
  }

  const startQrLogin = async () => {
    setPendingAction("qr");
    setErrorMessage(null);
    try {
      setQrSession(await musicRoomApi.startNeteaseQrLogin());
    } catch (error) {
      setPendingAction(null);
      setErrorMessage(toProviderErrorMessage(error));
    }
  };

  const searchTracks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pendingAction || !account?.connected) return;
    setPendingAction("search");
    setErrorMessage(null);
    try {
      const response = await musicRoomApi.searchNeteaseTracks(query);
      setResults(response.items);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const importTrack = async (track: NeteaseTrackCandidate) => {
    if (pendingAction) return;
    setPendingAction(`import:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      await onImportTrack(track);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const disconnect = async () => {
    if (pendingAction) return;
    setPendingAction("disconnect");
    setErrorMessage(null);
    try {
      await musicRoomApi.disconnectNeteaseAccount();
      setAccount({
        connected: false,
        neteaseUserId: null,
        nickname: null,
        avatarUrl: null,
        lastValidatedAt: null
      });
      setResults([]);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className="flex w-full flex-col gap-4 rounded-xl border border-surface-border bg-surface/40 p-4"
      data-testid="netease-source-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">网易云音乐</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            {account?.connected ? `已绑定 ${account.nickname ?? "网易云账号"}` : "未绑定网易云账号"}
          </p>
        </div>
        {account?.connected ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => void disconnect()}
            type="button"
          >
            解除绑定
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={pendingAction !== null}
            onClick={() => void startQrLogin()}
            type="button"
          >
            {pendingAction === "qr" ? "生成中…" : "扫码绑定"}
          </Button>
        )}
      </div>

      {qrSession ? (
        <div className="flex flex-col items-center gap-3 border-t border-surface-border pt-4 sm:flex-row sm:items-start">
          <Image
            alt="网易云登录二维码"
            className="h-40 w-40 rounded-lg bg-white p-2"
            height={160}
            unoptimized
            src={qrSession.qrimg}
            width={160}
          />
          <div className="flex min-w-0 flex-col gap-2 text-xs text-foreground-muted">
            <span>请使用网易云音乐扫码确认。</span>
            <span>二维码有效期至 {new Date(qrSession.expiresAt).toLocaleTimeString()}</span>
            <Button
              className="self-start"
              variant="ghost"
              size="sm"
              onClick={() => {
                setQrSession(null);
                setPendingAction(null);
              }}
              type="button"
            >
              取消
            </Button>
          </div>
        </div>
      ) : null}

      {account?.connected ? (
        <>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchTracks(event)}>
            <label className="sr-only" htmlFor="netease-search-input">搜索网易云歌曲</label>
            <input
              id="netease-search-input"
              className="min-w-0 flex-1 rounded-lg border border-surface-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="搜索歌曲、歌手或专辑"
              maxLength={100}
              type="search"
            />
            <Button disabled={!keywords.trim() || pendingAction !== null} size="sm" type="submit">
              {pendingAction === "search" ? "搜索中…" : "搜索"}
            </Button>
          </form>

          {results.length > 0 ? (
            <div className="flex flex-col divide-y divide-surface-border overflow-hidden rounded-lg border border-surface-border">
              {results.map((track) => {
                const isImporting = pendingAction === `import:${track.providerTrackId}`;
                return (
                  <article
                    className="flex flex-col gap-3 bg-background/40 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    data-testid="netease-search-result"
                    data-track-id={track.providerTrackId}
                    key={track.providerTrackId}
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-foreground">{track.title}</h3>
                      <p className="truncate text-xs text-foreground-muted">
                        {track.artist} · {track.album ?? "未知专辑"} · {formatDuration(track.durationMs)}
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
          ) : null}
        </>
      ) : null}

      {errorMessage ? (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}

function toProviderErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED") return "请先绑定网易云账号。";
    if (error.code === "NETEASE_AUTH_EXPIRED") return "网易云登录已失效，请重新绑定。";
    if (error.code === "NETEASE_DISABLED") return "网易云功能当前未启用。";
    if (error.code === "RATE_LIMITED") return "二维码请求过于频繁，请一分钟后再试。";
    if (error.code === "NETEASE_IMPORT_TOO_LARGE") return "歌曲文件过大，无法导入。";
    if (error.code === "NETEASE_AUDIO_UNSUPPORTED") return "网易云返回了当前播放器不支持的音频格式。";
    return error.message;
  }
  return error instanceof Error ? error.message : "网易云操作失败，请稍后重试。";
}

function shouldStopQrPolling(error: unknown) {
  if (!(error instanceof MusicRoomApiError)) {
    return false;
  }

  return [
    "UNAUTHORIZED",
    "NETEASE_DISABLED",
    "NETEASE_AUTH_EXPIRED",
    "NETEASE_QR_EXPIRED"
  ].includes(error.code ?? "");
}
