import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  PersonalizationFeedback,
  PersonalizationProfileResponse,
  PersonalizationRecommendationsQuery,
  PersonalizationRecommendationsResponse,
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

const syncIntervalMs = 24 * 60 * 60 * 1_000;
const recallCacheSeconds = 30 * 60;
const longTermHalfLifeMs = 120 * 24 * 60 * 60 * 1_000;
const sessionWindowMs = 2 * 60 * 60 * 1_000;
const maxTracksPerSection = 12;

type Provider = "netease" | "qqmusic";
type CandidateSource = "library" | "related" | "artist" | "playlist" | "explore";
type Candidate = { candidate: ProviderTrackCandidate; source: CandidateSource; baseScore: number };
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
  lastOccurredAt: Date | null;
  lastRecommendedAt: Date | null;
  updatedAt: Date;
};
type TasteEventRecord = { entityKind: string; entityKey: string; provider: string | null; listenedMs: bigint; occurredAt: Date; updatedAt: Date };

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
      await this.projectTrack(transaction, userId, input.track, delta, occurredAt);
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
    await this.syncProviders(userId, false);
    const [entities, events, syncs] = await Promise.all([
      this.prisma.userTasteEntity.findMany({ where: { userId } }),
      this.prisma.userTasteEvent.findMany({ where: { userId, eventType: "playback" } }),
      this.prisma.userProviderProfileSync.findMany({ where: { userId }, orderBy: { lastSyncedAt: "desc" } })
    ]);
    const tracks = entities.filter((item) => item.entityKind === "track");
    const artists = entities.filter((item) => item.entityKind === "artist");
    const tags = entities.filter((item) => item.entityKind === "tag")
      .sort((left, right) => entityScore(right) - entityScore(left))
      .slice(0, 5)
      .map((item) => ({ label: item.title ?? item.entityKey, confidence: Number(item.confidence) }));
    const totalListenedMs = events.reduce((total, event) => total + Number(event.listenedMs), 0);
    const topTracks = tracks
      .map((item) => ({ item, candidate: entityToCandidate(item) }))
      .filter((value): value is { item: typeof entities[number]; candidate: ProviderTrackCandidate } => value.candidate !== null)
      .sort((left, right) => entityScore(right.item) - entityScore(left.item))
      .slice(0, 5)
      .map(({ item, candidate }) => ({
        ...candidate,
        score: entityScore(item),
        reasons: ["长期偏好"],
        listenedMs: Number(events.filter((event) => event.entityKey === item.entityKey).reduce((total, event) => total + event.listenedMs, BigInt(0))),
        playCount: events.filter((event) => event.entityKey === item.entityKey).length
      }));
    const sourceDistribution = (["netease", "qqmusic", "local_upload"] as const).map((source) => ({
      source,
      listenedMs: Number(events.filter((event) => event.provider === source).reduce((total, event) => total + event.listenedMs, BigInt(0)))
    })).filter((item) => item.listenedMs > 0);
    const version = profileVersion(entities, events);
    return {
      version,
      startedAt: events.map((event) => event.occurredAt).sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() ?? null,
      totalListenedMs,
      totalPlayCount: events.length,
      trackCount: tracks.filter((item) => item.interactionCount > 0).length,
      artistCount: artists.length,
      tasteTags: tags,
      topTracks,
      topArtists: artists.sort((left, right) => entityScore(right) - entityScore(left)).slice(0, 5).map((item) => ({
        name: item.title ?? item.entityKey,
        score: entityScore(item),
        listenedMs: 0,
        playCount: item.interactionCount
      })),
      sourceDistribution,
      syncs: syncs.filter((item) => item.provider === "netease" || item.provider === "qqmusic").map((item) => ({
        provider: item.provider as Provider,
        lastSyncedAt: item.lastSyncedAt.toISOString()
      }))
    };
  }

  async getRecommendations(
    userId: string,
    query: PersonalizationRecommendationsQuery
  ): Promise<PersonalizationRecommendationsResponse> {
    this.assertDatabaseAvailable();
    const syncs = await this.syncProviders(userId, false);
    const [entities, events, exclusions] = await Promise.all([
      this.prisma.userTasteEntity.findMany({ where: { userId } }),
      this.prisma.userTasteEvent.findMany({ where: { userId }, orderBy: { occurredAt: "desc" }, take: 50 }),
      this.prisma.userRecommendationExclusion.findMany({ where: { userId } })
    ]);
    const providers: Provider[] = syncs.flatMap((item) => item.synced ? [item.provider as Provider] : []);
    const version = profileVersion(entities, events);
    const cacheKey = `personalization:recall:${userId}:${version}:${query.surface}:${query.provider ?? "all"}`;
    const cached = this.redis.isAvailable()
      ? await this.redis.getJson<{ candidates: Candidate[]; playlists: ProviderPlaylistSummary[] }>(cacheKey).catch(() => null)
      : null;
    const recalled: { candidates: Candidate[]; playlists: ProviderPlaylistSummary[] } = cached ?? await this.recallCandidates(userId, entities, providers, query.provider);
    if (!cached && this.redis.isAvailable()) {
      await this.redis.setJson(cacheKey, recalled, recallCacheSeconds).catch(() => undefined);
    }
    const excludedTracks = new Set([
      ...(query.excludedTrackKeys ?? []),
      ...(query.currentTrackKey ? [query.currentTrackKey] : []),
      ...exclusions.filter((item) => item.targetKind === "track").map((item) => item.targetKey)
    ]);
    const excludedArtists = new Set(exclusions.filter((item) => item.targetKind === "artist").map((item) => item.targetKey));
    const ranked = rankCandidates(recalled.candidates, entities, events, excludedTracks, excludedArtists, query);
    const forYou = diversify(ranked.filter((item) => item.source !== "artist"), maxTracksPerSection);
    const selectedKeys = new Set(forYou.map((item) => trackKey(item)));
    const familiarArtists = diversify(ranked.filter((item) => item.source === "artist" && !selectedKeys.has(trackKey(item.candidate))), maxTracksPerSection);
    const playlists = rankPlaylists(recalled.playlists, entities).slice(0, 10);
    await this.markRecommended(userId, [...forYou, ...familiarArtists]);
    return { profileVersion: version, providers, forYou, familiarArtists, playlists };
  }

  async syncProviders(userId: string, force: boolean) {
    this.assertDatabaseAvailable();
    const [netease, qqmusic] = await Promise.all([
      this.syncProvider(userId, "netease", force),
      this.syncProvider(userId, "qqmusic", force)
    ]);
    return [netease, qqmusic];
  }

  async clearProfile(userId: string) {
    this.assertDatabaseAvailable();
    await this.prisma.$transaction([
      this.prisma.userTasteEvent.deleteMany({ where: { userId } }),
      this.prisma.userTasteEntity.deleteMany({ where: { userId } }),
      this.prisma.userProviderProfileSync.deleteMany({ where: { userId } }),
      this.prisma.userRecommendationExclusion.deleteMany({ where: { userId } })
    ]);
    await this.clearRecallCache(userId);
    return { ok: true };
  }

  private async syncProvider(userId: string, provider: Provider, force: boolean) {
    const existing = await this.prisma.userProviderProfileSync.findUnique({ where: { userId_provider: { userId, provider } } });
    if (!force && existing && Date.now() - existing.lastSyncedAt.getTime() < syncIntervalMs) {
      return { provider, synced: true, refreshed: false };
    }
    try {
      const snapshot = provider === "netease"
        ? await this.netease.getLibrarySnapshot(userId)
        : await this.qqmusic.getLibrarySnapshot(userId);
      const now = new Date();
      await this.prisma.$transaction(async (transaction) => {
        for (const track of snapshot.likedTracks) await this.projectSyncedTrack(transaction, userId, track, 7, now);
        for (const artist of snapshot.followedArtists) {
          await this.projectEntity(transaction, userId, "artist", artist.name, { provider, providerItemId: artist.providerArtistId, title: artist.name, artworkUrl: artist.artworkUrl, score: 4, occurredAt: now, retainScore: true });
        }
        for (const album of snapshot.collectedAlbums) {
          await this.projectEntity(transaction, userId, "album", `${provider}:${album.providerAlbumId}`, { provider, providerItemId: album.providerAlbumId, title: album.title, artist: album.artist, album: album.title, artworkUrl: album.artworkUrl, score: 2, occurredAt: now, retainScore: true });
        }
        for (const playlist of snapshot.collectedPlaylists) {
          await this.projectEntity(transaction, userId, "playlist", `${provider}:${playlist.providerPlaylistId}`, { provider, providerItemId: playlist.providerPlaylistId, title: playlist.title, artist: playlist.creatorName, artworkUrl: playlist.artworkUrl, score: 2, occurredAt: now, retainScore: true });
          for (const tag of extractTasteLabels(`${playlist.title} ${playlist.description ?? ""}`)) {
            await this.projectEntity(transaction, userId, "tag", tag, { title: tag, score: 0.8, occurredAt: now, retainScore: true });
          }
        }
        const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
        await transaction.userProviderProfileSync.upsert({
          where: { userId_provider: { userId, provider } },
          update: { snapshotHash, lastSyncedAt: now },
          create: { id: `provider_sync_${randomUUID()}`, userId, provider, snapshotHash, lastSyncedAt: now }
        });
      });
      await this.clearRecallCache(userId);
      return { provider, synced: true, refreshed: true };
    } catch {
      return { provider, synced: false, refreshed: false };
    }
  }

  private async recallCandidates(userId: string, entities: TasteEntityRecord[], providers: Provider[], preferredProvider?: Provider) {
    const orderedProviders = preferredProvider ? providers.filter((provider) => provider === preferredProvider) : providers;
    const recalls = await Promise.all(orderedProviders.map((provider) => this.recallProvider(userId, provider, entities)));
    return {
      candidates: recalls.flatMap((item) => item.candidates),
      playlists: recalls.flatMap((item) => item.playlists)
    };
  }

  private async recallProvider(userId: string, provider: Provider, entities: TasteEntityRecord[]) {
    const tracks = entities.filter((item) => item.entityKind === "track" && item.provider === provider);
    const artists = entities.filter((item) => item.entityKind === "artist" && (item.provider === provider || !item.provider));
    const playlists = entities.filter((item) => item.entityKind === "playlist" && item.provider === provider);
    const libraryCandidates = tracks.map(entityToCandidate).filter((item): item is ProviderTrackCandidate => item !== null)
      .map((candidate) => ({ candidate, source: "library" as const, baseScore: 0.9 }));
    const seed = libraryCandidates[0]?.candidate ?? null;
    const artist = typeof artists[0]?.title === "string" ? artists[0].title : null;
    const savedPlaylist = playlists[0];
    const external = await this.getProviderRecall(userId, provider, seed, artist, savedPlaylist);
    return { candidates: dedupeCandidates([...libraryCandidates, ...external.candidates]), playlists: external.playlists };
  }

  private async getProviderRecall(userId: string, provider: Provider, seed: ProviderTrackCandidate | null, artist: string | null, savedPlaylist: TasteEntityRecord | undefined) {
    const service = provider === "netease" ? this.netease : this.qqmusic;
    const candidates: Candidate[] = [];
    const playlists: ProviderPlaylistSummary[] = [];
    const tasks: Promise<void>[] = [];
    if (seed) tasks.push((async () => {
      const related = await service.getRelatedPlaylists(userId, seed.providerTrackId);
      const first = related.items[0];
      if (!first) return;
      playlists.push(first);
      const detail = await service.getPlaylist(userId, first.providerPlaylistId);
      candidates.push(...detail.tracks.slice(0, 24).map((candidate) => ({ candidate, source: "related" as const, baseScore: 0.82 })));
    })().catch(() => undefined));
    if (artist) tasks.push((async () => {
      const result = await service.searchTracks(userId, { keywords: artist, limit: 12, offset: 0 });
      candidates.push(...result.items.map((candidate) => ({ candidate, source: "artist" as const, baseScore: 0.68 })));
      const found = await service.searchPlaylists(userId, { keywords: artist, limit: 6, offset: 0 });
      playlists.push(...found.items);
    })().catch(() => undefined));
    const savedPlaylistId = savedPlaylist?.providerItemId;
    if (typeof savedPlaylistId === "string") tasks.push((async () => {
      const detail = await service.getPlaylist(userId, savedPlaylistId);
      candidates.push(...detail.tracks.slice(0, 24).map((candidate) => ({ candidate, source: "playlist" as const, baseScore: 0.78 })));
    })().catch(() => undefined));
    await Promise.all(tasks);
    return { candidates, playlists: dedupePlaylists(playlists) };
  }

  private async projectTrack(transaction: Prisma.TransactionClient, userId: string, track: PersonalizationTrackInput, score: number, occurredAt: Date) {
    await this.projectEntity(transaction, userId, "track", trackKey(track), { provider: track.provider, providerItemId: track.providerTrackId, providerAlbumId: track.providerAlbumId ?? null, access: track.access, quality: track.quality, title: track.title, artist: track.artist, album: track.album, durationMs: track.durationMs, artworkUrl: track.artworkUrl, score, occurredAt });
    await this.projectEntity(transaction, userId, "artist", normalizeText(track.artist), { title: track.artist, score: score * 0.55, occurredAt });
    if (track.album) await this.projectEntity(transaction, userId, "album", `${track.provider}:${track.providerAlbumId ?? normalizeText(track.album)}`, { provider: track.provider, providerItemId: track.providerAlbumId ?? null, title: track.album, artist: track.artist, album: track.album, score: score * 0.25, occurredAt });
    await this.projectEntity(transaction, userId, "source", track.provider, { title: track.provider, score: score * 0.1, occurredAt });
  }

  private async projectSyncedTrack(transaction: Prisma.TransactionClient, userId: string, track: ProviderTrackCandidate, score: number, occurredAt: Date) {
    await this.projectEntity(transaction, userId, "track", trackKey(track), { provider: track.provider, providerItemId: track.providerTrackId, providerAlbumId: track.providerAlbumId ?? null, access: track.access, quality: track.quality, title: track.title, artist: track.artist, album: track.album, durationMs: track.durationMs, artworkUrl: track.artworkUrl, score, occurredAt, retainScore: true });
    await this.projectEntity(transaction, userId, "artist", normalizeText(track.artist), { title: track.artist, score: score * 0.55, occurredAt, retainScore: true });
  }

  private async projectEntity(transaction: Prisma.TransactionClient, userId: string, kind: TasteEntityKind, key: string, input: Record<string, unknown> & { score: number; occurredAt: Date; retainScore?: boolean }) {
    const existing = await transaction.userTasteEntity.findUnique({ where: { userId_entityKind_entityKey: { userId, entityKind: kind, entityKey: key } } });
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
    if (!existing) {
      await transaction.userTasteEntity.create({ data: { id: `taste_entity_${randomUUID()}`, userId, entityKind: kind, entityKey: key, ...data, positiveScore, negativeScore, confidence: Math.min(1, Math.abs(input.score) / 7), interactionCount: 1 } });
      return;
    }
    await transaction.userTasteEntity.update({
      where: { id: existing.id },
      data: {
        ...data,
        positiveScore: input.retainScore ? Math.max(existing.positiveScore, positiveScore) : { increment: positiveScore },
        negativeScore: input.retainScore ? Math.max(existing.negativeScore, negativeScore) : { increment: negativeScore },
        confidence: Math.min(1, existing.confidence + Math.abs(input.score) * 0.04),
        interactionCount: { increment: input.retainScore ? 0 : 1 }
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
    const keys = await this.redis.client.keys(`personalization:recall:${userId}:*`).catch(() => []);
    if (keys.length) await this.redis.client.del(...keys).catch(() => undefined);
  }

  private assertDatabaseAvailable() {
    if (!this.prisma.isAvailable()) throw new ServiceUnavailableException("Personalization storage is temporarily unavailable.");
  }
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

function rankCandidates(candidates: Candidate[], entities: TasteEntityRecord[], events: TasteEventRecord[], excludedTracks: Set<string>, excludedArtists: Set<string>, _query: PersonalizationRecommendationsQuery) {
  const trackEntities = new Map(entities.filter((item) => item.entityKind === "track").map((item) => [item.entityKey, item]));
  const artistEntities = new Map(entities.filter((item) => item.entityKind === "artist").map((item) => [item.entityKey, item]));
  const sessionTrackKeys = new Set(events.filter((item) => item.entityKind === "track" && item.occurredAt instanceof Date && Date.now() - item.occurredAt.getTime() <= sessionWindowMs).map((item) => String(item.entityKey)));
  const seenThreshold = Date.now() - 30 * 24 * 60 * 60 * 1_000;
  return dedupeCandidates(candidates).flatMap((item) => {
    const key = trackKey(item.candidate);
    const artistKey = normalizeText(item.candidate.artist);
    if (excludedTracks.has(key) || excludedArtists.has(artistKey)) return [];
    const trackScore = trackEntities.get(key) ? entityScore(trackEntities.get(key)!) : 0;
    const artistScore = artistEntities.get(artistKey) ? entityScore(artistEntities.get(artistKey)!) : 0;
    const sessionScore = sessionTrackKeys.has(key) ? 0.18 : 0;
    const availability = item.candidate.access === "free" ? 0.1 : item.candidate.access === "unknown" ? 0.05 : 0;
    const seenAt = entityDate(trackEntities.get(key), "lastRecommendedAt");
    const seenPenalty = seenAt && seenAt.getTime() > seenThreshold ? 0.16 : 0;
    const sourceScore = item.source === "library" ? 0.2 : item.source === "related" ? 0.15 : item.source === "playlist" ? 0.12 : item.source === "artist" ? 0.09 : 0.05;
    const score = item.baseScore * 0.32 + normalizeScore(trackScore) * 0.28 + normalizeScore(artistScore) * 0.18 + sessionScore + availability + sourceScore - seenPenalty;
    const reasons = [item.source === "library" ? "来自你的收藏" : item.source === "related" ? "延续你的常听歌曲" : item.source === "playlist" ? "来自收藏歌单" : "常听艺人"];
    if (sessionScore) reasons.push("延续当前会话");
    return [{ ...item, score, reasons }];
  }).sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title));
}

function diversify(items: Array<Candidate & { score: number; reasons: string[] }>, limit: number) {
  const selected: Array<ProviderTrackCandidate & { score: number; reasons: string[] }> = [];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const item of items) {
    if (selected.length >= limit) break;
    const artist = normalizeText(item.candidate.artist);
    const album = normalizeText(item.candidate.album ?? "");
    if ((artistCounts.get(artist) ?? 0) >= 2 || (album && (albumCounts.get(album) ?? 0) >= 3) || (sourceCounts.get(item.source) ?? 0) >= Math.ceil(limit * 0.65)) continue;
    selected.push({ ...item.candidate, score: item.score, reasons: item.reasons });
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    if (album) albumCounts.set(album, (albumCounts.get(album) ?? 0) + 1);
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
  }
  return selected;
}

function rankPlaylists(playlists: ProviderPlaylistSummary[], entities: TasteEntityRecord[]) {
  const artistNames = new Set(entities.filter((item) => item.entityKind === "artist").map((item) => normalizeText(String(item.title ?? ""))));
  return dedupePlaylists(playlists).map((playlist) => {
    const matchedArtist = artistNames.has(normalizeText(playlist.creatorName ?? ""));
    return { ...playlist, score: 0.5 + (matchedArtist ? 0.25 : 0) + Math.min(0.2, playlist.trackCount / 2_000), reasons: matchedArtist ? ["常听艺人"] : ["为你挑选"] };
  }).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
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

function normalizeScore(score: number) {
  return 0.5 + Math.tanh(score / 8) * 0.5;
}

function entityDate(entity: TasteEntityRecord | undefined, key: "lastRecommendedAt") {
  return entity?.[key] ?? null;
}

function extractTasteLabels(value: string) {
  const ignored = new Set(["歌单", "音乐", "收藏", "喜欢", "我的", "playlist"]);
  return value.split(/[\s,，、/|·:：()（）【】\]-]+/).map((item) => item.trim()).filter((item) => item.length >= 2 && item.length <= 12 && !ignored.has(item.toLocaleLowerCase())).slice(0, 3);
}

function profileVersion(entities: TasteEntityRecord[], events: TasteEventRecord[]) {
  const latest = Math.max(
    0,
    ...entities.map((item) => item.updatedAt.getTime()),
    ...events.map((item) => item.updatedAt.getTime())
  );
  return `${entities.length}:${events.length}:${latest}`;
}
