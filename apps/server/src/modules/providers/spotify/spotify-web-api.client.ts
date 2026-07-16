import { Injectable } from "@nestjs/common";
import SpotifyWebApi from "spotify-web-api-node";
import type { SpotifyTrackCandidate } from "@music-room/shared";

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
  private readonly api: SpotifyWebApi;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor() {
    this.api = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID?.trim() ?? "",
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? ""
    });
  }

  hasClientCredentials() {
    return Boolean(
      process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim()
    );
  }

  async searchTracks(input: { q: string; limit: number; offset: number }) {
    await this.ensureAccessToken();
    try {
      const response = await this.api.searchTracks(input.q, {
        limit: input.limit,
        offset: input.offset,
        market: process.env.SPOTIFY_MARKET?.trim() || undefined
      });
      const items = response.body.tracks?.items ?? [];
      return items
        .map((track) => this.toTrackCandidate(track as SpotifyTrackBody))
        .filter((track): track is SpotifyTrackCandidate => !!track);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getTrack(trackId: string) {
    await this.ensureAccessToken();
    try {
      const response = await this.api.getTrack(trackId, {
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
      throw this.mapError(error);
    }
  }

  private async ensureAccessToken() {
    if (!this.hasClientCredentials()) {
      throw new SpotifyWebApiClientError(
        "auth-expired",
        "Spotify Web API client credentials are not configured."
      );
    }

    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 30_000) {
      this.api.setAccessToken(this.accessToken);
      return;
    }

    try {
      this.api.setClientId(process.env.SPOTIFY_CLIENT_ID?.trim() ?? "");
      this.api.setClientSecret(process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? "");
      const grant = await this.api.clientCredentialsGrant();
      this.accessToken = grant.body.access_token;
      this.accessTokenExpiresAt = Date.now() + grant.body.expires_in * 1000;
      this.api.setAccessToken(this.accessToken);
    } catch (error) {
      throw this.mapError(error);
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

  private mapError(error: unknown): SpotifyWebApiClientError {
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
      this.accessToken = null;
      this.accessTokenExpiresAt = 0;
      return new SpotifyWebApiClientError("auth-expired");
    }
    if (status === 404) {
      return new SpotifyWebApiClientError("not-found");
    }
    return new SpotifyWebApiClientError("unavailable");
  }
}
