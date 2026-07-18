import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  NeteaseSearchResponse,
  NeteaseTrackCandidate
} from "@music-room/shared";
import {
  createApiErrorResponse,
  errorCodes
} from "@music-room/shared";
import { RedisService } from "../../../infra/redis/redis.service";
import { fetchProviderUrl } from "../provider-fetch";
import { NeteaseAccountService } from "./netease-account.service";
import { NeteaseApiClient, NeteaseApiError } from "./netease-api.client";
import {
  neteaseQualitySchema,
  type NeteaseQuality,
  type NeteaseSearchQuery
} from "./netease.schemas";

type SongRecord = {
  id?: unknown;
  name?: unknown;
  fee?: unknown;
  duration?: unknown;
  dt?: unknown;
  artists?: unknown;
  ar?: unknown;
  album?: unknown;
  al?: unknown;
  h?: unknown;
  m?: unknown;
  l?: unknown;
  sq?: unknown;
  hr?: unknown;
  privilege?: unknown;
};

type RateBucket = { timestamps: number[] };
type QrAttempt = { userId: string; key: string };

const qrTtlSeconds = 180;
const qrKeyPrefix = "music-room:netease:qr:";

@Injectable()
export class NeteaseService {
  private readonly userRateLimits = new Map<string, RateBucket>();

  constructor(
    private readonly api: NeteaseApiClient,
    private readonly accounts: NeteaseAccountService,
    private readonly redis: RedisService
  ) {}

  async getAccountStatus(userId: string) {
    this.assertEnabled();
    return this.accounts.getStatus(userId);
  }

  async startQrLogin(userId: string) {
    this.assertEnabled();
    this.assertRateLimit(`qr:${userId}`, 3, 60_000);
    const qr = await this.callProvider(undefined, () => this.api.createQrCode());
    const attemptId = randomUUID();
    await this.redis.setJson(`${qrKeyPrefix}${attemptId}`, { userId, key: qr.key }, qrTtlSeconds);
    return {
      attemptId,
      qrimg: qr.qrimg,
      expiresAt: new Date(Date.now() + qrTtlSeconds * 1000).toISOString()
    };
  }

  async checkQrLogin(userId: string, attemptId: string) {
    this.assertEnabled();
    const key = `${qrKeyPrefix}${attemptId}`;
    const attempt = await this.redis.getJson<QrAttempt>(key);
    if (!attempt) {
      return { status: "expired" as const };
    }
    if (attempt.userId !== userId) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.unauthorized, "This QR login attempt belongs to another user."),
        HttpStatus.FORBIDDEN
      );
    }

    const result = await this.callProvider(userId, () => this.api.checkQrCode(attempt.key));
    if (result.status === "connected" && result.cookie) {
      let profile;
      try {
        profile = await this.callProvider(userId, () => this.api.validateCookie(result.cookie!));
      } catch (error) {
        if (!isNeteaseUnavailableError(error)) {
          throw error;
        }
        await this.redis.delete(key);
        return {
          status: "failed" as const,
          message: "二维码已扫码，但网易云登录验证失败，请重新生成二维码。"
        };
      }
      await this.accounts.saveAccount({
        userId,
        cookie: result.cookie,
        ...profile
      });
      await this.redis.delete(key);
      return {
        status: "connected" as const,
        account: await this.accounts.getStatus(userId)
      };
    }
    if (result.status === "connected") {
      await this.redis.delete(key);
      return {
        status: "failed" as const,
        message: "NetEase QR login did not return a session cookie."
      };
    }
    if (result.status === "expired" || result.status === "failed") {
      await this.redis.delete(key);
    }

    return {
      status: result.status,
      ...(result.message ? { message: result.message } : {})
    };
  }

  async disconnectAccount(userId: string) {
    this.assertEnabled();
    return this.accounts.disconnect(userId);
  }

  async searchTracks(userId: string, query: NeteaseSearchQuery): Promise<NeteaseSearchResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search:${userId}`, 30, 60_000);
    const cookie = await this.getCookie(userId);
    const response = await this.callProvider(userId, () =>
      this.api.searchTracks({ ...query, cookie })
    );
    const songs = response.result?.songs ?? [];
    const detailByTrackId = await this.getSearchTrackDetails(userId, cookie, songs);
    return {
      items: songs
        .map((song) => {
          const trackId = readString(asRecord(song)?.id);
          const detail = trackId ? detailByTrackId.get(trackId) : undefined;
          return this.toTrackCandidate({
            ...(asRecord(song) ?? {}),
            ...(asRecord(detail) ?? {})
          });
        })
        .filter((song): song is NeteaseTrackCandidate => !!song),
      limit: query.limit,
      offset: query.offset
    };
  }

  async getTrack(userId: string, trackId: string) {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const response = await this.callProvider(userId, () =>
      this.api.getTrack({ trackId, cookie })
    );
    const songs = response.songs;
    const track = songs.map((song) => this.toTrackCandidate(song)).find(Boolean);
    if (!track) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseTrackNotFound, "NetEase track was not found."),
        HttpStatus.NOT_FOUND
      );
    }
    return track;
  }

  async openAudio(userId: string, trackId: string, quality: string, range?: string) {
    this.assertEnabled();
    this.assertRateLimit(`audio:${userId}`, 6, 60_000);
    const cookie = await this.getCookie(userId);
    const parsedQuality = neteaseQualitySchema.safeParse(quality);
    const selectedQuality = parsedQuality.success ? parsedQuality.data : this.defaultQuality();
    const bitrates = this.bitratesForQuality(selectedQuality);

    let response = await this.callProvider(userId, () =>
      this.api.getAudioUrl({
        trackId,
        bitrate: bitrates[0],
        cookie
      })
    );
    let audio = readAudioRecord(response);
    if (!audio?.url && bitrates.length > 1) {
      response = await this.callProvider(userId, () =>
        this.api.getAudioUrl({
          trackId,
          bitrate: bitrates[1],
          cookie
        })
      );
      audio = readAudioRecord(response);
    }

    if (!audio?.url) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseTrackNotFound, "NetEase audio is unavailable."),
        HttpStatus.NOT_FOUND
      );
    }

    let url: URL;
    try {
      url = new URL(audio.url);
    } catch {
      throw this.unavailableError();
    }
    if (!isAllowedAudioHost(url.hostname)) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseUnavailable, "NetEase returned an unsupported audio URL."),
        HttpStatus.BAD_GATEWAY
      );
    }

    const headers = new Headers();
    if (range) {
      headers.set("range", range);
    }
    const upstream = await fetchProviderUrl(
      url,
      { headers },
      this.requestTimeoutMs(),
      isAllowedAudioHost
    ).catch(() => {
      throw this.unavailableError();
    });

    if (!upstream.ok || !upstream.body) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseUnavailable, "NetEase audio could not be fetched."),
        HttpStatus.BAD_GATEWAY
      );
    }

    const mimeType = resolveAudioMimeType(audio.type, upstream.headers.get("content-type"));
    if (!mimeType) {
      await upstream.body.cancel().catch(() => undefined);
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseAudioUnsupported, "NetEase returned an unsupported audio format."),
        HttpStatus.UNSUPPORTED_MEDIA_TYPE
      );
    }

    const contentLength = Number(upstream.headers.get("content-length") ?? "0");
    if (contentLength > this.maxImportBytes()) {
      await upstream.body.cancel().catch(() => undefined);
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseImportTooLarge, "The NetEase audio file is too large."),
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

  private async getCookie(userId: string) {
    try {
      return await this.accounts.getCookieOrThrow(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "NetEase account is required.";
      if (message.includes("required")) {
        throw new HttpException(
          createApiErrorResponse(errorCodes.neteaseAccountRequired, "Bind a NetEase account first."),
          HttpStatus.CONFLICT
        );
      }
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseAuthExpired, "The NetEase account needs to be bound again."),
        HttpStatus.CONFLICT
      );
    }
  }

  private toTrackCandidate(value: unknown): NeteaseTrackCandidate | null {
    const song = asRecord(value) as SongRecord | null;
    if (!song) {
      return null;
    }
    const trackId = readString(song?.id);
    const title = readString(song?.name);
    if (!trackId || !/^\d+$/.test(trackId) || !title) {
      return null;
    }

    const artists = Array.isArray(song?.artists)
      ? song.artists
      : Array.isArray(song?.ar)
        ? song.ar
        : [];
    const artistNames = artists
      .map((artist) => readString(asRecord(artist)?.name))
      .filter((name): name is string => !!name);
    const album = asRecord(song?.album) ?? asRecord(song?.al);
    const artworkUrl = readString(album?.picUrl);
    return {
      provider: "netease",
      providerTrackId: trackId,
      access: resolveTrackAccess(song),
      quality: resolveTrackQuality(song),
      title,
      artist: artistNames.join(" / ") || "未知歌手",
      album: readString(album?.name),
      durationMs: readNumber(song?.duration) ?? readNumber(song?.dt) ?? 0,
      artworkUrl: artworkUrl && /^https?:\/\//.test(artworkUrl) ? artworkUrl : null
    };
  }

  private async getSearchTrackDetails(userId: string, cookie: string, songs: unknown[]) {
    const trackIds = songs
      .map((song) => readString(asRecord(song)?.id))
      .filter((trackId): trackId is string => !!trackId && /^\d+$/.test(trackId));
    if (trackIds.length === 0) {
      return new Map<string, unknown>();
    }

    try {
      const response = await this.callProvider(userId, () =>
        this.api.getTracks({ trackIds, cookie })
      );
      const detailByTrackId = new Map<string, unknown>();
      for (const song of response.songs) {
        const trackId = readString(asRecord(song)?.id);
        if (trackId) {
          detailByTrackId.set(trackId, song);
        }
      }
      return detailByTrackId;
    } catch (error) {
      if (isNeteaseUnavailableError(error)) {
        return new Map<string, unknown>();
      }
      throw error;
    }
  }

  private assertEnabled() {
    if (process.env.NETEASE_ENABLED !== "true") {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseDisabled, "NetEase integration is disabled."),
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private assertRateLimit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const bucket = this.userRateLimits.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (bucket.timestamps.length >= limit) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.rateLimited, "NetEase request rate limit exceeded."),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    bucket.timestamps.push(now);
    this.userRateLimits.set(key, bucket);
  }

  private unavailableError() {
    return new HttpException(
      createApiErrorResponse(
        errorCodes.neteaseUnavailable,
        "NetEase is temporarily unavailable."
      ),
      HttpStatus.BAD_GATEWAY
    );
  }

  private async callProvider<T>(userId: string | undefined, operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof NeteaseApiError && error.kind === "auth-expired") {
        if (userId) {
          await this.accounts.invalidate(userId).catch(() => undefined);
        }
        throw new HttpException(
          createApiErrorResponse(
            errorCodes.neteaseAuthExpired,
            "The NetEase account needs to be bound again."
          ),
          HttpStatus.CONFLICT
        );
      }
      throw this.unavailableError();
    }
  }

  private defaultQuality(): NeteaseQuality {
    return neteaseQualitySchema.safeParse(process.env.NETEASE_DEFAULT_QUALITY).success
      ? (process.env.NETEASE_DEFAULT_QUALITY as NeteaseQuality)
      : "exhigh";
  }

  private bitratesForQuality(quality: NeteaseQuality) {
    if (quality === "standard") return [128_000, 192_000];
    if (quality === "high") return [192_000, 128_000];
    return [320_000, 192_000];
  }

  private requestTimeoutMs() {
    const value = Number(process.env.NETEASE_REQUEST_TIMEOUT_MS ?? 15_000);
    return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000;
  }

  private maxImportBytes() {
    const value = Number(process.env.NETEASE_MAX_IMPORT_BYTES ?? 209_715_200);
    return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 209_715_200;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveTrackAccess(song: SongRecord) {
  const privilege = asRecord(song.privilege);
  const fee = readNumber(song.fee) ?? readNumber(privilege?.fee);
  if (fee === 0 || fee === 8) return "free" as const;
  if (fee === 1) return "vip" as const;
  if (fee === 4) return "paid" as const;
  return "unknown" as const;
}

function resolveTrackQuality(song: SongRecord) {
  if (hasAudioFile(song.hr)) return "hires" as const;
  if (hasAudioFile(song.sq)) return "lossless" as const;
  if (hasAudioFile(song.h) || (readNumber(asRecord(song.privilege)?.maxbr) ?? 0) >= 320_000) {
    return "exhigh" as const;
  }
  if (hasAudioFile(song.m)) return "high" as const;
  if (hasAudioFile(song.l)) return "standard" as const;
  return null;
}

function hasAudioFile(value: unknown) {
  const record = asRecord(value);
  return !!record && (readNumber(record.br) ?? 0) > 0;
}

function readAudioRecord(value: unknown) {
  const body = asRecord(value);
  const data = Array.isArray(body?.data) ? body.data : [];
  const item = asRecord(data[0]);
  const url = readString(item?.url);
  return url
    ? {
        url,
        type: readString(item?.type)
      }
    : null;
}

function resolveAudioMimeType(providerType: string | null, upstreamType: string | null) {
  const type = `${providerType ?? ""} ${upstreamType ?? ""}`.toLowerCase();
  if (type.includes("flac")) return "audio/flac";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio/mpeg";
  return null;
}

function isAllowedAudioHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "music.163.com" ||
    normalized.endsWith(".music.163.com") ||
    normalized.endsWith(".126.net") ||
    normalized.endsWith(".netease.com");
}

function isNeteaseUnavailableError(error: unknown) {
  if (!(error instanceof HttpException) || error.getStatus() !== HttpStatus.BAD_GATEWAY) {
    return false;
  }

  const response = error.getResponse();
  return typeof response === "object" &&
    response !== null &&
    "code" in response &&
    response.code === errorCodes.neteaseUnavailable;
}
