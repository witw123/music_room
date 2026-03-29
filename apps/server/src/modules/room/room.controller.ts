import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { SignalingGateway } from "../signaling/signaling.gateway";
import { RoomService } from "./room.service";

@Controller("v1/rooms")
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly signalingGateway: SignalingGateway
  ) {}

  @Post()
  async createRoom(
    @Body()
    body: {
      sessionId: string;
      visibility?: "private" | "public";
    }
  ) {
    const snapshot = await this.roomService.createRoom(body.sessionId, body.visibility);
    this.signalingGateway.emitRoomSnapshot(snapshot.room.id, snapshot);
    return snapshot;
  }

  @Get()
  async listRooms(@Query("sessionId") sessionId?: string) {
    if (!sessionId) {
      return [];
    }

    return this.roomService.listRoomsForSession(sessionId);
  }

  @Get("recent/active")
  async getRecentRoom(@Query("sessionId") sessionId?: string) {
    if (!sessionId) {
      return null;
    }

    return this.roomService.getRecentRoomSnapshotForSession(sessionId);
  }

  @Get(":roomId/recover")
  async recoverRoom(
    @Param("roomId") roomId: string,
    @Query("sessionId") sessionId?: string
  ) {
    if (!sessionId) {
      return null;
    }

    return this.roomService.getRecoverableRoomSnapshot(roomId, sessionId);
  }

  @Get(":roomId")
  async getRoom(@Param("roomId") roomId: string) {
    return this.roomService.getRoomSnapshot(roomId, []);
  }

  @Post("join-by-code")
  async joinRoomByCode(
    @Body()
    body: {
      sessionId: string;
      joinCode: string;
    }
  ) {
    const room = await this.roomService.findRoomByJoinCode(body.joinCode);
    await this.roomService.joinRoom(room.id, body.sessionId);
    const snapshot = await this.roomService.getRoomSnapshot(room.id, []);
    this.signalingGateway.emitRoomSnapshot(room.id, snapshot);
    return snapshot;
  }

  @Post(":roomId/join")
  async joinRoom(
    @Param("roomId") roomId: string,
    @Body() body: { sessionId: string }
  ) {
    const room = await this.roomService.joinRoom(roomId, body.sessionId);
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    return room;
  }

  @Post(":roomId/leave")
  async leaveRoom(
    @Param("roomId") roomId: string,
    @Body() body: { sessionId: string }
  ) {
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
    const track = await this.roomService.registerTrack(roomId, body.sessionId, body);
    const snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    this.signalingGateway.emitRoomSnapshot(roomId, snapshot);
    return track;
  }
}
