import { Injectable, Inject, forwardRef } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Playlist } from "@music-room/shared";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RoomService } from "../room/room.service";

@Injectable()
export class PlaylistService {
  private readonly playlists = new Map<string, Playlist>();
  private readonly playlistRoomIds = new Map<string, string | null>();

  constructor(
    @Inject(forwardRef(() => RoomService)) private readonly roomService: RoomService,
    private readonly prisma: PrismaService
  ) {}

  async listPlaylists(ownerId?: string) {
    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.playlist.findMany({
        ...(ownerId ? { where: { ownerId } } : {}),
        orderBy: { updatedAt: "desc" }
      });

      const playlists = persisted.map((item: any) => this.deserializePlaylist(item));
      persisted.forEach((item: any) => {
        this.playlistRoomIds.set(item.id, item.roomId ?? null);
      });
      playlists.forEach((playlist: Playlist) => this.playlists.set(playlist.id, playlist));
      return playlists;
    }

    const playlists = [...this.playlists.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );

    return ownerId ? playlists.filter((playlist) => playlist.ownerId === ownerId) : playlists;
  }

  async listPlaylistsForRoom(roomId: string) {
    const roomTrackIds = new Set((await this.roomService.getTracks(roomId)).map((track) => track.id));
    const playlists = await this.listPlaylists();
    return playlists.filter((playlist: Playlist) =>
      playlist.trackIds.some((trackId: string) => roomTrackIds.has(trackId))
    );
  }

  async createPlaylist(input: {
    ownerId: string;
    roomId?: string | null;
    title: string;
    description?: string | null;
    trackIds?: string[];
    tags?: string[];
    coverUrl?: string | null;
    isCollaborative?: boolean;
  }) {
    const playlist: Playlist = {
      id: `playlist_${randomUUID()}`,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description ?? null,
      coverUrl: input.coverUrl ?? null,
      tags: input.tags ?? [],
      isCollaborative: input.isCollaborative ?? false,
      trackIds: input.trackIds ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.playlists.set(playlist.id, playlist);
    this.playlistRoomIds.set(playlist.id, input.roomId ?? null);

    if (this.prisma.isAvailable()) {
      await this.prisma.playlist.upsert({
        where: { id: playlist.id },
        update: {
          ownerId: playlist.ownerId,
          roomId: input.roomId ?? null,
          title: playlist.title,
          description: playlist.description,
          coverUrl: playlist.coverUrl,
          tags: playlist.tags,
          isCollaborative: playlist.isCollaborative,
          trackIds: playlist.trackIds
        },
        create: {
          id: playlist.id,
          ownerId: playlist.ownerId,
          roomId: input.roomId ?? null,
          title: playlist.title,
          description: playlist.description,
          coverUrl: playlist.coverUrl,
          tags: playlist.tags,
          isCollaborative: playlist.isCollaborative,
          trackIds: playlist.trackIds,
          createdAt: new Date(playlist.createdAt),
          updatedAt: new Date(playlist.updatedAt)
        }
      });
    }

    return playlist;
  }

  async createPlaylistFromRoom(input: {
    ownerId: string;
    roomId: string;
    title: string;
    description?: string | null;
  }) {
    const roomQueue = await this.roomService.getQueue(input.roomId);

    return this.createPlaylist({
      ownerId: input.ownerId,
      roomId: input.roomId,
      title: input.title,
      description: input.description,
      trackIds: roomQueue.map((item) => item.trackId)
    });
  }

  async updatePlaylist(
    playlistId: string,
    input: {
      ownerId: string;
      title?: string;
      description?: string | null;
      tags?: string[];
      coverUrl?: string | null;
      trackIds?: string[];
    }
  ) {
    const current = await this.getPlaylistOrThrow(playlistId);

    if (current.ownerId !== input.ownerId) {
      throw new Error("Only the playlist owner can update this playlist.");
    }

    const updated: Playlist = {
      ...current,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      coverUrl: input.coverUrl ?? current.coverUrl,
      tags: input.tags ?? current.tags,
      trackIds: input.trackIds ?? current.trackIds,
      updatedAt: new Date().toISOString()
    };

    this.playlists.set(updated.id, updated);

    if (this.prisma.isAvailable()) {
      await this.prisma.playlist.update({
        where: { id: updated.id },
        data: {
          title: updated.title,
          description: updated.description,
          coverUrl: updated.coverUrl,
          tags: updated.tags,
          trackIds: updated.trackIds
        }
      });
    }

    return updated;
  }

  async deletePlaylist(playlistId: string, ownerId: string) {
    const current = await this.getPlaylistOrThrow(playlistId);

    if (current.ownerId !== ownerId) {
      throw new Error("Only the playlist owner can delete this playlist.");
    }

    this.playlists.delete(playlistId);
    this.playlistRoomIds.delete(playlistId);

    if (this.prisma.isAvailable()) {
      await this.prisma.playlist.deleteMany({
        where: { id: playlistId, ownerId }
      });
    }

    return { ok: true };
  }

  async removeTrackFromPlaylists(trackId: string) {
    const playlists = await this.listPlaylists();
    const affectedPlaylists = playlists.filter((playlist) => playlist.trackIds.includes(trackId));

    for (const playlist of affectedPlaylists) {
      const nextTrackIds = playlist.trackIds.filter((id) => id !== trackId);
      const updated: Playlist = {
        ...playlist,
        trackIds: nextTrackIds,
        updatedAt: new Date().toISOString()
      };

      this.playlists.set(updated.id, updated);

      if (this.prisma.isAvailable()) {
        await this.prisma.playlist.update({
          where: { id: updated.id },
          data: {
            trackIds: updated.trackIds
          }
        });
      }
    }
  }

  async deletePlaylistsForRoom(roomId: string) {
    const playlists = await this.listPlaylists();
    const roomPlaylists = playlists.filter((playlist) => this.playlistRoomIds.get(playlist.id) === roomId);

    for (const playlist of roomPlaylists) {
      this.playlists.delete(playlist.id);
      this.playlistRoomIds.delete(playlist.id);
    }

    if (this.prisma.isAvailable()) {
      await this.prisma.playlist.deleteMany({
        where: { roomId }
      });
    }

    return { ok: true };
  }

  async getPlaylist(playlistId: string) {
    return this.getPlaylistOrThrow(playlistId);
  }

  async getPlaylistForOwner(playlistId: string, ownerId: string) {
    const playlist = await this.getPlaylistOrThrow(playlistId);

    if (playlist.ownerId !== ownerId) {
      throw new Error("Only the playlist owner can access this playlist.");
    }

    return playlist;
  }

  private deserializePlaylist(item: {
    id: string;
    ownerId: string;
    title: string;
    description: string | null;
    coverUrl: string | null;
    tags: unknown;
    isCollaborative: boolean;
    trackIds: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): Playlist {
    return {
      id: item.id,
      ownerId: item.ownerId,
      title: item.title,
      description: item.description,
      coverUrl: item.coverUrl,
      tags: item.tags as string[],
      isCollaborative: item.isCollaborative,
      trackIds: item.trackIds as string[],
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString()
    };
  }

  private async getPlaylistOrThrow(playlistId: string) {
    const cached = this.playlists.get(playlistId);
    if (cached) {
      return cached;
    }

    if (this.prisma.isAvailable()) {
      const persisted = await this.prisma.playlist.findUnique({
        where: { id: playlistId }
      });

      if (persisted) {
        const playlist = this.deserializePlaylist(persisted);
        this.playlists.set(playlist.id, playlist);
        return playlist;
      }
    }

    throw new Error(`Playlist not found: ${playlistId}`);
  }
}
