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
import {
  SpotifyAccountCredentialsInvalidError,
  SpotifyAccountService,
  SpotifyAccountStorageUnavailableError
} from "./spotify-account.service";

type RateBucket = { timestamps: number[] };

@Injectable()
export class SpotifyService {
  private readonly userRateLimits = new Map<string, RateBucket>();

  constructor(
    private readonly api: SpotifyWebApiClient,
    private readonly downloads: ZotifyDownloadService,
    private readonly accounts: SpotifyAccountService
  ) {}

  async getAccountStatus(userId: string): Promise<SpotifyAccountStatus> {
    this.assertEnabled();
    const readiness = await this.downloads.getAccountReadiness();
    try {
      return await this.accounts.getStatus(userId, readiness.hasZotifyBinary);
    } catch (error) {
      if (error instanceof SpotifyAccountStorageUnavailableError) {
        throw new HttpException(
          createApiErrorResponse(errorCodes.spotifyUnavailable, "Spotify account storage is unavailable."),
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      throw error;
    }
  }

  async saveAccount(userId: string, config: import("./spotify-account.service").SpotifyStoredConfig) {
    this.assertEnabled();
    validateCredentialsJson(config.credentialsJson);
    try {
      await this.accounts.saveAccount(userId, config);
    } catch (error) {
      this.throwAccountStorageError(error);
    }
    return this.getAccountStatus(userId);
  }

  async disconnectAccount(userId: string) {
    this.assertEnabled();
    let result;
    try {
      result = await this.accounts.disconnect(userId);
    } catch (error) {
      this.throwAccountStorageError(error);
    }
    await this.downloads.deleteUserCache(userId);
    return result;
  }

  async searchTracks(userId: string, query: SpotifySearchQuery): Promise<SpotifySearchResponse> {
    this.assertEnabled();
    const config = await this.getConfigOrThrow(userId);
    this.assertRateLimit(`search:${userId}`, 30, 60_000);
    try {
      const items = await this.api.searchTracks(config, query);
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
    const config = await this.getConfigOrThrow(userId);
    this.assertRateLimit(`track:${userId}`, 30, 60_000);
    try {
      return await this.api.getTrack(config, trackId);
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

    const config = await this.getConfigOrThrow(userId);
    try {
      await this.api.getTrack(config, trackId);
    } catch (error) {
      throw this.mapProviderError(error);
    }

    return this.downloads.openAudio(userId, config, trackId, selectedQuality);
  }

  private assertEnabled() {
    if (process.env.SPOTIFY_ENABLED !== "true") {
      throw new HttpException(
        createApiErrorResponse(errorCodes.spotifyDisabled, "Spotify provider is disabled."),
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  private async getConfigOrThrow(userId: string) {
    try {
      return await this.accounts.getConfigOrThrow(userId);
    } catch (error) {
      if (error instanceof SpotifyAccountStorageUnavailableError) {
        throw new HttpException(
          createApiErrorResponse(errorCodes.spotifyUnavailable, "Spotify account storage is unavailable."),
          HttpStatus.SERVICE_UNAVAILABLE
        );
      }
      const code =
        error instanceof SpotifyAccountCredentialsInvalidError
          ? errorCodes.spotifyAuthExpired
          : errorCodes.spotifyAccountRequired;
      throw new HttpException(
        createApiErrorResponse(
          code,
          error instanceof Error ? error.message : "Spotify account credentials are required."
        ),
        code === errorCodes.spotifyAuthExpired ? HttpStatus.UNAUTHORIZED : HttpStatus.CONFLICT
      );
    }
  }

  private throwAccountStorageError(error: unknown): never {
    if (error instanceof SpotifyAccountStorageUnavailableError) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.spotifyUnavailable, "Spotify account storage is unavailable."),
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
    throw error;
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

function validateCredentialsJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
  } catch {
    throw new HttpException(
      createApiErrorResponse(
        errorCodes.validationFailed,
        "Spotify credentials.json must contain a valid JSON object."
      ),
      HttpStatus.BAD_REQUEST
    );
  }
}
