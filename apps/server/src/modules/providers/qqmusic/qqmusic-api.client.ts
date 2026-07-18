import { Injectable } from "@nestjs/common";
import { checkQQLoginQr, getMusicPlay, getQQLoginQr, getSearchByKey } from "@sansenjian/qq-music-api/services";

export type QqMusicApiErrorKind = "auth-expired" | "unavailable" | "invalid-response";
export class QqMusicApiError extends Error {
  constructor(public readonly kind: QqMusicApiErrorKind) { super("QQ Music provider request failed."); this.name = "QqMusicApiError"; }
}
type ApiResponse = { status?: unknown; body?: any };
@Injectable()
export class QqMusicApiClient {
  async createQrCode() {
    return this.call(async () => {
      const response = await getQQLoginQr({}) as ApiResponse;
      const body = response.body;
      const item = body?.response && typeof body.response === "object" ? body.response : body;
      if (!item?.img || !item?.qrsig || !item?.ptqrtoken) throw new QqMusicApiError("invalid-response");
      return { qrimg: String(item.img), qrsig: String(item.qrsig), ptqrtoken: String(item.ptqrtoken) };
    });
  }
  async checkQrCode(input: { qrsig: string; ptqrtoken: string }) {
    return this.call(async () => {
      const response = await checkQQLoginQr({ params: input }) as ApiResponse;
      const item = response.body?.response;
      if (!item || typeof item !== "object") throw new QqMusicApiError("invalid-response");
      if (item.refresh) return { status: "expired" as const, session: null };
      if (!item.isOk) return { status: "pending" as const, session: null, message: item.message ? String(item.message) : undefined };
      const session = item.session;
      const cookie = readCookie(session);
      if (!session || !cookie) throw new QqMusicApiError("invalid-response");
      return { status: "connected" as const, session: { cookie, userId: readString(session.uin ?? session.loginUin), nickname: null, avatarUrl: null } };
    });
  }
  async searchTracks(input: { keywords: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = await getSearchByKey({ params: { key: input.keywords, w: input.keywords, p: Math.floor(input.offset / input.limit) + 1, n: input.limit }, option: { headers: { Cookie: input.cookie } } }) as ApiResponse;
      const list = response.body?.response?.data?.song?.list;
      if (!Array.isArray(list)) throw new QqMusicApiError("invalid-response");
      return list;
    });
  }
  async getAudioUrl(input: { trackId: string; quality: "standard" | "high" | "exhigh"; cookie: string }) {
    return this.call(async () => {
      const quality = input.quality === "standard" ? "128" : input.quality === "high" ? "320" : "flac";
      const response = await getMusicPlay({ params: { songmid: input.trackId, quality, resType: "play" }, option: { headers: { Cookie: input.cookie } } }) as ApiResponse;
      const value = response.body?.data?.playUrl?.[input.trackId];
      const url = typeof value === "string" ? value : value?.url;
      if (!url) return { url: null };
      return { url: String(url) };
    });
  }
  private async call<T>(operation: () => Promise<T>) {
    try { return await operation(); } catch (error) {
      if (error instanceof QqMusicApiError) throw error;
      throw new QqMusicApiError("unavailable");
    }
  }
}
function readCookie(session: any) {
  if (typeof session?.cookie === "string" && session.cookie.trim()) return session.cookie.trim();
  if (Array.isArray(session?.cookieList)) return session.cookieList.filter((item: unknown): item is string => typeof item === "string").join("; ");
  if (session?.cookieObject && typeof session.cookieObject === "object") return Object.entries(session.cookieObject).map(([key, value]) => `${key}=${String(value)}`).join("; ");
  return null;
}
function readString(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" && value.trim() ? value.trim() : null; }
