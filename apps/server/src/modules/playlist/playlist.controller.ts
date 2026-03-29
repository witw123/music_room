import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomService } from "../room/room.service";
import { PlaylistService } from "./playlist.service";

@Controller("v1/playlists")
export class PlaylistController {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway,
    private readonly authService: AuthService
  ) {}

  private async assertSession(sessionId: string, sessionToken?: string) {
    try {
      await this.authService.assertSessionToken(sessionId, sessionToken);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Get()
  async listPlaylists(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Query("ownerId") ownerId?: string
  ) {
    if (ownerId) {
      await this.assertSession(ownerId, sessionToken);
    }
    return this.playlistService.listPlaylists(ownerId);
  }

  @Post()
  async createPlaylist(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      ownerId: string;
      title: string;
      description?: string | null;
      trackIds?: string[];
      tags?: string[];
      coverUrl?: string | null;
      isCollaborative?: boolean;
    }
  ) {
    await this.assertSession(body.ownerId, sessionToken);
    return this.playlistService.createPlaylist(body);
  }

  @Patch(":playlistId")
  async updatePlaylist(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      ownerId: string;
      title?: string;
      description?: string | null;
      tags?: string[];
      coverUrl?: string | null;
      trackIds?: string[];
    }
  ) {
    await this.assertSession(body.ownerId, sessionToken);
    return this.playlistService.updatePlaylist(playlistId, body);
  }

  @Delete(":playlistId")
  async deletePlaylist(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Query("ownerId") ownerId: string
  ) {
    await this.assertSession(ownerId, sessionToken);
    return this.playlistService.deletePlaylist(playlistId, ownerId);
  }

  @Post(":playlistId/import-to-room")
  async importPlaylistToRoom(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      roomId: string;
      sessionId: string;
    }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const playlist = await this.playlistService.getPlaylistForOwner(playlistId, body.sessionId);
    await this.roomService.importPlaylistToQueue(body.roomId, body.sessionId, playlist.trackIds);
    this.signalingGateway.emitRoomSnapshot(
      body.roomId,
      await this.roomService.getRoomSnapshot(
        body.roomId,
        await this.playlistService.listPlaylistsForRoom(body.roomId)
      )
    );
    return { ok: true };
  }

  @Post("from-room")
  async createPlaylistFromRoom(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      ownerId: string;
      roomId: string;
      title: string;
      description?: string | null;
    }
  ) {
    await this.assertSession(body.ownerId, sessionToken);
    const playlist = await this.playlistService.createPlaylistFromRoom(body);
    this.signalingGateway.emitRoomSnapshot(
      body.roomId,
      await this.roomService.getRoomSnapshot(
        body.roomId,
        await this.playlistService.listPlaylistsForRoom(body.roomId)
      )
    );
    return playlist;
  }
}
