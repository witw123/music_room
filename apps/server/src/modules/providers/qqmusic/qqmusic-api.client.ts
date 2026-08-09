import { Injectable } from "@nestjs/common";
import * as qqMusicServices from "@sansenjian/qq-music-api/services";
import {
  checkQQLoginQr,
  getAlbumInfo,
  getAlbumSongs,
  getDigitalAlbumLists,
  getMusicPlay,
  getQQLoginQr,
  getRecommendBanner,
  getRelatedPlaylists,
  getSmartbox,
  getHotKey,
  getSearchByKey,
  getTopLists,
  getUserPlaylists,
  getUserCollectedAlbums,
  getUserCollectedSongLists,
  getUserFollowSingers,
  songListCategories,
  songLists,
  songListDetail
} from "@sansenjian/qq-music-api/services";
import { fetchProviderUrl } from "../provider-fetch";

// The installed SDK exports this helper at runtime but omits it from its
// services declaration file. Keep the compatibility access local and typed.
const getUserDetail = (qqMusicServices as unknown as {
  getUserDetail?: (input: { uin: string; cookie: string }) => Promise<unknown>;
}).getUserDetail;

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
      const response = await getSearchByKey({
        params: {
          key: input.keywords,
          w: input.keywords,
          p: Math.floor(input.offset / input.limit) + 1,
          n: input.limit,
          t: kind === "album" ? 8 : kind === "playlist" ? 5 : 0,
          remoteplace: kind === "playlist" ? "txt.yqq.songlist" : `txt.yqq.${kind}`
        },
        option: { headers: { Cookie: input.cookie } }
      }) as ApiResponse;
      assertProviderStatus(response.status);
      const body = asRecord(response.body);
      const responseBody = asRecord(body?.response) ?? body;
      const data = asRecord(responseBody?.data) ?? responseBody;
      const list = readSearchResultList(data ?? {}, kind);
      if (!list) {
        // QQ currently omits the album section for some valid searches. Let
        // the service recover albums from the song section in that case.
        if (kind === "album") return [];
        throw new QqMusicApiError("invalid-response");
      }
      return list;
    });
  }

  async searchSuggestions(input: { keywords: string }) {
    return this.call(async () => {
      const response = await getSmartbox({ params: { key: input.keywords } }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getSearchHot() {
    return this.call(async () => {
      const response = await getHotKey({}) as ApiResponse;
      assertProviderStatus(response.status);
      return readSuccessfulProviderBody(response.body);
    });
  }
  async searchPlaylists(input: { keywords: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const url = new URL("https://c.y.qq.com/soso/fcgi-bin/client_music_search_songlist");
      url.search = new URLSearchParams({
        remoteplace: "txt.yqq.center",
        searchid: String(Date.now()),
        page_no: String(Math.floor(input.offset / input.limit)),
        num_per_page: String(input.limit),
        query: input.keywords,
        format: "json",
        inCharset: "utf8",
        outCharset: "utf-8",
        platform: "yqq"
      }).toString();
      const response = await fetchProviderUrl(
        url,
        {
          headers: {
            Cookie: input.cookie,
            Host: "c.y.qq.com",
            Referer: "https://y.qq.com/portal/search.html"
          }
        },
        requestTimeoutMs(),
        isAllowedHost,
        { allowSyntheticDns: true }
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new QqMusicApiError("unavailable");
      }
      const body = asRecord(parseJson(await response.text()));
      if (!body) {
        throw new QqMusicApiError("invalid-response");
      }
      if (Number(body.code) !== 0 || Number(body.subcode) !== 0) {
        throw new QqMusicApiError("unavailable");
      }
      const data = asRecord(body.data);
      if (!data || !Array.isArray(data.list)) {
        throw new QqMusicApiError("invalid-response");
      }
      return data.list;
    });
  }
  async getAudioUrl(input: { trackId: string; quality: "standard" | "high" | "exhigh"; cookie: string }) {
    return this.call(async () => {
      const quality = input.quality === "standard" ? "128" : input.quality === "high" ? "320" : "flac";
      const response = await getMusicPlay({ params: { songmid: input.trackId, quality, resType: "play" }, option: { headers: { Cookie: input.cookie } } }) as ApiResponse;
      assertProviderStatus(response.status);
      const url = readPlayUrl(response.body, input.trackId);
      if (!url) return { url: null };
      return { url: String(url) };
    });
  }

  async validateCookie(input: { userId: string; cookie: string }) {
    return this.call(async () => {
      if (!input.userId.trim()) throw new QqMusicApiError("auth-expired");
      if (!getUserDetail) throw new QqMusicApiError("unavailable");
      const response = await getUserDetail({ uin: normalizeQqUserId(input.userId), cookie: input.cookie }) as ApiResponse;
      assertProviderStatus(response.status);
      const body = asRecord(response.body);
      if (!body) throw new QqMusicApiError("invalid-response");
      throwIfAuthExpired(body);
      const item = asRecord(body.response) ?? body;
      if (!item) throw new QqMusicApiError("invalid-response");
      const code = readBusinessCode(item);
      if (code !== null && code !== 0 && code !== 200) {
        throw new QqMusicApiError("unavailable");
      }
      return { valid: true as const };
    });
  }

  async getLyrics(input: { trackId: string; cookie: string }) {
    return this.call(async () => {
      const loginUin = readQqUinFromCookie(input.cookie);
      const response = await fetchProviderUrl(
        new URL("https://u.y.qq.com/cgi-bin/musicu.fcg"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: input.cookie,
            Origin: "https://y.qq.com",
            Referer: "https://y.qq.com/portal/player.html"
          },
          body: JSON.stringify({
            comm: { uin: loginUin, format: "json", ct: 24, cv: 0 },
            req_0: {
              module: "music.musichallSong.PlayLyricInfo",
              method: "GetPlayLyricInfo",
              param: {
                songMID: input.trackId,
                songID: 0,
                trans_t: 1,
                roma_t: 1,
                qrc_t: 1,
                crypt: 1,
                lrc_t: 1,
                interval: 0
              }
            }
          })
        },
        requestTimeoutMs(),
        isAllowedHost,
        { allowSyntheticDns: true }
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new QqMusicApiError(response.status === 401 || response.status === 403 ? "auth-expired" : "unavailable");
      }
      const body = asRecord(parseJson(await response.text()));
      const result = asRecord(asRecord(body?.req_0)?.data ?? asRecord(body?.PlayLyricInfo)?.data);
      if (!result) throw new QqMusicApiError("invalid-response");
      throwIfAuthExpired(result);
      return {
        ...result,
        lyric: decodeLyricField(result.lyric),
        qrc: decodeLyricField(result.qrc ?? result.qrcLyric),
        trans: decodeLyricField(result.trans ?? result.transLyric),
        roma: decodeLyricField(result.roma ?? result.romaLyric ?? result.romalrc)
      };
    });
  }

  async getLikedPlaylist(input: { userId: string; cookie: string }) {
    return this.call(async () => {
      if (!getUserDetail) throw new QqMusicApiError("unavailable");
      const response = await getUserDetail({ uin: normalizeQqUserId(input.userId), cookie: input.cookie }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getCollectedPlaylists(input: { userId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = await getUserCollectedSongLists({
        uin: normalizeQqUserId(input.userId),
        page: Math.floor(input.offset / input.limit) + 1,
        limit: input.limit,
        cookie: input.cookie
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getCollectedAlbums(input: { userId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = await getUserCollectedAlbums({
        uin: normalizeQqUserId(input.userId),
        page: Math.floor(input.offset / input.limit) + 1,
        limit: input.limit,
        cookie: input.cookie
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getFollowedArtists(input: { userId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = await getUserFollowSingers({
        uin: normalizeQqUserId(input.userId),
        page: Math.floor(input.offset / input.limit) + 1,
        limit: input.limit,
        cookie: input.cookie
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getRelatedPlaylists(input: { trackId: string; cookie: string }) {
    return this.call(async () => {
      const response = await getRelatedPlaylists({
        params: { songid: input.trackId },
        option: { headers: { Cookie: input.cookie } }
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getUserPlaylists(input: { userId: string; limit: number; offset: number; cookie: string }) {
    return this.call(async () => {
      const response = await getUserPlaylists({
        uin: normalizeQqUserId(input.userId),
        limit: input.limit,
        offset: input.offset,
        cookie: input.cookie
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readProviderBody(response.body);
    });
  }

  async getPlaylistCategories() {
    return this.call(async () => {
      const response = await songListCategories({}) as ApiResponse;
      assertProviderStatus(response.status);
      return readSuccessfulProviderBody(response.body);
    });
  }

  async getCategoryPlaylists(input: {
    categoryId: number;
    sortId: number;
    limit: number;
    offset: number;
  }) {
    return this.call(async () => {
      const response = await songLists({
        params: {
          categoryId: input.categoryId,
          sortId: input.sortId,
          sin: input.offset,
          ein: input.offset + input.limit - 1
        }
      }) as ApiResponse;
      assertProviderStatus(response.status);
      return readSuccessfulProviderBody(response.body);
    });
  }

  async getToplists() {
    return this.call(async () => {
      const response = await getTopLists({}) as ApiResponse;
      assertProviderStatus(response.status);
      return readSuccessfulProviderBody(response.body);
    });
  }

  async getDigitalAlbums() {
    return this.call(async () => {
      const response = await getDigitalAlbumLists({}) as ApiResponse;
      assertProviderStatus(response.status);
      return readSuccessfulProviderBody(response.body);
    });
  }

  async getBanners() {
    return this.call(async () => {
      const response = await getRecommendBanner({}) as ApiResponse;
      assertProviderStatus(response.status);
      return readSuccessfulProviderBody(response.body);
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
  const cookies = new Map<string, string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    for (const part of value.split(";")) {
      const separator = part.indexOf("=");
      if (separator <= 0) continue;
      const name = part.slice(0, separator).trim();
      const cookieValue = part.slice(separator + 1).trim();
      if (name && cookieValue) cookies.set(name, `${name}=${cookieValue}`);
    }
  };
  add(session?.cookie);
  if (Array.isArray(session?.cookieList)) session.cookieList.forEach(add);
  if (session?.cookieObject && typeof session.cookieObject === "object") {
    for (const [key, value] of Object.entries(session.cookieObject)) {
      if (typeof value === "string" && value.trim()) cookies.set(key, `${key}=${value.trim()}`);
    }
  }
  return cookies.size > 0 ? [...cookies.values()].join("; ") : null;
}
function asRecord(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function readString(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" && value.trim() ? value.trim() : null; }
function normalizeQqUserId(value: string) {
  const normalized = value.trim();
  return /^o\d+$/i.test(normalized) ? normalized.slice(1) : normalized;
}

function readQqUinFromCookie(cookie: string) {
  for (const name of ["uin", "qqmusic_uin", "wxuin"]) {
    const match = new RegExp(`(?:^|;\\s*)${name}=o?(\\d+)`, "i").exec(cookie);
    if (match?.[1]) return match[1];
  }
  return "0";
}

function decodeLyricField(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return decoded.trim() ? decoded : value;
  } catch {
    return value;
  }
}

function readPlayUrl(value: unknown, trackId: string) {
  const body = asRecord(value);
  if (!body) return null;
  throwIfAuthExpired(body);
  const containers = [
    asRecord(asRecord(body.data)?.playUrl),
    asRecord(asRecord(asRecord(body.response)?.data)?.playUrl),
    asRecord(body.playUrl),
    asRecord(asRecord(body.response)?.playUrl)
  ];
  for (const container of containers) {
    if (!container) continue;
    const candidate = container[trackId] ?? container[trackId.trim()];
    const url = readUrlValue(candidate);
    if (url) return url;
  }

  const data = asRecord(body.data) ?? asRecord(body.response) ?? body;
  const midUrlInfo = Array.isArray(data?.midurlinfo) ? data.midurlinfo : [];
  const item = midUrlInfo.find((entry: unknown) => {
    const record = asRecord(entry);
    return readString(record?.songmid ?? record?.songMid ?? record?.mid) === trackId;
  });
  return readUrlValue(item);
}

function readUrlValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  const url = record?.url ?? record?.purl ?? record?.playUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function readBusinessCode(value: Record<string, any>) {
  for (const key of ["code", "retcode", "subcode"]) {
    const number = Number(value[key]);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function throwIfAuthExpired(value: Record<string, any>) {
  const records = [value, asRecord(value.response), asRecord(value.data), asRecord(asRecord(value.data)?.response)].filter(
    (record): record is Record<string, any> => !!record
  );
  for (const record of records) {
    const codes = [record.code, record.retcode, record.subcode].map(Number);
    if (codes.some((code) => code === 1000 || code === 1001 || code === 401 || code === 403)) {
      throw new QqMusicApiError("auth-expired");
    }
    const message = [record.message, record.msg, record.errmsg, record.error].find((item) => typeof item === "string");
    if (message && /(未登录|未登陆|登录失效|登陆失效|登录过期|登陆过期|请登录|请登陆|login\s+required|auth(?:entication)?\s+(?:expired|invalid)|invalid\s+cookie)/i.test(message)) {
      throw new QqMusicApiError("auth-expired");
    }
  }
}

function readSearchResultList(data: Record<string, any>, kind: "song" | "album" | "playlist") {
  const candidateKeys = kind === "song"
    ? ["song", "songList", "songlist"]
    : kind === "album"
      ? ["album", "albumList", "albumlist"]
      : ["playlist", "playlistList", "playlistlist", "songlist", "songList", "diss", "dissList", "disslist", "cdlist"];
  const listKeys = ["list", "itemlist", "songList", "songlist", "albumList", "albumlist", "playlistList", "playlistlist", "dissList", "disslist", "cdlist"];
  const queue: unknown[] = [data];
  const visited = new Set<Record<string, any>>();
  let emptyList: unknown[] | null = null;

  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record || visited.has(record)) continue;
    visited.add(record);

    for (const key of candidateKeys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        if (candidate.length > 0) return candidate;
        emptyList ??= candidate;
        continue;
      }
      const section = asRecord(candidate);
      if (!section) continue;
      for (const listKey of listKeys) {
        const list = section[listKey];
        if (!Array.isArray(list)) continue;
        if (list.length > 0) return list;
        emptyList ??= list;
      }
      queue.push(section);
    }

    for (const key of ["data", "result", "response"]) {
      const nested = asRecord(record[key]);
      if (nested) queue.push(nested);
    }
  }

  return emptyList;
}

function readProviderBody(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QqMusicApiError("invalid-response");
  const body = value as Record<string, any>;
  throwIfAuthExpired(body);
  if (body.error) throw new QqMusicApiError("unavailable");
  const response = body.response;
  return response && typeof response === "object" && !Array.isArray(response) ? response : body;
}

function readSuccessfulProviderBody(value: unknown): Record<string, any> {
  const body = readProviderBody(value);
  const code = Number(body.code);
  if (Number.isFinite(code) && code !== 0 && code !== 200) {
    throw new QqMusicApiError("unavailable");
  }
  return body;
}

function assertProviderStatus(status: unknown) {
  const code = Number(status);
  if (code === 401 || code === 403) throw new QqMusicApiError("auth-expired");
  if (Number.isFinite(code) && code >= 400) throw new QqMusicApiError("unavailable");
}

function parseJson(value: string) {
  const text = value.trim();
  const jsonp = /^\w+\((.*)\)$/s.exec(text);
  return JSON.parse(jsonp?.[1] ?? text) as unknown;
}

function requestTimeoutMs() {
  const value = Number(process.env.QQMUSIC_REQUEST_TIMEOUT_MS ?? 15_000);
  return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000;
}

function isAllowedHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "qq.com" || host.endsWith(".qq.com") || host === "gtimg.cn" || host.endsWith(".gtimg.cn");
}
