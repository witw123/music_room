import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProviderAlbumDetail,
  ProviderAlbumListResponse,
  ProviderAlbumSummary,
  ProviderArtistSummary,
  ProviderLyrics,
  ProviderLibrarySnapshot,
  ProviderPlaylistDetail,
  ProviderPlaylistListResponse,
  ProviderPlaylistSummary,
  ProviderSearchSuggestion,
  ProviderSearchSuggestionListResponse,
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
  type QqMusicSearchQuery,
  type QqMusicSearchSuggestQuery
} from "./qqmusic.schemas";

const maxProviderPlaylistTracks = 2_000;

type QrAttempt = { userId: string; qrsig: string; ptqrtoken: string };
type SearchTermCache = { expiresAt: number; items: ProviderSearchSuggestion[] };
const qrTtlSeconds = 180;
const accountValidationTtlMs = 5 * 60_000;
const qrKeyPrefix = "music-room:qqmusic:qr:";
@Injectable()
export class QqMusicService {
  private readonly rateLimits = new Map<string, number[]>();
  private readonly searchSuggestionCache = new Map<string, SearchTermCache>();
  private readonly accountValidation = new Map<string, Promise<void>>();
  private searchHotCache: SearchTermCache | null = null;
  constructor(private readonly api: QqMusicApiClient, private readonly accounts: QqMusicAccountService, private readonly redis: RedisService) {}
  async getAccountStatus(userId: string) {
    this.assertEnabled();
    const status = await this.accounts.getStatus(userId);
    if (!status.connected || !status.qqMusicUserId || typeof this.api.validateCookie !== "function" || typeof this.accounts.getValidationState !== "function") {
      return status;
    }
    try {
      const state = await this.accounts.getValidationState(userId);
      if (!state.qqMusicUserId) return status;
      if (state.lastValidatedAt && Date.now() - state.lastValidatedAt.getTime() < accountValidationTtlMs) return status;
      await this.validateAccount(userId, state.cookie, state.qqMusicUserId, true);
      return this.accounts.getStatus(userId);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.CONFLICT) {
        return { connected: false, qqMusicUserId: null, nickname: null, avatarUrl: null, lastValidatedAt: null };
      }
      return status;
    }
  }
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
      if (typeof this.api.validateCookie === "function") {
        try {
          if (!result.session.userId) throw new QqMusicApiError("auth-expired");
          await this.api.validateCookie({ userId: result.session.userId, cookie: result.session.cookie });
        } catch {
          await this.redis.delete(key);
          return { status: "failed" as const, message: "二维码已扫码，但 QQ 音乐登录验证失败，请重新生成二维码。" };
        }
      }
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

  async searchSuggestions(userId: string, query: QqMusicSearchSuggestQuery): Promise<ProviderSearchSuggestionListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search-suggest:${userId}`, 60);
    const key = query.keywords.trim().toLocaleLowerCase();
    const cached = readTermCache(this.searchSuggestionCache.get(key));
    if (cached) return { items: cached };

    try {
      const body = await this.callProvider(() => this.api.searchSuggestions({ keywords: query.keywords }));
      const items = toSearchSuggestions(readSearchTerms(body, ["keyword", "name", "searchWord", "word", "title", "query", "k"]), "联想");
      this.searchSuggestionCache.set(key, { items, expiresAt: Date.now() + 45_000 });
      trimTermCache(this.searchSuggestionCache);
      return { items };
    } catch {
      return { items: readTermCache(this.searchSuggestionCache.get(key), true) ?? [] };
    }
  }

  async getSearchHot(userId: string): Promise<ProviderSearchSuggestionListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search-hot:${userId}`, 12);
    const cached = readTermCache(this.searchHotCache);
    if (cached) return { items: cached };

    try {
      const body = await this.callProvider(() => this.api.getSearchHot());
      const items = toSearchSuggestions(readSearchTerms(body, ["searchWord", "searchword", "keyword", "word", "name", "k", "title"]), "热词");
      this.searchHotCache = { items, expiresAt: Date.now() + 10 * 60_000 };
      return { items };
    } catch {
      return { items: readTermCache(this.searchHotCache, true) ?? [] };
    }
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
      wordSyncedLyric: readLyricText(body.qrc),
      translatedLyric: readLyricText(body.trans),
      romanizedLyric: readLyricText(body.roma)
    };
  }

  async getLibrarySnapshot(userId: string): Promise<ProviderLibrarySnapshot> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const account = await this.accounts.getStatus(userId);
    if (!account.qqMusicUserId) {
      throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAuthExpired, "The QQ Music account needs to be bound again."), HttpStatus.CONFLICT);
    }
    const providerUserId = account.qqMusicUserId;
    const results = await Promise.allSettled([
      this.callProvider(() => this.api.getLikedPlaylist({ userId: providerUserId, cookie })),
      this.callProvider(() => this.api.getCollectedPlaylists({ userId: providerUserId, limit: 500, offset: 0, cookie })),
      this.callProvider(() => this.api.getCollectedAlbums({ userId: providerUserId, limit: 500, offset: 0, cookie })),
      this.callProvider(() => this.api.getFollowedArtists({ userId: providerUserId, limit: 500, offset: 0, cookie }))
    ]);
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (results.every((result) => result.status === "rejected") && firstFailure) throw firstFailure.reason;
    const profile = results[0].status === "fulfilled" ? results[0].value : {};
    const playlistBody = results[1].status === "fulfilled" ? results[1].value : {};
    const albumBody = results[2].status === "fulfilled" ? results[2].value : {};
    const artistBody = results[3].status === "fulfilled" ? results[3].value : {};
    const likedEntry = findFirstArray(profile, ["mymusic", "myMusic", "list"])
      .map(asRecord)
      .find((item) => item && (item.type === 1 || readString(item.title)?.includes("喜欢")));
    const likedPlaylistId = readString(likedEntry?.id ?? likedEntry?.dissid ?? likedEntry?.tid);
    let likedTracks: QqMusicTrackCandidate[] = [];
    if (likedPlaylistId) {
      try {
        const liked = await this.callProvider(() => this.api.getPlaylist({ playlistId: likedPlaylistId, cookie }));
        const playlist = readFirstRecord(liked, ["cdlist", "playlist", "playlists", "disslist", "dissList", "list"]);
        likedTracks = playlist ? readTrackArray(playlist).map((item) => this.toTrackCandidate(item)).filter((item): item is QqMusicTrackCandidate => !!item) : [];
      } catch {
        likedTracks = [];
      }
    }
    const collectedPlaylists = findFirstArray(playlistBody, ["cdlist", "disslist", "dissList", "list", "playlists"])
      .map((item) => this.toPlaylistSummary(item))
      .filter((item): item is ProviderPlaylistSummary => !!item);
    const collectedAlbums = findFirstArray(albumBody, ["albumlist", "albumList", "list", "albums"])
      .map((item) => this.toAlbumSummary(item))
      .filter((item): item is ProviderAlbumSummary => !!item);
    const followedArtists = findFirstArray(artistBody, ["singerlist", "singerList", "list", "singers"])
      .map((item) => this.toArtistSummary(item))
      .filter((item): item is ProviderArtistSummary => !!item);
    return { provider: "qqmusic", likedTracks, collectedPlaylists, collectedAlbums, followedArtists };
  }

  async getRelatedPlaylists(userId: string, trackId: string): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(() => this.api.getRelatedPlaylists({ trackId, cookie }));
    const items = findFirstArray(body, ["vec_sim_diss", "disslist", "dissList", "list", "playlists"])
      .map((item) => this.toPlaylistSummary(item))
      .filter((item): item is ProviderPlaylistSummary => !!item);
    return { items, limit: Math.max(1, items.length), offset: 0 };
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
      .filter((item): item is QqMusicTrackCandidate => !!item)
      .slice(0, maxProviderPlaylistTracks);
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
      artworkUrl: readHttpUrl(
        info?.albumPic,
        info?.album_pic,
        info?.albumPicUrl,
        info?.picUrl,
        info?.picurl,
        info?.imgUrl,
        info?.imgurl,
        info?.coverUrl,
        info?.coverImgUrl
      ) ?? buildQqAlbumArtwork(readString(info?.albumMid ?? info?.albummid ?? info?.albumMID) ?? albumId),
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

  async openArtwork(rawUrl: string) {
    this.assertEnabled();
    let url: URL;
    try {
      url = normalizeQqMusicArtworkUrl(rawUrl);
    } catch {
      throw this.unavailableError();
    }
    if (!isAllowedHost(url.hostname)) throw this.unavailableError();

    const upstream = await fetchProviderUrl(
      url,
      { headers: new Headers({ accept: "image/*" }) },
      this.requestTimeoutMs(),
      isAllowedHost,
      { allowSyntheticDns: true }
    ).catch(() => null);
    if (!upstream?.ok || !upstream.body) throw this.unavailableError();

    const mimeType = resolveArtworkMime(upstream.headers.get("content-type"));
    if (!mimeType) {
      await upstream.body.cancel().catch(() => undefined);
      throw this.unavailableError();
    }
    const contentLength = Number(upstream.headers.get("content-length") ?? "0");
    if (contentLength > this.maxArtworkBytes()) {
      await upstream.body.cancel().catch(() => undefined);
      throw this.unavailableError();
    }
    return {
      upstream,
      mimeType,
      contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null,
      maxBytes: this.maxArtworkBytes()
    };
  }

  async openAudio(userId: string, trackId: string, quality: string, range?: string) {
    this.assertEnabled(); this.assertRateLimit(`audio:${userId}`, 6);
    const selected = qqMusicQualitySchema.safeParse(quality).success ? quality as QqMusicQuality : this.defaultQuality();
    const cookie = await this.getCookie(userId);
    await this.ensureAccountValidated(userId, cookie);
    const qualities = this.qualitiesForQuality(selected);

    let sawUnsupported = false;
    let sawOversized = false;
    let sawUrl = false;
    for (const candidateQuality of qualities) {
      const result = await this.callProvider(() => this.api.getAudioUrl({ trackId, quality: candidateQuality, cookie }));
      if (!result.url) continue;
      let source: URL;
      try {
        source = normalizeQqMusicAudioUrl(result.url);
      } catch {
        continue;
      }
      if (!isAllowedHost(source.hostname)) continue;
      sawUrl = true;
      const headers = new Headers({
        accept: "audio/*,*/*;q=0.8",
        referer: "https://y.qq.com/"
      });
      if (range) headers.set("range", range);
      const upstream = await fetchProviderUrl(source, { headers }, this.requestTimeoutMs(), isAllowedHost, { allowSyntheticDns: true }).catch(() => null);
      if (!upstream?.ok || !upstream.body) {
        await upstream?.body?.cancel().catch(() => undefined);
        continue;
      }
      const mimeType = resolveMime(upstream.headers.get("content-type"), source.toString());
      if (!mimeType) {
        sawUnsupported = true;
        await upstream.body.cancel().catch(() => undefined);
        continue;
      }
      const contentLength = Number(upstream.headers.get("content-length") ?? "0");
      if (contentLength > this.maxImportBytes()) {
        sawOversized = true;
        await upstream.body.cancel().catch(() => undefined);
        continue;
      }
      return { upstream, mimeType, contentLength: Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null, fileType: mimeType === "audio/flac" ? "flac" : "mp3", maxBytes: this.maxImportBytes() };
    }

    if (!sawUrl) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicTrackNotFound, "QQ Music audio is unavailable."), HttpStatus.NOT_FOUND);
    if (sawOversized) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicImportTooLarge, "QQ Music audio is too large."), HttpStatus.PAYLOAD_TOO_LARGE);
    if (sawUnsupported) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAudioUnsupported, "QQ Music returned an unsupported audio format."), HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    throw this.unavailableError();
  }

  private async resolveAudioSource(userId: string, trackId: string, quality: QqMusicQuality) {
    const cookie = await this.getCookie(userId);
    await this.ensureAccountValidated(userId, cookie);
    const qualities = this.qualitiesForQuality(quality);
    for (const candidateQuality of qualities) {
      const result = await this.callProvider(() => this.api.getAudioUrl({ trackId, quality: candidateQuality, cookie }));
      if (!result.url) continue;
      try {
        const url = normalizeQqMusicAudioUrl(result.url);
        if (isAllowedHost(url.hostname)) return { url };
      } catch {
        // Keep trying a lower quality when QQ returns a stale or malformed URL.
      }
    }
    throw new HttpException(createApiErrorResponse(errorCodes.qqMusicTrackNotFound, "QQ Music audio is unavailable."), HttpStatus.NOT_FOUND);
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
    const artworkUrl = readHttpUrl(
      r.albumPic,
      r.album_pic,
      r.albumPicUrl,
      r.picUrl,
      r.picurl,
      r.imgUrl,
      r.imgurl,
      album?.albumPic,
      album?.album_pic,
      album?.picUrl,
      album?.picurl,
      album?.imgUrl,
      album?.imgurl
    ) ?? (albumMid ? buildQqAlbumArtwork(albumMid) : null);
    const relatedTrackId = readString(r.songid ?? r.songId ?? r.id);
    return { provider: "qqmusic", providerTrackId: id, ...(relatedTrackId ? { relatedTrackId } : {}), access: payPlay === 0 ? "free" : payPlay === 1 ? "paid" : "unknown", quality, title, artist: singers || "未知歌手", album: readString(r.albumname ?? r.albumName ?? album?.name), tags: readProviderTags(r), ...(albumMid ? { providerAlbumId: albumMid } : {}), durationMs: readDuration(r.interval ?? r.duration), artworkUrl };
  }
  private toPlaylistSummary(value: unknown): ProviderPlaylistSummary | null {
    const playlist = asRecord(value);
    const id = readString(playlist?.dissid ?? playlist?.disstid ?? playlist?.dissId ?? playlist?.dissID ?? playlist?.playlistId ?? playlist?.topId ?? playlist?.tid ?? playlist?.id);
    if (!playlist || !id) return null;
    return {
      provider: "qqmusic",
      providerPlaylistId: id,
      title: readString(playlist.dissname ?? playlist.topTitle ?? playlist.name ?? playlist.title) ?? "未命名歌单",
      description: readString(playlist.desc ?? playlist.description ?? playlist.introduction ?? playlist.updateTime),
      tags: readProviderTags(playlist),
      artworkUrl: readHttpUrl(
        playlist.logo,
        playlist.dissCover,
        playlist.disscover,
        playlist.coverUrl,
        playlist.coverurl,
        playlist.coverImgUrl,
        playlist.coverimgurl,
        playlist.picUrl,
        playlist.picurl,
        playlist.imgUrl,
        playlist.imgurl,
        playlist.pic,
        playlist.cover
      ),
      creatorName: readString(playlist.nickname ?? playlist.creatorName ?? asRecord(playlist.creator)?.name),
      trackCount: readNumber(playlist.songnum ?? playlist.songNum ?? playlist.song_count ?? playlist.total) ?? (Array.isArray(playlist.songlist) ? playlist.songlist.length : 0)
    };
  }

  private toAlbumSummary(value: unknown): ProviderAlbumSummary | null {
    const album = asRecord(value);
    const id = readString(album?.albummid ?? album?.albumMid ?? album?.albumMID ?? album?.album_mid ?? album?.albumid ?? album?.albumId ?? album?.albumID ?? album?.mid);
    const title = readString(album?.albumname ?? album?.albumName ?? album?.album_name ?? album?.name ?? album?.title);
    if (!album || !id || !title) return null;
    const singer = Array.isArray(album.singer)
      ? album.singer.map((item) => readString(asRecord(item)?.name)).filter(Boolean).join(" / ")
      : readString(album.singername ?? album.singerName ?? album.singer_name ?? album.artist);
    return {
      provider: "qqmusic",
      providerAlbumId: id,
      title,
      artist: singer || "未知歌手",
      description: readString(album.desc ?? album.description ?? album.intro),
      artworkUrl: readHttpUrl(
        album.albumPic,
        album.album_pic,
        album.albumPicUrl,
        album.picUrl,
        album.picurl,
        album.imgUrl,
        album.imgurl,
        album.coverUrl,
        album.coverImgUrl
      ) ?? buildQqAlbumArtwork(id),
      releaseTime: readString(album.pubtime ?? album.pubTime ?? album.publicTime ?? album.publishTime),
      trackCount: readNumber(album.songnum ?? album.songNum ?? album.song_count ?? album.total) ?? 0
    };
  }
  private toArtistSummary(value: unknown): ProviderArtistSummary | null {
    const artist = asRecord(value);
    const id = readString(artist?.singermid ?? artist?.singerMid ?? artist?.mid ?? artist?.id);
    const name = readString(artist?.singername ?? artist?.singerName ?? artist?.name);
    if (!artist || !id || !name) return null;
    return {
      provider: "qqmusic",
      providerArtistId: id,
      name,
      artworkUrl: readHttpUrl(artist.pic, artist.picUrl, artist.singerPic, artist.avatar),
      description: readString(artist.desc ?? artist.description)
    };
  }
  private async getCookie(userId: string) { try { return await this.accounts.getCookieOrThrow(userId); } catch { throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAccountRequired, "QQ Music account is required."), HttpStatus.CONFLICT); } }
  private async ensureAccountValidated(userId: string, cookie: string) {
    if (typeof this.api.validateCookie !== "function" || typeof this.accounts.getValidationState !== "function") return;
    const state = await this.accounts.getValidationState(userId).catch(() => null);
    if (!state?.qqMusicUserId) throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAuthExpired, "The QQ Music account needs to be bound again."), HttpStatus.CONFLICT);
    if (state.lastValidatedAt && Date.now() - state.lastValidatedAt.getTime() < accountValidationTtlMs) return;
    await this.validateAccount(userId, cookie, state.qqMusicUserId, false);
  }
  private async validateAccount(userId: string, cookie: string, qqMusicUserId: string, returnHttpError: boolean) {
    const pending = this.accountValidation.get(userId);
    if (pending) return pending;
    const validation = (async () => {
      try {
        await this.api.validateCookie({ userId: qqMusicUserId, cookie });
        if (typeof this.accounts.markValidated === "function") await this.accounts.markValidated(userId);
      } catch (error) {
        if (error instanceof QqMusicApiError && error.kind === "auth-expired") {
          await this.accounts.invalidate(userId).catch(() => undefined);
          throw new HttpException(createApiErrorResponse(errorCodes.qqMusicAuthExpired, "The QQ Music account needs to be bound again."), HttpStatus.CONFLICT);
        }
        if (returnHttpError) throw this.unavailableError();
      } finally {
        this.accountValidation.delete(userId);
      }
    })();
    this.accountValidation.set(userId, validation);
    return validation;
  }
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
  private maxArtworkBytes() { const value = Number(process.env.QQMUSIC_MAX_ARTWORK_BYTES ?? 10_485_760); return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 10_485_760; }
}
function asRecord(value: unknown): Record<string, any> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null; }
function readString(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" && value.trim() ? value.trim() : null; }

function readProviderTags(playlist: Record<string, any>) {
  const values = [
    playlist.tags,
    playlist.tag,
    playlist.category,
    playlist.categoryName,
    playlist.categories,
    playlist.genre,
    playlist.genres,
    playlist.style,
    playlist.styles,
    playlist.dissCate,
    playlist.disscate
  ];
  const tags = values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const record = asRecord(item);
        return readString(record?.name ?? record?.tagName ?? record?.label ?? record?.catname ?? item);
      });
    }
    const record = asRecord(value);
    return [readString(record?.name ?? record?.tagName ?? record?.label ?? record?.catname ?? value)];
  }).filter((value): value is string => !!value);
  return [...new Set(tags)].slice(0, 20);
}
function readQqTrackId(record: Record<string, any>) {
  const mid = readString(record.songmid ?? record.songMid ?? record.song_mid ?? record.mid);
  if (mid) return mid;
  const legacyId = readString(record.songId ?? record.songid ?? record.id);
  return legacyId && !/^\d+$/.test(legacyId) ? legacyId : null;
}
function findFirstArray(value: unknown, keys: string[]) {
  const queue = [value];
  const visited = new Set<Record<string, any>>();
  while (queue.length > 0) {
    const record = asRecord(queue.shift());
    if (!record || visited.has(record)) continue;
    visited.add(record);
    for (const key of keys) {
      if (Array.isArray(record[key])) return record[key];
      const nested = asRecord(record[key]);
      if (nested) queue.push(nested);
    }
    for (const key of ["data", "result", "response"]) {
      const nested = asRecord(record[key]);
      if (nested) queue.push(nested);
    }
  }
  return [] as unknown[];
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
function readHttpUrl(...values: unknown[]) {
  for (const value of values) {
    const result = readString(value);
    if (!result) continue;
    const normalized = result.startsWith("//") ? `https:${result}` : result.replace(/^http:/i, "https:");
    if (/^https:\/\//.test(normalized)) return normalized;
  }
  return null;
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
function resolveArtworkMime(contentType: string | null) {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType?.startsWith("image/") ? mimeType : null;
}
function normalizeQqMusicArtworkUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("QQ Music artwork must use HTTPS.");
  if (url.port || url.username || url.password || !isAllowedHost(url.hostname)) {
    throw new Error("QQ Music returned an unsupported artwork URL.");
  }
  return url;
}
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

function readTermCache(cache: SearchTermCache | null | undefined, allowExpired = false) {
  if (!cache) return null;
  if (!allowExpired && cache.expiresAt <= Date.now()) return null;
  return cache.items;
}

function trimTermCache(cache: Map<string, SearchTermCache>) {
  while (cache.size > 128) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") return;
    cache.delete(oldest);
  }
}

function toSearchSuggestions(labels: string[], hint: string): ProviderSearchSuggestion[] {
  return labels.slice(0, 10).map((label) => ({ provider: "qqmusic" as const, label, hint }));
}

function readSearchTerms(value: unknown, preferredKeys: string[]) {
  const terms: string[] = [];
  const seenTerms = new Set<string>();
  const ignoredTerms = new Set(["专辑", "歌手", "单曲", "歌曲", "歌单", "用户", "mv", "热搜"]);
  const visited = new Set<object>();
  const visit = (current: unknown, depth: number) => {
    if (depth > 6 || terms.length >= 20) return;
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!current || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);
    const record = current as Record<string, unknown>;
    for (const key of preferredKeys) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        const label = candidate.trim();
        const normalized = label.toLocaleLowerCase();
        if (ignoredTerms.has(normalized)) continue;
        if (!seenTerms.has(normalized)) {
          seenTerms.add(normalized);
          terms.push(label);
        }
      } else if (candidate && typeof candidate === "object") {
        visit(candidate, depth + 1);
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key === "code" || preferredKeys.includes(key)) continue;
      if (nested && typeof nested === "object") visit(nested, depth + 1);
    }
  };
  visit(value, 0);
  return terms;
}
