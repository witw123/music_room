import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { PlaylistService } from "../playlist/playlist.service";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomService } from "./room.service";

@Controller("v1/rooms")
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway,
    private readonly authService: AuthService,
    private readonly playlistService: PlaylistService
  ) {}

  private async getCurrentUserId(sessionToken?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Post()
  async createRoom(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { visibility?: "private" | "public" }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const snapshot = await this.roomService.createRoom(userId, body.visibility);
    this.signalingGateway.emitRoomSnapshot(snapshot.room.id, snapshot);
    return snapshot;
  }

  @Get()
  async listRooms(@Headers("x-session-token") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    const [accessibleRooms, publicRooms] = await Promise.all([
      this.roomService.listRoomsForSession(userId),
      this.roomService.listPublicRooms()
    ]);

    const deduped = new Map<string, (typeof accessibleRooms)[number]>();
    for (const room of [...accessibleRooms, ...publicRooms]) {
      deduped.set(room.room.id, room);
    }

    return [...deduped.values()];
  }

  @Get("recent/active")
  async getRecentRoom(@Headers("x-session-token") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getRecentRoomSnapshotForSession(userId);
  }

  @Get(":roomId/recover")
  async recoverRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getRecoverableRoomSnapshot(roomId, userId);
  }

  @Get(":roomId")
  async getRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getAccessibleRoomSnapshot(roomId, [], userId);
  }

  @Post("join-by-code")
  async joinRoomByCode(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { joinCode: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const room = await this.roomService.findRoomByJoinCode(body.joinCode);
    await this.roomService.joinRoom(room.id, userId);
    const snapshot = await this.roomService.getRoomSnapshot(room.id, []);
    this.signalingGateway.emitRoomSnapshot(room.id, snapshot);
    return snapshot;
  }

  @Post(":roomId/join")
  async joinRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const room = await this.roomService.joinRoom(roomId, userId);
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    return room;
  }

  @Post(":roomId/leave")
  async leaveRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const room = await this.roomService.leaveRoom(roomId, userId);
    if (room.members.length > 0) {
      const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
      this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    }
    return room;
  }

  @Delete(":roomId")
  async deleteRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const snapshot = await this.roomService.getRoomSnapshot(
      roomId,
      await this.playlistService.listPlaylistsForRoom(roomId)
    );
    const trackIds = snapshot.tracks.map((track) => track.id);
    await this.playlistService.deletePlaylistsForRoom(roomId);
    const result = await this.roomService.deleteRoom(roomId, userId);
    this.signalingGateway.emitRoomDeleted(roomId, trackIds);
    this.signalingGateway.emitRoomMissing(roomId);
    return result;
  }

  @Post(":roomId/tracks")
  async registerTrack(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
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
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const track = await this.roomService.registerTrack(roomId, userId, {
      ...body,
      ownerSessionId: body.ownerSessionId ?? userId,
      ownerNickname: body.ownerNickname ?? ""
    });
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitLibraryPatch(roomId, {
      tracks: snapshot.tracks,
      queue: snapshot.queue,
      playback: snapshot.room.playback
    });
    return track;
  }

  @Delete(":roomId/tracks/:trackId")
  async deleteTrack(
    @Param("roomId") roomId: string,
    @Param("trackId") trackId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const result = await this.roomService.removeTrack(roomId, userId, trackId);
    await this.playlistService.removeTrackFromPlaylists(trackId);
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitLibraryPatch(roomId, {
      tracks: snapshot.tracks,
      queue: snapshot.queue,
      playback: snapshot.room.playback
    });
    return result;
  }
}
