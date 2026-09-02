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
import { RoomService } from "../room/room.service";
import {
  accessScore,
  dedupeCandidates,
  dedupePlaylists,
  partitionDiscoveryRecommendations,
  rankRecommendationCandidates,
  rerankRecommendationCandidates,
  selectPersonalizedPlaylists,
  trackIdentity,
  type RecommendationCandidate
} from "./recommendation-engine";
import { buildTasteGroups, extractTasteEvidence } from "./taste-taxonomy";

const recallCacheSeconds = 30 * 60;
const recallEpochSeconds = 30 * 24 * 60 * 60;
const recommendedRememberSeconds = 7 * 24 * 60 * 60;
const longTermHalfLifeMs = 120 * 24 * 60 * 60 * 1_000;
const sessionWindowMs = 2 * 60 * 60 * 1_000;
const maxTracksPerSection = 16;
const compactionCutoffDays = 30;
const compactionTriggerProbability = 0.05;

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
  private readonly recallEpochFallback = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly netease: NeteaseService,
    private readonly qqmusic: QqMusicService,
    private readonly roomService: RoomService
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
    // Plain playback heartbeats only nudge entity scores by tiny increments;
    // invalidating the recall cache on every one of them kept the cache
    // permanently cold during playback. Substantive events (favorite, skip,
    // manual selection, …) still refresh recommendations immediately.
    if (input.type !== "playback") {
      await this.bumpRecallEpoch(userId);
    }
    // Opportunistic maintenance: merge aged duplicate playback rows so the
    // event table stays proportional to distinct listening history.
    if (Math.random() < compactionTriggerProbability) {
      void this.compactPlaybackEvents(userId).catch(() => undefined);
    }
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
    await this.bumpRecallEpoch(userId);
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
    await this.bumpRecallEpoch(userId);
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
    const epoch = await this.getRecallEpoch(userId);
    const cacheKey = `personalization:recall:v4:${userId}:${epoch}:${query.surface}:${query.provider ?? "all"}`;
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
    const recentlyRecommendedKeys = this.redis.isAvailable()
      ? new Set(await this.redis.client.smembers(`personalization:recommended:${userId}`).catch(() => []))
      : new Set<string>();
    const ranked = rankRecommendationCandidates({
      candidates: recalled.candidates,
      entities,
      events,
      excludedTracks,
      excludedIdentities,
      excludedArtists,
      recentlyRecommendedKeys,
      surface: query.surface,
      scoreEntity: entityScore
    });
    const discoverSections = query.surface === "discover"
      ? partitionDiscoveryRecommendations(ranked, maxTracksPerSection)
      : null;
    const forYou = discoverSections?.forYou ?? rerankRecommendationCandidates({
      items: ranked.filter((item) => item.source !== "artist"),
      limit: maxTracksPerSection,
      explorationRatio: 0.08
    });
    const familiarArtists = discoverSections?.familiarArtists ?? rerankRecommendationCandidates({
      items: ranked.filter((item) => item.source === "artist" && !new Set(forYou.map(trackKey)).has(trackKey(item.candidate))),
      limit: maxTracksPerSection,
      explorationRatio: 0
    });
    const moodDiscovery = discoverSections?.moodDiscovery ?? [];
    const deepCuts = discoverSections?.deepCuts ?? [];
    const playlists = selectPersonalizedPlaylists({ playlists: recalled.playlists, entities, limit: 10, scoreEntity: entityScore });
    await this.markRecommended(userId, [...forYou, ...familiarArtists, ...moodDiscovery, ...deepCuts]);

    // Build Daily Radar mix
    const dailyRadarTracks = dedupeCandidates(
      [...forYou, ...deepCuts, ...familiarArtists].map((candidate) => ({
        candidate,
        source: "related" as const,
        baseScore: candidate.score,
        interestKey: trackKey(candidate),
        interestLabel: candidate.title
      }))
    ).slice(0, 30).map((c) => ({ ...c.candidate, score: c.baseScore, reasons: ["今日私享雷达精选"] }));

    const genreSet = new Set<string>();
    for (const track of dailyRadarTracks) {
      const evidence = extractTasteEvidence({ title: track.title, artist: track.artist, album: track.album, providerTags: track.tags });
      evidence.filter((e) => e.dimension === "genre").forEach((e) => genreSet.add(e.label));
    }
    const summaryGenres = [...genreSet].slice(0, 4);

    const dailyRadar = query.surface === "discover" && dailyRadarTracks.length > 0 ? {
      date: new Date().toISOString().slice(0, 10),
      title: "Music Room 每日心动雷达",
      subtitle: `根据你最近的品味定制，已融合 ${summaryGenres.length ? summaryGenres.join("、") : "流行与常听"} 风格`,
      tracks: dailyRadarTracks,
      summaryGenres
    } : undefined;

    // Fetch Live Rooms for collaborative discovery
    let liveRooms: PersonalizationRecommendationsResponse["liveRooms"] = undefined;
    if (query.surface === "discover") {
      const publicRooms = await this.roomService.listPublicRooms().catch(() => []);

      liveRooms = publicRooms.slice(0, 6).map((snapshot) => {
        const hostMember = snapshot.room.members.find((member) => member.id === snapshot.room.hostId);
        const onlineCount = snapshot.room.members.filter(
          (member) => member.presenceState === "online" && !!member.peerId
        ).length;
        const currentTrack = snapshot.room.playback.currentTrackId
          ? snapshot.tracks.find((track) => track.id === snapshot.room.playback.currentTrackId) ?? null
          : null;

        return {
          roomId: snapshot.room.id,
          roomTitle: snapshot.room.name ?? "未命名房间",
          hostName: hostMember?.nickname || "房主",
          mode: snapshot.room.roomType === "radio"
            ? "radio"
            : snapshot.room.roomType === "request"
              ? "request"
              : "common",
          listenerCount: onlineCount,
          currentTrack: currentTrack?.title ? {
            title: currentTrack.title,
            artist: currentTrack.artist,
            artworkUrl: currentTrack.artworkUrl ?? null
          } : null
        };
      });
    }

    return { profileVersion: profileVersion(entities, events), providers, forYou, familiarArtists, moodDiscovery, deepCuts, playlists, dailyRadar, liveRooms };
  }

  async getTrackRadio(
    userId: string,
    query: import("@music-room/shared").TrackRadioQuery
  ): Promise<import("@music-room/shared").PersonalizationTrack[]> {
    this.assertDatabaseAvailable();
    const seed = query.seedTrack;
    const providers = await this.getBoundProviders(userId);
    const targetProvider: Provider = (seed.provider === "netease" || seed.provider === "qqmusic")
      ? seed.provider
      : (providers[0] ?? "netease");

    const candidates: Candidate[] = [];
    const service = targetProvider === "netease" ? this.netease : this.qqmusic;

    if (seed.artist) {
      const artistResult = await service.searchTracks(userId, { keywords: seed.artist, limit: 24, offset: 0 }).catch(() => null);
      if (artistResult?.items.length) {
        candidates.push(...artistResult.items.map((candidate) => ({
          candidate,
          source: "artist" as const,
          baseScore: 0.8,
          interestKey: `artist:${normalizeText(seed.artist)}`,
          interestLabel: seed.artist
        })));
      }
    }

    const evidence = extractTasteEvidence({
      title: seed.title,
      artist: seed.artist,
      album: seed.album,
      providerTags: seed.providerTags
    });
    const genreLabels = evidence.filter((e) => e.dimension === "genre" || e.dimension === "scene").map((e) => e.label).slice(0, 2);
    for (const label of genreLabels) {
      const genreResult = await service.searchTracks(userId, { keywords: label, limit: 16, offset: 0 }).catch(() => null);
      if (genreResult?.items.length) {
        candidates.push(...genreResult.items.map((candidate) => ({
          candidate,
          source: "explore" as const,
          baseScore: 0.7,
          interestKey: `taste:${normalizeText(label)}`,
          interestLabel: label
        })));
      }
    }

    if (seed.providerTrackId && (seed.provider === "netease" || seed.provider === "qqmusic")) {
      const related = await service.getRelatedPlaylists(userId, seed.providerTrackId).catch(() => null);
      if (related?.items.length) {
        const details = await Promise.all(related.items.slice(0, 2).map((p) => service.getPlaylist(userId, p.providerPlaylistId).catch(() => null)));
        details.filter((d): d is NonNullable<typeof d> => d !== null).forEach((detail) => {
          candidates.push(...detail.tracks.slice(0, 15).map((candidate) => ({
            candidate,
            source: "related" as const,
            baseScore: 0.75,
            interestKey: `seed:${trackIdentity(seed)}`,
            interestLabel: seed.title
          })));
        });
      }
    }

    const exclusions = await this.prisma.userRecommendationExclusion.findMany({ where: { userId } });
    const excludedKeys = new Set([
      ...(query.excludedTrackKeys ?? []),
      ...exclusions.filter((e) => e.targetKind === "track").map((e) => e.targetKey)
    ]);

    const { buildTrackRadioRecommendations } = await import("./recommendation-engine");
    return buildTrackRadioRecommendations({
      seedTrack: seed,
      candidates,
      excludedTrackKeys: excludedKeys,
      limit: query.limit
    });
  }

  async bootstrapColdStartProfile(
    userId: string,
    input: import("@music-room/shared").ColdStartTasteInput
  ): Promise<{ ok: boolean }> {
    this.assertDatabaseAvailable();
    const now = new Date();
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const label of input.selectedLabels) {
      ops.push(
        this.prisma.userTasteEntity.upsert({
          where: { userId_entityKind_entityKey: { userId, entityKind: "genre", entityKey: `seed:${normalizeText(label)}` } },
          create: {
            id: randomUUID(),
            userId,
            entityKind: "genre",
            entityKey: `seed:${normalizeText(label)}`,
            title: label,
            positiveScore: 8.0,
            negativeScore: 0,
            confidence: 0.95,
            durationMs: 0,
            updatedAt: now
          },
          update: {
            positiveScore: 8.0,
            confidence: 0.95,
            updatedAt: now
          }
        })
      );
    }

    if (input.initialArtists?.length) {
      for (const artist of input.initialArtists) {
        ops.push(
          this.prisma.userTasteEntity.upsert({
            where: { userId_entityKind_entityKey: { userId, entityKind: "artist", entityKey: `seed:artist:${normalizeText(artist)}` } },
            create: {
              id: randomUUID(),
              userId,
              entityKind: "artist",
              entityKey: `seed:artist:${normalizeText(artist)}`,
              title: artist,
              positiveScore: 9.0,
              negativeScore: 0,
              confidence: 0.95,
              durationMs: 0,
              updatedAt: now
            },
            update: {
              positiveScore: 9.0,
              confidence: 0.95,
              updatedAt: now
            }
          })
        );
      }
    }

    await this.prisma.$transaction(ops);
    await this.bumpRecallEpoch(userId);
    return { ok: true };
  }

  async clearProfile(userId: string) {
    this.assertDatabaseAvailable();
    await this.prisma.$transaction([
      this.prisma.userTasteEvent.deleteMany({ where: { userId } }),
      this.prisma.userTasteEntity.deleteMany({ where: { userId } }),
      this.prisma.userRecommendationExclusion.deleteMany({ where: { userId } })
    ]);
    await this.bumpRecallEpoch(userId);
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
    const artistNames = artists.flatMap((item) => typeof item.title === "string" ? [item.title] : []).filter((name, index, names) => names.findIndex((item) => normalizeText(item) === normalizeText(name)) === index).slice(0, 4);
    const tasteNames = tasteTerms.flatMap((item) => typeof item.title === "string" && entityScore(item) > 0 ? [item.title] : []).filter((name, index, names) => names.findIndex((item) => normalizeText(item) === normalizeText(name)) === index).slice(0, 2);
    const playlistQueries = [...new Set([tasteNames[0], artistNames[0]].filter((value): value is string => Boolean(value)))].slice(0, 2);
    const savedPlaylist = surface === "discover" ? undefined : playlists[0];
    const external = await this.getProviderRecall(userId, provider, seed, artistNames, tasteNames, playlistQueries, savedPlaylist, surface);
    return {
      candidates: dedupeCandidates([...(surface === "discover" ? [] : libraryCandidates), ...external.candidates]),
      playlists: external.playlists
    };
  }

  private async getProviderRecall(userId: string, provider: Provider, seed: ProviderTrackCandidate | null, artists: string[], tasteNames: string[], playlistQueries: string[], savedPlaylist: TasteEntityRecord | undefined, surface: PersonalizationRecommendationsQuery["surface"]) {
    const service = provider === "netease" ? this.netease : this.qqmusic;
    const candidates: Candidate[] = [];
    const playlists: ProviderPlaylistSummary[] = [];
    const tasks: Promise<void>[] = [];
    if (seed) tasks.push((async () => {
      const related = await service.getRelatedPlaylists(userId, seed.providerTrackId);
      playlists.push(...related.items.slice(0, 6));
      const details = await Promise.all(related.items.slice(0, 2).map((playlist) => service.getPlaylist(userId, playlist.providerPlaylistId).catch(() => null)));
      details.filter((detail) => detail !== null).forEach((detail) => {
        candidates.push(...detail.tracks.slice(0, 20).map((candidate) => ({ candidate, source: "related" as const, baseScore: 0.82, interestKey: `track:${trackIdentity(seed)}`, interestLabel: seed.title })));
      });
    })().catch(() => undefined));
    if (artists.length) tasks.push((async () => {
      for (const artist of artists) {
        const result = await service.searchTracks(userId, { keywords: artist, limit: 12, offset: 0 });
        candidates.push(...result.items.map((candidate) => ({ candidate, source: "artist" as const, baseScore: 0.68, interestKey: `artist:${normalizeText(artist)}`, interestLabel: artist })));
      }
    })().catch(() => undefined));
    if (tasteNames.length) tasks.push((async () => {
      for (const tasteName of tasteNames) {
        const result = await service.searchTracks(userId, { keywords: tasteName, limit: 12, offset: 0 });
        candidates.push(...result.items.map((candidate) => ({ candidate, source: "explore" as const, baseScore: 0.62, interestKey: `taste:${normalizeText(tasteName)}`, interestLabel: tasteName })));
      }
    })().catch(() => undefined));
    if (playlistQueries.length) tasks.push((async () => {
      const results = await Promise.all(playlistQueries.map((playlistQuery) => service.searchPlaylists(userId, { keywords: playlistQuery, limit: 6, offset: 0 }).catch(() => null)));
      for (const result of results) {
        if (!result) continue;
        const summaries = surface === "discover" ? await keepMultiArtistPlaylists(userId, service, result.items.slice(0, 2)) : result.items;
        playlists.push(...summaries);
      }
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
    const existing = await transaction.userTasteEntity.findUnique({
      where: { userId_entityKind_entityKey: { userId, entityKind: kind, entityKey: key } }
    });
    if (!existing) {
      await transaction.userTasteEntity.create({
        data: {
          id: `taste_entity_${randomUUID()}`,
          userId,
          entityKind: kind,
          entityKey: key,
          ...data,
          positiveScore,
          negativeScore,
          confidence: Math.min(1, input.confidence ?? Math.abs(input.score) / 7),
          interactionCount: 1
        }
      });
      return;
    }
    // Incremental half-life decay: stored scores are aged down to the new
    // event time before the fresh weight is added. Without this, long-term
    // scores grew unbounded and crowded out all exploration.
    const elapsedMs = Math.max(0, input.occurredAt.getTime() - (existing.lastOccurredAt?.getTime() ?? input.occurredAt.getTime()));
    const decay = Math.pow(0.5, elapsedMs / longTermHalfLifeMs);
    await transaction.userTasteEntity.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(input.retainScore
          ? { positiveScore: Math.max(0, positiveScore), negativeScore: Math.max(0, negativeScore) }
          : {
              positiveScore: existing.positiveScore * decay + positiveScore,
              negativeScore: existing.negativeScore * decay + negativeScore
            }),
        confidence: Math.min(1, existing.confidence + Math.min(0.1, input.confidence ?? Math.abs(input.score) * 0.04)),
        interactionCount: { increment: input.retainScore || input.incrementInteraction === false ? 0 : 1 }
      }
    });
  }

  /**
   * Recent recommendations live in Redis only: creating taste entities for
   * tracks the user never played polluted the profile table and grew it with
   * every discover request. The ranking engine applies the repetition penalty
   * through the key set below.
   */
  private async markRecommended(userId: string, tracks: ProviderTrackCandidate[]) {
    if (tracks.length === 0 || !this.redis.isAvailable()) return;
    const key = `personalization:recommended:${userId}`;
    try {
      await this.redis.client.sadd(key, ...tracks.map((candidate) => trackKey(candidate)));
      await this.redis.client.expire(key, recommendedRememberSeconds);
    } catch {
      // Forgetting a repetition penalty is harmless; never block the response.
    }
  }

  /**
   * Recall results are cached under a per-user epoch that only advances on
   * substantive taste changes. This keeps the cache warm during plain
   * listening (heartbeats never invalidate) and avoids KEYS scans entirely —
   * superseded epoch keys simply expire by TTL.
   */
  private async bumpRecallEpoch(userId: string) {
    const key = `personalization:recall-epoch:${userId}`;
    if (!this.redis.isAvailable()) {
      this.recallEpochFallback.set(userId, (this.recallEpochFallback.get(userId) ?? 0) + 1);
      return;
    }
    try {
      await this.redis.client.incr(key);
      await this.redis.client.expire(key, recallEpochSeconds);
    } catch {
      this.recallEpochFallback.set(userId, (this.recallEpochFallback.get(userId) ?? 0) + 1);
    }
  }

  private async getRecallEpoch(userId: string): Promise<number> {
    if (!this.redis.isAvailable()) {
      return this.recallEpochFallback.get(userId) ?? 0;
    }
    try {
      const value = await this.redis.client.get(`personalization:recall-epoch:${userId}`);
      const parsed = value ? Number(value) : 0;
      return Number.isFinite(parsed) ? parsed : this.recallEpochFallback.get(userId) ?? 0;
    } catch {
      return this.recallEpochFallback.get(userId) ?? 0;
    }
  }

  /**
   * Merge aged duplicate playback rows of the same track into their oldest
   * row (listening time and weight accumulate), keeping the event table
   * proportional to distinct listening history instead of raw sessions.
   * Completion/quick-skip rows are left untouched: the behavior tag ratios
   * depend on them staying separate.
   */
  private async compactPlaybackEvents(userId: string) {
    const cutoff = new Date(Date.now() - compactionCutoffDays * 24 * 60 * 60 * 1_000);
    const rows = await this.prisma.userTasteEvent.findMany({
      where: { userId, eventType: "playback", occurredAt: { lt: cutoff } },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
    });
    if (rows.length < 2) return;

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = groups.get(row.entityKey) ?? [];
      group.push(row);
      groups.set(row.entityKey, group);
    }

    const operations: Prisma.PrismaPromise<unknown>[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const keeper = group[0]!;
      const mergedListenedMs = group.reduce((total, row) => total + row.listenedMs, BigInt(0));
      const mergedWeight = group.reduce((total, row) => total + row.weight, 0);
      operations.push(
        this.prisma.userTasteEvent.update({
          where: { id: keeper.id },
          data: { listenedMs: mergedListenedMs, weight: mergedWeight }
        }),
        this.prisma.userTasteEvent.deleteMany({
          where: { id: { in: group.slice(1).map((row) => row.id) } }
        })
      );
    }
    if (operations.length > 0) {
      await this.prisma.$transaction(operations);
    }
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
