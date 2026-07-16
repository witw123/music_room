import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import SpotifyWebApi from "spotify-web-api-node";
import type { SpotifyTrackCandidate } from "@music-room/shared";
import type { SpotifyStoredConfig } from "./spotify-account.service";

export type SpotifyWebApiErrorKind = "auth-expired" | "not-found" | "unavailable" | "invalid-response";

export class SpotifyWebApiClientError extends Error {
  constructor(
    public readonly kind: SpotifyWebApiErrorKind,
    message = "Spotify Web API request failed."
  ) {
    super(message);
    this.name = "SpotifyWebApiClientError";
  }
}

type SpotifyImage = { url?: string | null };
type SpotifyArtist = { name?: string | null };
type SpotifyAlbum = {
  name?: string | null;
  images?: SpotifyImage[] | null;
};
type SpotifyTrackBody = {
  id?: string | null;
  name?: string | null;
  duration_ms?: number | null;
  explicit?: boolean | null;
  preview_url?: string | null;
  artists?: SpotifyArtist[] | null;
  album?: SpotifyAlbum | null;
};

@Injectable()
export class SpotifyWebApiClient {
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();

  async searchTracks(config: SpotifyStoredConfig, input: { q: string; limit: number; offset: number }) {
    const cacheKey = this.cacheKey(config);
    const api = await this.createAuthenticatedApi(config, cacheKey);
    try {
      const response = await api.searchTracks(input.q, {
        limit: input.limit,
        offset: input.offset,
        market: process.env.SPOTIFY_MARKET?.trim() || undefined
      });
      const items = response.body.tracks?.items ?? [];
      return items
        .map((track) => this.toTrackCandidate(track as SpotifyTrackBody))
        .filter((track): track is SpotifyTrackCandidate => !!track);
    } catch (error) {
      throw this.mapError(error, cacheKey);
    }
  }

  async getTrack(config: SpotifyStoredConfig, trackId: string) {
    const cacheKey = this.cacheKey(config);
    const api = await this.createAuthenticatedApi(config, cacheKey);
    try {
      const response = await api.getTrack(trackId, {
        market: process.env.SPOTIFY_MARKET?.trim() || undefined
      });
      const track = this.toTrackCandidate(response.body as SpotifyTrackBody);
      if (!track) {
        throw new SpotifyWebApiClientError("not-found", "Spotify track was not found.");
      }
      return track;
    } catch (error) {
      if (error instanceof SpotifyWebApiClientError) {
        throw error;
      }
      throw this.mapError(error, cacheKey);
    }
  }

  private async createAuthenticatedApi(config: SpotifyStoredConfig, cacheKey: string) {
    const clientId = config.clientId.trim();
    const clientSecret = config.clientSecret.trim();
    if (!clientId || !clientSecret) {
      throw new SpotifyWebApiClientError("auth-expired", "Spotify Web API credentials are missing.");
    }
    const api = new SpotifyWebApi({ clientId, clientSecret });
    const cached = this.accessTokens.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt - 30_000) {
      api.setAccessToken(cached.token);
      return api;
    }
    try {
      const grant = await api.clientCredentialsGrant();
      this.accessTokens.set(cacheKey, {
        token: grant.body.access_token,
        expiresAt: Date.now() + grant.body.expires_in * 1000
      });
      api.setAccessToken(grant.body.access_token);
      return api;
    } catch (error) {
      throw this.mapError(error, cacheKey);
    }
  }

  private toTrackCandidate(track: SpotifyTrackBody): SpotifyTrackCandidate | null {
    const id = typeof track.id === "string" ? track.id.trim() : "";
    if (!/^[0-9A-Za-z]{22}$/.test(id)) {
      return null;
    }

    const artists = (track.artists ?? [])
      .map((artist) => artist.name?.trim())
      .filter((name): name is string => !!name);
    const images = track.album?.images ?? [];
    const artworkUrl = images.find((image) => typeof image.url === "string" && image.url)?.url ?? null;
    const previewUrl =
      typeof track.preview_url === "string" && track.preview_url.startsWith("http")
        ? track.preview_url
        : null;

    return {
      provider: "spotify",
      providerTrackId: id,
      title: track.name?.trim() || "Unknown track",
      artist: artists.length > 0 ? artists.join(" / ") : "Unknown artist",
      album: track.album?.name?.trim() || null,
      durationMs: Number.isFinite(track.duration_ms) ? Math.max(0, Math.floor(track.duration_ms ?? 0)) : 0,
      artworkUrl,
      explicit: Boolean(track.explicit),
      previewUrl,
      quality: this.defaultQuality()
    };
  }

  private defaultQuality() {
    const value = process.env.SPOTIFY_DEFAULT_QUALITY?.trim();
    if (value === "normal" || value === "high" || value === "very_high") {
      return value;
    }
    return "high";
  }

  private mapError(error: unknown, cacheKey?: string): SpotifyWebApiClientError {
    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : null;

    if (status === 401 || status === 403) {
      if (cacheKey) this.accessTokens.delete(cacheKey);
      return new SpotifyWebApiClientError("auth-expired");
    }
    if (status === 404) {
      return new SpotifyWebApiClientError("not-found");
    }
    return new SpotifyWebApiClientError("unavailable");
  }

  private cacheKey(config: SpotifyStoredConfig) {
    return `${config.clientId.trim()}:${createHash("sha256")
      .update(config.clientSecret)
      .digest("hex")}`;
  }
}
