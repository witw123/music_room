import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  ProviderAlbumDetail,
  ProviderAlbumListResponse,
  ProviderAlbumSummary,
  ProviderLyrics,
  ProviderPlaylistCategory,
  ProviderPlaylistCategoryListResponse,
  ProviderPlaylistDetail,
  ProviderPlaylistListResponse,
  ProviderPlaylistSummary,
  ProviderTrackListResponse,
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
  type NeteaseCatalogPageQuery,
  type NeteaseDiscoverAlbumQuery,
  type NeteaseDiscoverPlaylistQuery,
  type NeteaseRecommendedPlaylistQuery,
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
type DiscoverCacheEntry = {
  value: unknown;
  freshUntil: number;
  staleUntil: number;
};

const qrTtlSeconds = 180;
const qrKeyPrefix = "music-room:netease:qr:";

@Injectable()
export class NeteaseService {
  private readonly userRateLimits = new Map<string, RateBucket>();
  private readonly discoverCache = new Map<string, DiscoverCacheEntry>();

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

  async searchPlaylists(userId: string, query: NeteaseSearchQuery): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search:${userId}`, 30, 60_000);
    const cookie = await this.getCookie(userId);
    const response = await this.callProvider(userId, () => this.api.searchPlaylists({ ...query, cookie }));
    return {
      items: (response.result?.playlists ?? [])
        .map((item) => this.toPlaylistSummary(item))
        .filter((item): item is ProviderPlaylistSummary => !!item),
      limit: query.limit,
      offset: query.offset
    };
  }

  async searchAlbums(userId: string, query: NeteaseSearchQuery): Promise<ProviderAlbumListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`search:${userId}`, 30, 60_000);
    const cookie = await this.getCookie(userId);
    const response = await this.callProvider(userId, () => this.api.searchAlbums({ ...query, cookie }));
    return {
      items: (response.result?.albums ?? [])
        .map((item) => this.toAlbumSummary(item))
        .filter((item): item is ProviderAlbumSummary => !!item),
      limit: query.limit,
      offset: query.offset
    };
  }

  async getRecommendedPlaylists(
    userId: string,
    query: NeteaseRecommendedPlaylistQuery
  ): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`discover:${userId}`, 60, 60_000);
    return this.getCachedDiscovery(`recommended:${query.limit}`, 300, async () => {
      const body = await this.callProvider(userId, () =>
        this.api.getRecommendedPlaylists({ limit: query.limit })
      );
      const records = Array.isArray(body.result) ? body.result : [];
      return {
        items: records
          .map((item) => this.toPlaylistSummary(item))
          .filter((item): item is ProviderPlaylistSummary => !!item),
        limit: query.limit,
        offset: 0
      };
    });
  }

  async getCategoryPlaylists(
    userId: string,
    query: NeteaseDiscoverPlaylistQuery
  ): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`discover:${userId}`, 60, 60_000);
    return this.getCachedDiscovery(
      `category:${query.category}:${query.order}:${query.limit}:${query.offset}`,
      300,
      async () => {
        const body = await this.callProvider(userId, () => this.api.getCategoryPlaylists(query));
        const records = Array.isArray(body.playlists) ? body.playlists : [];
        return {
          items: records
            .map((item) => this.toPlaylistSummary(item))
            .filter((item): item is ProviderPlaylistSummary => !!item),
          limit: query.limit,
          offset: query.offset
        };
      }
    );
  }

  async getPlaylistCategories(userId: string): Promise<ProviderPlaylistCategoryListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`discover:${userId}`, 60, 60_000);
    return this.getCachedDiscovery("playlist-categories", 3_600, async () => {
      const body = await this.callProvider(userId, () => this.api.getPlaylistCategories({}));
      const groups = asRecord(body.categories);
      const records = [body.all, ...(Array.isArray(body.sub) ? body.sub : [])];
      const items = records
        .map((item, index) => this.toPlaylistCategory(item, groups, index === 0))
        .filter((item): item is ProviderPlaylistCategory => !!item);
      return {
        items: [...new Map(items.map((item) => [item.id, item])).values()]
      };
    });
  }

  async getToplists(userId: string): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`discover:${userId}`, 60, 60_000);
    return this.getCachedDiscovery("toplists", 600, async () => {
      const body = await this.callProvider(userId, () => this.api.getToplists({}));
      const records = Array.isArray(body.list) ? body.list : [];
      const items = records
        .map((item) => this.toPlaylistSummary(item))
        .filter((item): item is ProviderPlaylistSummary => !!item);
      return { items, limit: Math.max(1, items.length), offset: 0 };
    });
  }

  async getNewAlbums(
    userId: string,
    query: NeteaseDiscoverAlbumQuery
  ): Promise<ProviderAlbumListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`discover:${userId}`, 60, 60_000);
    return this.getCachedDiscovery(
      `new-albums:${query.area}:${query.limit}:${query.offset}`,
      900,
      async () => {
        const body = await this.callProvider(userId, () => this.api.getNewAlbums(query));
        return {
          items: (Array.isArray(body.albums) ? body.albums : [])
            .map((item) => this.toAlbumSummary(item))
            .filter((item): item is ProviderAlbumSummary => !!item),
          limit: query.limit,
          offset: query.offset
        };
      }
    );
  }

  async getDailyPlaylists(userId: string): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`daily:${userId}`, 20, 60_000);
    const cookie = await this.getCookie(userId);
    return this.getCachedDiscovery(`daily-playlists:${userId}:${dateKey()}`, 300, async () => {
      const body = await this.callProvider(userId, () => this.api.getDailyPlaylists({ cookie }));
      const items = (Array.isArray(body.recommend) ? body.recommend : [])
        .map((item) => this.toPlaylistSummary(item))
        .filter((item): item is ProviderPlaylistSummary => !!item);
      return { items, limit: Math.max(1, items.length), offset: 0 };
    });
  }

  async getDailyTracks(userId: string): Promise<ProviderTrackListResponse> {
    this.assertEnabled();
    this.assertRateLimit(`daily:${userId}`, 20, 60_000);
    const cookie = await this.getCookie(userId);
    return this.getCachedDiscovery(`daily-tracks:${userId}:${dateKey()}`, 300, async () => {
      const body = await this.callProvider(userId, () => this.api.getDailyTracks({ cookie }));
      const data = asRecord(body.data);
      const items = (Array.isArray(data?.dailySongs) ? data.dailySongs : Array.isArray(body.dailySongs) ? body.dailySongs : [])
        .map((item) => this.toTrackCandidate(item))
        .filter((item): item is NeteaseTrackCandidate => !!item);
      return { items, limit: Math.max(1, items.length), offset: 0 };
    });
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

  async getLyrics(userId: string, trackId: string): Promise<ProviderLyrics> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(userId, () => this.api.getLyrics({ trackId, cookie }));
    return {
      provider: "netease",
      providerTrackId: trackId,
      plainLyric: readLyricText(asRecord(body?.lrc)?.lyric),
      translatedLyric: readLyricText(asRecord(body?.tlyric)?.lyric),
      romanizedLyric: readLyricText(asRecord(body?.romalrc)?.lyric)
    };
  }

  async listPlaylists(userId: string, query: NeteaseCatalogPageQuery): Promise<ProviderPlaylistListResponse> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const account = await this.accounts.getStatus(userId);
    if (!account.neteaseUserId) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseAuthExpired, "The NetEase account needs to be bound again."),
        HttpStatus.CONFLICT
      );
    }
    const body = await this.callProvider(userId, () => this.api.getUserPlaylists({ userId: account.neteaseUserId!, ...query, cookie }));
    const records = Array.isArray(body.playlist) ? body.playlist : Array.isArray(body.playlists) ? body.playlists : [];
    return {
      items: records.map((item) => this.toPlaylistSummary(item)).filter((item): item is ProviderPlaylistSummary => !!item),
      limit: query.limit,
      offset: query.offset
    };
  }

  async getPlaylist(userId: string, playlistId: string): Promise<ProviderPlaylistDetail> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(userId, () => this.api.getPlaylist({ playlistId, cookie }));
    const playlist = asRecord(body.playlist);
    if (!playlist) throw this.unavailableError();
    const summary = this.toPlaylistSummary(playlist);
    if (!summary) throw this.unavailableError();
    const rawTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
    const tracks = rawTracks.map((item) => this.toTrackCandidate(item)).filter((item): item is NeteaseTrackCandidate => !!item);
    const trackIds = Array.isArray(playlist.trackIds)
      ? playlist.trackIds.map((item) => readString(asRecord(item)?.id ?? item)).filter((item): item is string => !!item && /^\d+$/.test(item))
      : [];
    if (trackIds.length > rawTracks.length) {
      for (let offset = rawTracks.length; offset < trackIds.length; offset += 1_000) {
        const page = await this.callProvider(userId, () => this.api.getPlaylistTracks({ playlistId, limit: 1_000, offset, cookie }));
        const pageTracks = Array.isArray(page.songs) ? page.songs : [];
        tracks.push(...pageTracks.map((item) => this.toTrackCandidate(item)).filter((item): item is NeteaseTrackCandidate => !!item));
      }
    }
    return { ...summary, tracks };
  }

  async getAlbum(userId: string, albumId: string): Promise<ProviderAlbumDetail> {
    this.assertEnabled();
    const cookie = await this.getCookie(userId);
    const body = await this.callProvider(userId, () => this.api.getAlbum({ albumId, cookie }));
    const album = asRecord(body.album) ?? asRecord(body);
    if (!album) throw this.unavailableError();
    const tracks = readNeteaseTrackArray(body, album)
      .map((item) => this.toTrackCandidate(item))
      .filter((item): item is NeteaseTrackCandidate => !!item);
    const summary = this.toAlbumSummary({ ...album, id: album.id ?? albumId });
    if (!summary) throw this.unavailableError();
    return {
      ...summary,
      tracks
    };
  }

  async resolveAudio(userId: string, trackId: string, quality: NeteaseQuality) {
    this.assertEnabled();
    this.assertRateLimit(`audio:${userId}`, 6, 60_000);
    const source = await this.resolveAudioSource(userId, trackId, quality);
    const mimeType = resolveAudioMimeType(source.type, source.url.pathname);
    return {
      provider: "netease" as const,
      providerTrackId: trackId,
      url: source.url.toString(),
      mimeType,
      fileType: mimeType === "audio/flac" ? "flac" as const : "mp3" as const
    };
  }

  async openAudio(userId: string, trackId: string, quality: string, range?: string) {
    this.assertEnabled();
    this.assertRateLimit(`audio:${userId}`, 6, 60_000);
    const parsedQuality = neteaseQualitySchema.safeParse(quality);
    const source = await this.resolveAudioSource(
      userId,
      trackId,
      parsedQuality.success ? parsedQuality.data : this.defaultQuality()
    );
    const headers = new Headers();
    if (range) {
      headers.set("range", range);
    }
    const upstream = await fetchProviderUrl(
      source.url,
      { headers },
      this.requestTimeoutMs(),
      isAllowedAudioHost,
      { allowSyntheticDns: true }
    ).catch(() => {
      throw this.unavailableError();
    });

    if (!upstream.ok || !upstream.body) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseUnavailable, "NetEase audio could not be fetched."),
        HttpStatus.BAD_GATEWAY
      );
    }

    const mimeType = resolveAudioMimeType(source.type, upstream.headers.get("content-type"));
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

  private async resolveAudioSource(
    userId: string,
    trackId: string,
    quality: NeteaseQuality
  ) {
    const cookie = await this.getCookie(userId);
    const bitrates = this.bitratesForQuality(quality);
    let response = await this.callProvider(userId, () =>
      this.api.getAudioUrl({ trackId, bitrate: bitrates[0], cookie })
    );
    let audio = readAudioRecord(response);
    if (!audio?.url && bitrates.length > 1) {
      response = await this.callProvider(userId, () =>
        this.api.getAudioUrl({ trackId, bitrate: bitrates[1], cookie })
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
      url = normalizeNeteaseAudioUrl(audio.url);
    } catch {
      throw this.unavailableError();
    }
    if (!isAllowedAudioHost(url.hostname)) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.neteaseUnavailable, "NetEase returned an unsupported audio URL."),
        HttpStatus.BAD_GATEWAY
      );
    }
    return { url, type: audio.type };
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
    const albumRecord = asRecord(song?.album);
    const legacyAlbumRecord = asRecord(song?.al);
    const albumName = readString(albumRecord?.name) ?? readString(legacyAlbumRecord?.name);
    const providerAlbumId =
      readString(albumRecord?.id ?? albumRecord?.albumId) ??
      readString(legacyAlbumRecord?.id ?? legacyAlbumRecord?.albumId);
    const artworkUrl = readNeteaseArtworkUrl(
      albumRecord?.picUrl,
      legacyAlbumRecord?.picUrl
    );
    return {
      provider: "netease",
      providerTrackId: trackId,
      access: resolveTrackAccess(song),
      quality: resolveTrackQuality(song),
      title,
      artist: artistNames.join(" / ") || "未知歌手",
      album: albumName,
      ...(providerAlbumId ? { providerAlbumId } : {}),
      durationMs: readNumber(song?.duration) ?? readNumber(song?.dt) ?? 0,
      artworkUrl
    };
  }

  private toPlaylistSummary(value: unknown): ProviderPlaylistSummary | null {
    const playlist = asRecord(value);
    const id = readString(playlist?.id);
    if (!playlist || !id) return null;
    return {
      provider: "netease",
      providerPlaylistId: id,
      title: readString(playlist.name) ?? "未命名歌单",
      description: readString(playlist.description) ?? readString(playlist.desc),
      artworkUrl: readNeteaseArtworkUrl(playlist.coverImgUrl, playlist.coverImgUrlStr),
      creatorName: readString(asRecord(playlist.creator)?.nickname),
      trackCount: readNumber(playlist.trackCount) ?? readNumber(playlist.trackNumber) ?? (Array.isArray(playlist.tracks) ? playlist.tracks.length : 0),
    };
  }

  private toPlaylistCategory(
    value: unknown,
    groups: Record<string, unknown> | null,
    isAllCategory: boolean
  ): ProviderPlaylistCategory | null {
    const category = asRecord(value);
    const rawName = readString(category?.name);
    if (!category || !rawName) return null;
    const name = isAllCategory || rawName === "全部歌单" ? "全部" : rawName;
    const groupId = readString(category.category);
    return {
      provider: "netease",
      id: name,
      name,
      groupName: groupId ? readString(groups?.[groupId]) : null,
      sortOptions: [
        { id: "hot", label: "最热" },
        { id: "new", label: "最新" }
      ]
    };
  }

  private toAlbumSummary(value: unknown): ProviderAlbumSummary | null {
    const album = asRecord(value);
    const id = readString(album?.id ?? album?.albumId);
    const title = readString(album?.name ?? album?.albumName);
    if (!album || !id || !title) return null;
    const artistRecord = asRecord(album.artist);
    return {
      provider: "netease",
      providerAlbumId: id,
      title,
      artist: readString(album.artist) ?? readString(artistRecord?.name) ?? readString(album.artistName) ?? readArtistNames(album.artists),
      description: readString(album.description) ?? readString(album.briefDesc),
      artworkUrl: readNeteaseArtworkUrl(album.picUrl, album.blurPicUrl),
      releaseTime: readString(album.publishTime) ?? readString(album.company),
      trackCount: readNumber(album.size) ?? readNumber(album.trackCount) ?? 0
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

  private async getCachedDiscovery<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>
  ): Promise<T> {
    const now = Date.now();
    this.pruneDiscoverCache(now);
    const cached = this.discoverCache.get(key);
    if (cached && cached.freshUntil > now) {
      return cached.value as T;
    }

    try {
      const value = await load();
      this.discoverCache.set(key, {
        value,
        freshUntil: now + ttlSeconds * 1_000,
        staleUntil: now + Math.max(ttlSeconds * 6, 3_600) * 1_000
      });
      return value;
    } catch (error) {
      if (cached && cached.staleUntil > now) {
        return cached.value as T;
      }
      throw error;
    }
  }

  private pruneDiscoverCache(now: number) {
    for (const [key, entry] of this.discoverCache) {
      if (entry.staleUntil <= now) {
        this.discoverCache.delete(key);
      }
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

function readLyricText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readHttpUrl(value: unknown) {
  const result = readString(value);
  return result && /^https?:\/\//.test(result) ? result : null;
}

function readNeteaseTrackArray(...values: unknown[]): unknown[] {
  const queue = [...values];
  const visited = new Set<Record<string, unknown>>();
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
    for (const key of ["songs", "songList", "songlist", "list", "data", "result"]) {
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

function readNeteaseArtworkUrl(...values: unknown[]) {
  for (const value of values) {
    const result = readString(value);
    if (!result) continue;
    const normalized = result.startsWith("//")
      ? `https:${result}`
      : result.replace(/^http:\/\//i, "https://");
    try {
      const url = new URL(normalized);
      if (url.protocol === "https:" && url.hostname) return url.toString();
    } catch {
      // Ignore malformed provider artwork URLs and try the next field.
    }
  }
  return null;
}

function readArtistNames(value: unknown) {
  if (!Array.isArray(value)) return "未知歌手";
  const names = value.map((item) => readString(asRecord(item)?.name)).filter((item): item is string => !!item);
  return names.join(" / ") || "未知歌手";
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

/**
 * NetEase's player endpoint still returns HTTP CDN links. The CDN supports
 * HTTPS, which is required by the provider fetcher's SSRF-safe transport.
 */
function normalizeNeteaseAudioUrl(value: string) {
  const url = new URL(value);
  if (url.protocol === "http:") {
    url.protocol = "https:";
    if (url.port === "80") {
      url.port = "";
    }
  }
  if (url.protocol !== "https:") {
    throw new Error("NetEase returned a non-HTTPS audio URL.");
  }
  return url;
}

function dateKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
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
