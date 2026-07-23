import { Injectable } from "@nestjs/common";
import {
  album_new,
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_status,
  lyric,
  personalized,
  playlist_catlist,
  playlist_detail,
  playlist_track_all,
  recommend_resource,
  recommend_songs,
  user_playlist,
  album,
  search,
  song_detail,
  song_url,
  top_playlist,
  toplist
} from "@neteasecloudmusicapienhanced/api";
import type { RequestBaseConfig } from "@neteasecloudmusicapienhanced/api";
import type {
  NeteaseApiSong,
  NeteaseAudioUrlBody,
  NeteaseLoginStatusBody,
  NeteaseQrCheckBody,
  NeteaseSearchBody,
  NeteaseSongDetailBody
} from "./netease.schemas";
import {
  neteaseAudioUrlBodySchema,
  neteaseLoginStatusBodySchema,
  neteaseQrCheckBodySchema,
  neteaseQrCreateBodySchema,
  neteaseQrKeyBodySchema,
  neteaseSearchBodySchema,
  neteaseSongDetailBodySchema
} from "./netease.schemas";
import { z } from "zod";

type NeteaseApiResponse = {
  status?: unknown;
  body?: unknown;
  cookie?: unknown;
};

export type NeteaseApiErrorKind = "auth-expired" | "unavailable" | "invalid-response";

export class NeteaseApiError extends Error {
  constructor(public readonly kind: NeteaseApiErrorKind) {
    super("NetEase provider request failed.");
    this.name = "NeteaseApiError";
  }
}

export type NeteaseQrCheckResult = {
  status: "pending" | "scanned" | "connected" | "expired" | "failed";
  cookie: string | null;
  message?: string;
};

type NeteaseCrypto = "api" | "weapi";

@Injectable()
export class NeteaseApiClient {
  async createQrCode() {
    return this.call(async () => {
      const timeout = this.requestTimeoutMs();
      const keyRequest = withProviderOptions({}, timeout);
      const keyResponse = (await login_qr_key(keyRequest)) as NeteaseApiResponse;
      const keyBody = parseBody(neteaseQrKeyBodySchema, keyResponse.body);
      assertSuccessfulCode(keyBody.code);
      const key = "data" in keyBody ? keyBody.data.unikey : keyBody.unikey;

      const qrRequest = withProviderOptions({
        key,
        qrimg: true
      }, timeout);
      const qrResponse = (await login_qr_create(qrRequest)) as NeteaseApiResponse;
      const qrBody = parseBody(neteaseQrCreateBodySchema, qrResponse.body);
      assertSuccessfulCode(qrBody.code);
      const qrimg = "data" in qrBody ? qrBody.data.qrimg : qrBody.qrimg;

      return { key, qrimg };
    });
  }

  async checkQrCode(key: string): Promise<NeteaseQrCheckResult> {
    try {
      return await this.checkQrCodeWithCrypto(key);
    } catch (error) {
      if (!isRetryableProviderError(error)) {
        throw error;
      }
    }

    try {
      return await this.checkQrCodeWithCrypto(key, "weapi");
    } catch (error) {
      if (!isRetryableProviderError(error)) {
        throw error;
      }

      // The QR endpoint is polled repeatedly. Keep the attempt alive when
      // both provider transports fail for one poll; the next poll can recover.
      return { status: "pending", cookie: null };
    }
  }

  async validateCookie(cookie: string) {
    try {
      return await this.validateCookieWithCrypto(cookie);
    } catch (error) {
      if (!isRetryableProviderError(error)) {
        throw error;
      }
    }

    return this.validateCookieWithCrypto(cookie, "api");
  }

  private async validateCookieWithCrypto(cookie: string, crypto?: NeteaseCrypto) {
    return this.call(async () => {
      const request = withProviderOptions({ cookie }, this.requestTimeoutMs(), crypto);
      const response = (await login_status(request)) as NeteaseApiResponse;
      const body = parseBody(neteaseLoginStatusBodySchema, response.body);
      const code = body.code ?? body.data?.code ?? null;
      if (code === null) {
        throw new NeteaseApiError("invalid-response");
      }
      assertSuccessfulCode(code);
      const profile = body.data?.profile ?? body.profile;
      const neteaseUserId = readString(profile?.userId) ?? readString(profile?.id);
      if (!profile || !neteaseUserId) {
        throw new NeteaseApiError("invalid-response");
      }

      return {
        neteaseUserId,
        nickname: readString(profile.nickname) ?? readString(profile.signature),
        avatarUrl: readString(profile.avatarUrl)
      };
    });
  }

  async searchTracks(input: { keywords: string; limit: number; offset: number; cookie: string }) {
    return this.search({ ...input, type: 1 });
  }

  async searchAlbums(input: { keywords: string; limit: number; offset: number; cookie: string }) {
    return this.search({ ...input, type: 10 });
  }

  async searchPlaylists(input: { keywords: string; limit: number; offset: number; cookie: string }) {
    return this.search({ ...input, type: 1_000 });
  }

  private async search(input: { keywords: string; limit: number; offset: number; cookie: string; type: number }) {
    return this.call(async () => {
      const request = withProviderOptions({
        keywords: input.keywords,
        type: input.type,
        limit: input.limit,
        offset: input.offset,
        cookie: input.cookie
      }, this.requestTimeoutMs());
      const response = (await search(request)) as NeteaseApiResponse;
      const body = parseBody(neteaseSearchBodySchema, response.body);
      assertSuccessfulCode(body.code);
      return body;
    });
  }

  async getTrack(input: { trackId: string; cookie: string }) {
    return this.getTracks({ trackIds: [input.trackId], cookie: input.cookie });
  }

  async getTracks(input: { trackIds: string[]; cookie: string }) {
    return this.call(async () => {
      const request = withProviderOptions({
        ids: input.trackIds.join(","),
        cookie: input.cookie
      }, this.requestTimeoutMs());
      const response = (await song_detail(request)) as NeteaseApiResponse;
      const body = parseBody(neteaseSongDetailBodySchema, response.body);
      assertSuccessfulCode(body.code);
      return body;
    });
  }

  async getAudioUrl(input: { trackId: string; bitrate: number; cookie: string }) {
    return this.call(async () => {
      const request = withProviderOptions({
        id: input.trackId,
        br: input.bitrate,
        cookie: input.cookie
      }, this.requestTimeoutMs());
      const response = (await song_url(request)) as NeteaseApiResponse;
      const body = parseBody(neteaseAudioUrlBodySchema, response.body);
      assertSuccessfulCode(body.code);
      return body;
    });
  }

  async getLyrics(input: { trackId: string; cookie: string }) {
    return this.call(async () => {
      const response = (await lyric(withProviderOptions({ id: input.trackId, cookie: input.cookie }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getUserPlaylists(input: { userId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = (await user_playlist(withProviderOptions({ uid: input.userId, limit: input.limit, offset: input.offset, cookie: input.cookie }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getRecommendedPlaylists(input: { limit: number; cookie?: string }) {
    return this.call(async () => {
      const response = (await personalized(withProviderOptions({
        limit: input.limit,
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getCategoryPlaylists(input: {
    category: string;
    order: "hot" | "new";
    limit: number;
    offset: number;
    cookie?: string;
  }) {
    return this.call(async () => {
      const response = (await top_playlist(withProviderOptions({
        cat: input.category,
        order: input.order as never,
        limit: input.limit,
        offset: input.offset,
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getPlaylistCategories(input: { cookie?: string }) {
    return this.call(async () => {
      const response = (await playlist_catlist(withProviderOptions({
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getToplists(input: { cookie?: string }) {
    return this.call(async () => {
      const response = (await toplist(withProviderOptions({
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getNewAlbums(input: {
    area: "all" | "zh" | "ea" | "kr" | "jp";
    limit: number;
    offset: number;
    cookie?: string;
  }) {
    return this.call(async () => {
      const response = (await album_new(withProviderOptions({
        area: neteaseAlbumAreaByKey[input.area] as never,
        limit: input.limit,
        offset: input.offset,
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getDailyPlaylists(input: { cookie: string }) {
    return this.call(async () => {
      const response = (await recommend_resource(withProviderOptions({
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getDailyTracks(input: { cookie: string }) {
    return this.call(async () => {
      const response = (await recommend_songs(withProviderOptions({
        cookie: input.cookie
      }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getPlaylist(input: { playlistId: string; cookie: string }) {
    return this.call(async () => {
      const response = (await playlist_detail(withProviderOptions({ id: input.playlistId, cookie: input.cookie }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getPlaylistTracks(input: { playlistId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = (await playlist_track_all(withProviderOptions({ id: input.playlistId, limit: input.limit, offset: input.offset, cookie: input.cookie }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  async getAlbum(input: { albumId: string; cookie: string }) {
    return this.call(async () => {
      const response = (await album(withProviderOptions({ id: input.albumId, cookie: input.cookie }, this.requestTimeoutMs()))) as NeteaseApiResponse;
      const body = parseCatalogBody(response.body);
      assertSuccessfulCode(readCatalogCode(body));
      return body;
    });
  }

  private async call<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof NeteaseApiError) {
        throw error;
      }
      throw new NeteaseApiError("unavailable");
    }
  }

  private async checkQrCodeWithCrypto(key: string, crypto?: NeteaseCrypto) {
    return this.call(async () => {
      const request = withProviderOptions({ key }, this.requestTimeoutMs(), crypto);
      const response = (await login_qr_check(request)) as NeteaseApiResponse;
      const body = parseBody(neteaseQrCheckBodySchema, response.body);
      const code = body.code ?? body.data?.code ?? null;
      const cookie = readCookie(response, body);

      if (code === null) {
        throw new NeteaseApiError("invalid-response");
      }

      // The provider also returns an anonymous cookie while the QR code is
      // pending. Only code 803 represents a completed user login.
      if (code === 803) {
        return { status: "connected" as const, cookie };
      }
      if (code === 802) {
        return { status: "scanned" as const, cookie: null };
      }
      if (code === 800) {
        return { status: "expired" as const, cookie: null };
      }
      if (code === 801) {
        return { status: "pending" as const, cookie: null };
      }

      return {
        status: "failed" as const,
        cookie: null,
        message: "NetEase QR login failed."
      };
    });
  }

  private requestTimeoutMs() {
    const value = Number(process.env.NETEASE_REQUEST_TIMEOUT_MS ?? 15_000);
    return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000;
  }
}

function isRetryableProviderError(error: unknown): error is NeteaseApiError {
  return error instanceof NeteaseApiError &&
    (error.kind === "unavailable" || error.kind === "invalid-response");
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new NeteaseApiError("invalid-response");
  }
  return result.data;
}

function assertSuccessfulCode(code: number) {
  if (code === 301) {
    throw new NeteaseApiError("auth-expired");
  }
  if (code !== 200) {
    throw new NeteaseApiError("unavailable");
  }
}

function parseCatalogBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NeteaseApiError("invalid-response");
  }
  return value as Record<string, unknown>;
}

function readCatalogCode(body: Record<string, unknown>) {
  const value = body.code;
  const code = Number(value);
  if (!Number.isFinite(code)) throw new NeteaseApiError("invalid-response");
  return code;
}

function readCookie(
  response: NeteaseApiResponse,
  body: NeteaseQrCheckBody
) {
  const values = [
    ...(Array.isArray(response.cookie)
      ? response.cookie.filter((item): item is string => typeof item === "string")
      : []),
    ...(typeof body.cookie === "string" ? [body.cookie] : []),
    ...(typeof response.cookie === "string" ? [response.cookie] : [])
  ];
  const cookies = new Map<string, string>();
  for (const value of values) {
    for (const part of value.split(";")) {
      const separator = part.indexOf("=");
      if (separator <= 0) continue;
      const name = part.slice(0, separator).trim();
      const cookieValue = part.slice(separator + 1).trim();
      if (!name || !cookieValue || cookieAttributes.has(name.toLowerCase())) continue;
      cookies.set(name, cookieValue);
    }
  }

  return cookies.size > 0
    ? [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
    : null;
}

const cookieAttributes = new Set([
  "domain",
  "expires",
  "httponly",
  "max-age",
  "partitioned",
  "path",
  "priority",
  "samesite",
  "secure"
]);

const neteaseAlbumAreaByKey = {
  all: "ALL",
  zh: "ZH",
  ea: "EA",
  kr: "KR",
  jp: "JP"
} as const;

type ProviderRequestOptions = RequestBaseConfig & {
  crypto?: NeteaseCrypto;
  timeout: number;
};

// The package reads these runtime options, but its published declarations omit them.
function withProviderOptions<T extends object>(
  input: T,
  timeout: number,
  crypto?: NeteaseCrypto
) {
  return {
    ...input,
    timeout,
    ...(crypto ? { crypto } : {})
  } as T & ProviderRequestOptions;
}

function readString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type {
  NeteaseApiSong,
  NeteaseAudioUrlBody,
  NeteaseLoginStatusBody,
  NeteaseSearchBody,
  NeteaseSongDetailBody
};
