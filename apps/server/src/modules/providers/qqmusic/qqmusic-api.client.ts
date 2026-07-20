import { Injectable } from "@nestjs/common";
import {
  checkQQLoginQr,
  getAlbumInfo,
  getAlbumSongs,
  getLyric,
  getMusicPlay,
  getQQLoginQr,
  getSearchByKey,
  getUserPlaylists,
  songListDetail
} from "@sansenjian/qq-music-api/services";

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
      const body = response.body;
      const item = body?.response && typeof body.response === "object" ? body.response : body;
      if (!item || typeof item !== "object") throw new QqMusicApiError("invalid-response");
      if (item.refresh) return { status: "expired" as const, session: null };
      if (typeof item.isOk !== "boolean") throw new QqMusicApiError("invalid-response");
      if (!item.isOk) return { status: "pending" as const, session: null, message: item.message ? String(item.message) : undefined };
      const session = item.session;
      const cookie = readCookie(session);
      if (!session || !cookie) throw new QqMusicApiError("invalid-response");
      return { status: "connected" as const, session: { cookie, userId: readString(session.uin ?? session.loginUin), nickname: null, avatarUrl: null } };
    });
  }
  async searchTracks(input: { keywords: string; limit: number; offset: number; cookie: string; kind?: "song" | "album" | "playlist" }) {
    return this.call(async () => {
      const kind = input.kind ?? "song";
      const response = await getSearchByKey({ params: { key: input.keywords, w: input.keywords, p: Math.floor(input.offset / input.limit) + 1, n: input.limit, remoteplace: `txt.yqq.${kind}` }, option: { headers: { Cookie: input.cookie } } }) as ApiResponse;
      assertProviderStatus(response.status);
      const body = asRecord(response.body);
      const responseBody = asRecord(body?.response) ?? body;
      const data = asRecord(responseBody?.data) ?? responseBody;
      const section = asRecord(data?.[kind]) ?? data;
      const list = section?.list ?? section?.itemlist;
      if (!Array.isArray(list)) throw new QqMusicApiError("invalid-response");
      return list;
    });
  }
  async getAudioUrl(input: { trackId: string; quality: "standard" | "high" | "exhigh"; cookie: string }) {
    return this.call(async () => {
      const quality = input.quality === "standard" ? "128" : input.quality === "high" ? "320" : "flac";
      const response = await getMusicPlay({ params: { songmid: input.trackId, quality, resType: "play" }, option: { headers: { Cookie: input.cookie } } }) as ApiResponse;
      assertProviderStatus(response.status);
      const body = asRecord(response.body);
      const data = asRecord(body?.data) ?? asRecord(asRecord(body?.response)?.data);
      const value = data?.playUrl?.[input.trackId];
      const url = typeof value === "string" ? value : value?.url;
      if (!url) return { url: null };
      return { url: String(url) };
    });
  }

  async getLyrics(input: { trackId: string; cookie: string }) {
    return this.call(async () => {
      const response = await getLyric({
        params: { songmid: input.trackId },
        option: { headers: { Cookie: input.cookie } }
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getUserPlaylists(input: { userId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = await getUserPlaylists({
        uin: input.userId,
        limit: input.limit,
        offset: input.offset,
        cookie: input.cookie
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getPlaylist(input: { playlistId: string; cookie: string }) {
    return this.call(async () => {
      const response = await songListDetail({
        params: { disstid: input.playlistId },
        option: { headers: { Cookie: input.cookie } }
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getAlbum(input: { albumId: string; cookie: string }) {
    return this.call(async () => {
      const [infoResponse, songsResponse] = await Promise.all([
        getAlbumInfo({ params: { albummid: input.albumId }, option: { headers: { Cookie: input.cookie } } }) as Promise<ApiResponse>,
        getAlbumSongs({ params: { albummid: input.albumId }, option: { headers: { Cookie: input.cookie } } }) as Promise<ApiResponse>
      ]);
      assertProviderStatus(infoResponse.status);
      assertProviderStatus(songsResponse.status);
      return {
        info: readProviderBody(infoResponse.body),
        songs: readProviderBody(songsResponse.body)
      };
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
function asRecord(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function readString(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" && value.trim() ? value.trim() : null; }

function readProviderBody(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QqMusicApiError("invalid-response");
  const body = value as Record<string, any>;
  if (body.error) throw new QqMusicApiError("unavailable");
  const response = body.response;
  return response && typeof response === "object" && !Array.isArray(response) ? response : body;
}

function assertProviderStatus(status: unknown) {
  const code = Number(status);
  if (Number.isFinite(code) && code >= 400) throw new QqMusicApiError("unavailable");
}
