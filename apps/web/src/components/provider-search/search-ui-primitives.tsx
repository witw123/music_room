/* eslint-disable @next/next/no-img-element */
import React from "react";
import type { NeteaseTrackCandidate, QqMusicTrackCandidate } from "@music-room/shared";
import { MusicRoomApiError } from "@/lib/network/music-room-api";
import { getArtworkSourceUrl } from "@/components/bottom-player/artwork-colors";

export type Provider = "netease" | "qqmusic";
export type Track = NeteaseTrackCandidate | QqMusicTrackCandidate;

export function albumKey(provider: Provider, providerAlbumId: string) {
  return `${provider}:${providerAlbumId}`;
}

export function SearchTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      aria-selected={active}
      className={`relative min-h-11 px-1 pb-3 text-sm font-semibold transition ${
        active ? "text-white" : "text-white/40 hover:text-white/70"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
      {active ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" /> : null}
    </button>
  );
}

export function Artwork({
  alt,
  src,
  size,
  className = ""
}: {
  alt: string;
  src: string | null | undefined;
  size: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { sm: "h-10 w-10 rounded-lg", md: "h-20 w-20 rounded-xl", lg: "rounded-2xl" };
  return src ? (
    <img alt={alt} className={`object-cover ${sizes[size]} ${className}`} loading="lazy" src={getArtworkSourceUrl(src)} />
  ) : (
    <span aria-label={alt} className={`flex items-center justify-center bg-[linear-gradient(135deg,#252a32,#15171b)] text-white/25 ${sizes[size]} ${className}`}>
      <Icon name="music" />
    </span>
  );
}

export function SearchEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center rounded-2xl border border-white/[0.1] bg-black px-6 text-center">
      <Icon name="search" />
      <p className="mt-4 text-sm font-medium text-white/60">{title}</p>
      <p className="mt-2 text-xs text-white/30">{description}</p>
    </div>
  );
}

export function TrackAlbumLink({
  track,
  pending,
  onAlbum,
  className = ""
}: {
  track: Track;
  pending: string | null;
  onAlbum: (track: Track) => Promise<void>;
  className?: string;
}) {
  if (!track.album) return <span className={`${className} text-white/30`}>未知专辑</span>;
  return (
    <button
      className={`${className} truncate text-left text-accent/80 transition hover:text-accent`}
      disabled={pending !== null}
      onClick={() => void onAlbum(track)}
      title={`查看专辑 ${track.album}`}
      type="button"
    >
      {track.album}
    </button>
  );
}

export function Icon({
  name,
  filled = false
}: {
  name: "search" | "heart" | "arrow-left" | "close" | "music" | "chevron-right" | "playlist-add" | "download" | "loading";
  filled?: boolean;
}) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6Z" /></svg>;
  if (name === "playlist-add") return <svg {...common}><path d="M4 5.5h10M4 9.5h10M4 13.5h6" /><path d="M17 13v7M13.5 16.5h7" /></svg>;
  if (name === "download") return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>;
  if (name === "loading") return <svg {...common} className="animate-spin"><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
  if (name === "arrow-left") return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "chevron-right") return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>;
  return (
    <svg {...common}>
      <path d="M4 19.5V5.8a1.8 1.8 0 0 1 2.4-1.7l12 4.5a1.8 1.8 0 0 1 1.2 1.7v8.2" />
      <circle cx="8" cy="19" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
    </svg>
  );
}

export function toProviderErrorMessage(error: unknown, provider: Provider) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "请先在我的页面绑定对应平台账号。";
    if (error.code === "NETEASE_AUTH_EXPIRED" || error.code === "QQMUSIC_AUTH_EXPIRED") return "平台登录已失效，请回我的页面重新绑定。";
    if (error.code === "NETEASE_DISABLED" || error.code === "QQMUSIC_DISABLED") return "该音乐平台当前未启用。";
    if (error.code === "QQMUSIC_TRACK_NOT_FOUND") return "该歌曲没有可用的公开音频，可能受到 VIP 或版权限制；免费歌曲也无法播放时请重新绑定 QQ 音乐。";
    return error.message;
  }
  return error instanceof Error ? error.message : `${provider === "netease" ? "网易云" : "QQ 音乐"}操作失败，请稍后重试。`;
}
