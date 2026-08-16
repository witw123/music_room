import type {
  ListeningProfileDiscoverContext,
  ProviderPlaylistSummary,
  ProviderTrackCandidate
} from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { providerAccessScore, providerTrackToRecommendationCandidate } from "@/features/recommendations/provider-track-adapter";
import { rankRecommendationCandidates } from "@/features/recommendations/recommendation-ranking";
import { getRecommendationProfile } from "@/features/recommendations/recommendation-store";
import {
  normalizeRecommendationText,
  recommendationArtistKey,
  type RecommendationProfile
} from "@/features/recommendations/recommendation-types";

export type DiscoverProvider = "netease" | "qqmusic";

type TrackSource = "related" | "artist";

export type DiscoverRecallTrack = {
  candidate: ProviderTrackCandidate;
  source: TrackSource;
  baseScore: number;
};

export type DiscoverTrackRecommendation = {
  candidate: ProviderTrackCandidate;
  source: TrackSource;
  score: number;
};

export type DiscoverPlaylistRecommendation = {
  playlist: ProviderPlaylistSummary;
  score: number;
};

export type ProfileProviderRecommendations = {
  providers: DiscoverProvider[];
  forYou: DiscoverTrackRecommendation[];
  familiarArtists: DiscoverTrackRecommendation[];
  playlists: DiscoverPlaylistRecommendation[];
};

const maxSeedTracksPerProvider = 2;
const maxRelatedPlaylistsPerProvider = 2;
const maxRelatedTracksPerPlaylist = 16;
const maxArtistQueries = 3;
const maxPlaylistQueries = 4;
const providerSearchLimit = 10;
const providerPlaylistSearchLimit = 8;
const requestConcurrency = 2;
const sectionLimit = 12;
const playlistLimit = 10;

export async function getProfileProviderRecommendations(input: {
  userId: string;
  context: ListeningProfileDiscoverContext;
  enabledProviders: DiscoverProvider[];
  excludedCandidateKeys?: Iterable<string>;
  signal?: AbortSignal;
}): Promise<ProfileProviderRecommendations> {
  throwIfAborted(input.signal);
  const providers = await getBoundProviders(input.enabledProviders, input.signal);
  if (providers.length === 0 || input.context.seedTracks.length === 0) {
    return { providers, forYou: [], familiarArtists: [], playlists: [] };
  }

  const [profile, recalls] = await Promise.all([
    getRecommendationProfile(input.userId),
    mapWithConcurrency(providers, requestConcurrency, (provider) => recallProvider(provider, input.context, input.signal))
  ]);
  throwIfAborted(input.signal);

  const excludedCandidateKeys = new Set([
    ...input.context.excludedTrackKeys,
    ...(input.excludedCandidateKeys ?? [])
  ]);
  const ranked = rankDiscoverTrackCandidates(
    recalls.flatMap((recall) => recall.tracks),
    profile,
    excludedCandidateKeys
  );
  const forYou = ranked.filter((item) => item.source === "related").slice(0, sectionLimit);
  const forYouKeys = new Set(forYou.map((item) => providerTrackKey(item.candidate)));
  if (forYou.length < sectionLimit) {
    forYou.push(...ranked.filter((item) => !forYouKeys.has(providerTrackKey(item.candidate))).slice(0, sectionLimit - forYou.length));
  }

  const finalForYouKeys = new Set(forYou.map((item) => providerTrackKey(item.candidate)));
  const familiarArtistKeys = new Set(input.context.topArtists.map((artist) => recommendationArtistKey(artist.name)));
  const familiarArtists = ranked
    .filter((item) => !finalForYouKeys.has(providerTrackKey(item.candidate)))
    .filter((item) => familiarArtistKeys.has(recommendationArtistKey(item.candidate.artist)))
    .slice(0, sectionLimit);

  return {
    providers,
    forYou,
    familiarArtists,
    playlists: rankDiscoverPlaylists(recalls.flatMap((recall) => recall.playlists)).slice(0, playlistLimit)
  };
}

export function rankDiscoverTrackCandidates(
  tracks: DiscoverRecallTrack[],
  profile: RecommendationProfile,
  excludedCandidateKeys: ReadonlySet<string>
): DiscoverTrackRecommendation[] {
  const deduped = dedupeTracks(tracks, excludedCandidateKeys);
  const byKey = new Map(deduped.map((item) => [providerTrackKey(item.candidate), item]));
  const ranked = rankRecommendationCandidates(
    deduped.map((item) => providerTrackToRecommendationCandidate(item.candidate, {
      baseScore: item.baseScore,
      availabilityScore: providerAccessScore(item.candidate.access)
    })),
    profile,
    { excludedCandidateKeys }
  );
  const resolved = ranked.flatMap((item) => {
    const source = byKey.get(item.candidate.key);
    return source ? [{ candidate: source.candidate, source: source.source, score: item.score }] : [];
  });
  if (resolved.length > 0) return resolved;

  return deduped
    .sort(compareRecallTracks)
    .map((item) => ({ candidate: item.candidate, source: item.source, score: item.baseScore }));
}

async function getBoundProviders(enabledProviders: DiscoverProvider[], signal?: AbortSignal) {
  const statuses = await Promise.all(enabledProviders.map(async (provider) => {
    try {
      const account = provider === "netease"
        ? await musicRoomApi.getNeteaseAccount()
        : await musicRoomApi.getQqMusicAccount();
      throwIfAborted(signal);
      return account.connected ? provider : null;
    } catch {
      return null;
    }
  }));
  return statuses.filter((provider): provider is DiscoverProvider => provider !== null);
}

async function recallProvider(
  provider: DiscoverProvider,
  context: ListeningProfileDiscoverContext,
  signal?: AbortSignal
) {
  const seedTracks = context.seedTracks.filter((track) => track.provider === provider).slice(0, maxSeedTracksPerProvider);
  const relatedLists = await mapWithConcurrency(seedTracks, requestConcurrency, async (seed) => {
    const response = await getRelatedPlaylists(provider, seed.providerTrackId);
    throwIfAborted(signal);
    return response.items;
  });
  const relatedPlaylists = dedupePlaylists(relatedLists.flat()).slice(0, maxRelatedPlaylistsPerProvider);
  const relatedDetails = await mapWithConcurrency(relatedPlaylists, requestConcurrency, async (playlist) => {
    const detail = await getPlaylist(provider, playlist.providerPlaylistId);
    throwIfAborted(signal);
    return detail;
  });
  const artistNames = context.topArtists.map((artist) => artist.name).filter(Boolean).slice(0, maxArtistQueries);
  const artistSearches = await mapWithConcurrency(artistNames, requestConcurrency, async (artist) => {
    const response = await searchTracks(provider, artist, providerSearchLimit);
    throwIfAborted(signal);
    return response.items;
  });
  const playlistQueries = uniqueText([
    ...artistNames.slice(0, 2),
    ...context.tasteTags.slice(0, 2)
  ]).slice(0, maxPlaylistQueries);
  const playlistSearches = await mapWithConcurrency(playlistQueries, requestConcurrency, async (query) => {
    const response = await searchPlaylists(provider, query, providerPlaylistSearchLimit);
    throwIfAborted(signal);
    return response.items.map((playlist) => ({ playlist, query }));
  });

  return {
    tracks: [
      ...relatedDetails.flatMap((detail) => detail.tracks.slice(0, maxRelatedTracksPerPlaylist).map((candidate) => ({
        candidate,
        source: "related" as const,
        baseScore: 0.86
      }))),
      ...artistSearches.flat().map((candidate) => ({
        candidate,
        source: "artist" as const,
        baseScore: 0.64
      }))
    ],
    playlists: playlistSearches.flat().map(({ playlist, query }) => ({
      playlist,
      score: playlistQueryScore(playlist, query)
    }))
  };
}

function dedupeTracks(tracks: DiscoverRecallTrack[], excludedCandidateKeys: ReadonlySet<string>) {
  const byIdentity = new Map<string, DiscoverRecallTrack>();
  for (const item of tracks) {
    const providerKey = providerTrackKey(item.candidate);
    if (excludedCandidateKeys.has(providerKey)) continue;
    const identity = `${normalizeRecommendationText(item.candidate.title)}:${normalizeRecommendationText(item.candidate.artist)}`;
    if (!identity || identity === ":") continue;
    const existing = byIdentity.get(identity);
    if (!existing || compareRecallTracks(item, existing) < 0) byIdentity.set(identity, item);
  }
  return [...byIdentity.values()];
}

function compareRecallTracks(left: DiscoverRecallTrack, right: DiscoverRecallTrack) {
  return providerAccessScore(right.candidate.access) - providerAccessScore(left.candidate.access) ||
    right.baseScore - left.baseScore ||
    left.candidate.provider.localeCompare(right.candidate.provider) ||
    left.candidate.providerTrackId.localeCompare(right.candidate.providerTrackId);
}

function rankDiscoverPlaylists(items: Array<{ playlist: ProviderPlaylistSummary; score: number }>) {
  const byTitle = new Map<string, { playlist: ProviderPlaylistSummary; score: number }>();
  for (const item of items) {
    const key = normalizeRecommendationText(item.playlist.title);
    if (!key) continue;
    const existing = byTitle.get(key);
    if (!existing || item.score > existing.score || (item.score === existing.score && item.playlist.trackCount > existing.playlist.trackCount)) {
      byTitle.set(key, item);
    }
  }
  return [...byTitle.values()].sort((left, right) =>
    right.score - left.score ||
    right.playlist.trackCount - left.playlist.trackCount ||
    left.playlist.title.localeCompare(right.playlist.title)
  );
}

function playlistQueryScore(playlist: ProviderPlaylistSummary, query: string) {
  const haystack = normalizeRecommendationText(`${playlist.title} ${playlist.description ?? ""} ${playlist.creatorName ?? ""}`);
  const queryKey = normalizeRecommendationText(query);
  return (haystack.includes(queryKey) ? 1 : 0.55) + Math.min(0.25, playlist.trackCount / 2_000);
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeRecommendationText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePlaylists(playlists: ProviderPlaylistSummary[]) {
  const seen = new Set<string>();
  return playlists.filter((playlist) => {
    const key = `${playlist.provider}:${playlist.providerPlaylistId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function searchTracks(provider: DiscoverProvider, keywords: string, limit: number) {
  return provider === "netease"
    ? musicRoomApi.searchNeteaseTracks(keywords, { limit })
    : musicRoomApi.searchQqMusicTracks(keywords, { limit });
}

function searchPlaylists(provider: DiscoverProvider, keywords: string, limit: number) {
  return provider === "netease"
    ? musicRoomApi.searchNeteasePlaylists(keywords, { limit })
    : musicRoomApi.searchQqMusicPlaylists(keywords, { limit });
}

function getRelatedPlaylists(provider: DiscoverProvider, trackId: string) {
  return provider === "netease"
    ? musicRoomApi.listNeteaseRelatedPlaylists(trackId)
    : musicRoomApi.listQqMusicRelatedPlaylists(trackId);
}

function getPlaylist(provider: DiscoverProvider, playlistId: string) {
  return provider === "netease"
    ? musicRoomApi.getNeteasePlaylist(playlistId)
    : musicRoomApi.getQqMusicPlaylist(playlistId);
}

function providerTrackKey(track: Pick<ProviderTrackCandidate, "provider" | "providerTrackId">) {
  return `${track.provider}:${track.providerTrackId}`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Recommendation request aborted.", "AbortError");
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
