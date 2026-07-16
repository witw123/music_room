"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  AuthSession,
  MetingProvider,
  MetingTrackCandidate
} from "@music-room/shared";
import { formatDuration } from "@/lib/music-room-ui";
import { MusicRoomApiError, musicRoomApi } from "@/lib/music-room-api";
import { Button } from "@/components/ui/button";

const providerLabels: Record<MetingProvider, string> = {
  qqmusic: "QQ音乐",
  kugou: "酷狗音乐",
  kuwo: "酷我音乐",
  baidu: "百度音乐"
};

const providers: MetingProvider[] = ["qqmusic", "kugou", "kuwo", "baidu"];
const enabledByProvider: Record<MetingProvider, boolean> = {
  qqmusic: process.env.NEXT_PUBLIC_QQMUSIC_ENABLED === "true",
  kugou: process.env.NEXT_PUBLIC_KUGOU_ENABLED === "true",
  kuwo: process.env.NEXT_PUBLIC_KUWO_ENABLED === "true",
  baidu: process.env.NEXT_PUBLIC_BAIDU_ENABLED === "true"
};

type MetingSourcePanelProps = {
  activeSession: AuthSession | null;
  onImportTrack: (track: MetingTrackCandidate) => Promise<void>;
};

export function MetingSourcePanel({ activeSession, onImportTrack }: MetingSourcePanelProps) {
  const enabledProviders = useMemo(
    () => providers.filter((provider) => enabledByProvider[provider]),
    []
  );
  const [provider, setProvider] = useState<MetingProvider>(enabledProviders[0] ?? "qqmusic");
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<MetingTrackCandidate[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  if (!activeSession || enabledProviders.length === 0) return null;

  const searchTracks = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keywords.trim();
    if (!query || pendingAction) return;
    setPendingAction("search");
    setErrorMessage(null);
    try {
      const response = await musicRoomApi.searchMetingTracks(provider, query);
      setResults(response.items);
      setHasSearched(true);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const changeProvider = (nextProvider: MetingProvider) => {
    if (pendingAction || nextProvider === provider) return;
    setProvider(nextProvider);
    setResults([]);
    setHasSearched(false);
    setErrorMessage(null);
  };

  const importTrack = async (track: MetingTrackCandidate) => {
    if (pendingAction) return;
    setPendingAction(`import:${track.providerTrackId}`);
    setErrorMessage(null);
    try {
      await onImportTrack(track);
    } catch (error) {
      setErrorMessage(toProviderErrorMessage(error));
      setHasSearched(true);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className="flex w-full flex-col gap-4 rounded-xl border border-surface-border bg-surface/40 p-4"
      data-testid="meting-source-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">国内音乐平台</h2>
          <p className="mt-1 text-xs text-foreground-muted">服务器解析公开资源，无需单独登录。</p>
        </div>
        <span className="rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent">公开资源</span>
      </div>

      <div aria-label="音乐平台" className="flex flex-wrap gap-1 rounded-lg bg-background/70 p-1" role="tablist">
        {enabledProviders.map((nextProvider) => (
          <button
            key={nextProvider}
            aria-selected={provider === nextProvider}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              provider === nextProvider
                ? "bg-white/10 text-white"
                : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
            onClick={() => changeProvider(nextProvider)}
            role="tab"
            type="button"
          >
            {providerLabels[nextProvider]}
          </button>
        ))}
      </div>

      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void searchTracks(event)}>
        <label className="sr-only" htmlFor="meting-search-input">搜索音乐</label>
        <input
          id="meting-search-input"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#111] px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-accent focus:ring-1 focus:ring-accent"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder={`搜索${providerLabels[provider]}歌曲、歌手或专辑`}
          maxLength={100}
          type="search"
        />
        <Button disabled={!keywords.trim() || pendingAction !== null} size="sm" type="submit">
          {pendingAction === "search" ? "搜索中…" : "搜索"}
        </Button>
      </form>

      {results.length > 0 ? (
        <div className="flex items-center justify-between text-[11px] text-foreground-muted">
          <span>{providerLabels[provider]}搜索结果</span>
          <span className="font-mono tabular-nums">{results.length} 首</span>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="max-h-[min(32rem,58dvh)] overflow-y-auto overscroll-contain rounded-lg border border-surface-border">
          <div className="flex flex-col divide-y divide-surface-border">
            {results.map((track) => {
              const isImporting = pendingAction === `import:${track.providerTrackId}`;
              return (
                <article
                  className="flex min-h-[76px] flex-col gap-3 bg-background/40 px-3 py-3 transition-colors hover:bg-surface-hover/60 sm:flex-row sm:items-center sm:justify-between"
                  data-testid="meting-search-result"
                  data-provider={track.provider}
                  data-track-id={track.providerTrackId}
                  key={`${track.provider}:${track.providerTrackId}`}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">{track.title}</h3>
                    <p className="mt-1 flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
                      <span className="min-w-0 truncate">{track.artist} · {track.album ?? "未知专辑"}</span>
                      <span className="shrink-0 font-mono tabular-nums text-foreground/70">{formatDuration(track.durationMs)}</span>
                    </p>
                    <p className="mt-2 text-[10px] font-medium text-foreground-muted">
                      {track.quality ? `音质：${track.quality}` : "音质以平台实际返回为准"}
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

      {hasSearched && !pendingAction && results.length === 0 && !errorMessage ? (
        <p className="rounded-lg border border-surface-border bg-background/40 px-3 py-2 text-xs text-foreground-muted">
          没有返回可导入的公开歌曲，请更换关键词或平台。
        </p>
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
    if (error.code === "METING_DISABLED") return "该音乐平台当前未启用。";
    if (error.code === "METING_TRACK_NOT_FOUND") return "这首歌没有可用的公开音频，可能受付费、VIP 或版权限制。";
    if (error.code === "METING_AUDIO_UNSUPPORTED") return "平台返回了当前播放器不支持的音频格式。";
    if (error.code === "METING_IMPORT_TOO_LARGE") return "歌曲文件过大，无法导入。";
    if (error.code === "METING_UNAVAILABLE") return "平台接口暂时不可用，请稍后重试或切换平台。";
    if (error.code === "RATE_LIMITED") return "请求过于频繁，请稍后再试。";
    return error.message;
  }
  return error instanceof Error ? error.message : "音乐平台操作失败，请稍后重试。";
}
