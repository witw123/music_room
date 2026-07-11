import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException
} from "@nestjs/common";
import {
  createRoomRequestSchema,
  joinRoomByCodeRequestSchema,
  registerTrackRequestSchema
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { PlaylistService } from "../playlist/playlist.service";
import { RoomService } from "./room.service";
import { RoomRealtimePublisher } from "./services/room-realtime.publisher";
import { getSessionTokenFromCookie } from "../../common/auth/session-cookie";

@Controller("v1/rooms")
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService,
    private readonly playlistService: PlaylistService
  ) {}

  private async getCurrentUserId(cookieHeader?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(
        getSessionTokenFromCookie(cookieHeader)
      );
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Post()
  async createRoom(
    @Headers("cookie") sessionToken: string | undefined,
    @Body() body: { visibility?: "private" | "public" }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(createRoomRequestSchema, body);
    const snapshot = await this.roomService.createRoom(userId, payload.visibility);
    await this.roomRealtimePublisher.emitSnapshot(snapshot.room.id);
    return snapshot;
  }

  @Get()
  async listRooms(
    @Headers("cookie") sessionToken: string | undefined,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
    return this.roomService.listRoomSummariesForSession(userId, {
      cursor,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined
    });
  }

  @Get("recent/active")
  async getRecentRoom(@Headers("cookie") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getRecentRoomSnapshotForSession(userId);
  }

  @Get(":roomId/recover")
  async recoverRoom(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getRecoverableRoomSnapshot(roomId, userId);
  }

  @Get(":roomId")
  async getRoom(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getAccessibleRoomSnapshot(roomId, [], userId);
  }

  @Post("join-by-code")
  async joinRoomByCode(
    @Headers("cookie") sessionToken: string | undefined,
    @Body() body: { joinCode: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(joinRoomByCodeRequestSchema, body);
    const room = await this.roomService.findRoomByJoinCode(payload.joinCode);
    await this.roomService.joinRoom(room.id, userId);
    return this.roomRealtimePublisher.emitTopologySnapshot(room.id);
  }

  @Post(":roomId/leave")
  async leaveRoom(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const room = await this.roomService.leaveRoom(roomId, userId);
    await this.roomRealtimePublisher.emitTopologySnapshot(roomId);
    return room;
  }

  @Delete(":roomId")
  async deleteRoom(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.roomService.assertCanDeleteRoom(roomId, userId);
    const snapshot = await this.roomService.getRoomSnapshot(
      roomId,
      await this.playlistService.listPlaylistsForRoom(roomId)
    );
    const trackIds = snapshot.tracks.map((track) => track.id);
    const result = await this.roomService.deleteRoom(roomId, userId);
    await this.playlistService.deletePlaylistsForRoom(roomId);
    this.roomRealtimePublisher.emitRoomDeleted(roomId, trackIds);
    this.roomRealtimePublisher.emitRoomMissing(roomId);
    return result;
  }

  @Post(":roomId/tracks")
  async registerTrack(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined,
    @Body()
    body: {
      id?: string;
      title: string;
      artist: string;
      album: string | null;
      durationMs: number;
      bitrate: number | null;
      sizeBytes?: number | null;
      codec?: string | null;
      mimeType?: string | null;
      fileHash: string;
      artworkUrl: string | null;
      ownerSessionId?: string;
      ownerNickname?: string;
      sourceType: "local_upload";
      pieceManifest?: {
        totalChunks: number;
        chunkSize: number;
        pieceMimeType: string;
      } | null;
      relayManifest?: {
        totalChunks: number;
        chunkSize: number;
        pieceMimeType: string;
      } | null;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(registerTrackRequestSchema, body);
    const track = await this.roomService.registerTrack(roomId, userId, {
      ...payload,
      ownerSessionId: payload.ownerSessionId ?? userId,
      ownerNickname: payload.ownerNickname ?? ""
    });
    await this.roomRealtimePublisher.emitLibrarySnapshot(roomId);
    return track;
  }

  @Delete(":roomId/tracks/:trackId")
  async deleteTrack(
    @Param("roomId") roomId: string,
    @Param("trackId") trackId: string,
    @Headers("cookie") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const result = await this.roomService.removeTrack(roomId, userId, trackId);
    await this.playlistService.removeTrackFromPlaylists(trackId);
    await this.roomRealtimePublisher.emitLibrarySnapshot(roomId);
    return result;
  }
}
