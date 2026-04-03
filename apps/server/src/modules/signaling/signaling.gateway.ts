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
  RoomLibraryPatchPayload,
  RoomPlaybackPatchPayload,
  RoomPresencePatchPayload,
  RoomQueuePatchPayload,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { RedisService } from "../../infra/redis/redis.service";
import { getCorsOrigins } from "../../common/cors/get-cors-origins";
import { AuthService } from "../auth/auth.service";
import { RoomService } from "../room/room.service";

const roomSnapshotChannel = "music-room:room-snapshot";
const roomSnapshotMissingChannel = "music-room:room-snapshot-missing";
const roomDeletedChannel = "music-room:room-deleted";
const roomPlaybackPatchChannel = "music-room:room-playback-patch";
const roomQueuePatchChannel = "music-room:room-queue-patch";
const roomPresencePatchChannel = "music-room:room-presence-patch";
const roomLibraryPatchChannel = "music-room:room-library-patch";
const peerSignalChannel = "music-room:peer-signal";
const pieceAvailabilityChannel = "music-room:piece-availability";

@WebSocketGateway({
  path: "/ws/socket.io",
  cors: { origin: getCorsOrigins(), credentials: true }
})
export class SignalingGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly instanceId = randomUUID();
  private readonly disconnectGracePeriodMs = 25_000;
  private unsubscribeRoomSnapshots: (() => Promise<void> | void) | null = null;
  private sequence = 0;
  private readonly pendingDisconnectCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly availabilityByRoom = new Map<
    string,
    Map<string, TrackAvailabilityAnnouncement>
  >();
  private readonly peerSocketsByRoom = new Map<string, Map<string, Set<string>>>();
  private readonly activeSessionsByRoom = new Map<
    string,
    Map<string, { socketId: string; peerId: string }>
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
    this.peerSocketsByRoom.delete(roomId);
    this.activeSessionsByRoom.delete(roomId);
    this.server.to(roomId).emit("room.snapshot.missing", { roomId });
    void this.redisService.publish(roomSnapshotMissingChannel, {
      sourceId: this.instanceId,
      roomId
    });
  }

  emitRoomDeleted(roomId: string, trackIds: string[]) {
    this.availabilityByRoom.delete(roomId);
    this.peerSocketsByRoom.delete(roomId);
    this.activeSessionsByRoom.delete(roomId);
    this.server.to(roomId).emit("room.deleted", { roomId, trackIds });
    void this.redisService.publish(roomDeletedChannel, {
      sourceId: this.instanceId,
      roomId,
      trackIds
    });
  }

  emitPlaybackPatch(roomId: string, payload: Omit<RoomPlaybackPatchPayload, "roomId" | "updatedAt">) {
    const message: RoomPlaybackPatchPayload = {
      roomId,
      playback: payload.playback,
      updatedAt: new Date().toISOString()
    };
    this.server.to(roomId).emit("room.playback.patch", message);
    void this.redisService.publish(roomPlaybackPatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitQueuePatch(roomId: string, payload: Omit<RoomQueuePatchPayload, "roomId" | "updatedAt">) {
    const message: RoomQueuePatchPayload = {
      roomId,
      queue: payload.queue,
      playback: payload.playback,
      updatedAt: new Date().toISOString()
    };
    this.server.to(roomId).emit("room.queue.patch", message);
    void this.redisService.publish(roomQueuePatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitPresencePatch(
    roomId: string,
    payload: Omit<RoomPresencePatchPayload, "roomId" | "updatedAt">
  ) {
    const message: RoomPresencePatchPayload = {
      roomId,
      members: payload.members,
      playback: payload.playback,
      presenceRevision: payload.presenceRevision,
      updatedAt: new Date().toISOString()
    };
    this.server.to(roomId).emit("room.presence.patch", message);
    void this.redisService.publish(roomPresencePatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
    });
  }

  emitLibraryPatch(roomId: string, payload: Omit<RoomLibraryPatchPayload, "roomId" | "updatedAt">) {
    const message: RoomLibraryPatchPayload = {
      roomId,
      tracks: payload.tracks,
      queue: payload.queue,
      playback: payload.playback,
      updatedAt: new Date().toISOString()
    };
    this.server.to(roomId).emit("room.library.patch", message);
    void this.redisService.publish(roomLibraryPatchChannel, {
      sourceId: this.instanceId,
      roomId,
      payload: message
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
      this.peerSocketsByRoom.delete(message.roomId);
      this.activeSessionsByRoom.delete(message.roomId);
      this.server.to(message.roomId).emit("room.snapshot.missing", { roomId: message.roomId });
    });

    void this.redisService.subscribe(roomDeletedChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        trackIds?: string[];
      };

      if (!message.roomId || !message.sourceId || message.sourceId === this.instanceId) {
        return;
      }

      this.availabilityByRoom.delete(message.roomId);
      this.peerSocketsByRoom.delete(message.roomId);
      this.activeSessionsByRoom.delete(message.roomId);
      this.server
        .to(message.roomId)
        .emit("room.deleted", { roomId: message.roomId, trackIds: message.trackIds ?? [] });
    });

    void this.redisService.subscribe(roomPlaybackPatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomPlaybackPatchPayload;
      };

      if (
        !message.roomId ||
        !message.payload ||
        !message.sourceId ||
        message.sourceId === this.instanceId
      ) {
        return;
      }

      this.server.to(message.roomId).emit("room.playback.patch", message.payload);
    });

    void this.redisService.subscribe(roomQueuePatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomQueuePatchPayload;
      };

      if (
        !message.roomId ||
        !message.payload ||
        !message.sourceId ||
        message.sourceId === this.instanceId
      ) {
        return;
      }

      this.server.to(message.roomId).emit("room.queue.patch", message.payload);
    });

    void this.redisService.subscribe(roomPresencePatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomPresencePatchPayload;
      };

      if (
        !message.roomId ||
        !message.payload ||
        !message.sourceId ||
        message.sourceId === this.instanceId
      ) {
        return;
      }

      this.server.to(message.roomId).emit("room.presence.patch", message.payload);
    });

    void this.redisService.subscribe(roomLibraryPatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomLibraryPatchPayload;
      };

      if (
        !message.roomId ||
        !message.payload ||
        !message.sourceId ||
        message.sourceId === this.instanceId
      ) {
        return;
      }

      this.server.to(message.roomId).emit("room.library.patch", message.payload);
    });

    void this.redisService.subscribe(peerSignalChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: PeerSignalMessage;
      };

      if (
        !message.roomId ||
        !message.payload ||
        !message.sourceId ||
        message.sourceId === this.instanceId
      ) {
        return;
      }

      this.emitPeerSignalToPeer(message.roomId, message.payload.toPeerId, message.payload);
    });

    void this.redisService.subscribe(pieceAvailabilityChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: TrackAvailabilityAnnouncement;
      };

      if (
        !message.roomId ||
        !message.payload ||
        !message.sourceId ||
        message.sourceId === this.instanceId
      ) {
        return;
      }

      const roomAvailability = this.availabilityByRoom.get(message.roomId) ?? new Map();
      roomAvailability.set(
        `${message.payload.trackId}:${message.payload.ownerPeerId}`,
        message.payload
      );
      this.availabilityByRoom.set(message.roomId, roomAvailability);
      this.server.to(message.roomId).emit("piece.availability", message.payload);
    });
  }

  onModuleDestroy() {
    void this.unsubscribeRoomSnapshots?.();
    for (const timer of this.pendingDisconnectCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingDisconnectCleanupTimers.clear();
    this.peerSocketsByRoom.clear();
    this.activeSessionsByRoom.clear();
  }

  @SubscribeMessage("peer.signal")
  async handleSignal(@ConnectedSocket() client: Socket, @MessageBody() payload: PeerSignalMessage) {
    this.assertRealtimeClient(client, payload.roomId);
    this.assertRealtimeAvailable();

    if (client.data.peerId !== payload.fromPeerId) {
      throw new WsException("Peer mismatch.");
    }

    const nextPayload = {
      ...payload,
      sequence: (payload as PeerSignalMessage & { sequence?: number }).sequence ?? this.nextSequence()
    } as PeerSignalMessage;

    this.emitPeerSignalToPeer(payload.roomId, nextPayload.toPeerId, nextPayload);
    await this.redisService.publish(peerSignalChannel, {
      sourceId: this.instanceId,
      roomId: payload.roomId,
      payload: nextPayload
    });
    return nextPayload;
  }

  @SubscribeMessage("piece.availability")
  async handlePieceAvailability(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TrackAvailabilityAnnouncement
  ) {
    this.assertRealtimeClient(client, payload.roomId);
    this.assertRealtimeAvailable();

    if (client.data.peerId !== payload.ownerPeerId) {
      throw new WsException("Peer mismatch.");
    }

    const roomAvailability = this.availabilityByRoom.get(payload.roomId) ?? new Map();
    roomAvailability.set(`${payload.trackId}:${payload.ownerPeerId}`, payload);
    this.availabilityByRoom.set(payload.roomId, roomAvailability);
    client.to(payload.roomId).emit("piece.availability", payload);
    await this.redisService.publish(pieceAvailabilityChannel, {
      sourceId: this.instanceId,
      roomId: payload.roomId,
      payload
    });
    return payload;
  }

  @SubscribeMessage("room.chat")
  handleRoomChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; senderId: string; senderName: string; content: string; timestamp?: number }
  ) {
    this.assertRealtimeClient(client, payload.roomId);
    
    // Broadcast chat message to everyone in the room except sender (or including sender)?
    // Usually we broadcast to all in room except sender, and sender updates their own state, 
    // or just broadcast to everyone. Socket.io's `client.to(room).emit` broadcasts to everyone ELSE.
    client.to(payload.roomId).emit("room.chat", payload);
    return payload;
  }

  @SubscribeMessage("room.subscribe")
  async handleRoomSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; sessionId?: string; peerId?: string }
  ) {
    this.assertRealtimeAvailable();

    if (!payload.sessionId || !payload.peerId) {
      throw new WsException("Missing session identity.");
    }

    const sessionToken = this.getSocketSessionToken(client);
    try {
      await this.authService.assertSessionToken(payload.sessionId, sessionToken);
    } catch (error) {
      throw new WsException(error instanceof Error ? error.message : "Unauthorized.");
    }

    this.unregisterPeerSocket(
      client.data.roomId as string | undefined,
      client.data.peerId as string | undefined,
      client.id
    );
    this.unregisterSessionSocket(
      client.data.roomId as string | undefined,
      client.data.sessionId as string | undefined,
      client.id
    );
    client.data ??= {};

    await this.replaceExistingRoomSession(payload.roomId, payload.sessionId, client.id);

    client.data.roomId = payload.roomId;
    client.data.sessionId = payload.sessionId;
    client.data.peerId = payload.peerId;
    client.data.isRealtimeAuthenticated = true;
    client.join(payload.roomId);
    this.registerPeerSocket(payload.roomId, payload.peerId, client.id);
    this.registerSessionSocket(payload.roomId, payload.sessionId, payload.peerId, client.id);

    try {
      this.cancelPendingDisconnectCleanup(payload.roomId, payload.sessionId);
      await this.updatePeerPresence(payload.roomId, payload.sessionId, payload.peerId, "online");
      await this.emitLatestSnapshot(payload.roomId, payload.sessionId, client);
      this.emitAvailabilitySnapshot(payload.roomId, client);
    } catch (error) {
      this.unregisterPeerSocket(payload.roomId, payload.peerId, client.id);
      this.unregisterSessionSocket(payload.roomId, payload.sessionId, client.id);
      client.leave(payload.roomId);
      client.data.roomId = undefined;
      client.data.sessionId = undefined;
      client.data.peerId = undefined;
      client.data.isRealtimeAuthenticated = false;
      throw new WsException(error instanceof Error ? error.message : "Unauthorized.");
    }

    return { ok: true };
  }

  @SubscribeMessage("room.presence")
  async handleRoomPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; sessionId: string; peerId: string }
  ) {
    this.assertRealtimeClient(client, payload.roomId);
    this.assertRealtimeAvailable();

    if (client.data.sessionId !== payload.sessionId || client.data.peerId !== payload.peerId) {
      throw new WsException("Presence mismatch.");
    }

    const roomService = this.moduleRef.get(RoomService, { strict: false });
    if (!roomService) {
      return { ok: true };
    }

    await roomService.touchRealtimePresence(payload.roomId, payload.sessionId, payload.peerId);
    return { ok: true };
  }

  @SubscribeMessage("room.unsubscribe")
  handleRoomUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string }
  ) {
    this.unregisterPeerSocket(payload.roomId, client.data.peerId as string | undefined, client.id);
    this.unregisterSessionSocket(payload.roomId, client.data.sessionId as string | undefined, client.id);
    if (client.data.sessionId) {
      this.cancelPendingDisconnectCleanup(payload.roomId, client.data.sessionId as string);
    }
    client.leave(payload.roomId);
    if (client.data.sessionId) {
      void this.updatePeerPresence(
        payload.roomId,
        client.data.sessionId,
        null,
        "offline"
      );
    }
    if (client.data.peerId) {
      this.clearPeerAvailability(payload.roomId, client.data.peerId);
    }
    client.data.roomId = undefined;
    client.data.sessionId = undefined;
    client.data.peerId = undefined;
    client.data.isRealtimeAuthenticated = false;
    return { ok: true };
  }

  handleDisconnect(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    const peerId = client.data.peerId as string | undefined;

    this.unregisterPeerSocket(roomId, peerId, client.id);
    this.unregisterSessionSocket(roomId, sessionId, client.id);
    if (roomId && sessionId) {
      void this.updatePeerPresence(roomId, sessionId, null, "reconnecting");
      this.scheduleDisconnectCleanup(roomId, sessionId, peerId);
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
    peerId: string | null,
    presenceState: "online" | "reconnecting" | "offline"
  ) {
    const roomService = this.moduleRef.get(RoomService, { strict: false });

    if (!roomService) {
      return;
    }

    try {
      await roomService.updatePeerPresence(roomId, sessionId, peerId, presenceState);
      const snapshot = await roomService.getRoomSnapshot(roomId, []);
      this.emitPresencePatch(roomId, {
        members: snapshot.room.members,
        playback: snapshot.room.playback,
        presenceRevision: snapshot.room.presenceRevision
      });
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

  private assertRealtimeAvailable() {
    if (
      typeof this.redisService.isAvailable === "function" &&
      !this.redisService.isAvailable()
    ) {
      throw new WsException("Realtime sync unavailable.");
    }
  }

  private nextSequence() {
    this.sequence += 1;
    return this.sequence;
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

  private emitPeerSignalToPeer(roomId: string, peerId: string, payload: PeerSignalMessage) {
    const socketIds = this.peerSocketsByRoom.get(roomId)?.get(peerId);
    if (!socketIds?.size) {
      return;
    }

    for (const socketId of socketIds) {
      this.server.to(socketId).emit("peer.signal", payload);
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

  private scheduleDisconnectCleanup(roomId: string, sessionId: string, peerId?: string) {
    this.cancelPendingDisconnectCleanup(roomId, sessionId);
    const cleanupKey = this.disconnectCleanupKey(roomId, sessionId);
    const timeoutId = setTimeout(() => {
      this.pendingDisconnectCleanupTimers.delete(cleanupKey);
      void this.finalizePeerDisconnect(roomId, sessionId, peerId);
    }, this.disconnectGracePeriodMs);
    this.pendingDisconnectCleanupTimers.set(cleanupKey, timeoutId);
  }

  private cancelPendingDisconnectCleanup(roomId: string, sessionId: string) {
    const cleanupKey = this.disconnectCleanupKey(roomId, sessionId);
    const timeoutId = this.pendingDisconnectCleanupTimers.get(cleanupKey);
    if (!timeoutId) {
      return;
    }

    clearTimeout(timeoutId);
    this.pendingDisconnectCleanupTimers.delete(cleanupKey);
  }

  private async finalizePeerDisconnect(roomId: string, sessionId: string, peerId?: string) {
    await this.updatePeerPresence(roomId, sessionId, null, "offline");
    if (peerId) {
      this.clearPeerAvailability(roomId, peerId);
    }
  }

  private disconnectCleanupKey(roomId: string, sessionId: string) {
    return `${roomId}:${sessionId}`;
  }

  private registerPeerSocket(roomId?: string, peerId?: string, socketId?: string) {
    if (!roomId || !peerId || !socketId) {
      return;
    }

    const roomPeers = this.peerSocketsByRoom.get(roomId) ?? new Map<string, Set<string>>();
    const peerSockets = roomPeers.get(peerId) ?? new Set<string>();
    peerSockets.add(socketId);
    roomPeers.set(peerId, peerSockets);
    this.peerSocketsByRoom.set(roomId, roomPeers);
  }

  private unregisterPeerSocket(roomId?: string, peerId?: string, socketId?: string) {
    if (!roomId || !peerId || !socketId) {
      return;
    }

    const roomPeers = this.peerSocketsByRoom.get(roomId);
    if (!roomPeers) {
      return;
    }

    const peerSockets = roomPeers.get(peerId);
    if (!peerSockets) {
      return;
    }

    peerSockets.delete(socketId);
    if (peerSockets.size === 0) {
      roomPeers.delete(peerId);
    }
    if (roomPeers.size === 0) {
      this.peerSocketsByRoom.delete(roomId);
    }
  }

  private registerSessionSocket(
    roomId?: string,
    sessionId?: string,
    peerId?: string,
    socketId?: string
  ) {
    if (!roomId || !sessionId || !peerId || !socketId) {
      return;
    }

    const roomSessions = this.activeSessionsByRoom.get(roomId) ?? new Map();
    roomSessions.set(sessionId, { socketId, peerId });
    this.activeSessionsByRoom.set(roomId, roomSessions);
  }

  private unregisterSessionSocket(roomId?: string, sessionId?: string, socketId?: string) {
    if (!roomId || !sessionId || !socketId) {
      return;
    }

    const roomSessions = this.activeSessionsByRoom.get(roomId);
    if (!roomSessions) {
      return;
    }

    const current = roomSessions.get(sessionId);
    if (!current || current.socketId !== socketId) {
      return;
    }

    roomSessions.delete(sessionId);
    if (roomSessions.size === 0) {
      this.activeSessionsByRoom.delete(roomId);
    }
  }

  private async replaceExistingRoomSession(roomId: string, sessionId: string, nextSocketId: string) {
    const existing = this.activeSessionsByRoom.get(roomId)?.get(sessionId);
    if (!existing || existing.socketId === nextSocketId) {
      return;
    }

    this.cancelPendingDisconnectCleanup(roomId, sessionId);
    this.unregisterPeerSocket(roomId, existing.peerId, existing.socketId);
    this.unregisterSessionSocket(roomId, sessionId, existing.socketId);
    this.clearPeerAvailability(roomId, existing.peerId);

    const roomService = this.moduleRef.get(RoomService, { strict: false });
    if (
      roomService &&
      typeof (roomService as Partial<RoomService>).handleDuplicateSessionReplacement === "function"
    ) {
      await roomService.handleDuplicateSessionReplacement(roomId, sessionId);
    }

    const replacedSocket = this.server.sockets.sockets.get(existing.socketId);
    if (!replacedSocket) {
      return;
    }

    replacedSocket.emit("room.session.replaced", {
      roomId,
      reason: "duplicate-session"
    });
    replacedSocket.leave(roomId);
    replacedSocket.data.roomId = undefined;
    replacedSocket.data.sessionId = undefined;
    replacedSocket.data.peerId = undefined;
    replacedSocket.data.isRealtimeAuthenticated = false;
  }
}

function clientSafeNoop() {}
