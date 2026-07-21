import { OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
  PeerSignalMessage,
  RoomSubscribeAckPayload,
  RoomChatInputPayload,
  RoomLibraryPatchPayload,
  RoomPlaybackPatchPayload,
  RoomPresencePatchPayload,
  RoomPresencePayload,
  RoomQueuePatchPayload,
  RoomSubscribePayload,
  RoomSnapshot,
  RoomUnsubscribePayload
} from "@music-room/shared";
import { readUserSessionCookie } from "../auth/auth.cookies";
import {
  errorCodes,
  peerSignalMessageSchema,
  roomChatInputPayloadSchema,
  roomDeletedPayloadSchema,
  roomLibraryPatchPayloadSchema,
  roomPlaybackPatchPayloadSchema,
  roomPresencePayloadSchema,
  roomPresencePatchPayloadSchema,
  roomQueuePatchPayloadSchema,
  roomSubscribePayloadSchema,
  roomSnapshotMissingPayloadSchema,
  roomSnapshotSchema,
  roomUnsubscribePayloadSchema
} from "@music-room/shared";
import { diagnosticsReportPayloadSchema } from "@music-room/shared";
import { createWsApiException } from "../../common/errors/ws-error";
import { MetricsService } from "../../common/metrics/metrics.service";
import { RedisService } from "../../infra/redis/redis.service";
import { getCorsOrigins } from "../../common/cors/get-cors-origins";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";
import { RoomRealtimeBroadcaster } from "./room-realtime.broadcaster";
import {
  peerSignalChannel,
  roomDeletedChannel,
  roomLibraryPatchChannel,
  roomPlaybackPatchChannel,
  roomPresencePatchChannel,
  roomQueuePatchChannel,
  roomSnapshotChannel,
  roomSnapshotMissingChannel,
  sessionReplacementChannel
} from "./room-realtime.channels";

type PendingPeerSignal = {
  payload: PeerSignalMessage;
  expiresAtMs: number;
};

type SessionLease = {
  instanceId?: string;
  roomId?: string;
  sessionId?: string;
  peerId?: string;
  socketId?: string;
  fenceToken?: string;
};

type RealtimeRateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

function hasForeignRedisEnvelope(
  message: { sourceId?: unknown; roomId?: unknown },
  localInstanceId: string
) {
  return (
    typeof message.sourceId === "string" &&
    message.sourceId !== localInstanceId &&
    typeof message.roomId === "string" &&
    message.roomId.length > 0
  );
}

@WebSocketGateway({
  path: "/ws/socket.io",
  cors: { origin: getCorsOrigins(), credentials: true }
})
export class SignalingGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly disconnectGracePeriodMs = 25_000;
  private readonly pendingPeerSignalTtlMs = 10_000;
  private readonly pendingPeerSignalLimit = 32;
  private readonly pendingPeerSignalTargetLimit = 128;
  private readonly realtimeRateLimits = new Map<string, Map<string, RealtimeRateLimitBucket>>();
  private readonly redisUnsubscribers: Array<() => Promise<void> | void> = [];
  private sequence = 0;
  private recoveryGenerationSequence = 0;
  private readonly pendingDisconnectCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly peerSocketsByRoom = new Map<string, Map<string, Set<string>>>();
  private readonly activeSessionsByRoom = new Map<
    string,
    Map<string, { socketId: string; peerId: string; fenceToken: string }>
  >();
  private readonly sessionLeaseTtlMs = 90_000;
  private readonly recoveryGenerationByRoomSession = new Map<string, number>();
  private readonly recoveryGenerationByRoomPeer = new Map<string, Map<string, number>>();
  private readonly pendingPeerSignalsByRoomPeer = new Map<string, PendingPeerSignal[]>();
  private readonly telemetryLastReportAt = new Map<string, number>();

  constructor(
    private readonly redisService: RedisService,
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly roomRealtimeBroadcaster: RoomRealtimeBroadcaster,
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
    this.peerSocketsByRoom.delete(roomId);
    this.activeSessionsByRoom.delete(roomId);
    this.metrics.clearRoom(roomId);
    this.clearRoomRecoveryState(roomId);
    this.roomRealtimeBroadcaster.emitRoomMissing(roomId);
  }

  emitRoomDeleted(roomId: string, trackIds: string[]) {
    this.ensureBroadcasterServer();
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

  afterInit() {
    this.roomRealtimeBroadcaster.setServer(this.server);
    void this.redisService.subscribe("music-room:auth:user-invalidated", (payload) => {
      const userId = (payload as { userId?: unknown }).userId;
      if (typeof userId !== "string") return;
      for (const socket of this.server.sockets.sockets.values()) {
        if (socket.data.sessionId === userId) {
          socket.emit("session.revoked");
          socket.disconnect(true);
        }
      }
    }).then((unsubscribe) => this.redisUnsubscribers.push(unsubscribe));
    void this.redisService
      .subscribe(roomSnapshotChannel, (payload) => {
        const message = payload as {
          sourceId?: string;
          roomId?: string;
          snapshot?: RoomSnapshot;
        };

        if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
          return;
        }

        const parsed = roomSnapshotSchema.safeParse(message.snapshot);
        if (!parsed.success || parsed.data.room.id !== message.roomId) {
          return;
        }

        this.server.to(message.roomId).emit("room.snapshot", parsed.data);
      })
      .then((unsubscribe) => {
        this.redisUnsubscribers.push(unsubscribe);
      });

    void this.redisService.subscribe(roomSnapshotMissingChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = roomSnapshotMissingPayloadSchema.safeParse({ roomId: message.roomId });
      if (!parsed.success) {
        return;
      }

      this.peerSocketsByRoom.delete(parsed.data.roomId);
      this.activeSessionsByRoom.delete(parsed.data.roomId);
      this.metrics.clearRoom(parsed.data.roomId);
      this.clearRoomRecoveryState(parsed.data.roomId);
      this.server.to(parsed.data.roomId).emit("room.snapshot.missing", parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(roomDeletedChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        trackIds?: string[];
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = roomDeletedPayloadSchema.safeParse({
        roomId: message.roomId,
        trackIds: message.trackIds ?? []
      });
      if (!parsed.success) {
        return;
      }

      this.peerSocketsByRoom.delete(parsed.data.roomId);
      this.activeSessionsByRoom.delete(parsed.data.roomId);
      this.metrics.clearRoom(parsed.data.roomId);
      this.clearRoomRecoveryState(parsed.data.roomId);
      this.server.to(parsed.data.roomId).emit("room.deleted", parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(roomPlaybackPatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomPlaybackPatchPayload;
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = roomPlaybackPatchPayloadSchema.safeParse(message.payload);
      if (!parsed.success || parsed.data.roomId !== message.roomId) {
        return;
      }

      this.server.to(message.roomId).emit("room.playback.patch", parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(roomQueuePatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomQueuePatchPayload;
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = roomQueuePatchPayloadSchema.safeParse(message.payload);
      if (!parsed.success || parsed.data.roomId !== message.roomId) {
        return;
      }

      this.server.to(message.roomId).emit("room.queue.patch", parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(roomPresencePatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomPresencePatchPayload;
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = roomPresencePatchPayloadSchema.safeParse(message.payload);
      if (!parsed.success || parsed.data.roomId !== message.roomId) {
        return;
      }

      this.server.to(message.roomId).emit("room.presence.patch", parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(roomLibraryPatchChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: RoomLibraryPatchPayload;
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = roomLibraryPatchPayloadSchema.safeParse(message.payload);
      if (!parsed.success || parsed.data.roomId !== message.roomId) {
        return;
      }

      this.server.to(message.roomId).emit("room.library.patch", parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(peerSignalChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        payload?: PeerSignalMessage;
      };

      if (!hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId)) {
        return;
      }

      const parsed = peerSignalMessageSchema.safeParse(message.payload);
      if (!parsed.success || parsed.data.roomId !== message.roomId) {
        return;
      }

      this.emitPeerSignalToPeer(message.roomId, parsed.data.toPeerId, parsed.data);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

    void this.redisService.subscribe(sessionReplacementChannel, (payload) => {
      const message = payload as {
        sourceId?: string;
        roomId?: string;
        sessionId?: string;
        socketId?: string;
      };
      if (
        !hasForeignRedisEnvelope(message, this.roomRealtimeBroadcaster.instanceId) ||
        typeof message.roomId !== "string" ||
        typeof message.sessionId !== "string" ||
        typeof message.socketId !== "string"
      ) {
        return;
      }

      const socket = this.server.sockets.sockets.get(message.socketId);
      if (
        !socket ||
        socket.data.roomId !== message.roomId ||
        socket.data.sessionId !== message.sessionId
      ) {
        return;
      }

      this.invalidateReplacedSocket(socket, message.roomId);
    }).then((unsubscribe) => {
      this.redisUnsubscribers.push(unsubscribe);
    });

  }

  onModuleDestroy() {
    for (const unsubscribe of this.redisUnsubscribers.splice(0)) {
      void unsubscribe();
    }
    for (const timer of this.pendingDisconnectCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingDisconnectCleanupTimers.clear();
    this.peerSocketsByRoom.clear();
    this.activeSessionsByRoom.clear();
    this.pendingPeerSignalsByRoomPeer.clear();
    this.telemetryLastReportAt.clear();
    this.recoveryGenerationByRoomSession.clear();
    this.recoveryGenerationByRoomPeer.clear();
  }

  @SubscribeMessage("peer.signal")
  async handleSignal(@ConnectedSocket() client: Socket, @MessageBody() payload: PeerSignalMessage) {
    this.assertRealtimeRateLimit(client, "peer.signal", 300);
    const parsed = peerSignalMessageSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException(
        "Invalid peer signal payload.",
        errorCodes.validationFailed,
        parsed.error.flatten()
      );
    }
    const message = parsed.data;

    this.assertRealtimeClient(client, message.roomId);
    await this.assertSessionLease(client);
    if (client.data.peerId !== message.fromPeerId) {
      throw new WsException("Peer mismatch.");
    }

    const nextPayload = {
      ...message,
      sequence: this.nextSequence(),
      recoveryGeneration:
        message.recoveryGeneration ?? this.resolvePeerRecoveryGeneration(message.roomId, message.toPeerId)
    } as PeerSignalMessage;

    await this.emitPeerSignalToPeer(message.roomId, nextPayload.toPeerId, nextPayload);
    this.publishRealtime(peerSignalChannel, {
      sourceId: this.roomRealtimeBroadcaster.instanceId,
      roomId: message.roomId,
      payload: nextPayload
    });
    return nextPayload;
  }

  @SubscribeMessage("diagnostics.report")
  async handleDiagnosticsReport(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    this.assertRealtimeRateLimit(client, "diagnostics.report", 30);
    const parsed = diagnosticsReportPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException("Invalid diagnostics report.", errorCodes.validationFailed, parsed.error.flatten());
    }
    const report = parsed.data;
    this.assertRealtimeClient(client, report.roomId);
    await this.assertUserStillActive(client.data.sessionId as string);
    await this.assertSessionLease(client);
    if (client.data.sessionId !== report.sessionId || client.data.peerId !== report.peerId) {
      throw new WsException("Diagnostics identity mismatch.");
    }
    const rateKey = `${report.roomId}:${report.peerId}`;
    const now = Date.now();
    if (now - (this.telemetryLastReportAt.get(rateKey) ?? 0) < 5_000) { this.metrics.incrementDiagnosticsRateLimited(); return { ok: false, rateLimited: true }; }
    this.telemetryLastReportAt.set(rateKey, now);
    if (this.redisService.isAvailable()) {
      await this.redisService.setJson(`music-room:admin:telemetry:peer:${report.roomId}:${report.peerId}`, report, 45);
      await this.redisService.addSortedSetScore(`music-room:admin:telemetry:room-peers:${report.roomId}`, now, report.peerId);
      await this.redisService.addSortedSetScore("music-room:admin:telemetry:active-rooms", now, report.roomId);
    }
    this.metrics.incrementDiagnosticsReport();
    return { ok: true };
  }

  @SubscribeMessage("room.chat")
  async handleRoomChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RoomChatInputPayload
  ) {
    this.assertRealtimeRateLimit(client, "room.chat", 30);
    const parsed = roomChatInputPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException(
        "Invalid chat payload.",
        errorCodes.validationFailed,
        parsed.error.flatten()
      );
    }

    this.assertRealtimeClient(client, parsed.data.roomId);
    await this.assertSessionLease(client);
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
    @MessageBody() payload: RoomSubscribePayload
  ) {
    this.assertRealtimeRateLimit(client, "room.subscribe", 12);
    const parsed = roomSubscribePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException(
        "Invalid room subscribe payload.",
        errorCodes.validationFailed,
        parsed.error.flatten()
      );
    }
    const message = parsed.data;

    if (
      (message.protocolVersion ?? client.data.protocolVersion) !== 4 ||
      !(message.capabilities ?? client.data.capabilities)?.includes("webrtc-opus-v1")
    ) {
      return {
        ok: false,
        protocolVersion: 4,
        capability: "webrtc-opus-v1",
        errorCode: "client_upgrade_required"
      } satisfies RoomSubscribeAckPayload;
    }

    this.ensureBroadcasterServer();
    if (!message.sessionId || !message.peerId) {
      throw new WsException("Missing session identity.");
    }

    const sessionToken = this.getSocketSessionToken(client);
    try {
      await this.authService.assertSessionToken(message.sessionId, sessionToken);
    } catch (error) {
      throw createWsApiException(
        error instanceof Error ? error.message : "Unauthorized.",
        errorCodes.unauthorized
      );
    }

    const previousRoomId = client.data.roomId as string | undefined;
    const previousSessionId = client.data.sessionId as string | undefined;
    const previousPeerId = client.data.peerId as string | undefined;

    if (
      previousRoomId &&
      previousSessionId &&
      (previousRoomId !== message.roomId || previousSessionId !== message.sessionId)
    ) {
      await this.releaseSessionLease(client);
    }

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
    if (previousRoomId && previousRoomId !== message.roomId) {
      client.leave(previousRoomId);
      if (previousSessionId) {
        void this.updatePeerPresence(previousRoomId, previousSessionId, null, "offline");
      }
    }
    client.data ??= {};

    await this.replaceExistingRoomSession(
      message.roomId,
      message.sessionId,
      message.peerId,
      client.id
    );

    const fenceToken = randomUUID();
    const previousLease = await this.claimSessionLease(
      message.roomId,
      message.sessionId,
      message.peerId,
      client.id,
      fenceToken
    );
    if (
      previousLease?.socketId &&
      previousLease.socketId !== client.id &&
      previousLease.instanceId !== this.roomRealtimeBroadcaster.instanceId
    ) {
      this.publishRealtime(sessionReplacementChannel, {
        sourceId: this.roomRealtimeBroadcaster.instanceId,
        roomId: message.roomId,
        sessionId: message.sessionId,
        socketId: previousLease.socketId
      });
    }
    client.data.roomId = message.roomId;
    client.data.sessionId = message.sessionId;
    client.data.peerId = message.peerId;
    client.data.sessionFenceToken = fenceToken;
    client.data.protocolVersion = 4;
    client.data.capabilities = ["webrtc-opus-v1"];
    client.data.isRealtimeAuthenticated = true;
    client.join(message.roomId);
    const recoveryGeneration = this.registerRecoveryGeneration(
      message.roomId,
      message.sessionId,
      message.peerId
    );
    this.registerPeerSocket(message.roomId, message.peerId, client.id);
    this.registerSessionSocket(
      message.roomId,
      message.sessionId,
      message.peerId,
      client.id,
      fenceToken
    );

    try {
      this.cancelPendingDisconnectCleanup(message.roomId, message.sessionId);
      await this.updatePeerPresence(message.roomId, message.sessionId, message.peerId, "online");
      await this.rememberRecentRoom(message.roomId, message.sessionId);
      let snapshot: RoomSnapshot;
      try {
        snapshot = await this.roomService.getAccessibleRoomSnapshot(message.roomId, [], message.sessionId);
      } catch {
        client.emit("room.snapshot.missing", { roomId: message.roomId });
        return { ok: false };
      }
      this.metrics.bindRealtimeSocket(client.id, message.roomId);
      // Flush the compact subscribe ack before the snapshot so peer negotiation can start immediately.
      setImmediate(() => {
        if (!this.isActiveSessionSocket(message.roomId, message.sessionId, client.id)) {
          return;
        }
        client.emit("room.snapshot", snapshot);
      });
      return this.buildSubscribeAck(snapshot, recoveryGeneration);
    } catch (error) {
      this.unregisterPeerSocket(message.roomId, message.peerId, client.id);
      this.unregisterSessionSocket(message.roomId, message.sessionId, client.id);
      this.clearPendingPeerSignals(message.roomId, message.peerId);
      this.clearRecoveryGeneration(message.roomId, message.sessionId, message.peerId);
      client.leave(message.roomId);
      client.data.roomId = undefined;
      client.data.sessionId = undefined;
      client.data.peerId = undefined;
      client.data.sessionFenceToken = undefined;
      client.data.isRealtimeAuthenticated = false;
      this.metrics.unbindRealtimeSocket(client.id);
      throw createWsApiException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @SubscribeMessage("room.presence")
  async handleRoomPresence(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RoomPresencePayload
  ) {
    const parsed = roomPresencePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException(
        "Invalid room presence payload.",
        errorCodes.validationFailed,
        parsed.error.flatten()
      );
    }
    const message = parsed.data;

    this.ensureBroadcasterServer();
    this.assertRealtimeClient(client, message.roomId);
    await this.assertUserStillActive(client.data.sessionId as string);
    await this.assertSessionLease(client);
    if (!(await this.renewSessionLease(client))) {
      throw new WsException("Realtime session was replaced.");
    }

    if (client.data.sessionId !== message.sessionId || client.data.peerId !== message.peerId) {
      throw new WsException("Presence mismatch.");
    }

    const refreshResult = await this.roomService.refreshRealtimePresence(
      message.roomId,
      message.sessionId,
      message.peerId
    );
    if (refreshResult.changed) {
      await this.roomRealtimePublisher.emitTopologySnapshot(message.roomId);
    }
    return { ok: true };
  }

  @SubscribeMessage("room.unsubscribe")
  handleRoomUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RoomUnsubscribePayload
  ) {
    const parsed = roomUnsubscribePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw createWsApiException(
        "Invalid room unsubscribe payload.",
        errorCodes.validationFailed,
        parsed.error.flatten()
      );
    }
    const message = parsed.data;

    this.assertRealtimeClient(client, message.roomId);
    const sessionId = client.data.sessionId as string | undefined;
    const peerId = client.data.peerId as string | undefined;
    const isActiveSessionSocket = this.isActiveSessionSocket(message.roomId, sessionId, client.id);

    this.unregisterPeerSocket(message.roomId, peerId, client.id);
    this.unregisterSessionSocket(message.roomId, sessionId, client.id);
    this.metrics.unbindRealtimeSocket(client.id);
    if (sessionId && isActiveSessionSocket) {
      this.cancelPendingDisconnectCleanup(message.roomId, sessionId);
      void this.releaseSessionLease(client);
    }
    client.leave(message.roomId);
    if (sessionId && isActiveSessionSocket) {
      void this.updatePeerPresence(
        message.roomId,
        sessionId,
        null,
        "offline"
      );
    }
    if (peerId) {
      this.clearPendingPeerSignals(message.roomId, peerId);
    }
    this.clearRecoveryGeneration(message.roomId, sessionId, peerId);
    this.realtimeRateLimits.delete(client.id);
    client.data.roomId = undefined;
    client.data.sessionId = undefined;
    client.data.peerId = undefined;
    client.data.sessionFenceToken = undefined;
    client.data.isRealtimeAuthenticated = false;
    return { ok: true };
  }

  async handleDisconnect(client: Socket) {
    this.realtimeRateLimits.delete(client.id);
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    const peerId = client.data.peerId as string | undefined;
    const isActiveSessionSocket = this.isActiveSessionSocket(roomId, sessionId, client.id);

    this.unregisterPeerSocket(roomId, peerId, client.id);
    this.unregisterSessionSocket(roomId, sessionId, client.id);
    this.metrics.unbindRealtimeSocket(client.id);
    if (roomId && sessionId && isActiveSessionSocket) {
      const ownsLease = await this.sessionLeaseBelongsTo(roomId, sessionId, {
        peerId,
        socketId: client.id,
        fenceToken: client.data.sessionFenceToken as string | undefined
      });
      if (!ownsLease) {
        return;
      }
      void this.updatePeerPresence(roomId, sessionId, null, "reconnecting");
      this.scheduleDisconnectCleanup(
        roomId,
        sessionId,
        peerId,
        client.id,
        client.data.sessionFenceToken as string | undefined
      );
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
      noop();
    }
  }

  private async rememberRecentRoom(roomId: string, sessionId: string) {
    try {
      await this.roomService.rememberRecentRoom(roomId, sessionId);
    } catch {
      noop();
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
    if (typeof headerToken === "string") {
      return headerToken;
    }

    return readUserSessionCookie(client.handshake.headers.cookie);
  }

  private assertRealtimeClient(client: Socket, roomId: string) {
    if (!client.data.isRealtimeAuthenticated || client.data.roomId !== roomId) {
      throw new WsException("Unauthorized realtime request.");
    }
  }

  private publishRealtime(channel: string, payload: unknown) {
    void (async () => {
      const retryDelaysMs = [0, 100, 250, 500, 1_000, 2_000];
      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        try {
          await this.redisService.publish(channel, payload);
          return;
        } catch {
          // Retry short Redis outages so ICE and room patches are not lost.
        }
      }
      this.metrics.incrementRealtimeFailure();
    })();
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
      protocolVersion: 4,
      capability: "webrtc-opus-v1",
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
    if (!this.pendingPeerSignalsByRoomPeer.has(key) && this.pendingPeerSignalsByRoomPeer.size >= this.pendingPeerSignalTargetLimit) {
      const oldestKey = this.pendingPeerSignalsByRoomPeer.keys().next().value;
      if (typeof oldestKey === "string") {
        this.pendingPeerSignalsByRoomPeer.delete(oldestKey);
      }
    }
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

  private assertRealtimeRateLimit(client: Socket, action: string, limit: number) {
    const now = Date.now();
    const limits = this.realtimeRateLimits.get(client.id) ?? new Map<string, RealtimeRateLimitBucket>();
    const current = limits.get(action);
    const bucket = !current || now - current.windowStartedAt >= 60_000
      ? { windowStartedAt: now, count: 0 }
      : current;
    if (bucket.count >= limit) {
      throw createWsApiException("Realtime message rate limit exceeded.", errorCodes.rateLimited);
    }
    bucket.count += 1;
    limits.set(action, bucket);
    this.realtimeRateLimits.set(client.id, limits);
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

  private async emitPeerSignalToPeer(
    roomId: string,
    peerId: string,
    payload: PeerSignalMessage
  ) {
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
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket && !(await this.isSocketSessionLeaseOwner(socket))) {
        continue;
      }
      this.server.to(socketId).emit("peer.signal", nextPayload);
    }
  }

  private async isSocketSessionLeaseOwner(socket: Socket) {
    const roomId = socket.data.roomId as string | undefined;
    const sessionId = socket.data.sessionId as string | undefined;
    const fenceToken = socket.data.sessionFenceToken as string | undefined;
    if (!roomId || !sessionId || !fenceToken) {
      return true;
    }

    try {
      const lease = await this.redisService.getJson<{
        socketId?: string;
        fenceToken?: string;
      }>(this.sessionLeaseKey(roomId, sessionId));
      return (
        !lease ||
        (lease.socketId === socket.id && lease.fenceToken === fenceToken)
      );
    } catch {
      return true;
    }
  }

  private scheduleDisconnectCleanup(
    roomId: string,
    sessionId: string,
    peerId?: string,
    socketId?: string,
    fenceToken?: string
  ) {
    this.cancelPendingDisconnectCleanup(roomId, sessionId);
    const cleanupKey = this.disconnectCleanupKey(roomId, sessionId);
    const timeoutId = setTimeout(() => {
      this.pendingDisconnectCleanupTimers.delete(cleanupKey);
      void this.finalizePeerDisconnect(roomId, sessionId, peerId, socketId, fenceToken);
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

  private async finalizePeerDisconnect(
    roomId: string,
    sessionId: string,
    peerId?: string,
    socketId?: string,
    fenceToken?: string
  ) {
    if (this.activeSessionsByRoom.get(roomId)?.has(sessionId)) {
      return;
    }

    const ownsLease = await this.sessionLeaseBelongsTo(roomId, sessionId, {
      peerId,
      socketId,
      fenceToken
    });
    if (!ownsLease) {
      return;
    }
    const deleted = await this.deleteSessionLease(roomId, sessionId, {
      peerId,
      socketId,
      fenceToken
    });
    if (!deleted) {
      return;
    }

    await this.updatePeerPresence(roomId, sessionId, null, "offline");
    if (peerId) {
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

  private sessionLeaseKey(roomId: string, sessionId: string) {
    return `music-room:realtime-session:${roomId}:${sessionId}`;
  }

  private async claimSessionLease(
    roomId: string,
    sessionId: string,
    peerId: string,
    socketId: string,
    fenceToken: string
  ) {
    try {
      const previous = await this.redisService.claimJsonLease(
        this.sessionLeaseKey(roomId, sessionId),
        {
          instanceId: this.roomRealtimeBroadcaster.instanceId,
          roomId,
          sessionId,
          peerId,
          socketId,
          fenceToken
        },
        this.sessionLeaseTtlMs
      );
      if (!previous || typeof previous !== "object") {
        return null;
      }
      return previous as SessionLease;
    } catch {
      // Local signaling remains available when Redis is temporarily down.
      return null;
    }
  }

  private async assertSessionLease(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    const fenceToken = client.data.sessionFenceToken as string | undefined;
    if (!roomId || !sessionId || !fenceToken) {
      return;
    }

    try {
      const lease = await this.redisService.getJson<{
        socketId?: string;
        fenceToken?: string;
      }>(this.sessionLeaseKey(roomId, sessionId));
      if (
        lease &&
        (lease.socketId !== client.id || lease.fenceToken !== fenceToken)
      ) {
        throw new WsException("Realtime session was replaced.");
      }
    } catch (error) {
      if (error instanceof WsException) {
        throw error;
      }
      // Redis failure must not take down an otherwise healthy local socket.
    }
  }

  private async assertUserStillActive(sessionId: string) {
    if (!sessionId) throw new WsException("Unauthorized realtime request.");
    try {
      const user = await this.authService.getUserOrThrow(sessionId) as { status?: string };
      if (user.status === "DISABLED") throw new WsException("Account is disabled.");
    } catch (error) {
      if (error instanceof WsException) throw error;
      throw new WsException("Unauthorized realtime request.");
    }
  }

  private async renewSessionLease(client: Socket) {
    const roomId = client.data.roomId as string;
    const sessionId = client.data.sessionId as string;
    const peerId = client.data.peerId as string;
    const fenceToken = client.data.sessionFenceToken as string;
    try {
      return await this.redisService.renewJsonLeaseIfValue(
        this.sessionLeaseKey(roomId, sessionId),
        {
          instanceId: this.roomRealtimeBroadcaster.instanceId,
          roomId,
          sessionId,
          peerId,
          socketId: client.id,
          fenceToken
        },
        this.sessionLeaseTtlMs
      );
    } catch {
      // A transient Redis outage should not interrupt local presence.
      return true;
    }
  }

  private async releaseSessionLease(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    const sessionId = client.data.sessionId as string | undefined;
    const fenceToken = client.data.sessionFenceToken as string | undefined;
    if (!roomId || !sessionId || !fenceToken) {
      return;
    }
    try {
      await this.redisService.deleteJsonIfValue(this.sessionLeaseKey(roomId, sessionId), {
        instanceId: this.roomRealtimeBroadcaster.instanceId,
        roomId,
        sessionId,
        peerId: client.data.peerId as string,
        socketId: client.id,
        fenceToken
      });
    } catch {
      // Lease expiry is the fallback cleanup path.
    }
  }

  private async sessionLeaseBelongsTo(
    roomId: string,
    sessionId: string,
    expected?: { peerId?: string; socketId?: string; fenceToken?: string }
  ) {
    try {
      const lease = await this.redisService.getJson<{
        peerId?: string;
        socketId?: string;
        fenceToken?: string;
      }>(this.sessionLeaseKey(roomId, sessionId));
      return (
        !lease ||
        ((!expected?.peerId || lease.peerId === expected.peerId) &&
          (!expected?.socketId || lease.socketId === expected.socketId) &&
          (!expected?.fenceToken || lease.fenceToken === expected.fenceToken))
      );
    } catch {
      return true;
    }
  }

  private async deleteSessionLease(
    roomId: string,
    sessionId: string,
    expected?: { peerId?: string; socketId?: string; fenceToken?: string }
  ) {
    if (!expected?.peerId || !expected.socketId || !expected.fenceToken) {
      return false;
    }

    try {
      // The old socket may be racing a replacement. Compare and delete in one
      // Redis operation so a lease claimed after this cleanup starts cannot
      // be removed by the stale disconnect timer.
      return await this.redisService.deleteJsonIfValue(this.sessionLeaseKey(roomId, sessionId), {
        instanceId: this.roomRealtimeBroadcaster.instanceId,
        roomId,
        sessionId,
        peerId: expected.peerId,
        socketId: expected.socketId,
        fenceToken: expected.fenceToken
      });
    } catch {
      // Ignore lease cleanup failures; the TTL limits stale ownership.
      return false;
    }
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
    socketId?: string,
    fenceToken = "local"
  ) {
    if (!roomId || !sessionId || !peerId || !socketId) {
      return;
    }

    const roomSessions = this.activeSessionsByRoom.get(roomId) ?? new Map();
    roomSessions.set(sessionId, { socketId, peerId, fenceToken });
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
        this.invalidateReplacedSocket(replacedSocket, roomId);
      }
      return;
    }


    await this.roomService.handleDuplicateSessionReplacement(roomId, sessionId);
    await this.roomRealtimePublisher.emitTopologySnapshot(roomId);

    if (!replacedSocket) {
      return;
    }

    this.invalidateReplacedSocket(replacedSocket, roomId);
  }

  private invalidateReplacedSocket(socket: Socket, roomId: string) {
    const sessionId = socket.data.sessionId as string | undefined;
    const peerId = socket.data.peerId as string | undefined;
    if (sessionId) {
      this.cancelPendingDisconnectCleanup(roomId, sessionId);
    }
    this.unregisterPeerSocket(roomId, peerId, socket.id);
    this.unregisterSessionSocket(roomId, sessionId, socket.id);
    this.metrics.unbindRealtimeSocket(socket.id);
    socket.emit("room.session.replaced", {
      roomId,
      reason: "duplicate-session"
    });
    socket.leave(roomId);
    socket.data.roomId = undefined;
    socket.data.sessionId = undefined;
    socket.data.peerId = undefined;
    socket.data.sessionFenceToken = undefined;
    socket.data.isRealtimeAuthenticated = false;
  }
}

function noop() {}
