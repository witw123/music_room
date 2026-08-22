import type { ProviderPlaylistSummary, ProviderTrackCandidate } from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";

export type DiscoverTrackRecommendation = {
  candidate: ProviderTrackCandidate;
  source: "library" | "related" | "artist" | "playlist" | "explore";
  score: number;
  reasons: string[];
};

export type DiscoverPlaylistRecommendation = {
  playlist: ProviderPlaylistSummary;
  score: number;
  reasons: string[];
};

export type ProfileProviderRecommendations = {
  providers: Array<"netease" | "qqmusic">;
  forYou: DiscoverTrackRecommendation[];
  familiarArtists: DiscoverTrackRecommendation[];
  moodDiscovery: DiscoverTrackRecommendation[];
  deepCuts: DiscoverTrackRecommendation[];
  playlists: DiscoverPlaylistRecommendation[];
  dailyRadar?: import("@music-room/shared").DailyRadarResponse;
  liveRooms?: import("@music-room/shared").LiveRoomRecommendation[];
};

export async function getProfileProviderRecommendations(input: {
  signal?: AbortSignal;
}): Promise<ProfileProviderRecommendations> {
  if (input.signal?.aborted) throw new DOMException("Recommendation request aborted.", "AbortError");
  const response = await musicRoomApi.getPersonalizationRecommendations({ surface: "discover" });
  if (input.signal?.aborted) throw new DOMException("Recommendation request aborted.", "AbortError");
  return {
    providers: response.providers,
    forYou: response.forYou.map((item) => ({
      candidate: item,
      source: reasonToSource(item.reasons),
      score: item.score,
      reasons: item.reasons
    })),
    familiarArtists: response.familiarArtists.map((item) => ({
      candidate: item,
      source: "artist",
      score: item.score,
      reasons: item.reasons
    })),
    moodDiscovery: response.moodDiscovery.map((item) => ({
      candidate: item,
      source: "explore",
      score: item.score,
      reasons: item.reasons
    })),
    deepCuts: response.deepCuts.map((item) => ({
      candidate: item,
      source: "related",
      score: item.score,
      reasons: item.reasons
    })),
    playlists: response.playlists.map((item) => ({
      playlist: item,
      score: item.score,
      reasons: item.reasons
    })),
    dailyRadar: response.dailyRadar,
    liveRooms: response.liveRooms
  };
}

function reasonToSource(reasons: string[]): DiscoverTrackRecommendation["source"] {
  if (reasons.includes("来自你的收藏")) return "library";
  if (reasons.includes("来自收藏歌单")) return "playlist";
  if (reasons.includes("常听艺人")) return "artist";
  return "related";
}
