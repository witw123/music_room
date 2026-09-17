import type { ProviderPlaylistSummary, ProviderTrackCandidate } from "@music-room/shared";
import { generateLocalDiscoveryRecommendations } from "./local-discover-engine";

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
  return generateLocalDiscoveryRecommendations(input);
}
