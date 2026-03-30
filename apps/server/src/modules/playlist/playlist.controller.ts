import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  forwardRef
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomService } from "../room/room.service";
import { PlaylistService } from "./playlist.service";

@Controller("v1/playlists")
export class PlaylistController {
  constructor(
    private readonly playlistService: PlaylistService,
    @Inject(forwardRef(() => RoomService)) private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway,
    private readonly authService: AuthService
  ) {}

  private async getCurrentUserId(sessionToken?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Get()
  async listPlaylists(@Headers("x-session-token") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.playlistService.listPlaylists(userId);
  }

  @Post()
  async createPlaylist(
    @Headers("x-session-token") sessionToken: string | undefined,
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
    return this.playlistService.createPlaylist({
      ...body,
      ownerId: userId
    });
  }

  @Patch(":playlistId")
  async updatePlaylist(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
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
    return this.playlistService.updatePlaylist(playlistId, {
      ...body,
      ownerId: userId
    });
  }

  @Delete(":playlistId")
  async deletePlaylist(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.playlistService.deletePlaylist(playlistId, userId);
  }

  @Post(":playlistId/import-to-room")
  async importPlaylistToRoom(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      roomId: string;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const playlist = await this.playlistService.getPlaylistForOwner(playlistId, userId);
    await this.roomService.importPlaylistToQueue(body.roomId, userId, playlist.trackIds);
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
      roomId: string;
      title: string;
      description?: string | null;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const playlist = await this.playlistService.createPlaylistFromRoom({
      ...body,
      ownerId: userId
    });
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
