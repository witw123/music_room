import { Injectable } from "@nestjs/common";
import {
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_status,
  search,
  song_detail,
  song_url
} from "@neteasecloudmusicapienhanced/api";
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

@Injectable()
export class NeteaseApiClient {
  async createQrCode() {
    return this.call(async () => {
      const keyResponse = (await login_qr_key({})) as NeteaseApiResponse;
      const keyBody = parseBody(neteaseQrKeyBodySchema, keyResponse.body);
      assertSuccessfulCode(keyBody.code);
      const key = "data" in keyBody ? keyBody.data.unikey : keyBody.unikey;

      const qrResponse = (await login_qr_create({ key, qrimg: true })) as NeteaseApiResponse;
      const qrBody = parseBody(neteaseQrCreateBodySchema, qrResponse.body);
      assertSuccessfulCode(qrBody.code);
      const qrimg = "data" in qrBody ? qrBody.data.qrimg : qrBody.qrimg;

      return { key, qrimg };
    });
  }

  async checkQrCode(key: string): Promise<NeteaseQrCheckResult> {
    return this.call(async () => {
      const response = (await login_qr_check({ key })) as NeteaseApiResponse;
      const body = parseBody(neteaseQrCheckBodySchema, response.body);
      const code = body.code ?? body.data?.code ?? null;
      const cookie = readCookie(response, body);

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

  async validateCookie(cookie: string) {
    return this.call(async () => {
      const response = (await login_status({ cookie })) as NeteaseApiResponse;
      const body = parseBody(neteaseLoginStatusBodySchema, response.body);
      assertSuccessfulCode(body.code);
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
    return this.call(async () => {
      const response = (await search({
        keywords: input.keywords,
        type: 1,
        limit: input.limit,
        offset: input.offset,
        cookie: input.cookie
      })) as NeteaseApiResponse;
      const body = parseBody(neteaseSearchBodySchema, response.body);
      assertSuccessfulCode(body.code);
      return body;
    });
  }

  async getTrack(input: { trackId: string; cookie: string }) {
    return this.call(async () => {
      const response = (await song_detail({
        ids: input.trackId,
        cookie: input.cookie
      })) as NeteaseApiResponse;
      const body = parseBody(neteaseSongDetailBodySchema, response.body);
      assertSuccessfulCode(body.code);
      return body;
    });
  }

  async getAudioUrl(input: { trackId: string; bitrate: number; cookie: string }) {
    return this.call(async () => {
      const response = (await song_url({
        id: input.trackId,
        br: input.bitrate,
        cookie: input.cookie
      })) as NeteaseApiResponse;
      const body = parseBody(neteaseAudioUrlBodySchema, response.body);
      assertSuccessfulCode(body.code);
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

function readCookie(
  response: NeteaseApiResponse,
  body: NeteaseQrCheckBody
) {
  if (body.cookie?.trim()) {
    return body.cookie.trim();
  }

  if (Array.isArray(response.cookie)) {
    const values = response.cookie.filter((item): item is string => typeof item === "string");
    return values.length > 0 ? values.join(";") : null;
  }

  return typeof response.cookie === "string" && response.cookie.trim()
    ? response.cookie.trim()
    : null;
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
