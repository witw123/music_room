import { Inject, OnModuleDestroy, forwardRef } from "@nestjs/common";
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
import type { Server, Socket } from "socket.io";
import type {
  PieceAvailabilityClearPayload,
  PeerSignalMessage,
  RoomSubscribeAckPayload,
  RoomChatInputPayload,
  RoomLibraryPatchPayload,
  RoomPlaybackPatchPayload,
  RoomPresencePatchPayload,
  RoomQueuePatchPayload,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { errorCodes, roomChatInputPayloadSchema } from "@music-room/shared";
import { createWsApiException } from "../../common/errors/ws-error";
import { MetricsService } from "../../common/metrics/metrics.service";
import { RedisService } from "../../infra/redis/redis.service";
import { getCorsOrigins } from "../../common/cors/get-cors-origins";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";
import { RoomRealtimeBroadcaster } from "./room-realtime.broadcaster";
import { TrackAvailabilityRegistry } from "./track-availability.registry";
import {
  peerSignalChannel,
  pieceAvailabilityChannel,
  pieceAvailabilityClearChannel,
  roomDeletedChannel,
  roomLibraryPatchChannel,
  roomPlaybackPatchChannel,
  roomPresencePatchChannel,
  roomQueuePatchChannel,
  roomSnapshotChannel,
  roomSnapshotMissingChannel
} from "./room-realtime.channels";

type PendingPeerSignal = {
  payload: PeerSignalMessage;
  expiresAtMs: number;
};

@WebSocketGateway({
  path: "/ws/socket.io",
  cors: { origin: getCorsOrigins(), credentials: true }
})
export class SignalingGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly disconnectGracePeriodMs = 25_000;
  private readonly pendingPeerSignalTtlMs = 10_000;
  private readonly pendingPeerSignalLimit = 64;
  private unsubscribeRoomSnapshots: (() => Promise<void> | void) | null = null;
  private sequence = 0;
  private recoveryGenerationSequence = 0;
  private readonly pendingDisconnectCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly peerSocketsByRoom = new Map<string, Map<string, Set<string>>>();
  private readonly activeSessionsByRoom = new Map<
    string,
    Map<string, { socketId: string; peerId: string }>
  >();
  private readonly recoveryGenerationByRoomSession = new Map<string, number>();
  private readonly recoveryGenerationByRoomPeer = new Map<string, Map<string, number>>();
  private readonly pendingPeerSignalsByRoomPeer = new Map<string, PendingPeerSignal[]>();

  constructor(
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => RoomService))
    private readonly roomService: RoomService,
    @Inject(forwardRef(() => RoomRealtimePublisher))
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly roomRealtimeBroadcaster: RoomRealtimeBroadcaster,
    private readonly trackAvailabilityRegistry: TrackAvailabilityRegistry,
    private readonly authService: AuthService,
    private readonly metrics: MetricsService
  ) {}

  @WebSocketServer()
  server!: Server;

  emitRoomSnapshot(roomId: string, snapshot: RoomSnapshot) {
    this.ensureBroadcasterServer();
    this.roomRealtimeBroadcaster.emitRoomSnapshot(roomId, snapshot);
  }

  emitRoomMissing(roomId: string) {
    this.ensureBroadcasterServer();
    this.trackAvailabilityRegistry.clearRoom(roomId);
    this.peerSocketsByRoom.delete(roomId);
    this.activeSessionsByRoom.delete(roomId);
    this.metrics.clearRoom(roomId);
    this.clearRoomRecoveryState(roomId);
    this.roomRealtimeBroadcaster.emitRoomMissing(roomId);
  }

  emitRoomDeleted(roomId: string, trackIds: string[]) {
    this.ensureBroadcasterServer();
    this.trackAvailabilityRegistry.clearRoom(roomId);
    this.peerSocketsByRoom.delete(roomId);
    this.activeSessionsByRoom.delete(roomId);
    this.metrics.clearRoom(roomId);
    this.clearRoomRecoveryState(roomId);
    this.roomRealtimeBroadcaster.emitRoomDeleted(roomId, trackIds);
  }

  emitPlaybackPatch(roomId: string, payload: Omit<RoomPlaybackPatchPayload, "roomId" | "updatedAt">) {
    this.ensureBroadcasterServer();
    this.roomRealtimeBroadcaster.emitPlaybackPatch(roomId, payload);
  }

  emitQueuePatch(roomId: string, payload: Omit<RoomQueuePatchPayload, "roomId" | "updatedAt">) {
    this.ensureBroadcasterServer();
    this.roomRealtimeBroadcaster.emitQueuePatch(roomId, payload);
  }

  emitPresencePatch(
    roomId: string,
    payload: Omit<RoomPresencePatchPayload, "roomId" | "updatedAt">
  ) {
    this.ensureBroadcasterServer();
    this.roomRealtimeBroadcaster.emitPresencePatch(roomId, payload);
  }

  emitPresenceSnapshot(roomId: string, snapshot: RoomSnapshot) {
    this.emitRoomSnapshot(roomId, snapshot);
    this.emitPresencePatch(roomId, {
      members: snapshot.room.members,
      playback: snapshot.room.playback,
      presenceRevision: snapshot.room.presenceRevision,
      roomRevision: snapshot.room.roomRevision ?? 0
    });
  }

  emitLibraryPatch(roomId: string, payload: Omit<RoomLibraryPatchPayload, "roomId" | "updatedAt">) {
    this.ensureBroadcasterServer();
    this.roomRealtimeBroadcaster.emitLibraryPatch(roomId, payload);
  }

  getTrackAvailabilityAnnouncements(roomId: string, trackId: string) {
    return this.trackAvailabilityRegistry.getTrackAnnouncements(roomId, trackId);
  }

  private emitPieceAvailabilityClear(roomId: string, ownerPeerId: string) {
    const payload: PieceAvailabilityClearPayload = {
      roomId,
      ownerPeerId,
      updatedAt: new Date().toISOString()
    };
    this.server.to(roomId).emit("piece.availability.clear", payload);
    void this.redisService.publish(pieceAvailabilityClearChannel, {
      sourceId: this.roomRealtimeBroadcaster.instanceId,
      roomId,
      payload
    });
  }

  afterInit() {
    this.roomRealtimeBroadcaster.setServer(this.server);
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
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

      if (
        !message.roomId ||
        !message.sourceId ||
        message.sourceId === this.roomRealtimeBroadcaster.instanceId
      ) {
        return;
      }

      this.trackAvailabilityRegistry.clearRoom(message.roomId);
      this.peerSocketsByRoom.delete(message.roomId);
      this.activeSessionsByRoom.delete(message.roomId);
      this.metrics.clearRoom(message.roomId);
      this.clearRoomRecoveryState(message.roomId);
      this.server.to(message.roomId).emit("room.snapshot.missing", { roomId: message.roomId });
    });

    void this.redisService.subscribe(roomDeletedChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        trackIds?: string[];
      };

      if (
        !message.roomId ||
        !message.sourceId ||
        message.sourceId === this.roomRealtimeBroadcaster.instanceId
      ) {
        return;
      }

      this.trackAvailabilityRegistry.clearRoom(message.roomId);
      this.peerSocketsByRoom.delete(message.roomId);
      this.activeSessionsByRoom.delete(message.roomId);
      this.metrics.clearRoom(message.roomId);
      this.clearRoomRecoveryState(message.roomId);
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
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
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
        ) {
          return;
        }

      const mergedAnnouncement = this.trackAvailabilityRegistry.setAnnouncement(
        message.roomId,
        message.payload
      );
      this.server.to(message.roomId).emit("piece.availability", mergedAnnouncement);
    });

    void this.redisService.subscribe(pieceAvailabilityClearChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: PieceAvailabilityClearPayload;
      };

      if (
          !message.roomId ||
          !message.payload ||
          !message.sourceId ||
          message.sourceId === this.roomRealtimeBroadcaster.instanceId
        ) {
          return;
        }

      this.trackAvailabilityRegistry.removePeer(message.roomId, message.payload.ownerPeerId);
      this.server.to(message.roomId).emit("piece.availability.clear", message.payload);
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
    this.pendingPeerSignalsByRoomPeer.clear();
    this.recoveryGenerationByRoomSession.clear();
    this.recoveryGenerationByRoomPeer.clear();
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
      sequence: (payload as PeerSignalMessage & { sequence?: number }).sequence ?? this.nextSequence(),
      recoveryGeneration:
        payload.recoveryGeneration ?? this.resolvePeerRecoveryGeneration(payload.roomId, payload.toPeerId)
    } as PeerSignalMessage;

    this.emitPeerSignalToPeer(payload.roomId, nextPayload.toPeerId, nextPayload);
    await this.redisService.publish(peerSignalChannel, {
      sourceId: this.roomRealtimeBroadcaster.instanceId,
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

    const mergedAnnouncement = this.trackAvailabilityRegistry.setAnnouncement(payload.roomId, payload);
    client.to(payload.roomId).emit("piece.availability", mergedAnnouncement);
    await this.redisService.publish(pieceAvailabilityChannel, {
      sourceId: this.roomRealtimeBroadcaster.instanceId,
      roomId: payload.roomId,
      payload: mergedAnnouncement
    });
    return mergedAnnouncement;
  }

  @SubscribeMessage("room.chat")
  async handleRoomChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RoomChatInputPayload
  ) {
    const parsed = roomChatInputPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException(
        "Invalid chat payload.",
        errorCodes.validationFailed,
        parsed.error.flatten()
      );
    }

    this.assertRealtimeClient(client, parsed.data.roomId);
    const sessionId = client.data.sessionId as string | undefined;
    if (!sessionId) {
      throw new WsException("Unauthorized realtime request.");
    }

    const user = await this.authService.getUserOrThrow(sessionId);
    const nextPayload = {
      roomId: parsed.data.roomId,
      senderId: user.id,
      senderName: user.nickname,
      content: parsed.data.content,
      timestamp: parsed.data.timestamp ?? Date.now()
    };

    client.to(parsed.data.roomId).emit("room.chat", nextPayload);
    return nextPayload;
  }

  @SubscribeMessage("room.subscribe")
  async handleRoomSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; sessionId?: string; peerId?: string }
  ) {
    this.ensureBroadcasterServer();
    this.assertRealtimeAvailable();

    if (!payload.sessionId || !payload.peerId) {
      throw new WsException("Missing session identity.");
    }

    const sessionToken = this.getSocketSessionToken(client);
    try {
      await this.authService.assertSessionToken(payload.sessionId, sessionToken);
    } catch (error) {
      throw createWsApiException(
        error instanceof Error ? error.message : "Unauthorized.",
        errorCodes.unauthorized
      );
    }

    const previousRoomId = client.data.roomId as string | undefined;
    const previousSessionId = client.data.sessionId as string | undefined;
    const previousPeerId = client.data.peerId as string | undefined;

    this.unregisterPeerSocket(
      previousRoomId,
      previousPeerId,
      client.id
    );
    this.unregisterSessionSocket(
      previousRoomId,
      previousSessionId,
      client.id
    );
    this.metrics.unbindRealtimeSocket(client.id);
    if (previousRoomId && previousRoomId !== payload.roomId) {
      client.leave(previousRoomId);
      if (previousSessionId) {
        void this.updatePeerPresence(previousRoomId, previousSessionId, null, "offline");
      }
      if (previousPeerId) {
        this.clearPeerAvailability(previousRoomId, previousPeerId);
      }
    }
    client.data ??= {};

    await this.replaceExistingRoomSession(
      payload.roomId,
      payload.sessionId,
      payload.peerId,
      client.id
    );

    client.data.roomId = payload.roomId;
    client.data.sessionId = payload.sessionId;
    client.data.peerId = payload.peerId;
    client.data.isRealtimeAuthenticated = true;
    client.join(payload.roomId);
    const recoveryGeneration = this.registerRecoveryGeneration(
      payload.roomId,
      payload.sessionId,
      payload.peerId
    );
    this.registerPeerSocket(payload.roomId, payload.peerId, client.id);
    this.registerSessionSocket(payload.roomId, payload.sessionId, payload.peerId, client.id);

    try {
      this.cancelPendingDisconnectCleanup(payload.roomId, payload.sessionId);
      await this.updatePeerPresence(payload.roomId, payload.sessionId, payload.peerId, "online");
      await this.rememberRecentRoom(payload.roomId, payload.sessionId);
      let snapshot: RoomSnapshot;
      try {
        snapshot = await this.roomService.getAccessibleRoomSnapshot(payload.roomId, [], payload.sessionId);
      } catch {
        client.emit("room.snapshot.missing", { roomId: payload.roomId });
        return { ok: false };
      }
      this.metrics.bindRealtimeSocket(client.id, payload.roomId);
      setTimeout(() => {
        client.emit("room.snapshot", snapshot);
      }, 0);
      await this.emitAvailabilitySnapshot(payload.roomId, client);
      this.flushPendingPeerSignals(payload.roomId, payload.peerId);
      return this.buildSubscribeAck(snapshot, recoveryGeneration);
    } catch (error) {
      this.unregisterPeerSocket(payload.roomId, payload.peerId, client.id);
      this.unregisterSessionSocket(payload.roomId, payload.sessionId, client.id);
      this.clearPendingPeerSignals(payload.roomId, payload.peerId);
      this.clearRecoveryGeneration(payload.roomId, payload.sessionId, payload.peerId);
      client.leave(payload.roomId);
      client.data.roomId = undefined;
      client.data.sessionId = undefined;
      client.data.peerId = undefined;
      client.data.isRealtimeAuthenticated = false;
      this.metrics.unbindRealtimeSocket(client.id);
      throw createWsApiException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @SubscribeMessage("room.presence")
  async handleRoomPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; sessionId: string; peerId: string }
  ) {
    this.ensureBroadcasterServer();
    this.assertRealtimeClient(client, payload.roomId);
    this.assertRealtimeAvailable();

    if (client.data.sessionId !== payload.sessionId || client.data.peerId !== payload.peerId) {
      throw new WsException("Presence mismatch.");
    }

    const refreshResult = await this.roomService.refreshRealtimePresence(
      payload.roomId,
      payload.sessionId,
      payload.peerId
    );
    if (refreshResult.changed) {
      await this.roomRealtimePublisher.emitTopologySnapshot(payload.roomId);
    }
    return { ok: true };
  }

  @SubscribeMessage("room.unsubscribe")
  handleRoomUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string }
  ) {
    const sessionId = client.data.sessionId as string | undefined;
    const peerId = client.data.peerId as string | undefined;
    const isActiveSessionSocket = this.isActiveSessionSocket(payload.roomId, sessionId, client.id);

    this.unregisterPeerSocket(payload.roomId, peerId, client.id);
    this.unregisterSessionSocket(payload.roomId, sessionId, client.id);
    this.metrics.unbindRealtimeSocket(client.id);
    if (sessionId && isActiveSessionSocket) {
      this.cancelPendingDisconnectCleanup(payload.roomId, sessionId);
    }
    client.leave(payload.roomId);
    if (sessionId && isActiveSessionSocket) {
      void this.updatePeerPresence(
        payload.roomId,
        sessionId,
        null,
        "offline"
      );
    }
    if (peerId) {
      this.clearPeerAvailability(payload.roomId, peerId);
      this.clearPendingPeerSignals(payload.roomId, peerId);
    }
    this.clearRecoveryGeneration(payload.roomId, sessionId, peerId);
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
    const isActiveSessionSocket = this.isActiveSessionSocket(roomId, sessionId, client.id);

    this.unregisterPeerSocket(roomId, peerId, client.id);
    this.unregisterSessionSocket(roomId, sessionId, client.id);
    this.metrics.unbindRealtimeSocket(client.id);
    if (roomId && sessionId && isActiveSessionSocket) {
      void this.updatePeerPresence(roomId, sessionId, null, "reconnecting");
      this.scheduleDisconnectCleanup(roomId, sessionId, peerId);
    }
  }

  private async emitLatestSnapshot(roomId: string, sessionId: string, client: Socket) {
    try {
      client.emit(
        "room.snapshot",
        await this.roomService.getAccessibleRoomSnapshot(roomId, [], sessionId)
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
    this.ensureBroadcasterServer();
    try {
      await this.roomService.updatePeerPresence(roomId, sessionId, peerId, presenceState);
      await this.roomRealtimePublisher.emitTopologySnapshot(roomId);
    } catch {
      clientSafeNoop();
    }
  }

  private async rememberRecentRoom(roomId: string, sessionId: string) {
    try {
      await this.roomService.rememberRecentRoom(roomId, sessionId);
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
      this.metrics.incrementRealtimeFailure();
      throw createWsApiException(
        "Realtime sync unavailable.",
        errorCodes.realtimeUnavailable
      );
    }
  }

  private nextSequence() {
    this.sequence += 1;
    return this.sequence;
  }

  private nextRecoveryGeneration() {
    this.recoveryGenerationSequence += 1;
    return this.recoveryGenerationSequence;
  }

  private recoverySessionKey(roomId: string, sessionId: string) {
    return `${roomId}:${sessionId}`;
  }

  private roomPeerKey(roomId: string, peerId: string) {
    return `${roomId}:${peerId}`;
  }

  private getOrCreateRoomPeerRecoveryMap(roomId: string) {
    const current = this.recoveryGenerationByRoomPeer.get(roomId);
    if (current) {
      return current;
    }

    const next = new Map<string, number>();
    this.recoveryGenerationByRoomPeer.set(roomId, next);
    return next;
  }

  private registerRecoveryGeneration(roomId: string, sessionId: string, peerId: string) {
    const nextGeneration = this.nextRecoveryGeneration();
    this.recoveryGenerationByRoomSession.set(this.recoverySessionKey(roomId, sessionId), nextGeneration);
    this.getOrCreateRoomPeerRecoveryMap(roomId).set(peerId, nextGeneration);
    return nextGeneration;
  }

  private clearRecoveryGeneration(roomId?: string, sessionId?: string, peerId?: string) {
    if (roomId && sessionId) {
      this.recoveryGenerationByRoomSession.delete(this.recoverySessionKey(roomId, sessionId));
    }

    if (roomId && peerId) {
      const roomPeers = this.recoveryGenerationByRoomPeer.get(roomId);
      roomPeers?.delete(peerId);
      if (roomPeers && roomPeers.size === 0) {
        this.recoveryGenerationByRoomPeer.delete(roomId);
      }
    }
  }

  private resolvePeerRecoveryGeneration(roomId: string, peerId: string) {
    return this.recoveryGenerationByRoomPeer.get(roomId)?.get(peerId);
  }

  private buildSubscribeAck(snapshot: RoomSnapshot, recoveryGeneration: number): RoomSubscribeAckPayload {
    return {
      ok: true,
      serverNow: new Date().toISOString(),
      recoveryGeneration,
      bootstrap: {
        roomId: snapshot.room.id,
        roomRevision: snapshot.room.roomRevision ?? 0,
        presenceRevision: snapshot.room.presenceRevision ?? 0,
        playback: snapshot.room.playback,
        members: snapshot.room.members.map((member) => ({
          id: member.id,
          peerId: member.peerId ?? null,
          presenceState: member.presenceState,
          role: member.role
        }))
      }
    };
  }

  private queuePeerSignal(roomId: string, peerId: string, payload: PeerSignalMessage) {
    const key = this.roomPeerKey(roomId, peerId);
    const now = Date.now();
    const queued = (this.pendingPeerSignalsByRoomPeer.get(key) ?? []).filter(
      (entry) => entry.expiresAtMs > now
    );
    queued.push({
      payload,
      expiresAtMs: now + this.pendingPeerSignalTtlMs
    });
    if (queued.length > this.pendingPeerSignalLimit) {
      queued.splice(0, queued.length - this.pendingPeerSignalLimit);
    }
    this.pendingPeerSignalsByRoomPeer.set(key, queued);
  }

  private flushPendingPeerSignals(roomId: string, peerId: string) {
    const key = this.roomPeerKey(roomId, peerId);
    const queued = this.pendingPeerSignalsByRoomPeer.get(key);
    if (!queued?.length) {
      return;
    }

    const now = Date.now();
    this.pendingPeerSignalsByRoomPeer.delete(key);
    for (const entry of queued) {
      if (entry.expiresAtMs <= now) {
        continue;
      }

      this.emitPeerSignalToPeer(roomId, peerId, entry.payload);
    }
  }

  private clearPendingPeerSignals(roomId?: string, peerId?: string) {
    if (roomId && peerId) {
      this.pendingPeerSignalsByRoomPeer.delete(this.roomPeerKey(roomId, peerId));
      return;
    }

    if (roomId) {
      for (const key of this.pendingPeerSignalsByRoomPeer.keys()) {
        if (key.startsWith(`${roomId}:`)) {
          this.pendingPeerSignalsByRoomPeer.delete(key);
        }
      }
    }
  }

  private clearRoomRecoveryState(roomId: string) {
    this.clearPendingPeerSignals(roomId);
    this.recoveryGenerationByRoomPeer.delete(roomId);
    for (const key of [...this.recoveryGenerationByRoomSession.keys()]) {
      if (key.startsWith(`${roomId}:`)) {
        this.recoveryGenerationByRoomSession.delete(key);
      }
    }
  }

  private async emitAvailabilitySnapshot(roomId: string, client: Socket) {
    await this.trackAvailabilityRegistry.emitSnapshot(roomId, (announcement) => {
      client.emit("piece.availability", announcement);
    });
  }

  private emitPeerSignalToPeer(roomId: string, peerId: string, payload: PeerSignalMessage) {
    const socketIds = this.peerSocketsByRoom.get(roomId)?.get(peerId);
    if (!socketIds?.size) {
      this.queuePeerSignal(roomId, peerId, payload);
      return;
    }

    const recoveryGeneration = this.resolvePeerRecoveryGeneration(roomId, peerId);
    const nextPayload =
      typeof recoveryGeneration === "number"
        ? {
            ...payload,
            recoveryGeneration
          }
        : payload;
    for (const socketId of socketIds) {
      this.server.to(socketId).emit("peer.signal", nextPayload);
    }
  }

  private clearPeerAvailability(roomId: string, peerId: string) {
    const removed = this.trackAvailabilityRegistry.removePeer(roomId, peerId);
    if (!removed) {
      return false;
    }

    this.emitPieceAvailabilityClear(roomId, peerId);
    return true;
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
    if (this.activeSessionsByRoom.get(roomId)?.has(sessionId)) {
      return;
    }

    await this.updatePeerPresence(roomId, sessionId, null, "offline");
    if (peerId) {
      this.clearPeerAvailability(roomId, peerId);
      this.clearPendingPeerSignals(roomId, peerId);
    }
    this.clearRecoveryGeneration(roomId, sessionId, peerId);
  }

  private disconnectCleanupKey(roomId: string, sessionId: string) {
    return `${roomId}:${sessionId}`;
  }

  private ensureBroadcasterServer() {
    if (this.server) {
      this.roomRealtimeBroadcaster.setServer(this.server);
    }
  }

  private isActiveSessionSocket(roomId?: string, sessionId?: string, socketId?: string) {
    if (!roomId || !sessionId || !socketId) {
      return false;
    }

    return this.activeSessionsByRoom.get(roomId)?.get(sessionId)?.socketId === socketId;
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
    this.flushPendingPeerSignals(roomId, peerId);
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

  private async replaceExistingRoomSession(
    roomId: string,
    sessionId: string,
    nextPeerId: string,
    nextSocketId: string
  ) {
    this.ensureBroadcasterServer();
    const existing = this.activeSessionsByRoom.get(roomId)?.get(sessionId);
    if (!existing || existing.socketId === nextSocketId) {
      return;
    }

    this.cancelPendingDisconnectCleanup(roomId, sessionId);
    this.unregisterPeerSocket(roomId, existing.peerId, existing.socketId);
    this.unregisterSessionSocket(roomId, sessionId, existing.socketId);
    this.metrics.unbindRealtimeSocket(existing.socketId);
    this.clearRecoveryGeneration(roomId, sessionId, existing.peerId);

    const replacedSocket = this.server.sockets.sockets.get(existing.socketId);
    const isSeamlessReconnect = existing.peerId === nextPeerId;
    if (isSeamlessReconnect) {
      if (replacedSocket) {
        replacedSocket.leave(roomId);
        replacedSocket.data.roomId = undefined;
        replacedSocket.data.sessionId = undefined;
        replacedSocket.data.peerId = undefined;
        replacedSocket.data.isRealtimeAuthenticated = false;
      }
      return;
    }

    this.clearPeerAvailability(roomId, existing.peerId);

    await this.roomService.handleDuplicateSessionReplacement(roomId, sessionId);
    await this.roomRealtimePublisher.emitSnapshot(roomId);

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
