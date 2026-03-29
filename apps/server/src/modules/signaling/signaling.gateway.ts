import {
  ConnectedSocket,
  OnGatewayDisconnect,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
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
import { RoomService } from "../room/room.service";

const roomSnapshotChannel = "music-room:room-snapshot";

@WebSocketGateway({
  namespace: "/ws",
  cors: { origin: "*" }
})
export class SignalingGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly instanceId = randomUUID();

  constructor(
    private readonly redisService: RedisService,
    private readonly moduleRef: ModuleRef
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

  afterInit() {
    void this.redisService.subscribe(roomSnapshotChannel, (payload) => {
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
    });
  }

  @SubscribeMessage("peer.signal")
  handleSignal(@MessageBody() payload: PeerSignalMessage) {
    this.server.to(payload.roomId).emit("peer.signal", payload);
    return payload;
  }

  @SubscribeMessage("piece.availability")
  handlePieceAvailability(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TrackAvailabilityAnnouncement
  ) {
    client.to(payload.roomId).emit("piece.availability", payload);
    return payload;
  }

  @SubscribeMessage("room.subscribe")
  handleRoomSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; sessionId?: string; peerId?: string }
  ) {
    client.data ??= {};
    client.data.roomId = payload.roomId;
    client.data.sessionId = payload.sessionId;
    client.data.peerId = payload.peerId;
    client.join(payload.roomId);
    if (payload.sessionId && payload.peerId) {
      void this.updatePeerPresence(payload.roomId, payload.sessionId, payload.peerId);
    }
    void this.emitLatestSnapshot(payload.roomId, client);
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
    return { ok: true };
  }

  handleDisconnect(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;

    if (roomId && sessionId) {
      void this.updatePeerPresence(roomId, sessionId, null);
    }
  }

  private async emitLatestSnapshot(roomId: string, client: Socket) {
    const roomService = this.moduleRef.get(RoomService, { strict: false });

    if (!roomService) {
      return;
    }

    try {
      client.emit("room.snapshot", await roomService.getRoomSnapshot(roomId, []));
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
}

function clientSafeNoop() {}
