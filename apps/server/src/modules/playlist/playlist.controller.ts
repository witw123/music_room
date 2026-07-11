import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import {
  createPlaylistFromRoomRequestSchema,
  createPlaylistRequestSchema,
  importPlaylistToRoomRequestSchema,
  updatePlaylistRequestSchema
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";
import { PlaylistService } from "./playlist.service";
import { getSessionTokenFromCookie } from "../../common/auth/session-cookie";

@Controller("v1/playlists")
export class PlaylistController {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService
  ) {}

  private async getCurrentUserId(cookieHeader?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(getSessionTokenFromCookie(cookieHeader));
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Get()
  async listPlaylists(@Headers("cookie") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.playlistService.listPlaylists(userId);
  }

  @Post()
  async createPlaylist(
    @Headers("cookie") sessionToken: string | undefined,
    @Body()
    body: {
      title: string;
      description?: string | null;
      trackIds?: string[];
      tags?: string[];
      coverUrl?: string | null;
      isCollaborative?: boolean;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(createPlaylistRequestSchema, body);
    return this.playlistService.createPlaylist({
      ...payload,
      ownerId: userId
    });
  }

  @Patch(":playlistId")
  async updatePlaylist(
    @Param("playlistId") playlistId: string,
    @Headers("cookie") sessionToken: string | undefined,
    @Body()
    body: {
      title?: string;
      description?: string | null;
      tags?: string[];
      coverUrl?: string | null;
      trackIds?: string[];
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(updatePlaylistRequestSchema, body);
    return this.playlistService.updatePlaylist(playlistId, {
      ...payload,
      ownerId: userId
    });
  }

  @Delete(":playlistId")
  async deletePlaylist(
    @Param("playlistId") playlistId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.playlistService.deletePlaylist(playlistId, userId);
  }

  @Post(":playlistId/import-to-room")
  async importPlaylistToRoom(
    @Param("playlistId") playlistId: string,
    @Headers("cookie") sessionToken: string | undefined,
    @Body()
    body: {
      roomId: string;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(importPlaylistToRoomRequestSchema, body);
    const playlist = await this.playlistService.getPlaylistForOwner(playlistId, userId);
    await this.roomService.importPlaylistToQueue(payload.roomId, userId, playlist.trackIds);
    const snapshot = await this.roomRealtimePublisher.emitQueueSnapshot(
      payload.roomId,
      await this.playlistService.listPlaylistsForRoom(payload.roomId)
    );
    return {
      queue: snapshot.queue,
      playback: snapshot.room.playback
    };
  }

  @Post("from-room")
  async createPlaylistFromRoom(
    @Headers("cookie") sessionToken: string | undefined,
    @Body()
    body: {
      roomId: string;
      title: string;
      description?: string | null;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(createPlaylistFromRoomRequestSchema, body);
    const playlist = await this.playlistService.createPlaylistFromRoom({
      ...payload,
      ownerId: userId
    });
    await this.roomRealtimePublisher.emitSnapshot(
      payload.roomId,
      await this.playlistService.listPlaylistsForRoom(payload.roomId)
    );
    return playlist;
  }
}
