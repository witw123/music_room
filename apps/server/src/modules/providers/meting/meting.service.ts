import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import { isIP } from "node:net";
import type {
  MetingProvider,
  MetingSearchResponse,
  MetingTrackCandidate
} from "@music-room/shared";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";
import { RedisService } from "../../../infra/redis/redis.service";
import { MetingApiClient, MetingApiError } from "./meting-api.client";
import {
  metingQualitySchema,
  type MetingQuality,
  type MetingSearchQuery
} from "./meting.schemas";
import type { MetingPlatform } from "./meting.types";

type RateBucket = { timestamps: number[] };

@Injectable()
export class MetingService {
  private readonly localRateLimits = new Map<string, RateBucket>();

  constructor(
    private readonly api: MetingApiClient,
    private readonly redis: RedisService
  ) {}

  async searchTracks(provider: MetingProvider, userId: string, query: MetingSearchQuery): Promise<MetingSearchResponse> {
    this.assertEnabled(provider);
    await this.assertRateLimit(provider, userId, "search", 30);
    const records = await this.callProvider(provider, () => this.api.searchTracks(provider, query));
    return {
      items: records
        .map((record) => this.toTrackCandidate(provider, record))
        .filter((track): track is MetingTrackCandidate => !!track),
      limit: query.limit,
      offset: query.offset
    };
  }

  async getTrack(provider: MetingProvider, userId: string, trackId: string) {
    this.assertEnabled(provider);
    await this.assertRateLimit(provider, userId, "search", 30);
    const records = await this.callProvider(provider, () => this.api.getTrack(provider, trackId));
    const values = Array.isArray(records) ? records : [records];
    const track = values
      .map((record) => this.toTrackCandidate(provider, record))
      .find((candidate): candidate is MetingTrackCandidate => !!candidate);
    if (!track) {
      throw this.trackNotFoundError();
    }

    if (!track.artworkUrl) {
      try {
        const artwork = await this.api.getTrackArtwork(provider, trackId);
        const artworkUrl = readUrl(asRecord(artwork)?.url);
        if (artworkUrl) {
          track.artworkUrl = artworkUrl;
        }
      } catch {
        // Artwork is optional and should not prevent audio import.
      }
    }
    return track;
  }

  async openAudio(
    provider: MetingProvider,
    userId: string,
    trackId: string,
    quality: string,
    range?: string
  ) {
    this.assertEnabled(provider);
    await this.assertRateLimit(provider, userId, "audio", 6);

    const selectedQuality = metingQualitySchema.safeParse(quality).success
      ? quality as MetingQuality
      : this.defaultQuality();
    const qualities = qualitiesFrom(selectedQuality);
    let unsupportedFormat = false;
    let lastFetchFailed = false;

    for (const candidateQuality of qualities) {
      const resolved = await this.callProvider(provider, () =>
        this.api.getAudioUrl(provider, trackId, candidateQuality)
      );
      const url = readUrl(resolved.url);
      if (!url) {
        continue;
      }
      if (!isAllowedAudioUrl(provider, url)) {
        throw this.unavailableError();
      }

      for (let attempt = 0; attempt <= this.urlRetryCount(); attempt += 1) {
        const headers = new Headers();
        if (range) headers.set("range", range);
        const upstream = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(this.requestTimeoutMs())
        }).catch(() => null);

        if (!upstream || !upstream.ok || !upstream.body) {
          lastFetchFailed = true;
          continue;
        }

        const mimeType = resolveAudioMimeType(
          upstream.headers.get("content-type"),
          url
        );
        if (!mimeType) {
          unsupportedFormat = true;
          await upstream.body.cancel().catch(() => undefined);
          break;
        }

        const contentLength = Number(upstream.headers.get("content-length") ?? "0");
        if (contentLength > this.maxImportBytes()) {
          await upstream.body.cancel().catch(() => undefined);
          throw new HttpException(
            createApiErrorResponse(
              errorCodes.metingImportTooLarge,
              "The provider audio file is too large."
            ),
            HttpStatus.PAYLOAD_TOO_LARGE
          );
        }

        return {
          upstream,
          mimeType,
          contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
          fileType: mimeType === "audio/flac" ? "flac" : "mp3",
          maxBytes: this.maxImportBytes()
        };
      }
    }

    if (unsupportedFormat) {
      throw new HttpException(
        createApiErrorResponse(
          errorCodes.metingAudioUnsupported,
          "The provider returned an unsupported audio format."
        ),
        HttpStatus.UNSUPPORTED_MEDIA_TYPE
      );
    }
    if (lastFetchFailed) {
      throw this.unavailableError();
    }
    throw this.trackNotFoundError();
  }

  private toTrackCandidate(provider: MetingProvider, value: unknown): MetingTrackCandidate | null {
    const record = asRecord(value);
    if (!record) return null;
    const providerTrackId = readString(
      record.id ?? record.url_id ?? record.songmid ?? record.mid ?? record.hash ?? record.rid ?? record.song_id
    );
    const title = readString(record.name ?? record.title);
    if (!providerTrackId || !title) return null;

    const artist = Array.isArray(record.artist)
      ? record.artist.map(readString).filter((value): value is string => !!value).join(" / ")
      : readString(record.artist ?? record.author);
    const artworkUrl = readUrl(record.artworkUrl ?? record.picUrl ?? record.pic);
    return {
      provider,
      providerTrackId,
      access: "unknown",
      quality: null,
      title,
      artist: artist || "未知歌手",
      album: readString(record.album ?? record.album_title),
      durationMs: readDurationMs(record.duration ?? record.interval),
      artworkUrl
    };
  }

  private assertEnabled(provider: MetingProvider) {
    if (process.env[enabledEnvName(provider)] === "true") return;
    throw new HttpException(
      createApiErrorResponse(
        errorCodes.metingDisabled,
        "Meting provider integration is disabled.",
        { provider }
      ),
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  private async assertRateLimit(
    provider: MetingProvider,
    userId: string,
    kind: "search" | "audio",
    limit: number
  ) {
    const key = `music-room:meting:rate:${provider}:${kind}:${userId}`;
    if (typeof this.redis.isAvailable === "function" && this.redis.isAvailable()) {
      const count = await this.redis.incrementWithTtlMs(key, 60_000);
      if (count > limit) throw this.rateLimitError();
      return;
    }

    const now = Date.now();
    const bucket = this.localRateLimits.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < 60_000);
    if (bucket.timestamps.length >= limit) throw this.rateLimitError();
    bucket.timestamps.push(now);
    this.localRateLimits.set(key, bucket);
  }

  private async callProvider<T>(provider: MetingPlatform, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof MetingApiError && error.kind === "invalid-response") {
        throw this.unavailableError();
      }
      throw this.unavailableError(provider);
    }
  }

  private unavailableError(_provider?: MetingPlatform) {
    return new HttpException(
      createApiErrorResponse(errorCodes.metingUnavailable, "Meting provider is temporarily unavailable."),
      HttpStatus.BAD_GATEWAY
    );
  }

  private trackNotFoundError() {
    return new HttpException(
      createApiErrorResponse(errorCodes.metingTrackNotFound, "Provider audio is unavailable."),
      HttpStatus.NOT_FOUND
    );
  }

  private rateLimitError() {
    return new HttpException(
      createApiErrorResponse(errorCodes.rateLimited, "Meting request rate limit exceeded."),
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private defaultQuality(): MetingQuality {
    return metingQualitySchema.safeParse(process.env.METING_DEFAULT_QUALITY).success
      ? process.env.METING_DEFAULT_QUALITY as MetingQuality
      : "exhigh";
  }

  private requestTimeoutMs() {
    const value = Number(process.env.METING_REQUEST_TIMEOUT_MS ?? 15_000);
    return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000;
  }

  private maxImportBytes() {
    const value = Number(process.env.METING_MAX_IMPORT_BYTES ?? 209_715_200);
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 209_715_200;
  }

  private urlRetryCount() {
    const value = Number(process.env.METING_URL_RETRY_COUNT ?? 1);
    return Number.isFinite(value) ? Math.max(0, Math.min(3, Math.floor(value))) : 1;
  }
}

function enabledEnvName(provider: MetingProvider) {
  return {
    qqmusic: "QQMUSIC_ENABLED",
    kugou: "KUGOU_ENABLED",
    kuwo: "KUWO_ENABLED",
    baidu: "BAIDU_ENABLED"
  }[provider];
}

function qualitiesFrom(quality: MetingQuality) {
  if (quality === "standard") return ["standard"] as const;
  if (quality === "high") return ["high", "standard"] as const;
  return ["exhigh", "high", "standard"] as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readDurationMs(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number < 10_000 ? Math.round(number * 1_000) : Math.round(number);
}

function readUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function resolveAudioMimeType(contentType: string | null, sourceUrl: string) {
  const type = `${contentType ?? ""} ${sourceUrl}`.toLowerCase();
  if (type.includes("flac")) return "audio/flac";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio/mpeg";
  return null;
}

function isAllowedAudioUrl(provider: MetingProvider, value: string) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || isPrivateHostname(url.hostname)) return false;
    const host = url.hostname.toLowerCase();
    const suffixes = {
      qqmusic: ["qq.com", "gtimg.cn"],
      kugou: ["kugou.com", "kugoucdn.com"],
      kuwo: ["kuwo.cn", "kuwo.com"],
      baidu: ["baidu.com", "baidustatic.com", "taihe.com"]
    }[provider];
    return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.")) {
    return true;
  }
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    return parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0;
  }
  return false;
}
