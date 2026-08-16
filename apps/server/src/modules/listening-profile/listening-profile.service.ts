import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ListeningProfileProvider,
  ListeningProfileResponse,
  ListeningProfileDiscoverContext,
  ListeningProfileTrack,
  ListeningTrackMetadata,
  ListeningTrackMetadataStatus,
  ListeningTrackMetadataTag,
  RecordListeningProfileEvent,
  ResolveListeningTrackMetadata
} from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RecommendationsService } from "../recommendations/recommendations.service";

const timeBandIds = ["morning", "afternoon", "evening", "late-night"] as const;

@Injectable()
export class ListeningProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationsService
  ) {}

  async recordEvent(userId: string, input: RecordListeningProfileEvent) {
    this.assertDatabaseAvailable();
    await this.prisma.$transaction(async (transaction) => {
      const existingEvent = await transaction.userListeningEvent.findUnique({
        where: { userId_clientEventId: { userId, clientEventId: input.id } }
      });

      if (existingEvent && (
        existingEvent.eventType !== input.type ||
        existingEvent.candidateKey !== input.track.key
      )) {
        throw new BadRequestException("Listening event id conflicts with an existing event.");
      }

      const occurredAt = new Date(input.occurredAt);
      const previousListenedMs = existingEvent ? Number(existingEvent.listenedMs) : 0;
      const listenedMs = input.type === "playback" ? input.listenedMs : 0;
      const listenedDelta = Math.max(0, listenedMs - previousListenedMs);
      const completedDelta = input.type === "playback" && input.completed && !existingEvent?.completed ? 1 : 0;
      const quickSkipDelta = input.type === "playback" && input.quickSkipped && !existingEvent?.quickSkipped ? 1 : 0;
      const isNewPlayback = !existingEvent && input.type === "playback";

      if (existingEvent) {
        await transaction.userListeningEvent.update({
          where: { id: existingEvent.id },
          data: {
            title: input.track.title,
            artist: input.track.artist,
            album: input.track.album,
            durationMs: input.track.durationMs,
            listenedMs: BigInt(listenedMs),
            completed: input.type === "playback" ? existingEvent.completed || input.completed : existingEvent.completed,
            quickSkipped: input.type === "playback" ? existingEvent.quickSkipped || input.quickSkipped : existingEvent.quickSkipped
          }
        });
      } else {
        await transaction.userListeningEvent.create({
          data: {
            id: `listening_event_${randomUUID()}`,
            userId,
            clientEventId: input.id,
            eventType: input.type,
            candidateKey: input.track.key,
            provider: input.track.provider,
            providerTrackId: input.track.providerTrackId,
            title: input.track.title,
            artist: input.track.artist,
            album: input.track.album,
            durationMs: input.track.durationMs,
            listenedMs: BigInt(listenedMs),
            completed: input.type === "playback" && input.completed,
            quickSkipped: input.type === "playback" && input.quickSkipped,
            timezoneOffsetMinutes: input.type === "playback" ? input.timezoneOffsetMinutes : 0,
            occurredAt
          }
        });
      }

      const existingTrack = await transaction.userListeningTrack.findUnique({
        where: { userId_candidateKey: { userId, candidateKey: input.track.key } }
      });
      const favoritePatch = input.type === "favorite"
        ? true
        : input.type === "unfavorite"
          ? false
          : existingTrack?.isFavorite ?? false;
      const firstPlayedAt = isNewPlayback ? occurredAt : existingTrack?.firstPlayedAt ?? null;
      const lastPlayedAt = input.type === "playback"
        ? laterDate(existingTrack?.lastPlayedAt ?? null, occurredAt)
        : existingTrack?.lastPlayedAt ?? null;

      await transaction.userListeningTrack.upsert({
        where: { userId_candidateKey: { userId, candidateKey: input.track.key } },
        update: {
          provider: input.track.provider,
          providerTrackId: input.track.providerTrackId,
          title: input.track.title,
          artist: input.track.artist,
          album: input.track.album,
          durationMs: input.track.durationMs,
          artworkUrl: input.track.artworkUrl ?? null,
          listenedMs: { increment: BigInt(listenedDelta) },
          playCount: { increment: isNewPlayback ? 1 : 0 },
          completionCount: { increment: completedDelta },
          quickSkipCount: { increment: quickSkipDelta },
          isFavorite: favoritePatch,
          ...(firstPlayedAt ? { firstPlayedAt } : {}),
          ...(lastPlayedAt ? { lastPlayedAt } : {})
        },
        create: {
          id: `listening_track_${randomUUID()}`,
          userId,
          candidateKey: input.track.key,
          provider: input.track.provider,
          providerTrackId: input.track.providerTrackId,
          title: input.track.title,
          artist: input.track.artist,
          album: input.track.album,
          durationMs: input.track.durationMs,
          artworkUrl: input.track.artworkUrl ?? null,
          listenedMs: BigInt(listenedDelta),
          playCount: isNewPlayback ? 1 : 0,
          completionCount: completedDelta,
          quickSkipCount: quickSkipDelta,
          isFavorite: favoritePatch,
          firstPlayedAt,
          lastPlayedAt
        }
      });
    });
    return { ok: true };
  }

  async getProfile(userId: string): Promise<ListeningProfileResponse> {
    this.assertDatabaseAvailable();
    const [tracks, playbackEvents] = await Promise.all([
      this.prisma.userListeningTrack.findMany({ where: { userId } }),
      this.prisma.userListeningEvent.findMany({
        where: { userId, eventType: "playback", listenedMs: { gt: 0 } },
        orderBy: { occurredAt: "desc" },
        select: {
          candidateKey: true,
          provider: true,
          providerTrackId: true,
          title: true,
          artist: true,
          album: true,
          durationMs: true,
          listenedMs: true,
          timezoneOffsetMinutes: true,
          occurredAt: true
        }
      })
    ]);

    const metadataKeys = tracks.map((track) => track.candidateKey);
    const metadata = metadataKeys.length > 0
      ? await this.prisma.listeningTrackMetadata.findMany({
          where: { trackKey: { in: metadataKeys }, status: "resolved" },
          select: { trackKey: true, tags: true }
        })
      : [];
    const metadataByKey = new Map(metadata.map((item) => [item.trackKey, toMetadataTags(item.tags)]));
    const normalizedTracks = tracks.map(toProfileTrack);
    const totalListenedMs = normalizedTracks.reduce((total, track) => total + track.listenedMs, 0);
    const listenedTracks = normalizedTracks.filter((track) => track.playCount > 0);
    const artists = aggregateArtists(normalizedTracks);
    const topPlayedTracks = [...listenedTracks]
      .sort(comparePlayedTracks)
      .slice(0, 5);
    const favoriteTracks = [...normalizedTracks]
      .filter((track) => track.isFavorite || track.completionCount > 0 || track.playCount > 0)
      .sort(compareFavoriteTracks)
      .slice(0, 5);
    const timeBands = aggregateTimeBands(playbackEvents);
    const sourceDistribution = aggregateSources(normalizedTracks);
    const recent = playbackEvents.slice(0, 10).map((event) => ({
      key: event.candidateKey,
      provider: event.provider as ListeningProfileProvider,
      providerTrackId: event.providerTrackId,
      title: event.title,
      artist: event.artist,
      album: event.album,
      durationMs: event.durationMs,
      listenedMs: Number(event.listenedMs),
      occurredAt: event.occurredAt.toISOString()
    }));
    const earliestPlayedAt = tracks
      .map((track) => track.firstPlayedAt)
      .filter((value): value is Date => !!value)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;

    return {
      startedAt: earliestPlayedAt?.toISOString() ?? null,
      totalListenedMs,
      totalPlayCount: normalizedTracks.reduce((total, track) => total + track.playCount, 0),
      trackCount: listenedTracks.length,
      artistCount: new Set(listenedTracks.map((track) => normalizeArtist(track.artist))).size,
      topPlayedTracks,
      favoriteTracks,
      topArtists: artists.slice(0, 5),
      timeBands,
      sourceDistribution,
      recent,
      tasteTags: deriveTasteTags(normalizedTracks, metadataByKey)
    };
  }

  async getDiscoverContext(userId: string): Promise<ListeningProfileDiscoverContext> {
    this.assertDatabaseAvailable();
    const tracks = await this.prisma.userListeningTrack.findMany({ where: { userId } });
    const normalizedTracks = tracks.map(toProfileTrack);
    const metadataKeys = normalizedTracks.map((track) => track.key);
    const metadata = metadataKeys.length > 0
      ? await this.prisma.listeningTrackMetadata.findMany({
          where: { trackKey: { in: metadataKeys }, status: "resolved" },
          select: { trackKey: true, tags: true }
        })
      : [];
    const metadataByKey = new Map(metadata.map((item) => [item.trackKey, toMetadataTags(item.tags)]));
    const seedTracks = normalizedTracks
      .filter((track) => track.provider === "netease" || track.provider === "qqmusic")
      .filter((track) => track.playCount > 0 || track.isFavorite || track.completionCount > 0)
      .sort(compareDiscoverSeedTracks)
      .slice(0, 12);
    const excludedTrackKeys = normalizedTracks
      .filter((track) => track.playCount > 0)
      .sort((left, right) => {
        const rightTime = right.lastPlayedAt ? Date.parse(right.lastPlayedAt) : 0;
        const leftTime = left.lastPlayedAt ? Date.parse(left.lastPlayedAt) : 0;
        return rightTime - leftTime || right.playCount - left.playCount || left.key.localeCompare(right.key);
      })
      .slice(0, 50)
      .map((track) => track.key);

    return {
      seedTracks,
      excludedTrackKeys,
      topArtists: aggregateArtists(normalizedTracks).slice(0, 10),
      tasteTags: deriveTasteTags(normalizedTracks, metadataByKey)
    };
  }

  async resolveTrackMetadata(
    userId: string,
    input: ResolveListeningTrackMetadata
  ): Promise<ListeningTrackMetadata> {
    this.assertDatabaseAvailable();
    const track = input.track;
    const existing = await this.prisma.listeningTrackMetadata.findUnique({
      where: { trackKey: track.key }
    });
    if (existing && existing.status === "resolved") {
      return toTrackMetadata(existing);
    }

    let tags: ListeningTrackMetadataTag[] = [];
    let status: ListeningTrackMetadataStatus = "deferred";
    try {
      const result = await this.recommendations.getLastFmTrackTags(userId, {
        artist: track.artist,
        track: track.title,
        limit: 1
      });
      tags = result;
      status = tags.length > 0 ? "resolved" : "unmatched";
    } catch {
      status = "deferred";
    }

    const saved = await this.prisma.listeningTrackMetadata.upsert({
      where: { trackKey: track.key },
      update: {
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        tags,
        status
      },
      create: {
        trackKey: track.key,
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        title: track.title,
        artist: track.artist,
        album: track.album,
        tags,
        status
      }
    });
    return toTrackMetadata(saved);
  }

  async clearProfile(userId: string) {
    this.assertDatabaseAvailable();
    await this.prisma.$transaction([
      this.prisma.userListeningEvent.deleteMany({ where: { userId } }),
      this.prisma.userListeningTrack.deleteMany({ where: { userId } })
    ]);
    return { ok: true };
  }

  private assertDatabaseAvailable() {
    if (!this.prisma.isAvailable()) {
      throw new ServiceUnavailableException("Listening profile storage is temporarily unavailable.");
    }
  }
}

function toProfileTrack(record: {
  candidateKey: string;
  provider: string;
  providerTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  artworkUrl: string | null;
  playCount: number;
  listenedMs: bigint;
  completionCount: number;
  quickSkipCount: number;
  isFavorite: boolean;
  lastPlayedAt: Date | null;
}): ListeningProfileTrack {
  return {
    key: record.candidateKey,
    provider: record.provider as ListeningProfileProvider,
    providerTrackId: record.providerTrackId,
    title: record.title,
    artist: record.artist,
    album: record.album,
    durationMs: record.durationMs,
    artworkUrl: record.artworkUrl,
    playCount: record.playCount,
    listenedMs: Number(record.listenedMs),
    completionCount: record.completionCount,
    quickSkipCount: record.quickSkipCount,
    isFavorite: record.isFavorite,
    lastPlayedAt: record.lastPlayedAt?.toISOString() ?? null
  };
}

function aggregateArtists(tracks: ListeningProfileTrack[]) {
  const byArtist = new Map<string, { name: string; listenedMs: number; playCount: number; favoriteTrackCount: number }>();
  for (const track of tracks) {
    if (track.playCount === 0) continue;
    const key = normalizeArtist(track.artist);
    const current = byArtist.get(key) ?? {
      name: track.artist,
      listenedMs: 0,
      playCount: 0,
      favoriteTrackCount: 0
    };
    current.listenedMs += track.listenedMs;
    current.playCount += track.playCount;
    current.favoriteTrackCount += track.isFavorite ? 1 : 0;
    byArtist.set(key, current);
  }
  return [...byArtist.values()].sort((left, right) =>
    right.listenedMs - left.listenedMs || right.playCount - left.playCount || left.name.localeCompare(right.name)
  );
}

function aggregateTimeBands(events: Array<{ occurredAt: Date; listenedMs: bigint; timezoneOffsetMinutes: number }>) {
  const totals = new Map<(typeof timeBandIds)[number], number>(timeBandIds.map((id) => [id, 0]));
  for (const event of events) {
    const hour = new Date(
      event.occurredAt.getTime() - event.timezoneOffsetMinutes * 60_000
    ).getUTCHours();
    const band = hour >= 5 && hour < 10
      ? "morning"
      : hour < 17
        ? "afternoon"
        : hour < 22
          ? "evening"
          : "late-night";
    totals.set(band, (totals.get(band) ?? 0) + Number(event.listenedMs));
  }
  return timeBandIds.map((id) => ({ id, listenedMs: totals.get(id) ?? 0 }));
}

function aggregateSources(tracks: ListeningProfileTrack[]) {
  const totals = new Map<ListeningProfileProvider, number>();
  for (const track of tracks) {
    if (track.listenedMs <= 0) continue;
    totals.set(track.provider, (totals.get(track.provider) ?? 0) + track.listenedMs);
  }
  return [...totals.entries()]
    .map(([source, listenedMs]) => ({ source, listenedMs }))
    .sort((left, right) => right.listenedMs - left.listenedMs);
}

function comparePlayedTracks(left: ListeningProfileTrack, right: ListeningProfileTrack) {
  return right.listenedMs - left.listenedMs || right.playCount - left.playCount || left.title.localeCompare(right.title);
}

function compareFavoriteTracks(left: ListeningProfileTrack, right: ListeningProfileTrack) {
  const leftScore = (left.isFavorite ? 100 : 0) + left.completionCount * 3 + left.playCount - left.quickSkipCount * 4;
  const rightScore = (right.isFavorite ? 100 : 0) + right.completionCount * 3 + right.playCount - right.quickSkipCount * 4;
  return rightScore - leftScore || right.listenedMs - left.listenedMs || left.title.localeCompare(right.title);
}

function compareDiscoverSeedTracks(left: ListeningProfileTrack, right: ListeningProfileTrack) {
  const leftScore = (left.isFavorite ? 100 : 0) + left.completionCount * 8 + left.playCount * 3 + left.listenedMs / 60_000 - left.quickSkipCount * 10;
  const rightScore = (right.isFavorite ? 100 : 0) + right.completionCount * 8 + right.playCount * 3 + right.listenedMs / 60_000 - right.quickSkipCount * 10;
  const rightLastPlayedAt = right.lastPlayedAt ? Date.parse(right.lastPlayedAt) : 0;
  const leftLastPlayedAt = left.lastPlayedAt ? Date.parse(left.lastPlayedAt) : 0;
  return rightScore - leftScore || rightLastPlayedAt - leftLastPlayedAt || left.key.localeCompare(right.key);
}

function deriveTasteTags(
  tracks: ListeningProfileTrack[],
  metadataByKey: ReadonlyMap<string, ListeningTrackMetadataTag[]>
) {
  const totals = new Map<string, number>();
  for (const track of tracks) {
    const tags = metadataByKey.get(track.key) ?? [];
    if (!tags.length || track.listenedMs <= 0) continue;
    const listeningWeight = track.listenedMs * (track.isFavorite ? 1.2 : 1);
    for (const tag of tags) {
      const category = classifyMetadataTag(tag.name);
      if (!category) continue;
      totals.set(category, (totals.get(category) ?? 0) + listeningWeight * Math.max(1, Math.log1p(tag.weight)));
    }
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([label]) => label);
}

function classifyMetadataTag(value: string) {
  const tag = normalizeTag(value);
  if (!tag || ignoredMetadataTags.has(tag)) return null;
  for (const [label, aliases] of metadataTagAliases) {
    if (aliases.some((alias) => tag === alias || tag.includes(alias))) return label;
  }
  return null;
}

function toMetadataTags(value: unknown): ListeningTrackMetadataTag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as { name?: unknown; weight?: unknown };
    return typeof candidate.name === "string" && candidate.name.trim()
      ? [{ name: candidate.name.trim(), weight: Number(candidate.weight) || 0 }]
      : [];
  });
}

function toTrackMetadata(record: {
  trackKey: string;
  provider: string;
  providerTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  tags: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): ListeningTrackMetadata {
  return {
    trackKey: record.trackKey,
    provider: record.provider as ListeningProfileProvider,
    providerTrackId: record.providerTrackId,
    title: record.title,
    artist: record.artist,
    album: record.album,
    tags: toMetadataTags(record.tags),
    status: record.status as ListeningTrackMetadataStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

const metadataTagAliases: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["流行", ["pop", "popular"]],
  ["摇滚", ["rock", "metal", "punk"]],
  ["电子", ["electronic", "electronica", "house", "techno", "edm", "dance"]],
  ["嘻哈", ["hip hop", "hip-hop", "rap"]],
  ["爵士", ["jazz"]],
  ["古典", ["classical"]],
  ["民谣", ["folk", "singer-songwriter"]],
  ["灵魂乐", ["soul", "r&b", "rnb"]],
  ["独立音乐", ["indie", "alternative"]],
  ["舒缓", ["ambient", "chill", "chillout", "relax", "downtempo"]],
  ["忧郁", ["sad", "sadness", "melancholic", "melancholy"]],
  ["浪漫", ["romantic", "love"]]
];

const ignoredMetadataTags = new Set([
  "seen live",
  "favorites",
  "favorite",
  "under 2000 listeners",
  "under 1000 listeners",
  "albums i own",
  "male vocalists",
  "female vocalists"
]);

function normalizeTag(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();
}

function normalizeArtist(value: string) {
  return value.trim().toLocaleLowerCase();
}

function laterDate(current: Date | null, next: Date) {
  return !current || next > current ? next : current;
}
