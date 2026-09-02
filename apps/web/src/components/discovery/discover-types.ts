import type {
  ProviderPlaylistDetail,
  ProviderPlaylistSummary,
  ProviderTrackCandidate
} from "@music-room/shared";
import type { DiscoverPlaylistRecommendation, ProfileProviderRecommendations } from "@/features/discovery/profile-provider-recommendations";
import type { AnchoredDialogAnchor } from "@/components/ui/anchored-dialog";
import {
  SparklesIcon,
  MicIcon,
  VolumeIcon,
  ZapIcon,
  SakuraIcon,
  LaptopIcon,
  MoonIcon,
  LandmarkIcon
} from "@/components/icons/DiscoverIcons";
import { MusicRoomApiError } from "@/lib/network/music-room-api";

export type Provider = "netease" | "qqmusic";
export type Track = ProviderTrackCandidate;
export type DiscoverData = ProfileProviderRecommendations;
export type Detail = { summary: ProviderPlaylistSummary; value: ProviderPlaylistDetail };
export type DiscoverPlaylistCard = DiscoverPlaylistRecommendation & {
  tracks?: Track[];
};

export type DiscoverTrackActions = {
  pending: string | null;
  isFavorite: (track: Track) => boolean;
  isFavoritePending: (track: Track) => boolean;
  isDownloaded: (track: Track) => boolean;
  isQueued: (track: Track) => boolean;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onDownload: (track: Track) => void;
  onAddToPlaylist: (track: Track, anchor: AnchoredDialogAnchor) => void;
  onStartRadio: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onFeedback: (track: Track, action: "not-interested" | "exclude-from-profile") => void;
};

export const genreFilterPills = [
  { id: "all", label: "全部", icon: SparklesIcon },
  { id: "pop", label: "流行", icon: MicIcon, keywords: ["流行", "pop", "主打"] },
  { id: "rock", label: "摇滚", icon: VolumeIcon, keywords: ["摇滚", "rock", "朋克", "金属", "metal", "punk"] },
  { id: "electronic", label: "电子", icon: ZapIcon, keywords: ["电子", "edm", "house", "techno", "电音", "synth"] },
  { id: "acg", label: "ACG", icon: SakuraIcon, keywords: ["acg", "anime", "二次元", "动漫", "动画", "游戏", "vocaloid", "日系", "j-pop"] },
  { id: "focus", label: "专注", icon: LaptopIcon, keywords: ["专注", "学习", "工作", "轻音乐", "纯音乐", "lo-fi", "chill", "白噪音"] },
  { id: "night", label: "夜听", icon: MoonIcon, keywords: ["夜听", "深夜", "夜晚", "晚安", "治愈", "r&b", "soul"] },
  { id: "guofeng", label: "国风", icon: LandmarkIcon, keywords: ["国风", "古风", "仙侠", "华语", "戏腔", "新中式"] }
];

export function toPlaylistTrackActions(actions: DiscoverTrackActions) {
  return {
    isDownloaded: actions.isDownloaded,
    isPlayable: () => true,
    isQueueable: () => true,
    isQueued: actions.isQueued,
    isDownloading: (track: Track) => actions.pending === `download:${track.provider}:${track.providerTrackId}`,
    isPreparingPlayback: (track: Track) => actions.pending === `play:${track.provider}:${track.providerTrackId}` || actions.pending === `queue:${track.provider}:${track.providerTrackId}`,
    onDownload: actions.onDownload,
    onAddToQueue: actions.onQueue,
    onPlay: actions.onPlay,
    onAddToPlaylist: actions.onAddToPlaylist,
    isFavorite: actions.isFavorite,
    isTogglingFavorite: actions.isFavoritePending,
    onToggleFavorite: actions.onToggleFavorite
  };
}

export function providerTrackKey(track: Pick<Track, "provider" | "providerTrackId">) {
  return `${track.provider}:${track.providerTrackId}`;
}

export function providerPlaylistKey(provider: Provider, playlistId: string) {
  return `${provider}:${playlistId}`;
}

export function toErrorMessage(error: unknown) {
  if (error instanceof MusicRoomApiError) {
    if (error.code === "NETEASE_ACCOUNT_REQUIRED" || error.code === "QQMUSIC_ACCOUNT_REQUIRED") return "部分推荐需要先绑定对应音乐平台账号。";
    return error.message;
  }
  return error instanceof Error ? error.message : "内容加载失败，请稍后重试。";
}
