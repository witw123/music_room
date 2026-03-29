import { OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  OnGatewayDisconnect,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException
} from "@nestjs/websockets";
import { ModuleRef } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type {
  PeerSignalMessage,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { RoomService } from "../room/room.service";

const roomSnapshotChannel = "music-room:room-snapshot";
const roomSnapshotMissingChannel = "music-room:room-snapshot-missing";
const defaultCorsOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

function getCorsOrigins() {
  const configuredOrigins = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configuredOrigins?.length ? configuredOrigins : defaultCorsOrigins;
}

@WebSocketGateway({
  namespace: "/ws",
  path: "/ws/socket.io",
  cors: { origin: getCorsOrigins(), credentials: true }
})
export class SignalingGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly instanceId = randomUUID();
  private unsubscribeRoomSnapshots: (() => Promise<void> | void) | null = null;
  private readonly availabilityByRoom = new Map<
    string,
    Map<string, TrackAvailabilityAnnouncement>
  >();

  constructor(
    private readonly redisService: RedisService,
    private readonly moduleRef: ModuleRef,
    private readonly authService: AuthService
  ) {}

  @WebSocketServer()
  server!: Server;

  emitRoomSnapshot(roomId: string, snapshot: RoomSnapshot) {
    this.server.to(roomId).emit("room.snapshot", snapshot);
    void this.redisService.publish(roomSnapshotChannel, {
      sourceId: this.instanceId,
      roomId,
      snapshot
    });
  }

  emitRoomMissing(roomId: string) {
    this.availabilityByRoom.delete(roomId);
    this.server.to(roomId).emit("room.snapshot.missing", { roomId });
    void this.redisService.publish(roomSnapshotMissingChannel, {
      sourceId: this.instanceId,
      roomId
    });
  }

  afterInit() {
    void this.redisService
      .subscribe(roomSnapshotChannel, (payload) => {
        const message = payload as {
          sourceId?: string;
          roomId?: string;
          snapshot?: RoomSnapshot;
        };

        if (
          !message.roomId ||
          !message.snapshot ||
          !message.sourceId ||
          message.sourceId === this.instanceId
        ) {
          return;
        }

        this.server.to(message.roomId).emit("room.snapshot", message.snapshot);
      })
      .then((unsubscribe) => {
        this.unsubscribeRoomSnapshots = unsubscribe;
      });

    void this.redisService.subscribe(roomSnapshotMissingChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
      };

      if (!message.roomId || !message.sourceId || message.sourceId === this.instanceId) {
        return;
      }

      this.availabilityByRoom.delete(message.roomId);
      this.server.to(message.roomId).emit("room.snapshot.missing", { roomId: message.roomId });
    });
  }

  onModuleDestroy() {
    void this.unsubscribeRoomSnapshots?.();
  }

  @SubscribeMessage("peer.signal")
  handleSignal(@ConnectedSocket() client: Socket, @MessageBody() payload: PeerSignalMessage) {
    this.assertRealtimeClient(client, payload.roomId);

    if (client.data.peerId !== payload.fromPeerId) {
      throw new WsException("Peer mismatch.");
    }

    this.server.to(payload.roomId).emit("peer.signal", payload);
    return payload;
  }

  @SubscribeMessage("piece.availability")
  handlePieceAvailability(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TrackAvailabilityAnnouncement
  ) {
    this.assertRealtimeClient(client, payload.roomId);

    if (client.data.peerId !== payload.ownerPeerId) {
      throw new WsException("Peer mismatch.");
    }

    const roomAvailability = this.availabilityByRoom.get(payload.roomId) ?? new Map();
    roomAvailability.set(`${payload.trackId}:${payload.ownerPeerId}`, payload);
    this.availabilityByRoom.set(payload.roomId, roomAvailability);
    client.to(payload.roomId).emit("piece.availability", payload);
    return payload;
  }

  @SubscribeMessage("room.subscribe")
  async handleRoomSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; sessionId?: string; peerId?: string }
  ) {
    if (!payload.sessionId || !payload.peerId) {
      throw new WsException("Missing session identity.");
    }

    const sessionToken = this.getSocketSessionToken(client);
    try {
      await this.authService.assertSessionToken(payload.sessionId, sessionToken);
    } catch (error) {
      throw new WsException(error instanceof Error ? error.message : "Unauthorized.");
    }

    client.data ??= {};
    client.data.roomId = payload.roomId;
    client.data.sessionId = payload.sessionId;
    client.data.peerId = payload.peerId;
    client.data.isRealtimeAuthenticated = true;
    client.join(payload.roomId);

    try {
      await this.updatePeerPresence(payload.roomId, payload.sessionId, payload.peerId);
      await this.emitLatestSnapshot(payload.roomId, payload.sessionId, client);
      this.emitAvailabilitySnapshot(payload.roomId, client);
    } catch (error) {
      client.leave(payload.roomId);
      client.data.roomId = undefined;
      client.data.sessionId = undefined;
      client.data.peerId = undefined;
      client.data.isRealtimeAuthenticated = false;
      throw new WsException(error instanceof Error ? error.message : "Unauthorized.");
    }

    return { ok: true };
  }

  @SubscribeMessage("room.unsubscribe")
  handleRoomUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string }
  ) {
    client.leave(payload.roomId);
    if (client.data.sessionId) {
      void this.updatePeerPresence(payload.roomId, client.data.sessionId, null);
    }
    if (client.data.peerId) {
      this.clearPeerAvailability(payload.roomId, client.data.peerId);
    }
    client.data.roomId = undefined;
    client.data.peerId = undefined;
    client.data.isRealtimeAuthenticated = false;
    return { ok: true };
  }

  handleDisconnect(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;

    if (roomId && sessionId) {
      void this.updatePeerPresence(roomId, sessionId, null);
    }
    if (roomId && client.data.peerId) {
      this.clearPeerAvailability(roomId, client.data.peerId as string);
    }
  }

  private async emitLatestSnapshot(roomId: string, sessionId: string, client: Socket) {
    const roomService = this.moduleRef.get(RoomService, { strict: false });

    if (!roomService) {
      return;
    }

    try {
      client.emit(
        "room.snapshot",
        await roomService.getAccessibleRoomSnapshot(roomId, [], sessionId)
      );
    } catch {
      client.emit("room.snapshot.missing", { roomId });
    }
  }

  private async updatePeerPresence(
    roomId: string,
    sessionId: string,
    peerId: string | null
  ) {
    const roomService = this.moduleRef.get(RoomService, { strict: false });

    if (!roomService) {
      return;
    }

    try {
      await roomService.updatePeerPresence(roomId, sessionId, peerId);
      this.emitRoomSnapshot(roomId, await roomService.getRoomSnapshot(roomId, []));
    } catch {
      clientSafeNoop();
    }
  }

  private getSocketSessionToken(client: Socket) {
    const authToken =
      typeof client.handshake.auth?.sessionToken === "string"
        ? client.handshake.auth.sessionToken
        : undefined;

    if (authToken) {
      return authToken;
    }

    const headerToken = client.handshake.headers["x-session-token"];
    return typeof headerToken === "string" ? headerToken : undefined;
  }

  private assertRealtimeClient(client: Socket, roomId: string) {
    if (!client.data.isRealtimeAuthenticated || client.data.roomId !== roomId) {
      throw new WsException("Unauthorized realtime request.");
    }
  }

  private emitAvailabilitySnapshot(roomId: string, client: Socket) {
    const roomAvailability = this.availabilityByRoom.get(roomId);
    if (!roomAvailability) {
      return;
    }

    for (const announcement of roomAvailability.values()) {
      client.emit("piece.availability", announcement);
    }
  }

  private clearPeerAvailability(roomId: string, peerId: string) {
    const roomAvailability = this.availabilityByRoom.get(roomId);
    if (!roomAvailability) {
      return;
    }

    for (const [key, announcement] of roomAvailability.entries()) {
      if (announcement.ownerPeerId === peerId) {
        roomAvailability.delete(key);
      }
    }

    if (roomAvailability.size === 0) {
      this.availabilityByRoom.delete(roomId);
    }
  }
}

function clientSafeNoop() {}
