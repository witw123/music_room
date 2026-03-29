import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomService } from "./room.service";

@Controller("v1/rooms")
export class RoomController {
  constructor(
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

  @Post()
  async createRoom(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      sessionId: string;
      visibility?: "private" | "public";
    }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const snapshot = await this.roomService.createRoom(body.sessionId, body.visibility);
    this.signalingGateway.emitRoomSnapshot(snapshot.room.id, snapshot);
    return snapshot;
  }

  @Get()
  async listRooms(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Query("sessionId") sessionId?: string
  ) {
    if (!sessionId) {
      return [];
    }

    await this.assertSession(sessionId, sessionToken);
    return this.roomService.listRoomsForSession(sessionId);
  }

  @Get("recent/active")
  async getRecentRoom(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Query("sessionId") sessionId?: string
  ) {
    if (!sessionId) {
      return null;
    }

    await this.assertSession(sessionId, sessionToken);
    return this.roomService.getRecentRoomSnapshotForSession(sessionId);
  }

  @Get(":roomId/recover")
  async recoverRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Query("sessionId") sessionId?: string
  ) {
    if (!sessionId) {
      return null;
    }

    await this.assertSession(sessionId, sessionToken);
    return this.roomService.getRecoverableRoomSnapshot(roomId, sessionId);
  }

  @Get(":roomId")
  async getRoom(@Param("roomId") roomId: string) {
    return this.roomService.getRoomSnapshot(roomId, []);
  }

  @Post("join-by-code")
  async joinRoomByCode(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      sessionId: string;
      joinCode: string;
    }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const room = await this.roomService.findRoomByJoinCode(body.joinCode);
    await this.roomService.joinRoom(room.id, body.sessionId);
    const snapshot = await this.roomService.getRoomSnapshot(room.id, []);
    this.signalingGateway.emitRoomSnapshot(room.id, snapshot);
    return snapshot;
  }

  @Post(":roomId/join")
  async joinRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { sessionId: string }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const room = await this.roomService.joinRoom(roomId, body.sessionId);
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    return room;
  }

  @Post(":roomId/leave")
  async leaveRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: { sessionId: string }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const room = await this.roomService.leaveRoom(roomId, body.sessionId);
    if (room.members.length > 0) {
      const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
      this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    }
    return room;
  }

  @Post(":roomId/tracks")
  async registerTrack(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      sessionId: string;
      id?: string;
      title: string;
      artist: string;
      album: string | null;
      durationMs: number;
      bitrate: number | null;
      fileHash: string;
      artworkUrl: string | null;
      sourceType: "local_upload";
    }
  ) {
    await this.assertSession(body.sessionId, sessionToken);
    const track = await this.roomService.registerTrack(roomId, body.sessionId, body);
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    return track;
  }
}
