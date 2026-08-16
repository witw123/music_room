"use client";

import type {
  AudioFeatureValues,
  ListeningTrack,
  SaveListeningAudioFeatures,
  TrackMeta
} from "@music-room/shared";
import { getRoomLocalAudioFile } from "@/features/library/local-audio-storage";
import { musicRoomApi } from "@/lib/network/music-room-api";

const reccoBeatsBaseUrl = "https://api.reccobeats.com/v1";
const minimumMatchScore = 0.86;

type ReccoBeatsTrack = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
};

const pendingFeatureLookups = new Map<string, Promise<void>>();

export async function ensureListeningAudioFeatures(track: TrackMeta) {
  const listeningTrack = toListeningTrack(track);
  if (!listeningTrack || !await hasLocallyCachedAudio(track)) return;

  const existing = await musicRoomApi.getListeningAudioFeature(listeningTrack.key).catch(() => null);
  if (existing?.status === "resolved" || existing?.status === "unmatched") return;

  const pending = pendingFeatureLookups.get(listeningTrack.key);
  if (pending) return pending;

  const lookup = resolveAudioFeatures(listeningTrack)
    .catch(() => undefined)
    .finally(() => pendingFeatureLookups.delete(listeningTrack.key));
  pendingFeatureLookups.set(listeningTrack.key, lookup);
  return lookup;
}

export function toListeningTrack(track: TrackMeta | null): ListeningTrack | null {
  if (!track) return null;
  const provider = track.sourceRef?.provider ?? track.sourceType;
  if (provider !== "local_upload" && provider !== "netease" && provider !== "qqmusic") return null;
  const providerTrackId = track.sourceRef?.trackId ?? track.fileHash ?? track.id;
  if (!providerTrackId) return null;
  return {
    key: `${provider}:${providerTrackId}`,
    provider,
    providerTrackId,
    title: track.title.trim() || "未命名歌曲",
    artist: track.artist.trim() || "未知艺人",
    album: track.album?.trim() || null,
    durationMs: Math.max(0, Math.round(track.durationMs)),
    artworkUrl: /^https?:\/\//i.test(track.artworkUrl ?? "") ? track.artworkUrl : null
  };
}

async function resolveAudioFeatures(track: ListeningTrack) {
  try {
    const matches = await searchReccoBeatsTracks(track);
    const match = matches
      .map((candidate) => ({ candidate, score: scoreTrackMatch(track, candidate) }))
      .sort((left, right) => right.score - left.score)[0] ?? null;
    if (!match || match.score < minimumMatchScore) {
      await saveFeatureResult({
        trackKey: track.key,
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        providerTrackId: track.providerTrackId,
        reccoBeatsTrackId: null,
        status: "unmatched",
        features: null
      });
      return;
    }

    const features = await fetchReccoBeatsFeatures(match.candidate.id);
    await saveFeatureResult({
      trackKey: track.key,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.durationMs,
      providerTrackId: track.providerTrackId,
      reccoBeatsTrackId: match.candidate.id,
      status: features ? "resolved" : "unmatched",
      features
    });
  } catch {
    await saveFeatureResult({
      trackKey: track.key,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationMs: track.durationMs,
      providerTrackId: track.providerTrackId,
      reccoBeatsTrackId: null,
      status: "deferred",
      features: null
    }).catch(() => undefined);
  }
}

async function hasLocallyCachedAudio(track: TrackMeta) {
  if (!track.fileHash) return false;
  const file = await getRoomLocalAudioFile({
    trackId: track.id,
    fileHash: track.fileHash,
    title: track.title ?? "未命名歌曲",
    mimeType: track.mimeType ?? "audio/mpeg",
    provider: track.sourceRef?.provider,
    providerTrackId: track.sourceRef?.trackId ?? null
  }).catch(() => null);
  return !!file;
}

async function searchReccoBeatsTracks(track: ListeningTrack): Promise<ReccoBeatsTrack[]> {
  const query = `${track.title} ${track.artist}`.trim();
  const response = await fetch(
    `${reccoBeatsBaseUrl}/track/search?searchText=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error("ReccoBeats search is unavailable.");
  const payload = await response.json() as unknown;
  return readTrackResults(payload);
}

async function fetchReccoBeatsFeatures(trackId: string): Promise<AudioFeatureValues | null> {
  const response = await fetch(
    `${reccoBeatsBaseUrl}/track/${encodeURIComponent(trackId)}/audio-features`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error("ReccoBeats features are unavailable.");
  return readAudioFeatures(await response.json() as unknown);
}

function readTrackResults(payload: unknown): ReccoBeatsTrack[] {
  const root = asRecord(payload);
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.content)
      ? root.content
      : Array.isArray(root?.tracks)
        ? root.tracks
        : [];
  return values.flatMap((value) => {
    const candidate = asRecord(value);
    const id = asText(candidate?.id);
    const title = asText(candidate?.trackTitle) ?? asText(candidate?.title) ?? asText(candidate?.name);
    const artist = readArtist(candidate?.artists) ?? asText(candidate?.artist);
    if (!id || !title || !artist) return [];
    return [{
      id,
      title,
      artist,
      album: readAlbum(candidate?.album),
      durationMs: readDurationMs(candidate?.durationMs ?? candidate?.duration)
    }];
  });
}

function readAudioFeatures(payload: unknown): AudioFeatureValues | null {
  const root = asRecord(payload);
  const values = asRecord(root?.content) ?? root;
  if (!values) return null;
  const result: AudioFeatureValues = {
    danceability: readUnit(values.danceability),
    energy: readUnit(values.energy),
    valence: readUnit(values.valence),
    acousticness: readUnit(values.acousticness),
    instrumentalness: readUnit(values.instrumentalness),
    speechiness: readUnit(values.speechiness),
    liveness: readUnit(values.liveness),
    tempo: readRange(values.tempo, 0, 400)
  };
  return Object.values(result).some((value) => value !== null) ? result : null;
}

function scoreTrackMatch(track: ListeningTrack, candidate: ReccoBeatsTrack) {
  const titleScore = normalizedSimilarity(track.title, candidate.title);
  const artistScore = normalizedSimilarity(track.artist, candidate.artist);
  const albumScore = track.album && candidate.album
    ? normalizedSimilarity(track.album, candidate.album)
    : 1;
  const durationScore = track.durationMs > 0 && candidate.durationMs && candidate.durationMs > 0
    ? Math.max(0, 1 - Math.abs(track.durationMs - candidate.durationMs) / Math.max(track.durationMs, candidate.durationMs, 1))
    : 0.75;
  return titleScore * 0.5 + artistScore * 0.32 + albumScore * 0.08 + durationScore * 0.1;
}

function normalizedSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.86;
  return 0;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function readArtist(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const names = value
    .map((item) => typeof item === "string" ? item : asText(asRecord(item)?.name))
    .filter((item): item is string => !!item);
  return names.length ? names.join(" / ") : null;
}

function readAlbum(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  return asText(asRecord(value)?.name);
}

function readDurationMs(value: unknown) {
  const duration = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration < 10_000 ? Math.round(duration * 1_000) : Math.round(duration);
}

function readUnit(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function readRange(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function saveFeatureResult(input: SaveListeningAudioFeatures) {
  return musicRoomApi.saveListeningAudioFeatures(input);
}
