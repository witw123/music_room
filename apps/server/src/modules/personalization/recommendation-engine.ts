import type { PersonalizationRecommendationsQuery, ProviderPlaylistSummary, ProviderTrackCandidate } from "@music-room/shared";
import { extractTasteEvidence } from "./taste-taxonomy";

export type RecommendationCandidateSource = "library" | "related" | "artist" | "playlist" | "explore";

export type RecommendationCandidate = {
  candidate: ProviderTrackCandidate;
  source: RecommendationCandidateSource;
  baseScore: number;
  interestKey: string;
  interestLabel: string | null;
};

export type RecommendationTasteEntity = {
  entityKind: string;
  entityKey: string;
  title: string | null;
  positiveScore: number;
  negativeScore: number;
  lastOccurredAt: Date | null;
  lastRecommendedAt: Date | null;
};

export type RecommendationTasteEvent = {
  entityKind: string;
  entityKey: string;
  artist: string | null;
  occurredAt: Date;
};

export type RankedRecommendationCandidate = RecommendationCandidate & {
  score: number;
  reasons: string[];
  exploratory: boolean;
};

type RankedPlaylist = {
  playlist: ProviderPlaylistSummary;
  score: number;
  reasons: string[];
  artistCentric: boolean;
  interestKey: string;
};

const sessionWindowMs = 2 * 60 * 60 * 1_000;

export function rankRecommendationCandidates(input: {
  candidates: RecommendationCandidate[];
  entities: RecommendationTasteEntity[];
  events: RecommendationTasteEvent[];
  excludedTracks: ReadonlySet<string>;
  excludedIdentities: ReadonlySet<string>;
  excludedArtists: ReadonlySet<string>;
  surface: PersonalizationRecommendationsQuery["surface"];
  scoreEntity: (entity: RecommendationTasteEntity) => number;
  /** Keys recommended recently (external memory); they receive a repetition penalty. */
  recentlyRecommendedKeys?: ReadonlySet<string>;
}) {
  const trackEntities = new Map(input.entities.filter((item) => item.entityKind === "track").map((item) => [item.entityKey, item]));
  const artistEntities = new Map(input.entities.filter((item) => item.entityKind === "artist").map((item) => [item.entityKey, item]));
  const tasteScores = new Map(input.entities
    .filter((item) => item.entityKind === "genre" || item.entityKind === "scene")
    .flatMap((item) => item.title ? [[normalizeText(item.title), input.scoreEntity(item)] as const] : []));
  const sessionArtists = new Set(input.events
    .filter((item) => item.artist && Date.now() - item.occurredAt.getTime() <= sessionWindowMs)
    .map((item) => normalizeText(item.artist!)));
  const seenThreshold = Date.now() - 30 * 24 * 60 * 60 * 1_000;

  return dedupeCandidates(input.candidates).flatMap((item): RankedRecommendationCandidate[] => {
    const key = trackKey(item.candidate);
    const artistKey = normalizeText(item.candidate.artist);
    if (isRecommendationCandidateExcluded(item.candidate, input.excludedTracks, input.excludedIdentities, input.excludedArtists)) return [];

    const trackEntity = trackEntities.get(key);
    const artistEntity = artistEntities.get(artistKey);
    const trackAffinity = trackEntity ? positiveAffinity(input.scoreEntity(trackEntity)) : 0;
    const artistAffinity = artistEntity ? positiveAffinity(input.scoreEntity(artistEntity)) : 0;
    const tasteAffinity = candidateTasteAffinity(item.candidate, tasteScores);
    const sessionAffinity = sessionArtists.has(artistKey) ? 1 : 0;
    const availability = item.candidate.access === "free" ? 1 : item.candidate.access === "unknown" ? 0.55 : 0.2;
    const novelty = trackEntity?.lastOccurredAt ? 0 : 1;
    const freshness = releaseFreshness(item.candidate.releaseTime);
    const seenAt = trackEntity?.lastRecommendedAt ?? null;
    const seenRecently = (seenAt && seenAt.getTime() > seenThreshold) ||
      input.recentlyRecommendedKeys?.has(key) === true;
    const seenPenalty = seenRecently ? 0.14 : 0;
    const sourceTrust = sourceTrustScore(item.source);
    const score = item.baseScore * 0.28
      + trackAffinity * 0.18
      + artistAffinity * 0.18
      + tasteAffinity * 0.14
      + sessionAffinity * 0.1
      + sourceTrust * 0.06
      + availability * 0.03
      + novelty * 0.02
      + freshness * 0.01
      - seenPenalty;
    const exploratory = item.source === "explore" && !artistEntity;
    const reasons = recommendationReasons(item, sessionAffinity > 0, exploratory);
    return [{ ...item, score, reasons, exploratory }];
  }).sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title));
}

export function rerankRecommendationCandidates(input: {
  items: RankedRecommendationCandidate[];
  limit: number;
  explorationRatio: number;
  maxPerArtist?: number;
}) {
  const selected: RankedRecommendationCandidate[] = [];
  const remaining = [...input.items];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const sourceCounts = new Map<RecommendationCandidateSource, number>();
  const interestCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  const availableProviders = new Set(remaining.map((item) => item.candidate.provider));
  const targetExploration = Math.min(Math.ceil(input.limit * input.explorationRatio), remaining.filter((item) => item.exploratory).length);
  const maxSource = Math.max(2, Math.ceil(input.limit * 0.35));
  const maxInterest = Math.max(2, Math.ceil(input.limit * 0.4));
  const maxProvider = availableProviders.size > 1 ? Math.ceil(input.limit * 0.65) : input.limit;
  const maxPerArtist = input.maxPerArtist ?? 2;

  while (selected.length < input.limit && remaining.length) {
    const slotsLeft = input.limit - selected.length;
    const explorationNeeded = targetExploration - selected.filter((item) => item.exploratory).length;
    const forceExploration = explorationNeeded > 0 && slotsLeft <= explorationNeeded;
    const previousArtist = selected.length ? normalizeText(selected[selected.length - 1]!.candidate.artist) : null;
    const matches = (item: RankedRecommendationCandidate, options: { allowConsecutive: boolean; allowArtistOverflow: boolean; allowOtherOverflow: boolean }) => {
      if (forceExploration && !item.exploratory) return false;
      const artist = normalizeText(item.candidate.artist);
      const album = normalizeText(item.candidate.album ?? "");
      const artistAllowed = options.allowArtistOverflow || (artistCounts.get(artist) ?? 0) < maxPerArtist;
      const otherLimitsAllowed = options.allowOtherOverflow || (
        (!album || (albumCounts.get(album) ?? 0) < 2)
        && (sourceCounts.get(item.source) ?? 0) < maxSource
        && (interestCounts.get(item.interestKey) ?? 0) < maxInterest
        && (providerCounts.get(item.candidate.provider) ?? 0) < maxProvider
      );
      return (options.allowConsecutive || artist !== previousArtist) && artistAllowed && otherLimitsAllowed;
    };
    const pool = [
      remaining.filter((item) => matches(item, { allowConsecutive: false, allowArtistOverflow: false, allowOtherOverflow: false })),
      remaining.filter((item) => matches(item, { allowConsecutive: true, allowArtistOverflow: false, allowOtherOverflow: false })),
      remaining.filter((item) => matches(item, { allowConsecutive: true, allowArtistOverflow: true, allowOtherOverflow: false })),
      remaining.filter((item) => matches(item, { allowConsecutive: true, allowArtistOverflow: true, allowOtherOverflow: true }))
    ].find((items) => items.length > 0) ?? [];
    if (!pool.length) break;
    const next = pool
      .map((item) => ({ item, adjustedScore: diversityAdjustedScore(item, selected, sourceCounts, interestCounts, providerCounts, explorationNeeded) }))
      .sort((left, right) => right.adjustedScore - left.adjustedScore || right.item.score - left.item.score)[0]!.item;
    selected.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    increment(artistCounts, normalizeText(next.candidate.artist));
    if (next.candidate.album) increment(albumCounts, normalizeText(next.candidate.album));
    increment(sourceCounts, next.source);
    increment(interestCounts, next.interestKey);
    increment(providerCounts, next.candidate.provider);
  }

  return selected.map(({ candidate, score, reasons }) => ({ ...candidate, score, reasons }));
}

export function partitionDiscoveryRecommendations(items: RankedRecommendationCandidate[], limit = 16) {
  const forYou = rerankRecommendationCandidates({
    items,
    limit,
    explorationRatio: 0.17,
    maxPerArtist: 2
  });
  const selectedKeys = new Set(forYou.map(trackKey));
  const selectedArtists = new Set(forYou.map((item) => normalizeText(item.artist)));
  const takeUnselected = (source: RecommendationCandidateSource) => {
    const sourceItems = items.filter((item) => item.source === source && !selectedKeys.has(trackKey(item.candidate)));
    const freshArtistItems = sourceItems.filter((item) => !selectedArtists.has(normalizeText(item.candidate.artist)));
    const section = rerankRecommendationCandidates({
      items: freshArtistItems.length >= Math.min(4, limit) ? freshArtistItems : sourceItems,
      limit,
      explorationRatio: source === "explore" ? 0.25 : 0,
      maxPerArtist: 2
    });
    section.forEach((item) => {
      selectedKeys.add(trackKey(item));
      selectedArtists.add(normalizeText(item.artist));
    });
    return section;
  };

  return {
    forYou,
    familiarArtists: takeUnselected("artist"),
    moodDiscovery: takeUnselected("explore"),
    deepCuts: takeUnselected("related")
  };
}

export function selectPersonalizedPlaylists(input: {
  playlists: ProviderPlaylistSummary[];
  entities: RecommendationTasteEntity[];
  limit: number;
  scoreEntity: (entity: RecommendationTasteEntity) => number;
}) {
  const tasteEntities = input.entities
    .filter((item) => (item.entityKind === "genre" || item.entityKind === "scene") && item.title)
    .sort((left, right) => input.scoreEntity(right) - input.scoreEntity(left));
  const tasteScores = new Map(tasteEntities.map((item) => [normalizeText(item.title!), input.scoreEntity(item)]));
  const artistNames = input.entities
    .filter((item) => item.entityKind === "artist" && item.title)
    .sort((left, right) => input.scoreEntity(right) - input.scoreEntity(left))
    .slice(0, 10)
    .map((item) => item.title!);
  const ranked = dedupePlaylists(input.playlists).map((playlist): RankedPlaylist => {
    const text = [playlist.title, playlist.description, ...playlist.tags].filter(Boolean).join(" ");
    const evidence = extractTasteEvidence({ title: playlist.title, album: null, playlistMetadata: [text] });
    const matchedTaste = evidence
      .map((item) => ({ label: item.label, score: tasteScores.get(normalizeText(item.label)) ?? 0 }))
      .sort((left, right) => right.score - left.score)[0];
    const matchedArtist = artistNames.find((artist) => normalizeText(playlist.title).includes(normalizeText(artist)));
    const artistCentric = Boolean(matchedArtist && /(?:精选|合集|全收录|歌曲集|单曲|best\s+of|collection)/iu.test(playlist.title));
    const tasteAffinity = matchedTaste?.score ? positiveAffinity(matchedTaste.score) : 0;
    const score = 0.45 + tasteAffinity * 0.3 + Math.min(0.12, playlist.trackCount / 2_000) - (artistCentric ? 0.2 : 0);
    return {
      playlist,
      score,
      reasons: matchedTaste?.score ? [`符合你的${matchedTaste.label}偏好`] : matchedArtist ? ["常听艺人"] : ["为你挑选"],
      artistCentric,
      interestKey: matchedTaste?.score ? `taste:${normalizeText(matchedTaste.label)}` : matchedArtist ? `artist:${normalizeText(matchedArtist)}` : "mixed"
    };
  }).sort((left, right) => right.score - left.score || left.playlist.title.localeCompare(right.playlist.title));

  const selected: RankedPlaylist[] = [];
  const creatorCounts = new Map<string, number>();
  const interestCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  const providerCount = new Set(ranked.map((item) => item.playlist.provider)).size;
  const maxProvider = providerCount > 1 ? Math.ceil(input.limit * 0.65) : input.limit;
  let artistCentricCount = 0;
  for (const item of ranked) {
    if (selected.length >= input.limit) break;
    const creator = normalizeText(item.playlist.creatorName ?? "");
    if ((creator && (creatorCounts.get(creator) ?? 0) >= 2)
      || (interestCounts.get(item.interestKey) ?? 0) >= 3
      || (providerCounts.get(item.playlist.provider) ?? 0) >= maxProvider
      || (item.artistCentric && artistCentricCount >= 1)) continue;
    selected.push(item);
    if (creator) increment(creatorCounts, creator);
    increment(interestCounts, item.interestKey);
    increment(providerCounts, item.playlist.provider);
    if (item.artistCentric) artistCentricCount += 1;
  }
  return selected.map(({ playlist, score, reasons }) => ({ ...playlist, score, reasons }));
}

export function trackIdentity(track: { title: string; artist: string }) {
  return `${normalizeText(track.title)}:${normalizeText(track.artist)}`;
}

export function isRecommendationCandidateExcluded(
  candidate: ProviderTrackCandidate,
  excludedTracks: ReadonlySet<string>,
  excludedIdentities: ReadonlySet<string>,
  excludedArtists: ReadonlySet<string>
) {
  return excludedTracks.has(trackKey(candidate))
    || excludedIdentities.has(trackIdentity(candidate))
    || excludedArtists.has(normalizeText(candidate.artist));
}

function diversityAdjustedScore(
  item: RankedRecommendationCandidate,
  selected: RankedRecommendationCandidate[],
  sourceCounts: ReadonlyMap<RecommendationCandidateSource, number>,
  interestCounts: ReadonlyMap<string, number>,
  providerCounts: ReadonlyMap<string, number>,
  explorationNeeded: number
) {
  const similarityPenalty = selected.length ? Math.max(...selected.map((selectedItem) => candidateSimilarity(item, selectedItem))) * 0.28 : 0;
  const newArtistBonus = selected.some((selectedItem) => normalizeText(selectedItem.candidate.artist) === normalizeText(item.candidate.artist)) ? 0 : 0.08;
  const newSourceBonus = sourceCounts.has(item.source) ? 0 : 0.04;
  const newInterestBonus = interestCounts.has(item.interestKey) ? 0 : 0.05;
  const newProviderBonus = providerCounts.has(item.candidate.provider) ? 0 : 0.025;
  const explorationBonus = explorationNeeded > 0 && item.exploratory ? 0.08 : 0;
  return item.score - similarityPenalty + newArtistBonus + newSourceBonus + newInterestBonus + newProviderBonus + explorationBonus;
}

function candidateSimilarity(left: RankedRecommendationCandidate, right: RankedRecommendationCandidate) {
  let similarity = 0;
  if (normalizeText(left.candidate.artist) === normalizeText(right.candidate.artist)) similarity = Math.max(similarity, 0.85);
  if (left.candidate.album && right.candidate.album && normalizeText(left.candidate.album) === normalizeText(right.candidate.album)) similarity = Math.max(similarity, 0.6);
  if (left.interestKey === right.interestKey) similarity = Math.max(similarity, 0.4);
  if (left.source === right.source) similarity = Math.max(similarity, 0.2);
  const leftTags = new Set((left.candidate.tags ?? []).map(normalizeText));
  const rightTags = new Set((right.candidate.tags ?? []).map(normalizeText));
  if (leftTags.size && rightTags.size) {
    const overlap = [...leftTags].filter((tag) => rightTags.has(tag)).length;
    similarity = Math.max(similarity, overlap / new Set([...leftTags, ...rightTags]).size * 0.55);
  }
  return similarity;
}

function candidateTasteAffinity(candidate: ProviderTrackCandidate, tasteScores: ReadonlyMap<string, number>) {
  const labels = extractTasteEvidence({
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album,
    releaseTime: candidate.releaseTime,
    providerTags: candidate.tags
  });
  const scores = labels.map((item) => tasteScores.get(normalizeText(item.label)) ?? 0);
  return scores.length ? positiveAffinity(Math.max(...scores)) : 0;
}

export function buildTrackRadioRecommendations(input: {
  seedTrack: { title: string; artist: string; album?: string | null; durationMs?: number; tags?: string[] };
  candidates: RecommendationCandidate[];
  excludedTrackKeys?: ReadonlySet<string>;
  limit?: number;
}): Array<ProviderTrackCandidate & { score: number; reasons: string[] }> {
  const limit = input.limit ?? 20;
  const excluded = input.excludedTrackKeys ?? new Set<string>();
  const seedArtist = normalizeText(input.seedTrack.artist);
  const seedAlbum = input.seedTrack.album ? normalizeText(input.seedTrack.album) : "";
  const seedEvidence = extractTasteEvidence({
    title: input.seedTrack.title,
    artist: input.seedTrack.artist,
    album: input.seedTrack.album ?? null,
    providerTags: input.seedTrack.tags
  });
  const seedLabels = new Set(seedEvidence.map((e) => normalizeText(e.label)));

  const scored = dedupeCandidates(input.candidates).flatMap((item) => {
    const key = trackKey(item.candidate);
    if (excluded.has(key)) return [];
    if (trackIdentity(item.candidate) === trackIdentity(input.seedTrack)) return [];

    const candArtist = normalizeText(item.candidate.artist);
    const candAlbum = item.candidate.album ? normalizeText(item.candidate.album) : "";
    const isSameArtist = candArtist === seedArtist;
    const isSameAlbum = Boolean(candAlbum && candAlbum === seedAlbum);

    const candEvidence = extractTasteEvidence({
      title: item.candidate.title,
      artist: item.candidate.artist,
      album: item.candidate.album ?? null,
      providerTags: item.candidate.tags
    });
    const candLabels = candEvidence.map((e) => normalizeText(e.label));
    const overlapCount = candLabels.filter((l) => seedLabels.has(l)).length;
    const tagSimilarity = seedLabels.size ? overlapCount / Math.max(1, seedLabels.size) : 0;

    const durationDiffRatio = input.seedTrack.durationMs && item.candidate.durationMs
      ? 1 - Math.min(1, Math.abs(input.seedTrack.durationMs - item.candidate.durationMs) / 180_000)
      : 0.5;

    const baseScore = (isSameArtist ? 0.35 : 0)
      + (isSameAlbum ? 0.15 : 0)
      + tagSimilarity * 0.35
      + durationDiffRatio * 0.15;

    const matchedGenre = candEvidence.find((e) => e.dimension === "genre")?.label;
    const reasons = [
      isSameArtist ? `同歌手深度探索 · ${item.candidate.artist}` : matchedGenre ? `相似风格 · ${matchedGenre}` : `从《${input.seedTrack.title}》漫游`
    ];

    return [{
      ...item.candidate,
      score: Number(baseScore.toFixed(3)),
      reasons
    }];
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function recommendationReasons(item: RecommendationCandidate, sessionMatch: boolean, exploratory: boolean) {
  const reasons: string[] = [];
  if (item.source === "library") {
    reasons.push("来自你的收藏");
  } else if (item.source === "related") {
    reasons.push(item.interestLabel ? `与《${item.interestLabel}》相似` : "延续你的常听曲目");
  } else if (item.source === "playlist") {
    reasons.push("来自收藏歌单精选");
  } else if (item.source === "artist") {
    reasons.push(item.interestLabel ? `常听艺人 · ${item.interestLabel}` : "常听艺人精选");
  } else if (item.source === "explore" && item.interestLabel) {
    reasons.push(`探索 · ${item.interestLabel}`);
  } else {
    reasons.push("为你挑选");
  }

  if (sessionMatch) reasons.push("延续当前会话情绪");
  if (exploratory) reasons.push("发现新艺人");
  return reasons;
}

function sourceTrustScore(source: RecommendationCandidateSource) {
  if (source === "library") return 1;
  if (source === "related") return 0.9;
  if (source === "playlist") return 0.82;
  if (source === "artist") return 0.76;
  return 0.65;
}

function releaseFreshness(value: string | null | undefined) {
  const year = Number(value?.match(/(?:19|20)\d{2}/u)?.[0]);
  if (!Number.isFinite(year)) return 0;
  const age = Math.max(0, new Date().getUTCFullYear() - year);
  return Math.max(0, 1 - age / 10);
}

function dedupeCandidates(items: RecommendationCandidate[]) {
  const byIdentity = new Map<string, RecommendationCandidate>();
  for (const item of items) {
    const key = trackIdentity(item.candidate);
    const existing = byIdentity.get(key);
    if (!existing || item.baseScore > existing.baseScore || accessScore(item.candidate) > accessScore(existing.candidate)) byIdentity.set(key, item);
  }
  return [...byIdentity.values()];
}

function dedupePlaylists(items: ProviderPlaylistSummary[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.provider}:${item.providerPlaylistId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function accessScore(track: ProviderTrackCandidate) {
  return track.access === "free" ? 3 : track.access === "unknown" ? 2 : 1;
}

function normalizeScore(score: number) {
  return 0.5 + Math.tanh(score / 8) * 0.5;
}

function positiveAffinity(score: number) {
  return score > 0 ? normalizeScore(score) : 0;
}

function normalizeText(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function trackKey(track: { provider: string; providerTrackId: string }) {
  return `${track.provider}:${track.providerTrackId}`;
}

function increment<K>(map: Map<K, number>, key: K) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

