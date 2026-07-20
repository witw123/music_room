import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProviderAlbumDetail,
  ProviderAlbumListResponse,
  ProviderAlbumSummary,
  ProviderLyrics,
  ProviderPlaylistDetail,
  ProviderPlaylistListResponse,
  ProviderPlaylistSummary,
  QqMusicSearchResponse,
  QqMusicTrackCandidate
} from "@music-room/shared";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";
import { RedisService } from "../../../infra/redis/redis.service";
import { fetchProviderUrl } from "../provider-fetch";
import { QqMusicAccountService } from "./qqmusic-account.service";
import { QqMusicApiClient, QqMusicApiError } from "./qqmusic-api.client";
import {
  qqMusicQualitySchema,
  type QqMusicCatalogPageQuery,
  type QqMusicQuality,
  type QqMusicSearchQuery
} from "./qqmusic.schemas";

type QrAttempt = { userId: string; qrsig: string; ptqrtoken: string };
const qrTtlSeconds = 180;
const qrKeyPrefix = "music-room:qqmusic:qr:";
@Injectable()
export class QqMusicService {
  private readonly rateLimits = new Map<string, number[]>();
  constructor(private readonly api: QqMusicApiClient, private readonly accounts: QqMusicAccountService, private readonly redis: RedisService) {}
  async getAccountStatus(userId: string) { this.assertEnabled(); return this.accounts.getStatus(userId); }
  async startQrLogin(userId: string) {
    this.assertEnabled(); this.assertRateLimit(`qr:${userId}`, 3);
    const qr = await this.callProvider(() => this.api.createQrCode()); const attemptId = randomUUID();
    await this.redis.setJson(`${qrKeyPrefix}${attemptId}`, { userId, qrsig: qr.qrsig, ptqrtoken: qr.ptqrtoken }, qrTtlSeconds);
    return { attemptId, qrimg: qr.qrimg, expiresAt: new Date(Date.now() + qrTtlSeconds * 1000).toISOString() };
  }
  async checkQrLogin(userId: string, attemptId: string) {
    this.assertEnabled(); const key = `${qrKeyPrefix}${attemptId}`; const attempt = await this.redis.getJson<QrAttempt>(key);
    if (!attempt) return { status: "expired" as const }; if (attempt.userId !== userId) throw new HttpException(createApiErrorResponse(errorCodes.unauthorized, "This QR login attempt belongs to another user."), HttpStatus.FORBIDDEN);
    const result = await this.callProvider(() => this.api.checkQrCode(attempt));
    if (result.status === "connected" && result.session) {
      await this.accounts.saveAccount({ userId, cookie: result.session.cookie, qqMusicUserId: result.session.userId, nickname: result.session.nickname, avatarUrl: result.session.avatarUrl });
      await this.redis.delete(key); return { status: "connected" as const, account: await this.accounts.getStatus(userId) };
    }
    if (result.status === "expired") await this.redis.delete(key);
    return { status: result.status, ...(result.message ? { message: result.message } : {}) };
  }
  async disconnectAccount(userId: string) { this.assertEnabled(); return this.accounts.disconnect(userId); }
  async searchTracks(userId: string, query: QqMusicSearchQuery): Promise<QqMusicSearchResponse> {
    this.assertEnabled(); this.assertRateLimit(`search:${userId}`, 30); const cookie = await this.getCookie(userId);
    const records = await this.callProvider(() => this.api.searchTracks({ ...query, cookie }));
    return { items: records.map((record) => this.toTrackCandidate(record)).filter((value): value is QqMusicTrackCandidate => !!value), limit: query.limit, offset: query.offset };
  }

  async searchPlaylists(userId: string, query: QqMusicSearchQuery): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search:${userId}`, 30);
    const cookie = await this.getCookie(userId);
    const records = await this.callProvider(() => this.api.searchPlaylists({ ...query, cookie }));
    return {
      items: records.map((record) => this.toPlaylistSummary(record)).filter((value): value is ProviderPlaylistSummary => !!value),
      limit: query.limit,
      offset: query.offset
    };
  }

  async searchAlbums(userId: string, query: QqMusicSearchQuery): Promise<ProviderAlbumListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search:${userId}`, 30);
    const cookie = await this.getCookie(userId);
    const records = await this.callProvider(() => this.api.searchTracks({ ...query, cookie, kind: "album" }));
    const albumItems = records
      .map((record) => this.toAlbumSummary(record))
      .filter((value): value is ProviderAlbumSummary => !!value);
    const fallbackRecords = albumItems.length > 0
      ? []
      : await this.callProvider(() => this.api.searchTracks({ ...query, cookie, kind: "song" }));
    const items = albumItems.length > 0
      ? dedupeAlbums(albumItems)
      : dedupeAlbums(fallbackRecords
        .map((record) => this.toAlbumSummary(record))
        .filter((value): value is ProviderAlbumSummary => !!value));
    return {
      items,
      limit: query.limit,
      offset: query.offset
    };
  }
  async getTrack(userId: string, trackId: string) {
    this.assertEnabled(); const cookie = await this.getCookie(userId); const records = await this.callProvider(() => this.api.searchTracks({ keywords: trackId, limit: 20, offset: 0, cookie }));
    const track = records
      .map((record) => this.toTrackCandidate(record))
      .find((value) => value?.providerTrackId === trackId);
    if (!track) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicTrackNotFound, "QQ Music track was not found."), HttpStatus.NOT_FOUND); return track;
  }

  async getLyrics(userId: string, trackId: string): Promise<ProviderLyrics> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(() => this.api.getLyrics({ trackId, cookie }));
    return {
      provider: "qqmusic",
      providerTrackId: trackId,
      plainLyric: readLyricText(body.lyric),
      translatedLyric: readLyricText(body.trans ?? body.transLyric ?? body.tlyric),
      romanizedLyric: readLyricText(body.roma ?? body.romaLyric ?? body.romalrc)
    };
  }

  async listPlaylists(userId: string, query: QqMusicCatalogPageQuery): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const account = await this.accounts.getStatus(userId);
    if (!account.qqMusicUserId) {
      throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAuthExpired, "The QQ Music account needs to be bound again."), HttpStatus.CONFLICT);
    }
    const body = await this.callProvider(() => this.api.getUserPlaylists({ userId: account.qqMusicUserId!, ...query, cookie }));
    const data = asRecord(body.data);
    const records = Array.isArray(data?.playlists)
      ? data.playlists
      : Array.isArray(data?.list)
        ? data.list
      : Array.isArray(body.playlists)
        ? body.playlists
        : Array.isArray(asRecord(data?.mydiss)?.list)
          ? asRecord(data?.mydiss)?.list
          : [];
    return {
      items: records
        .map((item: unknown) => this.toPlaylistSummary(item))
        .filter((item: ProviderPlaylistSummary | null): item is ProviderPlaylistSummary => !!item),
      limit: query.limit,
      offset: query.offset
    };
  }

  async getPlaylist(userId: string, playlistId: string): Promise<ProviderPlaylistDetail> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(() => this.api.getPlaylist({ playlistId, cookie }));
    const playlist = readFirstRecord(body, ["cdlist", "playlist", "playlists", "disslist", "dissList", "list"]);
    if (!playlist) throw this.unavailableError();
    const summary = this.toPlaylistSummary(playlist);
    if (!summary) throw this.unavailableError();
    const tracks = readTrackArray(playlist)
      .map((item) => this.toTrackCandidate(item))
      .filter((item): item is QqMusicTrackCandidate => !!item);
    return { ...summary, tracks };
  }

  async getAlbum(userId: string, albumId: string): Promise<ProviderAlbumDetail> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(() => this.api.getAlbum({ albumId, cookie }));
    const info = unwrapData(body.info);
    const tracks = readTrackArray(body.songs)
      .map((item) => this.toTrackCandidate(item))
      .filter((item): item is QqMusicTrackCandidate => !!item);
    return {
      provider: "qqmusic",
      providerAlbumId: readString(info?.albumMid ?? info?.albummid ?? info?.albumMID ?? info?.albumid ?? info?.albumID ?? info?.id) ?? albumId,
      title: readString(info?.albumName ?? info?.albumname ?? info?.name) ?? "未命名专辑",
      artist: readString(info?.singerName ?? info?.singername ?? info?.artist) ?? "未知歌手",
      description: readString(info?.desc ?? info?.description),
      artworkUrl: readHttpUrl(info?.albumPic ?? info?.album_pic ?? info?.albumPicUrl ?? info?.picUrl ?? info?.picurl) ?? buildQqAlbumArtwork(readString(info?.albumMid ?? info?.albummid ?? info?.albumMID) ?? albumId),
      releaseTime: readString(info?.pubTime ?? info?.publishTime ?? info?.time_public ?? info?.aDate),
      trackCount: readNumber(info?.songNum ?? info?.songnum ?? info?.cur_song_num ?? info?.total) ?? tracks.length,
      tracks
    };
  }
  async resolveAudio(userId: string, trackId: string, quality: QqMusicQuality) {
    this.assertEnabled(); this.assertRateLimit(`audio:${userId}`, 6);
    const source = await this.resolveAudioSource(userId, trackId, quality);
    const mimeType = resolveMime(null, source.url.toString());
    return {
      provider: "qqmusic" as const,
      providerTrackId: trackId,
      url: source.url.toString(),
      mimeType,
      fileType: mimeType === "audio/flac" ? "flac" as const : "mp3" as const
    };
  }

  async openAudio(userId: string, trackId: string, quality: string, range?: string) {
    this.assertEnabled(); this.assertRateLimit(`audio:${userId}`, 6);
    const selected = qqMusicQualitySchema.safeParse(quality).success ? quality as QqMusicQuality : this.defaultQuality();
    const source = await this.resolveAudioSource(userId, trackId, selected);
    const headers = new Headers(); if (range) headers.set("range", range); const upstream = await fetchProviderUrl(source.url, { headers }, this.requestTimeoutMs(), isAllowedHost, { allowSyntheticDns: true }).catch(() => null);
    if (!upstream?.ok || !upstream.body) throw this.unavailableError(); const mimeType = resolveMime(upstream.headers.get("content-type"), source.url.toString());
    if (!mimeType) { await upstream.body.cancel().catch(() => undefined); throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAudioUnsupported, "QQ Music returned an unsupported audio format."), HttpStatus.UNSUPPORTED_MEDIA_TYPE); }
    const contentLength = Number(upstream.headers.get("content-length") ?? "0"); if (contentLength > this.maxImportBytes()) { await upstream.body.cancel().catch(() => undefined); throw new HttpException(createApiErrorResponse(errorCodes.qqMusicImportTooLarge, "QQ Music audio is too large."), HttpStatus.PAYLOAD_TOO_LARGE); }
    return { upstream, mimeType, contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null, fileType: mimeType === "audio/flac" ? "flac" : "mp3", maxBytes: this.maxImportBytes() };
  }

  private async resolveAudioSource(userId: string, trackId: string, quality: QqMusicQuality) {
    const cookie = await this.getCookie(userId);
    const qualities = this.qualitiesForQuality(quality);
    let result = await this.callProvider(() => this.api.getAudioUrl({ trackId, quality: qualities[0], cookie }));
    for (const fallbackQuality of qualities.slice(1)) {
      if (result.url) break;
      result = await this.callProvider(() => this.api.getAudioUrl({ trackId, quality: fallbackQuality, cookie }));
    }
    if (!result.url) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicTrackNotFound, "QQ Music audio is unavailable."), HttpStatus.NOT_FOUND);
    let url: URL;
    try { url = normalizeQqMusicAudioUrl(result.url); } catch { throw this.unavailableError(); }
    if (!isAllowedHost(url.hostname)) throw this.unavailableError();
    return { url };
  }
  private toTrackCandidate(value: unknown): QqMusicTrackCandidate | null {
    const raw = asRecord(value);
    const r = asRecord(raw?.songInfo) ?? asRecord(raw?.songinfo) ?? asRecord(raw?.song) ?? raw;
    if (!r) return null;
    const id = readQqTrackId(r);
    const title = readString(r.songname ?? r.songName ?? r.name ?? r.title);
    if (!id || !title) return null;
    const singers = Array.isArray(r.singer)
      ? r.singer.map((s) => readString(asRecord(s)?.name)).filter(Boolean).join(" / ")
      : Array.isArray(r.singers)
        ? r.singers.map((s) => readString(asRecord(s)?.name)).filter(Boolean).join(" / ")
        : readString(r.singername ?? r.singerName ?? r.artist) ?? "未知歌手";
    const pay = asRecord(r.pay); const payPlay = Number(pay?.payplay ?? pay?.pay_play); const file = asRecord(r.file); const quality = Number(r.sizeflac ?? file?.size_flac) > 0 ? "lossless" : Number(r.size320 ?? file?.size_320mp3) > 0 ? "high" : Number(r.size128 ?? file?.size_128mp3) > 0 ? "standard" : null;
    const album = asRecord(r.album); const albumMid = readString(r.albummid ?? r.albumMid ?? r.albumMID ?? album?.mid ?? album?.albummid ?? album?.albumMid ?? album?.albumMID);
    const artworkUrl = readHttpUrl(r.albumPic ?? r.album_pic ?? r.picUrl) ?? (albumMid ? buildQqAlbumArtwork(albumMid) : null);
    return { provider: "qqmusic", providerTrackId: id, access: payPlay === 0 ? "free" : payPlay === 1 ? "paid" : "unknown", quality, title, artist: singers || "未知歌手", album: readString(r.albumname ?? r.albumName ?? album?.name), ...(albumMid ? { providerAlbumId: albumMid } : {}), durationMs: readDuration(r.interval ?? r.duration), artworkUrl };
  }
  private toPlaylistSummary(value: unknown): ProviderPlaylistSummary | null {
    const playlist = asRecord(value);
    const id = readString(playlist?.dissid ?? playlist?.disstid ?? playlist?.dissId ?? playlist?.dissID ?? playlist?.playlistId ?? playlist?.tid ?? playlist?.id);
    if (!playlist || !id) return null;
    return {
      provider: "qqmusic",
      providerPlaylistId: id,
      title: readString(playlist.dissname ?? playlist.name ?? playlist.title) ?? "未命名歌单",
      description: readString(playlist.desc ?? playlist.description ?? playlist.introduction),
      artworkUrl: readHttpUrl(playlist.logo ?? playlist.coverUrl ?? playlist.picUrl ?? playlist.imgurl ?? playlist.imgUrl),
      creatorName: readString(playlist.nickname ?? playlist.creatorName ?? asRecord(playlist.creator)?.name),
      trackCount: readNumber(playlist.songnum ?? playlist.songNum ?? playlist.song_count ?? playlist.total) ?? (Array.isArray(playlist.songlist) ? playlist.songlist.length : 0)
    };
  }

  private toAlbumSummary(value: unknown): ProviderAlbumSummary | null {
    const album = asRecord(value);
    const id = readString(album?.albummid ?? album?.albumMid ?? album?.albumMID ?? album?.album_mid ?? album?.albumid ?? album?.albumId ?? album?.albumID ?? album?.mid);
    const title = readString(album?.albumname ?? album?.albumName ?? album?.name ?? album?.title);
    if (!album || !id || !title) return null;
    const singer = Array.isArray(album.singer)
      ? album.singer.map((item) => readString(asRecord(item)?.name)).filter(Boolean).join(" / ")
      : readString(album.singername ?? album.singerName ?? album.artist);
    return {
      provider: "qqmusic",
      providerAlbumId: id,
      title,
      artist: singer || "未知歌手",
      description: readString(album.desc ?? album.description),
      artworkUrl: readHttpUrl(album.albumPic ?? album.album_pic ?? album.albumPicUrl ?? album.picUrl) ?? buildQqAlbumArtwork(id),
      releaseTime: readString(album.pubtime ?? album.pubTime ?? album.publicTime ?? album.publishTime),
      trackCount: readNumber(album.songnum ?? album.songNum ?? album.song_count ?? album.total) ?? 0
    };
  }
  private async getCookie(userId: string) { try { return await this.accounts.getCookieOrThrow(userId); } catch { throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAccountRequired, "QQ Music account is required."), HttpStatus.CONFLICT); } }
  private assertEnabled() { if (process.env.QQMUSIC_ENABLED !== "true") throw new HttpException(createApiErrorResponse(errorCodes.qqMusicDisabled, "QQ Music integration is disabled."), HttpStatus.SERVICE_UNAVAILABLE); }
  private assertRateLimit(key: string, limit: number) { const now = Date.now(); const values = (this.rateLimits.get(key) ?? []).filter((time) => now - time < 60_000); if (values.length >= limit) throw new HttpException(createApiErrorResponse(errorCodes.rateLimited, "QQ Music request rate limit exceeded."), HttpStatus.TOO_MANY_REQUESTS); values.push(now); this.rateLimits.set(key, values); }
  private async callProvider<T>(operation: () => Promise<T>) { try { return await operation(); } catch (error) { if (error instanceof HttpException) throw error; if (error instanceof QqMusicApiError && error.kind === "auth-expired") throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAuthExpired, "The QQ Music account needs to be bound again."), HttpStatus.CONFLICT); throw this.unavailableError(); } }
  private unavailableError() { return new HttpException(createApiErrorResponse(errorCodes.qqMusicUnavailable, "QQ Music is temporarily unavailable."), HttpStatus.BAD_GATEWAY); }
  private defaultQuality(): QqMusicQuality { return qqMusicQualitySchema.safeParse(process.env.QQMUSIC_DEFAULT_QUALITY).success ? process.env.QQMUSIC_DEFAULT_QUALITY as QqMusicQuality : "exhigh"; }
  private qualitiesForQuality(quality: QqMusicQuality): QqMusicQuality[] {
    if (quality === "standard") return ["standard", "high"];
    if (quality === "high") return ["high", "standard"];
    return ["exhigh", "high", "standard"];
  }
  private requestTimeoutMs() { const value = Number(process.env.QQMUSIC_REQUEST_TIMEOUT_MS ?? 15_000); return Number.isFinite(value) ? Math.max(1_000, Math.floor(value)) : 15_000; }
  private maxImportBytes() { const value = Number(process.env.QQMUSIC_MAX_IMPORT_BYTES ?? 209_715_200); return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 209_715_200; }
}
function asRecord(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function readString(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" && value.trim() ? value.trim() : null; }
function readQqTrackId(record: Record<string, any>) {
  const mid = readString(record.songmid ?? record.songMid ?? record.song_mid ?? record.mid);
  if (mid) return mid;
  const legacyId = readString(record.songId ?? record.songid ?? record.id);
  return legacyId && !/^\d+$/.test(legacyId) ? legacyId : null;
}
function readTrackArray(value: unknown): unknown[] {
  const queue = [value];
  const visited = new Set<Record<string, any>>();
  let emptyList: unknown[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      if (current.length > 0) return current;
      emptyList = current;
      continue;
    }
    const record = asRecord(current);
    if (!record || visited.has(record)) continue;
    visited.add(record);
    for (const key of ["songlist", "songList", "songs", "list", "albumSonglist", "data", "result"]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        if (nested.length > 0) return nested;
        emptyList = nested;
        continue;
      }
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return emptyList;
}
function readFirstRecord(value: unknown, keys: string[]): Record<string, any> | null {
  const queue = [value];
  const visited = new Set<Record<string, any>>();
  while (queue.length > 0) {
    const current = queue.shift();
    const record = asRecord(current);
    if (!record || visited.has(record)) continue;
    visited.add(record);
    for (const key of keys) {
      const candidate = record[key];
      if (Array.isArray(candidate)) {
        const item = candidate.map(asRecord).find((entry): entry is Record<string, any> => !!entry);
        if (item) return item;
      } else if (asRecord(candidate)) {
        const candidateRecord = asRecord(candidate);
        if (candidateRecord) {
          if (hasPlaylistIdentity(candidateRecord)) return candidateRecord;
          queue.push(candidateRecord);
        }
      }
    }
    for (const key of ["data", "result", "response"]) {
      const nested = asRecord(record[key]);
      if (nested) queue.push(nested);
    }
  }
  return null;
}
function hasPlaylistIdentity(value: Record<string, any>) {
  return ["dissid", "disstid", "dissId", "dissID", "playlistId", "tid", "id", "dissname", "name", "title"]
    .some((key) => readString(value[key]) !== null);
}
function readNumber(value: unknown) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function dedupeAlbums(albums: ProviderAlbumSummary[]) {
  return [...new Map(albums.map((album) => [album.providerAlbumId, album])).values()];
}
function readLyricText(value: unknown) { return typeof value === "string" && value.trim() ? value : null; }
function readHttpUrl(value: unknown) {
  const result = readString(value);
  return result && /^https?:\/\//.test(result) ? result.replace(/^http:/i, "https:") : null;
}
function unwrapData(value: unknown): Record<string, any> | null {
  const record = asRecord(value);
  if (!record) return null;
  const data = asRecord(record.data);
  return data ?? record;
}
function buildQqAlbumArtwork(albumMid: string) { return albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null; }
function readDuration(value: unknown) { const n = Number(value); return Number.isFinite(n) && n > 0 ? (n < 10_000 ? Math.round(n * 1_000) : Math.round(n)) : 0; }
function resolveMime(contentType: string | null, url: string) { const type = `${contentType ?? ""} ${url}`.toLowerCase(); return type.includes("flac") ? "audio/flac" : type.includes("mp3") || type.includes("mpeg") ? "audio/mpeg" : null; }
function normalizeQqMusicAudioUrl(value: string) {
  const url = new URL(value);
  if (url.protocol === "http:") {
    url.protocol = "https:";
    if (url.port === "80") url.port = "";
  }
  if (url.protocol !== "https:") throw new Error("QQ Music returned a non-HTTPS audio URL.");
  return url;
}
function isAllowedHost(host: string) { const h = host.toLowerCase(); return h === "qq.com" || h.endsWith(".qq.com") || h === "gtimg.cn" || h.endsWith(".gtimg.cn"); }
