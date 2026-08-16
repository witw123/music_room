import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AudioFeatureValues,
  ListeningProfileProvider,
  ListeningProfileResponse,
  ListeningProfileTrack,
  ListeningTrack,
  RecordListeningProfileEvent,
  SaveListeningAudioFeatures
} from "@music-room/shared";
import { Prisma } from "../../generated/prisma";
import { PrismaService } from "../../infra/prisma/prisma.service";

const timeBandIds = ["morning", "afternoon", "evening", "late-night"] as const;

@Injectable()
export class ListeningProfileService {
  constructor(private readonly prisma: PrismaService) {}

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

    const featureKeys = tracks.map((track) => track.candidateKey);
    const features = featureKeys.length > 0
      ? await this.prisma.listeningAudioFeature.findMany({
          where: { trackKey: { in: featureKeys }, status: "resolved" },
          select: { trackKey: true, features: true }
        })
      : [];
    const featuresByKey = new Map(features.map((feature) => [feature.trackKey, toAudioFeatureValues(feature.features)]));
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
      tasteTags: deriveTasteTags(normalizedTracks, featuresByKey)
    };
  }

  async getAudioFeature(trackKey: string) {
    this.assertDatabaseAvailable();
    return this.prisma.listeningAudioFeature.findUnique({ where: { trackKey } });
  }

  async saveAudioFeature(input: SaveListeningAudioFeatures) {
    this.assertDatabaseAvailable();
    return this.prisma.listeningAudioFeature.upsert({
      where: { trackKey: input.trackKey },
      update: {
        title: input.title,
        artist: input.artist,
        album: input.album,
        durationMs: input.durationMs,
        providerTrackId: input.providerTrackId,
        reccoBeatsTrackId: input.reccoBeatsTrackId,
        status: input.status,
        features: input.features ?? Prisma.JsonNull
      },
      create: {
        trackKey: input.trackKey,
        title: input.title,
        artist: input.artist,
        album: input.album,
        durationMs: input.durationMs,
        providerTrackId: input.providerTrackId,
        reccoBeatsTrackId: input.reccoBeatsTrackId,
        status: input.status,
        features: input.features ?? Prisma.JsonNull
      }
    });
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

function deriveTasteTags(
  tracks: ListeningProfileTrack[],
  featuresByKey: ReadonlyMap<string, AudioFeatureValues | null>
) {
  let totalWeight = 0;
  const totals = {
    energy: 0,
    danceability: 0,
    acousticness: 0,
    instrumentalness: 0,
    valence: 0
  };
  for (const track of tracks) {
    const features = featuresByKey.get(track.key);
    if (!features || track.listenedMs <= 0) continue;
    const weight = Math.max(track.listenedMs, track.isFavorite ? Math.max(track.durationMs, 180_000) : 0);
    if (weight <= 0) continue;
    totalWeight += weight;
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      const value = features[key];
      if (typeof value === "number") totals[key] += value * weight;
    }
  }
  if (totalWeight <= 0) return [];
  const averages = Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, value / totalWeight])
  ) as Record<keyof typeof totals, number>;
  return [
    averages.energy >= 0.62 ? "高能量" : averages.energy <= 0.38 ? "舒缓" : null,
    averages.danceability >= 0.62 ? "律动感" : null,
    averages.acousticness >= 0.6 ? "原声感" : null,
    averages.instrumentalness >= 0.55 ? "器乐倾向" : null,
    averages.valence >= 0.62 ? "明朗" : null
  ].filter((value): value is string => !!value).slice(0, 3);
}

function toAudioFeatureValues(value: unknown): AudioFeatureValues | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<AudioFeatureValues>;
  const keys: Array<keyof AudioFeatureValues> = [
    "danceability", "energy", "valence", "acousticness",
    "instrumentalness", "speechiness", "liveness", "tempo"
  ];
  if (!keys.every((key) => candidate[key] === null || typeof candidate[key] === "number")) return null;
  return {
    danceability: candidate.danceability ?? null,
    energy: candidate.energy ?? null,
    valence: candidate.valence ?? null,
    acousticness: candidate.acousticness ?? null,
    instrumentalness: candidate.instrumentalness ?? null,
    speechiness: candidate.speechiness ?? null,
    liveness: candidate.liveness ?? null,
    tempo: candidate.tempo ?? null
  };
}

function normalizeArtist(value: string) {
  return value.trim().toLocaleLowerCase();
}

function laterDate(current: Date | null, next: Date) {
  return !current || next > current ? next : current;
}
