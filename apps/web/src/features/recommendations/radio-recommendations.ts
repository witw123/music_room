import type {
  LastFmSimilarTrack,
  ProviderTrackCandidate,
  RoomSnapshot
} from "@music-room/shared";
import { musicRoomApi } from "@/lib/network/music-room-api";
import { providerAccessScore, providerTrackToRecommendationCandidate } from "./provider-track-adapter";
import { buildRecommendationProfile } from "./recommendation-profile";
import { rankRecommendationCandidates } from "./recommendation-ranking";
import { getRecommendationProfile } from "./recommendation-store";
import { normalizeRecommendationText, type RecommendationReason } from "./recommendation-types";

const mappedCandidateTarget = 12;
const neteaseSourceLimit = 4;
const providerSearchLimit = 10;
const providerSearchConcurrency = 3;
const neteaseSearchConcurrency = 1;
const nativeFallbackSearchLimit = 20;
const relatedPlaylistLimit = 3;
const minimumTitleScore = 0.82;
const minimumArtistScore = 0.7;
const minimumMatchScore = 0.8;
const minimumNativeFallbackScore = 0.42;

export type RadioRecommendationCandidate = {
  candidate: ProviderTrackCandidate;
  lastFmMatch: number;
  providerMatchScore: number;
  recommendationScore: number;
  recommendationReasons: RecommendationReason[];
  existingRoomTrackId?: string;
};

export async function getRadioRecommendationCandidates(input: {
  userId: string;
  snapshot: RoomSnapshot;
  provider: "netease" | "qqmusic";
  seed: {
    title: string;
    artist: string;
  };
}): Promise<RadioRecommendationCandidate[]> {
  const excludedTrackKeys = getExcludedProviderTrackKeys(input.snapshot);
  const alternateProvider = input.provider === "netease" ? "qqmusic" : "netease";
  // Last.fm is an enhancement, not a hard dependency. Start provider-native
  // recall at the same time so an upstream timeout cannot block the refill.
  const [sources, nativeFallbacks] = await Promise.all([
    musicRoomApi.getLastFmSimilarTracks({
      artist: input.seed.artist,
      track: input.seed.title,
      limit: 100
    })
      .then((recall) => recall.items.slice(0, mappedCandidateTarget))
      .catch(() => []),
    getNativeProviderFallbackCandidates({
      provider: input.provider,
      alternateProvider,
      seed: input.seed,
      seedProviderTrackId: getCurrentProviderTrackId(input.snapshot),
      excludedTrackKeys
    }).catch(() => [])
  ]);
  // A provider result can be searchable but still fail during audio import.
  // Resolve both catalogs so a temporary upstream failure or paid result does
  // not suppress a playable fallback from the other provider.
  const [primary, alternate] = await Promise.all([
    mapSimilarTracksToProvider({
      provider: input.provider,
      sources: limitSourcesForProvider(input.provider, sources),
      excludedTrackKeys
    }),
    mapSimilarTracksToProvider({
      provider: alternateProvider,
      sources: limitSourcesForProvider(alternateProvider, sources),
      excludedTrackKeys
    })
  ]);

  let mapped = dedupeMappedCandidates([...primary, ...alternate, ...nativeFallbacks], excludedTrackKeys);

  if (mapped.length < mappedCandidateTarget) {
    mapped = dedupeMappedCandidates([
      ...mapped,
      ...getRoomLibraryFallbackCandidates(input.snapshot, input.seed, excludedTrackKeys)
    ], excludedTrackKeys);
  }

  const profile = await getRecommendationProfile(input.userId)
    .catch(() => buildRecommendationProfile(input.userId, []));
  const mappedByKey = new Map(mapped.map((item) => [getProviderTrackKey(item.candidate), item]));
  const ranked = rankRecommendationCandidates(
    mapped.map((item) => providerTrackToRecommendationCandidate(item.candidate, {
      baseScore: item.lastFmMatch * 0.74 + item.providerMatchScore * 0.21 + providerAccessScore(item.candidate.access) * 0.05,
      availabilityScore: providerAccessScore(item.candidate.access)
    })),
    profile,
    {
      excludedCandidateKeys: excludedTrackKeys,
      recentArtistKeys: getRadioRecentArtists(input.snapshot),
      preferredSource: input.provider
    }
  );

  const rankedCandidates = ranked
    .map((item) => {
      const mappedItem = mappedByKey.get(item.candidate.key);
      return mappedItem
        ? {
          candidate: mappedItem.candidate,
          lastFmMatch: mappedItem.lastFmMatch,
          providerMatchScore: mappedItem.providerMatchScore,
          recommendationScore: item.score,
          recommendationReasons: item.reasons,
          ...(mappedItem.existingRoomTrackId ? { existingRoomTrackId: mappedItem.existingRoomTrackId } : {})
        }
        : null;
    })
    .filter((item): item is RadioRecommendationCandidate => item !== null)
    .slice(0, mappedCandidateTarget);

  if (rankedCandidates.length > 0) return rankedCandidates;

  // The ranking layer intentionally filters recent artists and recent
  // candidates. If that removes every safe option, keep the station alive by
  // relaxing only those preference constraints; queue/source de-duplication
  // has already happened in `mapped` and remains enforced.
  return mapped
    .slice()
    .sort(compareMappedCandidates)
    .slice(0, mappedCandidateTarget)
    .map((item) => ({
      candidate: item.candidate,
      lastFmMatch: item.lastFmMatch,
      providerMatchScore: item.providerMatchScore,
      recommendationScore: item.lastFmMatch * 0.74 + item.providerMatchScore * 0.21 + providerAccessScore(item.candidate.access) * 0.05,
      recommendationReasons: ["base" as const],
      ...(item.existingRoomTrackId ? { existingRoomTrackId: item.existingRoomTrackId } : {})
    }));
}

type MappedSimilarTrack = {
  candidate: ProviderTrackCandidate;
  lastFmMatch: number;
  providerMatchScore: number;
  source: LastFmSimilarTrack;
  existingRoomTrackId?: string;
};

async function getNativeProviderFallbackCandidates(input: {
  provider: "netease" | "qqmusic";
  alternateProvider: "netease" | "qqmusic";
  seed: { title: string; artist: string };
  seedProviderTrackId: string | null;
  excludedTrackKeys: Set<string>;
}) {
  const providers = [input.provider, input.alternateProvider] as const;
  const candidates = await Promise.all(providers.map((provider) =>
    getProviderNativeFallbackCandidates({
      provider,
      seed: input.seed,
      seedProviderTrackId: provider === input.provider ? input.seedProviderTrackId : null,
      excludedTrackKeys: input.excludedTrackKeys
    })
  ));
  return candidates.flat();
}

async function getProviderNativeFallbackCandidates(input: {
  provider: "netease" | "qqmusic";
  seed: { title: string; artist: string };
  seedProviderTrackId: string | null;
  excludedTrackKeys: Set<string>;
}) {
  const relatedTracks = input.seedProviderTrackId
    ? await getRelatedPlaylistTracks(input.provider, input.seedProviderTrackId)
    : [];
  const searchTerms = uniqueSearchTerms([
    `${input.seed.title} ${input.seed.artist}`,
    input.seed.artist,
    input.seed.title
  ]);
  const searchResults = await Promise.all(
    searchTerms.map((keywords) => searchProvider(input.provider, keywords, nativeFallbackSearchLimit).catch(() => null))
  );
  const candidates = [
    ...relatedTracks.map((candidate) => ({ candidate, source: "related" as const })),
    ...searchResults.flatMap((result) => (result?.items ?? []).map((candidate) => ({ candidate, source: "search" as const })))
  ];
  const unique = new Map<string, MappedSimilarTrack>();

  for (const item of candidates) {
    const key = getProviderTrackKey(item.candidate);
    if (input.excludedTrackKeys.has(key) || unique.has(key)) continue;
    const metadataScore = scoreSeedRelationship(input.seed, item.candidate);
    const relationScore = item.source === "related"
      ? Math.max(0.58, metadataScore)
      : metadataScore;
    if (relationScore < minimumNativeFallbackScore) continue;
    unique.set(key, {
      candidate: item.candidate,
      lastFmMatch: relationScore,
      providerMatchScore: relationScore,
      source: {
        title: input.seed.title,
        artist: input.seed.artist,
        match: relationScore
      }
    });
  }

  return [...unique.values()];
}

async function getRelatedPlaylistTracks(
  provider: "netease" | "qqmusic",
  trackId: string
) {
  const related = await (provider === "netease"
    ? musicRoomApi.listNeteaseRelatedPlaylists(trackId)
    : musicRoomApi.listQqMusicRelatedPlaylists(trackId)).catch(() => null);
  const playlists = related?.items?.slice(0, relatedPlaylistLimit) ?? [];
  const details = await Promise.all(playlists.map((playlist) => (
    provider === "netease"
      ? musicRoomApi.getNeteasePlaylist(playlist.providerPlaylistId)
      : musicRoomApi.getQqMusicPlaylist(playlist.providerPlaylistId)
  ).catch(() => null)));
  return details.flatMap((detail) => detail?.tracks ?? []);
}

function uniqueSearchTerms(terms: string[]) {
  const seen = new Set<string>();
  return terms
    .map((term) => term.trim())
    .filter((term) => {
      const key = normalizeRecommendationText(term);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function scoreSeedRelationship(
  seed: { title: string; artist: string },
  candidate: ProviderTrackCandidate
) {
  const titleScore = textSimilarity(seed.title, candidate.title);
  const artistScore = textSimilarity(seed.artist, candidate.artist);
  if (artistScore < 0.45 && titleScore < 0.7) return 0;
  return titleScore * 0.55 + artistScore * 0.45;
}

function getCurrentProviderTrackId(snapshot: RoomSnapshot) {
  const currentTrackId = snapshot.room.playback.currentTrackId;
  const currentTrack = currentTrackId
    ? snapshot.tracks.find((track) => track.id === currentTrackId)
    : null;
  return currentTrack?.sourceRef?.trackId ?? null;
}

function getRoomLibraryFallbackCandidates(
  snapshot: RoomSnapshot,
  seed: { title: string; artist: string },
  excludedTrackKeys: Set<string>
) {
  return snapshot.tracks
    .filter((track) => track.sourceRef && (track.sourceType === "netease" || track.sourceType === "qqmusic"))
    .map((track) => {
      const source = track.sourceRef!;
      const key = `${source.provider}:${source.trackId}`;
      return {
        track,
        key,
        score: scoreSeedRelationship(seed, {
          provider: source.provider,
          providerTrackId: source.trackId,
          access: "free",
          quality: null,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          artworkUrl: track.artworkUrl
        })
      };
    })
    .filter(({ key, score }) => !excludedTrackKeys.has(key) && score >= minimumNativeFallbackScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, mappedCandidateTarget)
    .map(({ track, score }) => {
      const source = track.sourceRef!;
      const candidate: ProviderTrackCandidate = {
        provider: source.provider,
        providerTrackId: source.trackId,
        access: "free",
        quality: null,
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl
      };
      return {
        candidate,
        lastFmMatch: score,
        providerMatchScore: score,
        source: {
          title: seed.title,
          artist: seed.artist,
          match: score
        },
        existingRoomTrackId: track.id
      } satisfies MappedSimilarTrack;
    });
}

async function mapSimilarTracksToProvider(input: {
  provider: "netease" | "qqmusic";
  sources: LastFmSimilarTrack[];
  excludedTrackKeys: Set<string>;
}): Promise<MappedSimilarTrack[]> {
  const resolved = await mapWithConcurrency(
    input.sources,
    input.provider === "netease" ? neteaseSearchConcurrency : providerSearchConcurrency,
    async (source) => {
    const result = await searchProvider(input.provider, `${source.title} ${source.artist}`).catch(() => null);
    if (!result) return null;
    const candidate = selectProviderMatch(source, result.items, input.excludedTrackKeys);
    return candidate
      ? {
        candidate,
        lastFmMatch: source.match,
        providerMatchScore: scoreProviderTrackMatch(source, candidate),
        source
      }
      : null;
    }
  );
  return resolved.filter((candidate): candidate is MappedSimilarTrack => candidate !== null);
}

function limitSourcesForProvider(
  provider: "netease" | "qqmusic",
  sources: LastFmSimilarTrack[]
) {
  return provider === "netease" ? sources.slice(0, neteaseSourceLimit) : sources;
}

function searchProvider(provider: "netease" | "qqmusic", keywords: string, limit = providerSearchLimit) {
  return provider === "netease"
    ? musicRoomApi.searchNeteaseTracks(keywords, { limit })
    : musicRoomApi.searchQqMusicTracks(keywords, { limit });
}

function selectProviderMatch(
  source: LastFmSimilarTrack,
  candidates: ProviderTrackCandidate[],
  excludedTrackKeys: Set<string>
) {
  return candidates
    .filter((candidate) => !excludedTrackKeys.has(getProviderTrackKey(candidate)))
    .map((candidate) => ({
      candidate,
      score: scoreProviderTrackMatch(source, candidate)
    }))
    .filter(({ score }) => score >= minimumMatchScore)
    .sort((left, right) =>
      providerAccessScore(right.candidate.access) - providerAccessScore(left.candidate.access) ||
      right.score - left.score ||
      left.candidate.durationMs - right.candidate.durationMs
    )[0]?.candidate ?? null;
}

function scoreProviderTrackMatch(source: LastFmSimilarTrack, candidate: ProviderTrackCandidate) {
  const titleScore = textSimilarity(source.title, candidate.title);
  const artistScore = textSimilarity(source.artist, candidate.artist);
  if (titleScore < minimumTitleScore || artistScore < minimumArtistScore) return 0;
  return titleScore * 0.72 + artistScore * 0.28;
}

function dedupeMappedCandidates(
  candidates: MappedSimilarTrack[],
  excludedTrackKeys: Set<string>
) {
  const unique = new Map<string, MappedSimilarTrack>();
  for (const item of candidates) {
    const key = getProviderTrackKey(item.candidate);
    if (excludedTrackKeys.has(key)) continue;
    const existing = unique.get(key);
    if (!existing || compareMappedCandidates(item, existing) < 0) {
      unique.set(key, item);
    }
  }
  return [...unique.values()];
}

function compareMappedCandidates(
  left: MappedSimilarTrack,
  right: MappedSimilarTrack
) {
  const lastFmDifference = right.lastFmMatch - left.lastFmMatch;
  if (lastFmDifference !== 0) return lastFmDifference;
  const matchDifference = right.providerMatchScore - left.providerMatchScore;
  if (matchDifference !== 0) return matchDifference;
  return providerAccessScore(right.candidate.access) - providerAccessScore(left.candidate.access);
}

function getExcludedProviderTrackKeys(snapshot: RoomSnapshot) {
  const tracksById = new Map(snapshot.tracks.map((track) => [track.id, track]));
  const keys = new Set<string>();
  for (const queueItem of snapshot.queue) {
    const track = tracksById.get(queueItem.trackId);
    if (track?.sourceRef) {
      keys.add(`${track.sourceRef.provider}:${track.sourceRef.trackId}`);
    }
  }
  const currentTrack = snapshot.room.playback.currentTrackId
    ? tracksById.get(snapshot.room.playback.currentTrackId)
    : null;
  if (currentTrack?.sourceRef) {
    keys.add(`${currentTrack.sourceRef.provider}:${currentTrack.sourceRef.trackId}`);
  }
  return keys;
}

function getProviderTrackKey(candidate: ProviderTrackCandidate) {
  return `${candidate.provider}:${candidate.providerTrackId}`;
}

function textSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeRecommendationText(left);
  const normalizedRight = normalizeRecommendationText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.92;
  if (normalizedLeft.length < 2 || normalizedRight.length < 2) return 0;

  const leftBigrams = getBigrams(normalizedLeft);
  const rightBigrams = getBigrams(normalizedRight);
  let overlap = 0;
  for (const [bigram, count] of leftBigrams) {
    overlap += Math.min(count, rightBigrams.get(bigram) ?? 0);
  }
  return (2 * overlap) / (normalizedLeft.length - 1 + normalizedRight.length - 1);
}

function getBigrams(value: string) {
  const bigrams = new Map<string, number>();
  for (let index = 0; index < value.length - 1; index += 1) {
    const bigram = value.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}

function getRadioRecentArtists(snapshot: RoomSnapshot) {
  const currentQueueItemId = snapshot.room.playback.currentQueueItemId;
  const currentIndex = currentQueueItemId
    ? snapshot.queue.findIndex((item) => item.id === currentQueueItemId)
    : -1;
  if (currentIndex < 0) return [];
  const tracksById = new Map(snapshot.tracks.map((track) => [track.id, track]));
  return snapshot.queue
    .slice(Math.max(0, currentIndex - 1), currentIndex + 1)
    .flatMap((item) => {
      const track = tracksById.get(item.trackId);
      return track ? [track.artist] : [];
    });
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex];
      nextIndex += 1;
      results.push(await mapper(value));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}
