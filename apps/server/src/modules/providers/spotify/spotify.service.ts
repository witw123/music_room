import {
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import type {
  SpotifyAccountStatus,
  SpotifySearchResponse,
  SpotifyTrackCandidate
} from "@music-room/shared";
import {
  createApiErrorResponse,
  errorCodes
} from "@music-room/shared";
import { SpotifyWebApiClient, SpotifyWebApiClientError } from "./spotify-web-api.client";
import {
  spotifyQualitySchema,
  type SpotifyQuality,
  type SpotifySearchQuery
} from "./spotify.schemas";
import { ZotifyDownloadService } from "./zotify-download.service";

type RateBucket = { timestamps: number[] };

@Injectable()
export class SpotifyService {
  private readonly userRateLimits = new Map<string, RateBucket>();

  constructor(
    private readonly api: SpotifyWebApiClient,
    private readonly downloads: ZotifyDownloadService
  ) {}

  async getAccountStatus(_userId: string): Promise<SpotifyAccountStatus> {
    this.assertEnabled();
    const readiness = await this.downloads.getAccountReadiness();
    const hasWebApiCredentials = this.api.hasClientCredentials();
    const connected =
      hasWebApiCredentials && readiness.hasDownloadCredentials && readiness.hasZotifyBinary;

    let message: string | null = null;
    if (!hasWebApiCredentials) {
      message = "Spotify Web API client credentials are not configured.";
    } else if (!readiness.hasDownloadCredentials) {
      message = "Spotify download credentials.json is missing on the server.";
    } else if (!readiness.hasZotifyBinary) {
      message = "Zotify binary is not available on the server.";
    }

    return {
      connected,
      mode: "server_credentials",
      hasWebApiCredentials,
      hasDownloadCredentials: readiness.hasDownloadCredentials,
      hasZotifyBinary: readiness.hasZotifyBinary,
      message
    };
  }

  async searchTracks(userId: string, query: SpotifySearchQuery): Promise<SpotifySearchResponse> {
    this.assertEnabled();
    this.assertConfiguredForSearch();
    this.assertRateLimit(`search:${userId}`, 30, 60_000);
    try {
      const items = await this.api.searchTracks(query);
      return {
        items,
        limit: query.limit,
        offset: query.offset
      };
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  async getTrack(userId: string, trackId: string): Promise<SpotifyTrackCandidate> {
    this.assertEnabled();
    this.assertConfiguredForSearch();
    this.assertRateLimit(`track:${userId}`, 30, 60_000);
    try {
      return await this.api.getTrack(trackId);
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  async openAudio(userId: string, trackId: string, quality: string) {
    this.assertEnabled();
    this.assertRateLimit(`audio:${userId}`, 3, 60_000);
    const parsedQuality = spotifyQualitySchema.safeParse(quality);
    const selectedQuality: SpotifyQuality = parsedQuality.success
      ? parsedQuality.data
      : this.defaultQuality();

    this.assertConfiguredForSearch();
    try {
      await this.api.getTrack(trackId);
    } catch (error) {
      throw this.mapProviderError(error);
    }

    return this.downloads.openAudio(trackId, selectedQuality);
  }

  private assertEnabled() {
    if (process.env.SPOTIFY_ENABLED !== "true") {
      throw new HttpException(
        createApiErrorResponse(errorCodes.spotifyDisabled, "Spotify provider is disabled."),
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private assertConfiguredForSearch() {
    if (!this.api.hasClientCredentials()) {
      throw new HttpException(
        createApiErrorResponse(
          errorCodes.spotifyAccountRequired,
          "Spotify Web API client credentials are not configured."
        ),
        HttpStatus.CONFLICT
      );
    }
  }

  private defaultQuality(): SpotifyQuality {
    const value = process.env.SPOTIFY_DEFAULT_QUALITY?.trim();
    return spotifyQualitySchema.safeParse(value).success
      ? (value as SpotifyQuality)
      : "high";
  }

  private assertRateLimit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const bucket = this.userRateLimits.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (bucket.timestamps.length >= limit) {
      this.userRateLimits.set(key, bucket);
      throw new HttpException(
        createApiErrorResponse(errorCodes.rateLimited, "Too many Spotify provider requests."),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    bucket.timestamps.push(now);
    this.userRateLimits.set(key, bucket);
  }

  private mapProviderError(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }
    if (error instanceof SpotifyWebApiClientError) {
      if (error.kind === "auth-expired") {
        throw new HttpException(
          createApiErrorResponse(
            errorCodes.spotifyAuthExpired,
            "Spotify Web API authentication failed."
          ),
          HttpStatus.UNAUTHORIZED
        );
      }
      if (error.kind === "not-found") {
        throw new HttpException(
          createApiErrorResponse(errorCodes.spotifyTrackNotFound, "Spotify track was not found."),
          HttpStatus.NOT_FOUND
        );
      }
      throw new HttpException(
        createApiErrorResponse(errorCodes.spotifyUnavailable, "Spotify Web API is unavailable."),
        HttpStatus.BAD_GATEWAY
      );
    }
    throw new HttpException(
      createApiErrorResponse(errorCodes.spotifyUnavailable, "Spotify provider request failed."),
      HttpStatus.BAD_GATEWAY
    );
  }
}
