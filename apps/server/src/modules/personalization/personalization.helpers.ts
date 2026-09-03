import type {
  PersonalizationTasteTag,
  ProviderPlaylistSummary,
  ProviderTrackCandidate,
  RecordPersonalizationEvent
} from "@music-room/shared";
import type { NeteaseService } from "../providers/netease/netease.service";
import type { QqMusicService } from "../providers/qqmusic/qqmusic.service";
import { extractTasteEvidence } from "./taste-taxonomy";

export const longTermHalfLifeMs = 120 * 24 * 60 * 60 * 1_000;

export type TasteEntityRecord = {
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

export type TasteEventRecord = {
  eventType: string;
  entityKind: string;
  entityKey: string;
  provider: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  weight: number;
  listenedMs: bigint;
  occurredAt: Date;
  updatedAt: Date;
};

export type PlaylistTasteRecord = {
  title: string;
  description: string | null;
  tags: unknown;
  trackIds: unknown;
};

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
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.playCount - left.playCount ||
        right.listenedMs - left.listenedMs ||
        left.name.localeCompare(right.name, "zh-CN")
    );
}

export function buildBehaviorTasteTags(
  events: TasteEventRecord[],
  playbackEvents: TasteEventRecord[]
): PersonalizationTasteTag[] {
  if (playbackEvents.length < 3) return [];
  const latestAt = events.reduce<Date>(
    (latest, event) => (event.updatedAt > latest ? event.updatedAt : latest),
    playbackEvents[0]?.updatedAt ?? new Date(0)
  );
  const completions = events.filter((event) => event.eventType === "completion").length;
  const quickSkips = events.filter((event) => event.eventType === "quick-skip").length;
  const favorites = events.filter((event) => event.eventType === "favorite").length;
  const playCounts = new Map<string, number>();
  for (const event of playbackEvents)
    playCounts.set(event.entityKey, (playCounts.get(event.entityKey) ?? 0) + 1);
  const repeatedTrackCount = [...playCounts.values()].filter((count) => count >= 3).length;
  const completionRate = completions / playbackEvents.length;
  const quickSkipRate = quickSkips / playbackEvents.length;
  const tags: PersonalizationTasteTag[] = [];

  if (completions >= 2 && completionRate >= 0.45)
    tags.push(behaviorTag("高完成度", completionRate, latestAt));
  if (favorites >= 2)
    tags.push(
      behaviorTag("偏好收藏", Math.min(1, favorites / Math.max(3, playbackEvents.length)), latestAt)
    );
  if (repeatedTrackCount >= 1)
    tags.push(behaviorTag("偏好重复播放", Math.min(1, repeatedTrackCount / 3), latestAt));
  if (playbackEvents.length >= 5 && quickSkipRate <= 0.15)
    tags.push(behaviorTag("少跳过", 1 - quickSkipRate, latestAt));

  return tags.slice(0, 4);
}

export function behaviorTag(label: string, score: number, updatedAt: Date): PersonalizationTasteTag {
  return {
    label,
    score: Number(score.toFixed(3)),
    confidence: Math.min(1, Math.max(0.45, score)),
    source: "derived-behavior",
    updatedAt: updatedAt.toISOString()
  };
}

export function playlistTasteEntities(
  tracks: TasteEntityRecord[],
  playlists: PlaylistTasteRecord[]
): TasteEntityRecord[] {
  const metadataByTrack = indexPlaylistMetadata(playlists);
  return tracks.flatMap((track) => {
    const metadata = metadataByTrack.get(track.entityKey);
    if (!metadata?.length) return [];
    return extractTasteEvidence({ title: null, album: null, playlistMetadata: metadata }).map(
      (evidence) => ({
        ...track,
        entityKind: evidence.dimension,
        entityKey: `${evidence.source}:${normalizeText(evidence.label)}`,
        title: evidence.label,
        positiveScore: Math.max(0, entityScore(track) * evidence.confidence),
        negativeScore: 0,
        confidence: evidence.confidence
      })
    );
  });
}

export function historicalTasteEntities(events: TasteEventRecord[]): TasteEntityRecord[] {
  return events
    .filter((event) => event.entityKind === "track" && event.eventType === "playback" && event.title)
    .flatMap((event) =>
      extractTasteEvidence({
        title: event.title,
        artist: event.artist,
        album: event.album
      }).map((evidence) => ({
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
      }))
    );
}

export function eventWeight(input: RecordPersonalizationEvent) {
  if (input.type === "favorite") return 7;
  if (input.type === "unfavorite") return -7;
  if (input.type === "manual-selection") return 5;
  if (input.type === "completion") return 3;
  if (input.type === "quick-skip") return -6;
  if (input.type === "dismissed") return -7;
  if (input.type === "unavailable") return -1;
  return Math.min(2, Math.max(0, (input.listenedMs ?? 0) / 90_000));
}

export function trackKey(track: { provider: string; providerTrackId: string }) {
  return `${track.provider}:${track.providerTrackId}`;
}

export function normalizeText(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

export function entityScore(
  entity: Pick<TasteEntityRecord, "positiveScore" | "negativeScore" | "lastOccurredAt">
) {
  const age = entity.lastOccurredAt
    ? Math.max(0, Date.now() - entity.lastOccurredAt.getTime())
    : longTermHalfLifeMs;
  return (entity.positiveScore - entity.negativeScore) * Math.pow(0.5, age / longTermHalfLifeMs);
}

export function entityToCandidate(entity: TasteEntityRecord): ProviderTrackCandidate | null {
  if (
    (entity.provider !== "netease" && entity.provider !== "qqmusic") ||
    typeof entity.providerItemId !== "string" ||
    typeof entity.title !== "string" ||
    typeof entity.artist !== "string"
  )
    return null;
  return {
    provider: entity.provider,
    providerTrackId: entity.providerItemId,
    access:
      entity.access === "free" || entity.access === "vip" || entity.access === "paid"
        ? entity.access
        : "unknown",
    quality:
      entity.quality === "standard" ||
      entity.quality === "high" ||
      entity.quality === "exhigh" ||
      entity.quality === "lossless" ||
      entity.quality === "hires"
        ? entity.quality
        : null,
    title: entity.title,
    artist: entity.artist,
    album: typeof entity.album === "string" ? entity.album : null,
    providerAlbumId:
      typeof entity.providerAlbumId === "string" ? entity.providerAlbumId : undefined,
    durationMs: typeof entity.durationMs === "number" ? entity.durationMs : 0,
    artworkUrl: typeof entity.artworkUrl === "string" ? entity.artworkUrl : null
  } as ProviderTrackCandidate;
}

export function profileVersion(entities: TasteEntityRecord[], events: TasteEventRecord[]) {
  const tasteEntities = entities.filter((item) => item.lastOccurredAt !== null);
  const latest = Math.max(
    0,
    ...tasteEntities.map((item) => item.lastOccurredAt!.getTime()),
    ...events.map((item) => item.updatedAt.getTime())
  );
  return `${tasteEntities.length}:${events.length}:${latest}`;
}

export function indexPlaylistMetadata(playlists: PlaylistTasteRecord[]) {
  const metadataByTrack = new Map<string, string[]>();
  for (const playlist of playlists) {
    const metadata = [playlist.title, playlist.description, ...toStringList(playlist.tags)].filter(
      (value): value is string => Boolean(value?.trim())
    );
    if (metadata.length === 0) continue;
    for (const trackId of toStringList(playlist.trackIds)) {
      const keys = [
        trackId,
        trackId.startsWith("provider:") ? trackId.slice("provider:".length) : `provider:${trackId}`
      ];
      for (const key of keys)
        metadataByTrack.set(key, [...(metadataByTrack.get(key) ?? []), ...metadata]);
    }
  }
  return metadataByTrack;
}

export function toStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function keepMultiArtistPlaylists(
  userId: string,
  service: NeteaseService | QqMusicService,
  playlists: ProviderPlaylistSummary[]
) {
  const details = await Promise.all(
    playlists.map(async (playlist) => {
      try {
        const detail = await service.getPlaylist(userId, playlist.providerPlaylistId);
        const artistCount = new Set(
          detail.tracks.map((track) => normalizeText(track.artist)).filter(Boolean)
        ).size;
        return artistCount >= 2 ? playlist : null;
      } catch {
        return null;
      }
    })
  );
  return details.filter((playlist): playlist is ProviderPlaylistSummary => playlist !== null);
}
