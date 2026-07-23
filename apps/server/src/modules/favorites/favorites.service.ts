import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ProviderAlbumFavorite, ProviderAlbumSummary, ProviderTrackCandidate, ProviderTrackFavorite } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async listAlbums(userId: string): Promise<ProviderAlbumFavorite[]> {
    this.assertDatabaseAvailable();
    const records = await this.prisma.userFavoriteAlbum.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" }
    });
    return records.map(toFavoriteAlbum);
  }

  async saveAlbum(userId: string, album: ProviderAlbumSummary): Promise<ProviderAlbumFavorite> {
    this.assertDatabaseAvailable();
    const record = await this.prisma.userFavoriteAlbum.upsert({
      where: {
        userId_provider_providerAlbumId: {
          userId,
          provider: album.provider,
          providerAlbumId: album.providerAlbumId
        }
      },
      update: {
        title: album.title,
        artist: album.artist,
        artworkUrl: album.artworkUrl,
        description: album.description,
        releaseTime: album.releaseTime,
        trackCount: album.trackCount
      },
      create: {
        id: `favorite_album_${randomUUID()}`,
        userId,
        provider: album.provider,
        providerAlbumId: album.providerAlbumId,
        title: album.title,
        artist: album.artist,
        artworkUrl: album.artworkUrl,
        description: album.description,
        releaseTime: album.releaseTime,
        trackCount: album.trackCount
      }
    });
    return toFavoriteAlbum(record);
  }

  async removeAlbum(userId: string, provider: ProviderAlbumSummary["provider"], providerAlbumId: string) {
    this.assertDatabaseAvailable();
    await this.prisma.userFavoriteAlbum.deleteMany({
      where: { userId, provider, providerAlbumId }
    });
    return { ok: true };
  }

  async listTracks(userId: string): Promise<ProviderTrackFavorite[]> {
    this.assertDatabaseAvailable();
    const records = await this.prisma.userFavoriteTrack.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" }
    });
    return records.map(toFavoriteTrack);
  }

  async saveTrack(userId: string, track: ProviderTrackCandidate): Promise<ProviderTrackFavorite> {
    this.assertDatabaseAvailable();
    const record = await this.prisma.userFavoriteTrack.upsert({
      where: {
        userId_provider_providerTrackId: {
          userId,
          provider: track.provider,
          providerTrackId: track.providerTrackId
        }
      },
      update: {
        access: track.access,
        quality: track.quality,
        title: track.title,
        artist: track.artist,
        album: track.album,
        providerAlbumId: track.providerAlbumId ?? null,
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl
      },
      create: {
        id: `favorite_track_${randomUUID()}`,
        userId,
        provider: track.provider,
        providerTrackId: track.providerTrackId,
        access: track.access,
        quality: track.quality,
        title: track.title,
        artist: track.artist,
        album: track.album,
        providerAlbumId: track.providerAlbumId ?? null,
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl
      }
    });
    return toFavoriteTrack(record);
  }

  async removeTrack(userId: string, provider: ProviderTrackCandidate["provider"], providerTrackId: string) {
    this.assertDatabaseAvailable();
    await this.prisma.userFavoriteTrack.deleteMany({
      where: { userId, provider, providerTrackId }
    });
    return { ok: true };
  }

  private assertDatabaseAvailable() {
    if (!this.prisma.isAvailable()) {
      throw new ServiceUnavailableException("Database is temporarily unavailable.");
    }
  }
}

function toFavoriteTrack(record: {
  id: string;
  provider: string;
  providerTrackId: string;
  access: string;
  quality: string | null;
  title: string;
  artist: string;
  album: string | null;
  providerAlbumId: string | null;
  durationMs: number;
  artworkUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProviderTrackFavorite {
  return {
    id: record.id,
    provider: record.provider === "qqmusic" ? "qqmusic" : "netease",
    providerTrackId: record.providerTrackId,
    access: record.access === "vip" || record.access === "paid" || record.access === "free" ? record.access : "unknown",
    quality: record.quality === "standard" || record.quality === "high" || record.quality === "exhigh" || record.quality === "lossless" || record.quality === "hires" ? record.quality : null,
    title: record.title,
    artist: record.artist,
    album: record.album,
    providerAlbumId: record.providerAlbumId,
    durationMs: record.durationMs,
    artworkUrl: record.artworkUrl,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function toFavoriteAlbum(record: {
  id: string;
  provider: string;
  providerAlbumId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  description: string | null;
  releaseTime: string | null;
  trackCount: number;
  createdAt: Date;
  updatedAt: Date;
}): ProviderAlbumFavorite {
  return {
    id: record.id,
    provider: record.provider === "qqmusic" ? "qqmusic" : "netease",
    providerAlbumId: record.providerAlbumId,
    title: record.title,
    artist: record.artist,
    artworkUrl: record.artworkUrl,
    description: record.description,
    releaseTime: record.releaseTime,
    trackCount: record.trackCount,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
