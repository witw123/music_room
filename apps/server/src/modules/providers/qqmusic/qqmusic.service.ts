import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProviderAlbumDetail,
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
  async getTrack(userId: string, trackId: string) {
    this.assertEnabled(); const cookie = await this.getCookie(userId); const records = await this.callProvider(() => this.api.searchTracks({ keywords: trackId, limit: 20, offset: 0, cookie }));
    const track = records.map((record) => this.toTrackCandidate(record)).find((value) => value?.providerTrackId === trackId) ?? records.map((record) => this.toTrackCandidate(record)).find(Boolean);
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
    const data = asRecord(body.data);
    const playlist = (Array.isArray(body.cdlist) ? asRecord(body.cdlist[0]) : null)
      ?? (Array.isArray(data?.cdlist) ? asRecord(data.cdlist[0]) : null)
      ?? asRecord(body.playlist)
      ?? asRecord(data?.playlist);
    if (!playlist) throw this.unavailableError();
    const summary = this.toPlaylistSummary(playlist);
    if (!summary) throw this.unavailableError();
    const tracks = (Array.isArray(playlist.songlist) ? playlist.songlist : Array.isArray(playlist.songs) ? playlist.songs : [])
      .map((item) => this.toTrackCandidate(item))
      .filter((item): item is QqMusicTrackCandidate => !!item);
    return { ...summary, tracks };
  }

  async getAlbum(userId: string, albumId: string): Promise<ProviderAlbumDetail> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(() => this.api.getAlbum({ albumId, cookie }));
    const info = unwrapData(body.info);
    const songsEnvelope = asRecord(body.songs);
    const songsData = unwrapData(songsEnvelope?.albumSonglist ?? songsEnvelope);
    const tracks = (Array.isArray(songsData?.songList) ? songsData.songList : Array.isArray(songsData?.songlist) ? songsData.songlist : Array.isArray(songsData?.list) ? songsData.list : [])
      .map((item) => this.toTrackCandidate(item))
      .filter((item): item is QqMusicTrackCandidate => !!item);
    return {
      provider: "qqmusic",
      providerAlbumId: readString(info?.albumMid ?? info?.albummid ?? info?.albumid) ?? albumId,
      title: readString(info?.albumName ?? info?.albumname ?? info?.name) ?? "未命名专辑",
      artist: readString(info?.singerName ?? info?.singername ?? info?.artist) ?? "未知歌手",
      description: readString(info?.desc ?? info?.description),
      artworkUrl: readHttpUrl(info?.albumPic ?? info?.album_pic ?? info?.picUrl) ?? buildQqAlbumArtwork(readString(info?.albumMid ?? info?.albummid) ?? albumId),
      releaseTime: readString(info?.pubTime ?? info?.publishTime),
      trackCount: readNumber(info?.songNum ?? info?.songnum) ?? tracks.length,
      tracks
    };
  }
  async openAudio(userId: string, trackId: string, quality: string, range?: string) {
    this.assertEnabled(); this.assertRateLimit(`audio:${userId}`, 6); const cookie = await this.getCookie(userId); const selected = qqMusicQualitySchema.safeParse(quality).success ? quality as QqMusicQuality : this.defaultQuality();
    const qualities = this.qualitiesForQuality(selected);
    let result = await this.callProvider(() => this.api.getAudioUrl({ trackId, quality: qualities[0], cookie }));
    for (const fallbackQuality of qualities.slice(1)) {
      if (result.url) break;
      result = await this.callProvider(() => this.api.getAudioUrl({ trackId, quality: fallbackQuality, cookie }));
    }
    if (!result.url) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicTrackNotFound, "QQ Music audio is unavailable."), HttpStatus.NOT_FOUND);
    let url: URL;
    try { url = normalizeQqMusicAudioUrl(result.url); } catch { throw this.unavailableError(); }
    if (!isAllowedHost(url.hostname)) throw this.unavailableError();
    const headers = new Headers(); if (range) headers.set("range", range); const upstream = await fetchProviderUrl(url, { headers }, this.requestTimeoutMs(), isAllowedHost, { allowSyntheticDns: true }).catch(() => null);
    if (!upstream?.ok || !upstream.body) throw this.unavailableError(); const mimeType = resolveMime(upstream.headers.get("content-type"), url.toString());
    if (!mimeType) { await upstream.body.cancel().catch(() => undefined); throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAudioUnsupported, "QQ Music returned an unsupported audio format."), HttpStatus.UNSUPPORTED_MEDIA_TYPE); }
    const contentLength = Number(upstream.headers.get("content-length") ?? "0"); if (contentLength > this.maxImportBytes()) { await upstream.body.cancel().catch(() => undefined); throw new HttpException(createApiErrorResponse(errorCodes.qqMusicImportTooLarge, "QQ Music audio is too large."), HttpStatus.PAYLOAD_TOO_LARGE); }
    return { upstream, mimeType, contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null, fileType: mimeType === "audio/flac" ? "flac" : "mp3", maxBytes: this.maxImportBytes() };
  }
  private toTrackCandidate(value: unknown): QqMusicTrackCandidate | null {
    const raw = asRecord(value); const r = asRecord(raw?.songInfo) ?? raw; if (!r) return null; const id = readString(r.songmid ?? r.mid ?? r.songId ?? r.id); const title = readString(r.songname ?? r.name ?? r.title); if (!id || !title) return null;
    const singers = Array.isArray(r.singer) ? r.singer.map((s) => readString(asRecord(s)?.name)).filter(Boolean).join(" / ") : readString(r.singername ?? r.artist) ?? "未知歌手";
    const pay = asRecord(r.pay); const payPlay = Number(pay?.payplay ?? pay?.pay_play); const file = asRecord(r.file); const quality = Number(r.sizeflac ?? file?.size_flac) > 0 ? "lossless" : Number(r.size320 ?? file?.size_320mp3) > 0 ? "high" : Number(r.size128 ?? file?.size_128mp3) > 0 ? "standard" : null;
    const album = asRecord(r.album); const albumMid = readString(r.albummid ?? album?.mid); return { provider: "qqmusic", providerTrackId: id, access: payPlay === 0 ? "free" : payPlay === 1 ? "paid" : "unknown", quality, title, artist: singers || "未知歌手", album: readString(r.albumname ?? album?.name), ...(albumMid ? { providerAlbumId: albumMid } : {}), durationMs: readDuration(r.interval ?? r.duration), artworkUrl: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : null };
  }
  private toPlaylistSummary(value: unknown): ProviderPlaylistSummary | null {
    const playlist = asRecord(value);
    const id = readString(playlist?.dissid ?? playlist?.disstid ?? playlist?.tid ?? playlist?.id);
    if (!playlist || !id) return null;
    return {
      provider: "qqmusic",
      providerPlaylistId: id,
      title: readString(playlist.dissname ?? playlist.name ?? playlist.title) ?? "未命名歌单",
      description: readString(playlist.desc ?? playlist.description),
      artworkUrl: readHttpUrl(playlist.logo ?? playlist.coverUrl ?? playlist.picUrl),
      creatorName: readString(playlist.nickname ?? playlist.creatorName ?? asRecord(playlist.creator)?.name),
      trackCount: readNumber(playlist.songnum ?? playlist.songNum ?? playlist.total) ?? (Array.isArray(playlist.songlist) ? playlist.songlist.length : 0)
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
function readNumber(value: unknown) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function readLyricText(value: unknown) { return typeof value === "string" && value.trim() ? value : null; }
function readHttpUrl(value: unknown) { const result = readString(value); return result && /^https?:\/\//.test(result) ? result : null; }
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
