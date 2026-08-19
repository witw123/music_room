import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  PersonalizationFeedback,
  PersonalizationProfileResponse,
  PersonalizationRecommendationsQuery,
  PersonalizationRecommendationsResponse,
  PersonalizationTasteTag,
  PersonalizationTrackInput,
  ProviderPlaylistSummary,
  ProviderTrackCandidate,
  RecordPersonalizationEvent,
  TasteEntityKind
} from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import type { Prisma } from "../../generated/prisma";
import { RedisService } from "../../infra/redis/redis.service";
import { NeteaseService } from "../providers/netease/netease.service";
import { QqMusicService } from "../providers/qqmusic/qqmusic.service";
import {
  rankRecommendationCandidates,
  rerankRecommendationCandidates,
  selectPersonalizedPlaylists,
  trackIdentity,
  type RecommendationCandidate
} from "./recommendation-engine";
import { buildTasteGroups, extractTasteEvidence } from "./taste-taxonomy";

const recallCacheSeconds = 30 * 60;
const longTermHalfLifeMs = 120 * 24 * 60 * 60 * 1_000;
const sessionWindowMs = 2 * 60 * 60 * 1_000;
const maxTracksPerSection = 12;

type Provider = "netease" | "qqmusic";
type Candidate = RecommendationCandidate;
type TasteEntityRecord = {
  entityKind: string;
  entityKey: string;
  provider: string | null;
  providerItemId: string | null;
  providerAlbumId: string | null;
  access: string | null;
  quality: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number;
  artworkUrl: string | null;
  positiveScore: number;
  negativeScore: number;
  confidence: number;
  lastOccurredAt: Date | null;
  lastRecommendedAt: Date | null;
  updatedAt: Date;
};
type TasteEventRecord = { eventType: string; entityKind: string; entityKey: string; provider: string | null; title: string | null; artist: string | null; album: string | null; weight: number; listenedMs: bigint; occurredAt: Date; updatedAt: Date };
type PlaylistTasteRecord = { title: string; description: string | null; tags: unknown; trackIds: unknown };

@Injectable()
export class PersonalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly netease: NeteaseService,
    private readonly qqmusic: QqMusicService
  ) {}

  async recordEvent(userId: string, input: RecordPersonalizationEvent) {
    this.assertDatabaseAvailable();
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.userTasteEvent.findUnique({
        where: { userId_clientEventId: { userId, clientEventId: input.id } }
      });
      const weight = eventWeight(input);
      const previousWeight = existing?.weight ?? 0;
      const occurredAt = new Date(input.occurredAt);
      const payload = {
        eventType: input.type,
        surface: input.surface ?? null,
        entityKind: "track",
        entityKey: trackKey(input.track),
        provider: input.track.provider,
        providerItemId: input.track.providerTrackId,
        title: input.track.title,
        artist: input.track.artist,
        album: input.track.album ?? null,
        durationMs: input.track.durationMs,
        listenedMs: BigInt(input.listenedMs ?? 0),
        weight,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? 0,
        occurredAt
      };
      if (existing) {
        await transaction.userTasteEvent.update({ where: { id: existing.id }, data: payload });
      } else {
        await transaction.userTasteEvent.create({
          data: { id: `taste_event_${randomUUID()}`, userId, clientEventId: input.id, ...payload }
        });
      }
      const excluded = await transaction.userRecommendationExclusion.findUnique({
        where: { userId_targetKind_targetKey: { userId, targetKind: "track", targetKey: trackKey(input.track) } }
      });
      if (excluded?.reason === "exclude-from-profile") return;
      const delta = weight - previousWeight;
      if (delta === 0 && existing) return;
      await this.projectTrack(transaction, userId, input.track, delta, occurredAt, !existing);
    });
    await this.clearRecallCache(userId);
    return { ok: true };
  }

  async recordFeedback(userId: string, input: PersonalizationFeedback) {
    this.assertDatabaseAvailable();
    await this.prisma.userRecommendationExclusion.upsert({
      where: { userId_targetKind_targetKey: { userId, targetKind: input.target.kind, targetKey: input.target.key } },
      update: { reason: input.action },
      create: {
        id: `taste_exclusion_${randomUUID()}`,
        userId,
        targetKind: input.target.kind,
        targetKey: input.target.key,
        reason: input.action,
        label: input.target.label ?? null
      }
    });
    if (input.action === "exclude-from-profile") {
      await this.prisma.$transaction([
        this.prisma.userTasteEntity.deleteMany({ where: { userId, entityKind: input.target.kind, entityKey: input.target.key } }),
        this.prisma.userTasteEvent.deleteMany({ where: { userId, entityKind: input.target.kind, entityKey: input.target.key } })
      ]);
    }
    await this.clearRecallCache(userId);
    return { ok: true };
  }

  async listExclusions(userId: string) {
    this.assertDatabaseAvailable();
    const items = await this.prisma.userRecommendationExclusion.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    return items.map((item) => ({
      kind: item.targetKind as "track" | "artist",
      key: item.targetKey,
      label: item.label,
      action: item.reason as "not-interested" | "exclude-from-profile",
      createdAt: item.createdAt.toISOString()
    }));
  }

  async removeExclusion(userId: string, kind: "track" | "artist", key: string) {
    this.assertDatabaseAvailable();
    await this.prisma.userRecommendationExclusion.deleteMany({ where: { userId, targetKind: kind, targetKey: key } });
    await this.clearRecallCache(userId);
    return { ok: true };
  }

  async getProfile(userId: string): Promise<PersonalizationProfileResponse> {
    this.assertDatabaseAvailable();
    const [entities, events, playlists] = await Promise.all([
      this.prisma.userTasteEntity.findMany({ where: { userId } }),
      this.prisma.userTasteEvent.findMany({ where: { userId } }),
      this.prisma.playlist.findMany({ where: { ownerId: userId }, select: { title: true, description: true, tags: true, trackIds: true } })
    ]);
    const playbackEvents = events.filter((event) => event.eventType === "playback");
    const tracks = entities.filter((item) => item.entityKind === "track");
    const artists = entities.filter((item) => item.entityKind === "artist");
    const topArtists = buildTopArtists(playbackEvents, artists);
    const tasteGroups = buildTasteGroups({
      entities: [...entities, ...playlistTasteEntities(tracks, playlists), ...historicalTasteEntities(events)],
      behavior: buildBehaviorTasteTags(events, playbackEvents),
      score: entityScore
    });
    const totalListenedMs = playbackEvents.reduce((total, event) => total + Number(event.listenedMs), 0);
    const topTracks = tracks
      .map((item) => ({ item, candidate: entityToCandidate(item) }))
      .filter((value): value is { item: typeof entities[number]; candidate: ProviderTrackCandidate } => value.candidate !== null)
      .sort((left, right) => entityScore(right.item) - entityScore(left.item))
      .slice(0, 5)
      .map(({ item, candidate }) => ({
        ...candidate,
        score: entityScore(item),
        reasons: ["长期偏好"],
        listenedMs: Number(playbackEvents.filter((event) => event.entityKey === item.entityKey).reduce((total, event) => total + event.listenedMs, BigInt(0))),
        playCount: playbackEvents.filter((event) => event.entityKey === item.entityKey).length
      }));
    const sourceDistribution = (["netease", "qqmusic", "local_upload"] as const).map((source) => ({
      source,
      listenedMs: Number(playbackEvents.filter((event) => event.provider === source).reduce((total, event) => total + event.listenedMs, BigInt(0)))
    })).filter((item) => item.listenedMs > 0);
    const version = profileVersion(entities, events);
    return {
      version,
      startedAt: playbackEvents.map((event) => event.occurredAt).sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() ?? null,
      totalListenedMs,
      totalPlayCount: playbackEvents.length,
      trackCount: tracks.filter((item) => item.interactionCount > 0).length,
      artistCount: topArtists.length,
      tasteGroups,
      topTracks,
      topArtists: topArtists.slice(0, 5),
      sourceDistribution
    };
  }

  async getRecommendations(
    userId: string,
    query: PersonalizationRecommendationsQuery
  ): Promise<PersonalizationRecommendationsResponse> {
    this.assertDatabaseAvailable();
    const [entities, events, exclusions, listenedTracks] = await Promise.all([
      this.prisma.userTasteEntity.findMany({ where: { userId } }),
      this.prisma.userTasteEvent.findMany({ where: { userId }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.userRecommendationExclusion.findMany({ where: { userId } }),
      query.surface === "discover"
        ? this.prisma.userTasteEvent.findMany({
            where: { userId, eventType: "playback" },
            distinct: ["entityKey"],
            select: { entityKey: true, title: true, artist: true }
          })
        : query.surface === "radio"
          ? this.prisma.userTasteEvent.findMany({
              where: { userId, eventType: "playback" },
              orderBy: { occurredAt: "desc" },
              take: 20,
              select: { entityKey: true, title: true, artist: true }
            })
          : Promise.resolve([])
    ]);
    const providers = await this.getBoundProviders(userId);
    const version = profileVersion(entities, events);
    const cacheKey = `personalization:recall:v3:${userId}:${version}:${query.surface}:${query.provider ?? "all"}`;
    const cached = this.redis.isAvailable()
      ? await this.redis.getJson<{ candidates: Candidate[]; playlists: ProviderPlaylistSummary[] }>(cacheKey).catch(() => null)
      : null;
    const recalled: { candidates: Candidate[]; playlists: ProviderPlaylistSummary[] } = cached ?? await this.recallCandidates(userId, entities, events, providers, query.surface, query.provider);
    if (!cached && this.redis.isAvailable()) {
      await this.redis.setJson(cacheKey, recalled, recallCacheSeconds).catch(() => undefined);
    }
    const excludedTracks = new Set([
      ...(query.excludedTrackKeys ?? []),
      ...(query.currentTrackKey ? [query.currentTrackKey] : []),
      ...exclusions.filter((item) => item.targetKind === "track").map((item) => item.targetKey)
    ]);
    const excludedIdentities = new Set(listenedTracks.flatMap((item) => item.title && item.artist ? [trackIdentity({ title: item.title, artist: item.artist })] : []));
    const excludedArtists = new Set(exclusions.filter((item) => item.targetKind === "artist").map((item) => item.targetKey));
    const ranked = rankRecommendationCandidates({
      candidates: recalled.candidates,
      entities,
      events,
      excludedTracks,
      excludedIdentities,
      excludedArtists,
      surface: query.surface,
      scoreEntity: entityScore
    });
    const forYou = rerankRecommendationCandidates({
      items: ranked.filter((item) => item.source !== "artist"),
      limit: maxTracksPerSection,
      explorationRatio: query.surface === "discover" ? 0.17 : 0.08
    });
    const selectedKeys = new Set(forYou.map((item) => trackKey(item)));
    const familiarArtists = rerankRecommendationCandidates({
      items: ranked.filter((item) => item.source === "artist" && !selectedKeys.has(trackKey(item.candidate))),
      limit: maxTracksPerSection,
      explorationRatio: 0
    });
    const playlists = selectPersonalizedPlaylists({ playlists: recalled.playlists, entities, limit: 10, scoreEntity: entityScore });
    await this.markRecommended(userId, [...forYou, ...familiarArtists]);
    return { profileVersion: version, providers, forYou, familiarArtists, playlists };
  }

  async clearProfile(userId: string) {
    this.assertDatabaseAvailable();
    await this.prisma.$transaction([
      this.prisma.userTasteEvent.deleteMany({ where: { userId } }),
      this.prisma.userTasteEntity.deleteMany({ where: { userId } }),
      this.prisma.userRecommendationExclusion.deleteMany({ where: { userId } })
    ]);
    await this.clearRecallCache(userId);
    return { ok: true };
  }

  private async getBoundProviders(userId: string): Promise<Provider[]> {
    const accounts = await Promise.all([
      this.prisma.neteaseAccount.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.qqMusicAccount.findUnique({ where: { userId }, select: { id: true } })
    ]);
    return accounts.flatMap((account, index) => account ? [index === 0 ? "netease" : "qqmusic"] : []);
  }

  private async recallCandidates(userId: string, entities: TasteEntityRecord[], events: TasteEventRecord[], providers: Provider[], surface: PersonalizationRecommendationsQuery["surface"], preferredProvider?: Provider) {
    const orderedProviders = preferredProvider ? providers.filter((provider) => provider === preferredProvider) : providers;
    const recalls = await Promise.all(orderedProviders.map((provider) => this.recallProvider(userId, provider, entities, events, surface)));
    return {
      candidates: recalls.flatMap((item) => item.candidates),
      playlists: recalls.flatMap((item) => item.playlists)
    };
  }

  private async recallProvider(userId: string, provider: Provider, entities: TasteEntityRecord[], events: TasteEventRecord[], surface: PersonalizationRecommendationsQuery["surface"]) {
    const tracks = entities.filter((item) => item.entityKind === "track" && item.provider === provider).sort((left, right) => entityScore(right) - entityScore(left));
    const sessionArtists = new Set(events.filter((event) => event.artist && Date.now() - event.occurredAt.getTime() <= sessionWindowMs).map((event) => normalizeText(event.artist!)));
    const artists = entities.filter((item) => item.entityKind === "artist" && (item.provider === provider || !item.provider)).sort((left, right) => {
      const leftScore = entityScore(left) + (left.title && sessionArtists.has(normalizeText(left.title)) ? 3 : 0);
      const rightScore = entityScore(right) + (right.title && sessionArtists.has(normalizeText(right.title)) ? 3 : 0);
      return rightScore - leftScore;
    });
    const playlists = entities.filter((item) => item.entityKind === "playlist" && item.provider === provider).sort((left, right) => entityScore(right) - entityScore(left));
    const tasteTerms = entities.filter((item) => item.entityKind === "genre" || item.entityKind === "scene").sort((left, right) => entityScore(right) - entityScore(left));
    const libraryCandidates = tracks.map(entityToCandidate).filter((item): item is ProviderTrackCandidate => item !== null)
      .map((candidate) => ({ candidate, source: "library" as const, baseScore: 0.9, interestKey: "library", interestLabel: null }));
    const seed = libraryCandidates[0]?.candidate ?? null;
    const artistNames = artists.flatMap((item) => typeof item.title === "string" ? [item.title] : []).filter((name, index, names) => names.findIndex((item) => normalizeText(item) === normalizeText(name)) === index).slice(0, 2);
    const tasteNames = tasteTerms.flatMap((item) => typeof item.title === "string" && entityScore(item) > 0 ? [item.title] : []).filter((name, index, names) => names.findIndex((item) => normalizeText(item) === normalizeText(name)) === index).slice(0, 2);
    const playlistQuery = tasteNames[0] ?? artistNames[1] ?? artistNames[0] ?? null;
    const savedPlaylist = surface === "discover" ? undefined : playlists[0];
    const external = await this.getProviderRecall(userId, provider, seed, artistNames, tasteNames, playlistQuery, savedPlaylist, surface);
    return {
      candidates: dedupeCandidates([...(surface === "discover" ? [] : libraryCandidates), ...external.candidates]),
      playlists: external.playlists
    };
  }

  private async getProviderRecall(userId: string, provider: Provider, seed: ProviderTrackCandidate | null, artists: string[], tasteNames: string[], playlistQuery: string | null, savedPlaylist: TasteEntityRecord | undefined, surface: PersonalizationRecommendationsQuery["surface"]) {
    const service = provider === "netease" ? this.netease : this.qqmusic;
    const candidates: Candidate[] = [];
    const playlists: ProviderPlaylistSummary[] = [];
    const tasks: Promise<void>[] = [];
    if (seed) tasks.push((async () => {
      const related = await service.getRelatedPlaylists(userId, seed.providerTrackId);
      const first = related.items[0];
      if (!first) return;
      playlists.push(...related.items.slice(0, 6));
      const detail = await service.getPlaylist(userId, first.providerPlaylistId);
      candidates.push(...detail.tracks.slice(0, 24).map((candidate) => ({ candidate, source: "related" as const, baseScore: 0.82, interestKey: `track:${trackIdentity(seed)}`, interestLabel: seed.title })));
    })().catch(() => undefined));
    if (artists.length) tasks.push((async () => {
      for (const artist of artists) {
        const result = await service.searchTracks(userId, { keywords: artist, limit: 8, offset: 0 });
        candidates.push(...result.items.map((candidate) => ({ candidate, source: "artist" as const, baseScore: 0.68, interestKey: `artist:${normalizeText(artist)}`, interestLabel: artist })));
      }
    })().catch(() => undefined));
    if (tasteNames.length) tasks.push((async () => {
      for (const tasteName of tasteNames) {
        const result = await service.searchTracks(userId, { keywords: tasteName, limit: 8, offset: 0 });
        candidates.push(...result.items.map((candidate) => ({ candidate, source: "explore" as const, baseScore: 0.62, interestKey: `taste:${normalizeText(tasteName)}`, interestLabel: tasteName })));
      }
    })().catch(() => undefined));
    if (playlistQuery) tasks.push((async () => {
      const found = await service.searchPlaylists(userId, { keywords: playlistQuery, limit: 8, offset: 0 });
      const summaries = surface === "discover" ? await keepMultiArtistPlaylists(userId, service, found.items.slice(0, 3)) : found.items;
      playlists.push(...summaries);
    })().catch(() => undefined));
    const savedPlaylistId = savedPlaylist?.providerItemId;
    const savedPlaylistTitle = savedPlaylist?.title ?? null;
    if (typeof savedPlaylistId === "string") tasks.push((async () => {
      const detail = await service.getPlaylist(userId, savedPlaylistId);
      candidates.push(...detail.tracks.slice(0, 24).map((candidate) => ({ candidate, source: "playlist" as const, baseScore: 0.78, interestKey: `playlist:${savedPlaylistId}`, interestLabel: savedPlaylistTitle })));
    })().catch(() => undefined));
    await Promise.all(tasks);
    return { candidates, playlists: dedupePlaylists(playlists) };
  }

  private async projectTrack(transaction: Prisma.TransactionClient, userId: string, track: PersonalizationTrackInput, score: number, occurredAt: Date, incrementInteraction: boolean) {
    await this.projectEntity(transaction, userId, "track", trackKey(track), { provider: track.provider, providerItemId: track.providerTrackId, providerAlbumId: track.providerAlbumId ?? null, access: track.access, quality: track.quality, title: track.title, artist: track.artist, album: track.album, durationMs: track.durationMs, artworkUrl: track.artworkUrl, score, occurredAt, incrementInteraction });
    await this.projectEntity(transaction, userId, "artist", normalizeText(track.artist), { title: track.artist, score: score * 0.55, occurredAt, incrementInteraction });
    if (track.album) await this.projectEntity(transaction, userId, "album", `${track.provider}:${track.providerAlbumId ?? normalizeText(track.album)}`, { provider: track.provider, providerItemId: track.providerAlbumId ?? null, title: track.album, artist: track.artist, album: track.album, score: score * 0.25, occurredAt, incrementInteraction });
    for (const evidence of extractTasteEvidence(track)) {
      await this.projectEntity(transaction, userId, evidence.dimension, `${evidence.source}:${normalizeText(evidence.label)}`, {
        title: evidence.label,
        score: score * evidence.confidence * 0.35,
        confidence: evidence.confidence,
        occurredAt,
        incrementInteraction
      });
    }
    await this.projectEntity(transaction, userId, "source", track.provider, { title: track.provider, score: score * 0.1, occurredAt, incrementInteraction });
  }

  private async projectEntity(transaction: Prisma.TransactionClient, userId: string, kind: TasteEntityKind, key: string, input: Record<string, unknown> & { score: number; confidence?: number; occurredAt: Date; incrementInteraction?: boolean; retainScore?: boolean }) {
    const positiveScore = Math.max(0, input.score);
    const negativeScore = Math.max(0, -input.score);
    const data = {
      provider: typeof input.provider === "string" ? input.provider : null,
      providerItemId: typeof input.providerItemId === "string" ? input.providerItemId : null,
      providerAlbumId: typeof input.providerAlbumId === "string" ? input.providerAlbumId : null,
      access: typeof input.access === "string" ? input.access : null,
      quality: typeof input.quality === "string" ? input.quality : null,
      title: typeof input.title === "string" ? input.title : null,
      artist: typeof input.artist === "string" ? input.artist : null,
      album: typeof input.album === "string" ? input.album : null,
      durationMs: typeof input.durationMs === "number" ? input.durationMs : 0,
      artworkUrl: typeof input.artworkUrl === "string" ? input.artworkUrl : null,
      lastOccurredAt: input.occurredAt
    };
    await transaction.userTasteEntity.upsert({
      where: { userId_entityKind_entityKey: { userId, entityKind: kind, entityKey: key } },
      create: {
        id: `taste_entity_${randomUUID()}`,
        userId,
        entityKind: kind,
        entityKey: key,
        ...data,
        positiveScore,
        negativeScore,
        confidence: Math.min(1, input.confidence ?? Math.abs(input.score) / 7),
        interactionCount: 1
      },
      update: {
        ...data,
        ...(input.retainScore
          ? { positiveScore: Math.max(0, positiveScore), negativeScore: Math.max(0, negativeScore) }
          : { positiveScore: { increment: positiveScore }, negativeScore: { increment: negativeScore } }),
        confidence: { increment: Math.min(0.1, input.confidence ?? Math.abs(input.score) * 0.04) },
        interactionCount: { increment: input.retainScore || input.incrementInteraction === false ? 0 : 1 }
      }
    });
  }

  private async markRecommended(userId: string, tracks: ProviderTrackCandidate[]) {
    const now = new Date();
    await Promise.all(tracks.map((candidate) => this.prisma.userTasteEntity.upsert({
      where: { userId_entityKind_entityKey: { userId, entityKind: "track", entityKey: trackKey(candidate) } },
      update: { lastRecommendedAt: now },
      create: { id: `taste_entity_${randomUUID()}`, userId, entityKind: "track", entityKey: trackKey(candidate), provider: candidate.provider, providerItemId: candidate.providerTrackId, providerAlbumId: candidate.providerAlbumId ?? null, access: candidate.access, quality: candidate.quality, title: candidate.title, artist: candidate.artist, album: candidate.album, durationMs: candidate.durationMs, artworkUrl: candidate.artworkUrl, lastRecommendedAt: now }
    })));
  }

  private async clearRecallCache(userId: string) {
    if (!this.redis.isAvailable()) return;
    const keys = await this.redis.client.keys(`personalization:recall:v3:${userId}:*`).catch(() => []);
    if (keys.length) await this.redis.client.del(...keys).catch(() => undefined);
  }

  private assertDatabaseAvailable() {
    if (!this.prisma.isAvailable()) throw new ServiceUnavailableException("Personalization storage is temporarily unavailable.");
  }
}

export function buildTopArtists(events: TasteEventRecord[], artists: TasteEntityRecord[]) {
  const artistEntities = new Map(artists.map((artist) => [artist.entityKey, artist]));
  const stats = new Map<string, { name: string; listenedMs: number; playCount: number }>();
  for (const event of events) {
    const name = event.artist?.trim();
    if (!name) continue;
    const key = normalizeText(name);
    const current = stats.get(key) ?? { name, listenedMs: 0, playCount: 0 };
    current.listenedMs += Number(event.listenedMs);
    current.playCount += 1;
    stats.set(key, current);
  }
  return [...stats.entries()]
    .map(([key, stat]) => ({
      ...stat,
      score: artistEntities.has(key)
        ? entityScore(artistEntities.get(key)!)
        : stat.playCount + stat.listenedMs / 3_600_000
    }))
    .sort((left, right) => right.score - left.score || right.playCount - left.playCount || right.listenedMs - left.listenedMs || left.name.localeCompare(right.name, "zh-CN"));
}

function buildBehaviorTasteTags(events: TasteEventRecord[], playbackEvents: TasteEventRecord[]): PersonalizationTasteTag[] {
  if (playbackEvents.length < 3) return [];
  const latestAt = events.reduce<Date>((latest, event) => event.updatedAt > latest ? event.updatedAt : latest, playbackEvents[0]?.updatedAt ?? new Date(0));
  const completions = events.filter((event) => event.eventType === "completion").length;
  const quickSkips = events.filter((event) => event.eventType === "quick-skip").length;
  const favorites = events.filter((event) => event.eventType === "favorite").length;
  const playCounts = new Map<string, number>();
  for (const event of playbackEvents) playCounts.set(event.entityKey, (playCounts.get(event.entityKey) ?? 0) + 1);
  const repeatedTrackCount = [...playCounts.values()].filter((count) => count >= 3).length;
  const completionRate = completions / playbackEvents.length;
  const quickSkipRate = quickSkips / playbackEvents.length;
  const tags: PersonalizationTasteTag[] = [];

  if (completions >= 2 && completionRate >= 0.45) tags.push(behaviorTag("高完成度", completionRate, latestAt));
  if (favorites >= 2) tags.push(behaviorTag("偏好收藏", Math.min(1, favorites / Math.max(3, playbackEvents.length)), latestAt));
  if (repeatedTrackCount >= 1) tags.push(behaviorTag("偏好重复播放", Math.min(1, repeatedTrackCount / 3), latestAt));
  if (playbackEvents.length >= 5 && quickSkipRate <= 0.15) tags.push(behaviorTag("少跳过", 1 - quickSkipRate, latestAt));

  return tags.slice(0, 4);
}

function behaviorTag(label: string, score: number, updatedAt: Date): PersonalizationTasteTag {
  return {
    label,
    score: Number(score.toFixed(3)),
    confidence: Math.min(1, Math.max(0.45, score)),
    source: "derived-behavior",
    updatedAt: updatedAt.toISOString()
  };
}

function playlistTasteEntities(tracks: TasteEntityRecord[], playlists: PlaylistTasteRecord[]): TasteEntityRecord[] {
  const metadataByTrack = indexPlaylistMetadata(playlists);
  return tracks.flatMap((track) => {
    const metadata = metadataByTrack.get(track.entityKey);
    if (!metadata?.length) return [];
    return extractTasteEvidence({ title: null, album: null, playlistMetadata: metadata }).map((evidence) => ({
      ...track,
      entityKind: evidence.dimension,
      entityKey: `${evidence.source}:${normalizeText(evidence.label)}`,
      title: evidence.label,
      positiveScore: Math.max(0, entityScore(track) * evidence.confidence),
      negativeScore: 0,
      confidence: evidence.confidence
    }));
  });
}

function historicalTasteEntities(events: TasteEventRecord[]): TasteEntityRecord[] {
  return events
    .filter((event) => event.entityKind === "track" && event.eventType === "playback" && event.title)
    .flatMap((event) => extractTasteEvidence({ title: event.title, artist: event.artist, album: event.album }).map((evidence) => ({
      entityKind: evidence.dimension,
      entityKey: `${evidence.source}:${normalizeText(evidence.label)}`,
      provider: null,
      providerItemId: null,
      providerAlbumId: null,
      access: null,
      quality: null,
      title: evidence.label,
      artist: null,
      album: null,
      durationMs: 0,
      artworkUrl: null,
      positiveScore: Math.max(0, event.weight * evidence.confidence * 0.35),
      negativeScore: Math.max(0, -event.weight * evidence.confidence * 0.35),
      confidence: evidence.confidence,
      lastOccurredAt: event.occurredAt,
      lastRecommendedAt: null,
      updatedAt: event.updatedAt
    })));
}

function eventWeight(input: RecordPersonalizationEvent) {
  if (input.type === "favorite") return 7;
  if (input.type === "unfavorite") return -7;
  if (input.type === "manual-selection") return 5;
  if (input.type === "completion") return 3;
  if (input.type === "quick-skip") return -6;
  if (input.type === "dismissed") return -7;
  if (input.type === "unavailable") return -1;
  return Math.min(2, Math.max(0, (input.listenedMs ?? 0) / 90_000));
}

function trackKey(track: { provider: string; providerTrackId: string }) {
  return `${track.provider}:${track.providerTrackId}`;
}

function normalizeText(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function entityScore(entity: Pick<TasteEntityRecord, "positiveScore" | "negativeScore" | "lastOccurredAt">) {
  const age = entity.lastOccurredAt ? Math.max(0, Date.now() - entity.lastOccurredAt.getTime()) : longTermHalfLifeMs;
  return (entity.positiveScore - entity.negativeScore) * Math.pow(0.5, age / longTermHalfLifeMs);
}

function entityToCandidate(entity: TasteEntityRecord): ProviderTrackCandidate | null {
  if ((entity.provider !== "netease" && entity.provider !== "qqmusic") || typeof entity.providerItemId !== "string" || typeof entity.title !== "string" || typeof entity.artist !== "string") return null;
  return {
    provider: entity.provider,
    providerTrackId: entity.providerItemId,
    access: entity.access === "free" || entity.access === "vip" || entity.access === "paid" ? entity.access : "unknown",
    quality: entity.quality === "standard" || entity.quality === "high" || entity.quality === "exhigh" || entity.quality === "lossless" || entity.quality === "hires" ? entity.quality : null,
    title: entity.title,
    artist: entity.artist,
    album: typeof entity.album === "string" ? entity.album : null,
    providerAlbumId: typeof entity.providerAlbumId === "string" ? entity.providerAlbumId : undefined,
    durationMs: typeof entity.durationMs === "number" ? entity.durationMs : 0,
    artworkUrl: typeof entity.artworkUrl === "string" ? entity.artworkUrl : null
  } as ProviderTrackCandidate;
}

function dedupeCandidates(items: Candidate[]) {
  const byIdentity = new Map<string, Candidate>();
  for (const item of items) {
    const key = `${normalizeText(item.candidate.title)}:${normalizeText(item.candidate.artist)}`;
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

function profileVersion(entities: TasteEntityRecord[], events: TasteEventRecord[]) {
  const tasteEntities = entities.filter((item) => item.lastOccurredAt !== null);
  const latest = Math.max(
    0,
    ...tasteEntities.map((item) => item.lastOccurredAt!.getTime()),
    ...events.map((item) => item.updatedAt.getTime())
  );
  return `${tasteEntities.length}:${events.length}:${latest}`;
}

function indexPlaylistMetadata(playlists: PlaylistTasteRecord[]) {
  const metadataByTrack = new Map<string, string[]>();
  for (const playlist of playlists) {
    const metadata = [playlist.title, playlist.description, ...toStringList(playlist.tags)]
      .filter((value): value is string => Boolean(value?.trim()));
    if (metadata.length === 0) continue;
    for (const trackId of toStringList(playlist.trackIds)) {
      const keys = [trackId, trackId.startsWith("provider:") ? trackId.slice("provider:".length) : `provider:${trackId}`];
      for (const key of keys) metadataByTrack.set(key, [...(metadataByTrack.get(key) ?? []), ...metadata]);
    }
  }
  return metadataByTrack;
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function keepMultiArtistPlaylists(
  userId: string,
  service: NeteaseService | QqMusicService,
  playlists: ProviderPlaylistSummary[]
) {
  const details = await Promise.all(playlists.map(async (playlist) => {
    try {
      const detail = await service.getPlaylist(userId, playlist.providerPlaylistId);
      const artistCount = new Set(detail.tracks.map((track) => normalizeText(track.artist)).filter(Boolean)).size;
      return artistCount >= 2 ? playlist : null;
    } catch {
      return null;
    }
  }));
  return details.filter((playlist): playlist is ProviderPlaylistSummary => playlist !== null);
}
