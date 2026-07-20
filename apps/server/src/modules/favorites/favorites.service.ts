import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ProviderAlbumFavorite, ProviderAlbumSummary } from "@music-room/shared";
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

  private assertDatabaseAvailable() {
    if (!this.prisma.isAvailable()) {
      throw new ServiceUnavailableException("Database is temporarily unavailable.");
    }
  }
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
