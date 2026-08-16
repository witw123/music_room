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
const providerSearchLimit = 10;
const providerSearchConcurrency = 3;
const minimumTitleScore = 0.82;
const minimumArtistScore = 0.7;
const minimumMatchScore = 0.8;

export type RadioRecommendationCandidate = {
  candidate: ProviderTrackCandidate;
  lastFmMatch: number;
  providerMatchScore: number;
  recommendationScore: number;
  recommendationReasons: RecommendationReason[];
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
  const recall = await musicRoomApi.getLastFmSimilarTracks({
    artist: input.seed.artist,
    track: input.seed.title,
    limit: 100
  });
  const sources = recall.items.slice(0, mappedCandidateTarget);
  const excludedTrackKeys = getExcludedProviderTrackKeys(input.snapshot);
  const alternateProvider = input.provider === "netease" ? "qqmusic" : "netease";
  // A provider result can be searchable but still fail during audio import.
  // Resolve both catalogs so a temporary upstream failure or paid result does
  // not suppress a playable fallback from the other provider.
  const [primary, alternate] = await Promise.all([
    mapSimilarTracksToProvider({ provider: input.provider, sources, excludedTrackKeys }),
    mapSimilarTracksToProvider({ provider: alternateProvider, sources, excludedTrackKeys })
  ]);

  const mapped = dedupeMappedCandidates([...primary, ...alternate], excludedTrackKeys);
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

  return ranked
    .map((item) => {
      const mappedItem = mappedByKey.get(item.candidate.key);
      return mappedItem
        ? {
          candidate: mappedItem.candidate,
          lastFmMatch: mappedItem.lastFmMatch,
          providerMatchScore: mappedItem.providerMatchScore,
          recommendationScore: item.score,
          recommendationReasons: item.reasons
        }
        : null;
    })
    .filter((item): item is RadioRecommendationCandidate => item !== null)
    .slice(0, mappedCandidateTarget);
}

type MappedSimilarTrack = {
  candidate: ProviderTrackCandidate;
  lastFmMatch: number;
  providerMatchScore: number;
  source: LastFmSimilarTrack;
};

async function mapSimilarTracksToProvider(input: {
  provider: "netease" | "qqmusic";
  sources: LastFmSimilarTrack[];
  excludedTrackKeys: Set<string>;
}): Promise<MappedSimilarTrack[]> {
  const resolved = await mapWithConcurrency(input.sources, providerSearchConcurrency, async (source) => {
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
  });
  return resolved.filter((candidate): candidate is MappedSimilarTrack => candidate !== null);
}

function searchProvider(provider: "netease" | "qqmusic", keywords: string) {
  return provider === "netease"
    ? musicRoomApi.searchNeteaseTracks(keywords, { limit: providerSearchLimit })
    : musicRoomApi.searchQqMusicTracks(keywords, { limit: providerSearchLimit });
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
