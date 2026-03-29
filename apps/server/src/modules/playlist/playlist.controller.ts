import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomService } from "../room/room.service";
import { PlaylistService } from "./playlist.service";

@Controller("v1/playlists")
export class PlaylistController {
  constructor(
    private readonly playlistService: PlaylistService,
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway
  ) {}

  @Get()
  async listPlaylists(@Query("ownerId") ownerId?: string) {
    return this.playlistService.listPlaylists(ownerId);
  }

  @Post()
  async createPlaylist(
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
    return this.playlistService.createPlaylist(body);
  }

  @Patch(":playlistId")
  async updatePlaylist(
    @Param("playlistId") playlistId: string,
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
    return this.playlistService.updatePlaylist(playlistId, body);
  }

  @Delete(":playlistId")
  async deletePlaylist(
    @Param("playlistId") playlistId: string,
    @Query("ownerId") ownerId: string
  ) {
    return this.playlistService.deletePlaylist(playlistId, ownerId);
  }

  @Post(":playlistId/import-to-room")
  async importPlaylistToRoom(
    @Param("playlistId") playlistId: string,
    @Body()
    body: {
      roomId: string;
      sessionId: string;
    }
  ) {
    const playlist = await this.playlistService.getPlaylist(playlistId);
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
    @Body()
    body: {
      ownerId: string;
      roomId: string;
      title: string;
      description?: string | null;
    }
  ) {
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
