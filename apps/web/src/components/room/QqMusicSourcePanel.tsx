"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import type {
  AuthSession,
  QqMusicAccountStatus,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import {
  MusicRoomApiError,
  musicRoomApi
} from "@/lib/music-room-api";
import { Button } from "@/components/ui/button";
import {
  getCachedProviderAccount,
  setCachedProviderAccount
} from "@/features/workspace/page-data-cache";

const qualityLabels = {
  standard: "标准",
  high: "高品",
  exhigh: "极高",
  lossless: "无损",
  hires: "Hi-Res"
} as const;

const accessLabels = {
  free: "免费",
  vip: "VIP",
  paid: "付费"
} as const;

type QqMusicSourcePanelProps = {
  activeSession: AuthSession | null;
  onImportTrack?: (track: QqMusicTrackCandidate) => Promise<void>;
  mode?: "full" | "account";
};

export function QqMusicSourcePanel({
  activeSession,
  onImportTrack,
  mode = "full"
}: QqMusicSourcePanelProps) {
  const [account, setAccount] = useState<QqMusicAccountStatus | null>(() =>
    activeSession ? getCachedProviderAccount(activeSession.userId, "qqmusic") ?? null : null
  );
  const [qrSession, setQrSession] = useState<{
    attemptId: string;
    qrimg: string;
    expiresAt: string;
  } | null>(null);
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<QqMusicTrackCandidate[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSession) {
      setAccount(null);
      return;
    }

    let cancelled = false;
    void musicRoomApi.getQqMusicAccount()
      .then((nextAccount) => {
        if (!cancelled) {
          setCachedProviderAccount(activeSession.userId, "qqmusic", nextAccount);
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
    if (!qrSession || !activeSession) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const status = await musicRoomApi.getQqMusicQrStatus(qrSession.attemptId);
        if (cancelled) return;
        if (status.status === "connected" && status.account) {
          setAccount(status.account);
          setCachedProviderAccount(activeSession.userId, "qqmusic", status.account);
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
  }, [activeSession, qrSession]);

  if (!activeSession) {
    return null;
  }

  const displayedAccount = account ?? (
    activeSession ? getCachedProviderAccount(activeSession.userId, "qqmusic") ?? null : null
  );

  const startQrLogin = async () => {
    setPendingAction("qr");
    setErrorMessage(null);
    try {
      setQrSession(await musicRoomApi.startQqMusicQrLogin());
    } catch (error) {
      setPendingAction(null);
      setErrorMessage(toProviderErrorMessage(error));
    }
  };

  const searchTracks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pendingAction || !displayedAccount?.connected) return;
    setPendingAction("search");
    setErrorMessage(null);
    try {
      const response = await musicRoomApi.searchQqMusicTracks(query);
      setResults(response.items);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const importTrack = async (track: QqMusicTrackCandidate) => {
    if (pendingAction) return;
    setPendingAction(`import:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      if (!onImportTrack) return;
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
      await musicRoomApi.disconnectQqMusicAccount();
      setAccount({
        connected: false,
        qqMusicUserId: null,
        nickname: null,
        avatarUrl: null,
        lastValidatedAt: null
      });
      setCachedProviderAccount(activeSession.userId, "qqmusic", {
        connected: false,
        qqMusicUserId: null,
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
      className="flex w-full min-w-0 flex-col gap-4 rounded-xl border border-surface-border bg-surface/40 p-3 sm:p-4"
      data-testid="qqmusic-source-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">QQ 音乐</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            {displayedAccount?.connected ? `已绑定 ${displayedAccount.nickname ?? "QQ 音乐账号"}` : "未绑定 QQ 音乐账号"}
          </p>
        </div>
        {displayedAccount?.connected ? (
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
            alt="QQ 音乐登录二维码"
            className="h-40 w-40 rounded-lg bg-white p-2"
            height={160}
            unoptimized
            src={qrSession.qrimg}
            width={160}
          />
          <div className="flex min-w-0 flex-col gap-2 text-xs text-foreground-muted">
            <span>请使用 QQ 音乐扫码确认。</span>
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

      {mode !== "account" && displayedAccount?.connected ? (
        <>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchTracks(event)}>
            <label className="sr-only" htmlFor="qqmusic-search-input">搜索 QQ 音乐歌曲</label>
            <input
              id="qqmusic-search-input"
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
            <div className="flex items-center justify-between text-[11px] text-foreground-muted">
              <span>搜索结果</span>
              <span className="font-mono tabular-nums">{results.length} 首</span>
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="qqmusic-results-scroll max-h-[min(28rem,52dvh)] overflow-y-auto overscroll-contain rounded-lg border border-surface-border sm:max-h-[min(32rem,58dvh)]">
              <div className="flex flex-col divide-y divide-surface-border">
              {results.map((track) => {
                const isImporting = pendingAction === `import:${track.providerTrackId}`;
                const accessLabel = track.access === "unknown" ? null : accessLabels[track.access];
                const qualityLabel = track.quality ? qualityLabels[track.quality] : "标准";
                return (
                  <article
                    className="flex min-h-[76px] min-w-0 flex-col gap-3 bg-background/40 px-3 py-3 transition-colors hover:bg-surface-hover/60 sm:flex-row sm:items-center sm:justify-between"
                    data-testid="qqmusic-search-result"
                    data-track-id={track.providerTrackId}
                    key={track.providerTrackId}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium text-foreground">{track.title}</h3>
                      <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
                        <span className="min-w-0 truncate">{track.artist} · {track.album ?? "未知专辑"}</span>
                        <span className="shrink-0 font-mono tabular-nums text-foreground/70">{formatDuration(track.durationMs)}</span>
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-foreground-muted">
                        {accessLabel ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{accessLabel}</span> : null}
                        <span className="rounded bg-white/[0.06] px-1.5 py-0.5">{qualityLabel}</span>
                      </p>
                    </div>
                    {onImportTrack ? (
                      <Button
                        className="shrink-0 self-start sm:self-auto"
                        disabled={pendingAction !== null}
                        onClick={() => void importTrack(track)}
                        size="sm"
                        type="button"
                      >
                        {isImporting ? "导入中…" : "导入曲库"}
                      </Button>
                    ) : null}
                  </article>
                );
              })}
              </div>
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
    if (error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "请先绑定 QQ 音乐账号。";
    if (error.code === "QQMUSIC_AUTH_EXPIRED") return "QQ 音乐登录已失效，请重新绑定。";
    if (error.code === "QQMUSIC_DISABLED") return "QQ 音乐功能当前未启用。";
    if (error.code === "QQMUSIC_UNAVAILABLE") return "QQ 音乐服务暂时不可用，请稍后重试。";
    if (error.code === "RATE_LIMITED") return "二维码请求过于频繁，请一分钟后再试。";
    if (error.code === "QQMUSIC_IMPORT_TOO_LARGE") return "歌曲文件过大，无法导入。";
    if (error.code === "QQMUSIC_AUDIO_UNSUPPORTED") return "QQ 音乐返回了当前播放器不支持的音频格式。";
    return error.message;
  }
  return error instanceof Error ? error.message : "QQ 音乐操作失败，请稍后重试。";
}

function shouldStopQrPolling(error: unknown) {
  if (!(error instanceof MusicRoomApiError)) {
    return false;
  }

  return [
    "UNAUTHORIZED",
    "QQMUSIC_DISABLED",
    "QQMUSIC_AUTH_EXPIRED",
    "QQMUSIC_QR_EXPIRED"
  ].includes(error.code ?? "");
}
