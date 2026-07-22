import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  Query,
  Patch,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import {
  computeAssetId,
  createRoomRequestSchema,
  joinRoomByCodeRequestSchema,
  registerTrackRequestSchema,
  updateRoomMemberPermissionsRequestSchema,
  updateRoomRequestSchema,
  type Playlist,
  type RegisterTrackRequest
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { PlaylistService } from "../playlist/playlist.service";
import { RoomService } from "./room.service";
import { RoomRealtimePublisher } from "./services/room-realtime.publisher";

@Controller("v1/rooms")
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
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
    @Body() body: { visibility?: "private" | "public"; name?: string; description?: string | null; password?: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(createRoomRequestSchema, body);
    const metadata = {
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.password !== undefined ? { password: payload.password } : {})
    };
    const snapshot = Object.keys(metadata).length > 0
      ? await this.roomService.createRoom(userId, payload.visibility, metadata)
      : await this.roomService.createRoom(userId, payload.visibility);
    await this.roomRealtimePublisher.emitSnapshot(snapshot.room.id);
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
    for (const room of [...accessibleRooms, ...publicRooms]) deduped.set(room.room.id, room);
    return [...deduped.values()];
  }

  @Get("recent/active")
  async getRecentRoom(@Headers("x-session-token") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getRecentRoomSnapshotForSession(userId);
  }

  @Get("recent")
  async listRecentRooms(@Headers("x-session-token") sessionToken: string | undefined) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.listRecentRoomSnapshotsForSession(userId);
  }

  @Get(":roomId/recover")
  async recoverRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.roomService.getRecoverableRoomSnapshot(roomId, userId);
  }

  @Get(":roomId/sync")
  async syncRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Headers("x-room-revision") roomRevisionHeader?: string,
    @Query("since") sinceQuery?: string
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const sinceRevision = Number.parseInt(roomRevisionHeader ?? sinceQuery ?? "0", 10);
    return this.roomService.syncRoom(
      roomId,
      userId,
      Number.isFinite(sinceRevision) ? sinceRevision : 0
    );
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
    @Body() body: { joinCode: string; password?: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(joinRoomByCodeRequestSchema, body);
    const room = await this.roomService.findRoomByJoinCode(payload.joinCode);
    if (payload.password !== undefined) {
      await this.roomService.joinRoom(room.id, userId, payload.password);
    } else {
      await this.roomService.joinRoom(room.id, userId);
    }
    return this.roomRealtimePublisher.emitTopologySnapshot(room.id);
  }

  @Post(":roomId/join")
  async joinRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body?: { password?: string }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    if (body?.password !== undefined) {
      await this.roomService.joinRoom(roomId, userId, body.password);
    } else {
      await this.roomService.joinRoom(roomId, userId);
    }
    return this.roomRealtimePublisher.emitTopologySnapshot(roomId);
  }

  @Patch(":roomId")
  async updateRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      visibility: "private" | "public";
      name: string;
      description?: string | null;
      password?: string;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(updateRoomRequestSchema, body);
    await this.roomService.updateRoom(roomId, userId, payload);
    let playlists: Playlist[] = [];
    try {
      playlists = await this.playlistService.listPlaylistsForRoom(roomId);
    } catch {
      // Room metadata updates do not depend on optional playlist storage.
    }
    return this.roomRealtimePublisher.emitSnapshot(roomId, playlists);
  }

  @Patch(":roomId/members/:memberId/permissions")
  async updateMemberPermissions(
    @Param("roomId") roomId: string,
    @Param("memberId") memberId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: unknown
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(updateRoomMemberPermissionsRequestSchema, body);
    await this.roomService.updateMemberPermissions(roomId, userId, memberId, payload.permissions);
    return this.roomRealtimePublisher.emitTopologySnapshot(roomId);
  }

  @Delete(":roomId/members/:memberId")
  async removeMember(
    @Param("roomId") roomId: string,
    @Param("memberId") memberId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.roomService.removeMember(roomId, userId, memberId);
    const snapshot = await this.roomRealtimePublisher.emitTopologySnapshot(roomId);
    this.roomRealtimePublisher.emitMemberRemoved(roomId, memberId);
    return snapshot;
  }

  @Post(":roomId/leave")
  async leaveRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const room = await this.roomService.leaveRoom(roomId, userId);
    await this.roomRealtimePublisher.emitTopologySnapshot(roomId);
    return room;
  }

  @Delete(":roomId")
  async deleteRoom(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    await this.roomService.assertCanDeleteRoom(roomId, userId);
    let snapshot;
    try {
      snapshot = await this.roomService.getRoomSnapshot(
        roomId,
        await this.playlistService.listPlaylistsForRoom(roomId)
      );
    } catch {
      // Playlist data is auxiliary to room termination. Continue with the
      // authoritative room snapshot if playlist storage is unavailable.
      snapshot = await this.roomService.getRoomSnapshot(roomId, []);
    }
    const trackIds = snapshot.tracks.map((track) => track.id);
    const result = await this.roomService.deleteRoom(roomId, userId);
    await this.playlistService.deletePlaylistsForRoom(roomId).catch(() => undefined);
    this.roomRealtimePublisher.emitRoomDeleted(roomId, trackIds);
    this.roomRealtimePublisher.emitRoomMissing(roomId);
    return result;
  }

  @Post(":roomId/tracks")
  async registerTrack(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: RegisterTrackRequest
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(registerTrackRequestSchema, body);
    if (!payload.originalAsset || !payload.playbackAsset) {
      throw new BadRequestException("P2P v4 tracks require original and playback assets.");
    }
    if (
      payload.originalAsset.fileHash !== payload.fileHash ||
      payload.playbackAsset.sourceFileHash !== payload.fileHash
    ) {
      throw new BadRequestException("Track asset source hashes do not match the registered file.");
    }
    const { assetId: originalAssetId, ...originalManifest } = payload.originalAsset;
    const { assetId: playbackAssetId, ...playbackManifest } = payload.playbackAsset;
    const [expectedOriginalAssetId, expectedPlaybackAssetId] = await Promise.all([
      computeAssetId(originalManifest),
      computeAssetId(playbackManifest)
    ]);
    if (
      originalAssetId !== expectedOriginalAssetId ||
      playbackAssetId !== expectedPlaybackAssetId
    ) {
      throw new BadRequestException("Track asset ids do not match their canonical manifests.");
    }
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
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const getRoomSnapshot = this.roomService.getRoomSnapshot;
    const beforeSnapshot = typeof getRoomSnapshot === "function"
      ? await getRoomSnapshot.call(this.roomService, roomId, []).catch(() => null)
      : null;
    const deletedTrack = beforeSnapshot?.tracks.find((track) => track.id === trackId);
    const result = await this.roomService.removeTrack(roomId, userId, trackId);
    await this.playlistService.removeTrackFromPlaylists(trackId);
    const librarySnapshot = await this.roomRealtimePublisher.emitLibrarySnapshot(roomId);
    if (deletedTrack) {
      this.roomRealtimePublisher.emitTrackDeleted(roomId, {
        trackId,
        fileHash: deletedTrack.fileHash,
        originalAssetId: deletedTrack.originalAsset?.assetId ?? null,
        playbackAssetId: deletedTrack.playbackAsset?.assetId ?? null,
        roomRevision: librarySnapshot?.room.roomRevision ?? (beforeSnapshot?.room.roomRevision ?? 0) + 1,
        deletedAt: new Date().toISOString()
      });
    }
    return result;
  }
}
