import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
  createApiErrorResponse,
  errorCodes,
  type LastFmSimilarTrack,
  type LastFmSimilarTracksQuery,
  type LastFmSimilarTracksResponse,
  type LastFmTrackTag
} from "@music-room/shared";
import { z } from "zod";
import { fetchProviderUrl } from "../providers/provider-fetch";

const lastFmApiUrl = "https://ws.audioscrobbler.com/2.0/";
const lastFmHost = "ws.audioscrobbler.com";
const lastFmRequestTimeoutMs = 15_000;
const requestLimit = 12;
const requestWindowMs = 60_000;

type RateBucket = { timestamps: number[] };

const lastFmSimilarTrackPayloadSchema = z
  .object({
    name: z.string().optional(),
    match: z.union([z.string(), z.number()]).optional(),
    artist: z.union([
      z.string(),
      z.object({ name: z.string().optional() }).passthrough()
    ]).optional()
  })
  .passthrough();

const lastFmSimilarPayloadSchema = z
  .object({
    similartracks: z
      .object({ track: z.array(lastFmSimilarTrackPayloadSchema).optional() })
      .passthrough()
      .optional(),
    error: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional()
  })
  .passthrough();

const lastFmTagPayloadSchema = z
  .object({
    name: z.string().optional(),
    count: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

const lastFmTagsPayloadSchema = z
  .object({
    toptags: z
      .object({ tag: z.array(lastFmTagPayloadSchema).optional() })
      .passthrough()
      .optional(),
    error: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional()
  })
  .passthrough();

@Injectable()
export class RecommendationsService {
  private readonly userRateLimits = new Map<string, RateBucket>();

  async getLastFmSimilarTracks(
    userId: string,
    input: LastFmSimilarTracksQuery
  ): Promise<LastFmSimilarTracksResponse> {
    const apiKey = process.env.LASTFM_API_KEY?.trim();
    if (!apiKey) {
      throw this.unavailableError(HttpStatus.SERVICE_UNAVAILABLE, "Last.fm recommendation is not configured.");
    }

    this.assertRateLimit(userId);
    const [similarPayload, tagsResult] = await Promise.all([
      this.fetchLastFm("track.getSimilar", input, apiKey),
      this.fetchLastFm("track.getTopTags", input, apiKey).catch(() => null)
    ]);
    const similar = lastFmSimilarPayloadSchema.safeParse(similarPayload);
    if (!similar.success || similar.data.error !== undefined) {
      throw this.unavailableError(HttpStatus.BAD_GATEWAY, "Last.fm recommendation is unavailable.");
    }

    const parsedTags = tagsResult === null
      ? null
      : lastFmTagsPayloadSchema.safeParse(tagsResult);

    return {
      seed: {
        title: input.track,
        artist: input.artist
      },
      tags: parsedTags?.success ? normalizeTags(parsedTags.data) : [],
      items: normalizeSimilarTracks(similar.data.similartracks?.track ?? [], input.limit)
    };
  }

  async getLastFmTrackTags(
    userId: string,
    input: LastFmSimilarTracksQuery
  ): Promise<LastFmTrackTag[]> {
    const apiKey = process.env.LASTFM_API_KEY?.trim();
    if (!apiKey) {
      throw this.unavailableError(HttpStatus.SERVICE_UNAVAILABLE, "Last.fm metadata is not configured.");
    }

    this.assertRateLimit(userId);
    const payload = await this.fetchLastFm("track.getTopTags", input, apiKey);
    const parsed = lastFmTagsPayloadSchema.safeParse(payload);
    if (!parsed.success || parsed.data.error !== undefined) {
      throw this.unavailableError(HttpStatus.BAD_GATEWAY, "Last.fm metadata is unavailable.");
    }
    return normalizeTags(parsed.data);
  }

  private async fetchLastFm(
    method: "track.getSimilar" | "track.getTopTags",
    input: LastFmSimilarTracksQuery,
    apiKey: string
  ) {
    const url = new URL(lastFmApiUrl);
    url.searchParams.set("method", method);
    url.searchParams.set("artist", input.artist);
    url.searchParams.set("track", input.track);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("autocorrect", "1");
    if (method === "track.getSimilar") {
      url.searchParams.set("limit", String(input.limit));
    }

    let response: Response;
    try {
      response = await fetchProviderUrl(
        url,
        { headers: { Accept: "application/json" } },
        lastFmRequestTimeoutMs,
        (hostname) => hostname === lastFmHost
      );
    } catch {
      throw this.unavailableError(HttpStatus.BAD_GATEWAY, "Last.fm recommendation is unavailable.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw this.unavailableError(HttpStatus.BAD_GATEWAY, "Last.fm recommendation is unavailable.");
    }

    try {
      return await response.json();
    } catch {
      throw this.unavailableError(HttpStatus.BAD_GATEWAY, "Last.fm recommendation returned an invalid response.");
    }
  }

  private assertRateLimit(userId: string) {
    const now = Date.now();
    const bucket = this.userRateLimits.get(userId) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < requestWindowMs);
    if (bucket.timestamps.length >= requestLimit) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.rateLimited, "Recommendation request rate limit exceeded."),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    bucket.timestamps.push(now);
    this.userRateLimits.set(userId, bucket);
  }

  private unavailableError(
    status: HttpStatus.SERVICE_UNAVAILABLE | HttpStatus.BAD_GATEWAY,
    message: string
  ) {
    return new HttpException(
      createApiErrorResponse(errorCodes.recommendationUnavailable, message),
      status
    );
  }
}

function normalizeSimilarTracks(
  values: z.infer<typeof lastFmSimilarTrackPayloadSchema>[],
  limit: number
): LastFmSimilarTrack[] {
  const seen = new Set<string>();
  const tracks: LastFmSimilarTrack[] = [];
  for (const value of values) {
    const title = value.name?.trim() ?? "";
    const artist = typeof value.artist === "string"
      ? value.artist.trim()
      : value.artist?.name?.trim() ?? "";
    if (!title || !artist) continue;
    const key = `${title.toLocaleLowerCase()}:${artist.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      title,
      artist,
      match: normalizeUnitInterval(value.match)
    });
  }
  return tracks
    .sort((left, right) => right.match - left.match)
    .slice(0, limit);
}

function normalizeTags(payload: z.infer<typeof lastFmTagsPayloadSchema>): LastFmTrackTag[] {
  if (payload.error !== undefined) return [];
  const seen = new Set<string>();
  const tags: LastFmTrackTag[] = [];
  for (const value of payload.toptags?.tag ?? []) {
    const name = value.name?.trim() ?? "";
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    tags.push({
      name,
      weight: Math.max(0, Number(value.count) || 0)
    });
  }
  return tags
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 10);
}

function normalizeUnitInterval(value: string | number | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}
