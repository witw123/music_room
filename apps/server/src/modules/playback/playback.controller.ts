import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { createApiErrorResponse, errorCodes, updatePlaybackRequestSchema } from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { MetricsService } from "../../common/metrics/metrics.service";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";
import { RedisService } from "../../infra/redis/redis.service";
import { getSessionTokenFromCookie } from "../../common/auth/session-cookie";

type PlaybackAction = "play" | "pause" | "seek" | "next" | "prev";

@Controller("v1/rooms/:roomId/playback")
export class PlaybackController {
  private readonly logger = new Logger(PlaybackController.name);

  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService,
    private readonly metrics: MetricsService,
    @Optional() private readonly redis?: RedisService
  ) {}

  private async getCurrentUserId(cookieHeader?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(getSessionTokenFromCookie(cookieHeader));
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Patch()
  async updatePlayback(
    @Param("roomId") roomId: string,
    @Headers("cookie") sessionToken: string | undefined,
    @Body()
    body: {
      action: PlaybackAction;
      trackId?: string;
      queueItemId?: string;
      positionMs?: number;
      actorPeerId?: string;
      expectedVersion?: number;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(updatePlaybackRequestSchema, body);

    if (!this.roomService.isRealtimeAvailable()) {
      this.logger.warn(
        `rejected playback update room=${roomId} actor=${userId} reason=realtime-unavailable`
      );
      this.metrics.incrementRealtimeFailure();
      throw new ServiceUnavailableException(
        createApiErrorResponse(errorCodes.realtimeUnavailable, "Realtime sync unavailable.")
      );
    }

    await this.assertPlaybackRateLimit(roomId, userId, payload.action);

    try {
      const playback = await this.roomService.updatePlayback(roomId, {
        ...payload,
        expectedVersion: payload.expectedVersion,
        actorSessionId: userId
      });
      this.logger.log(
        `accepted playback update room=${roomId} actor=${userId} action=${payload.action} expectedVersion=${payload.expectedVersion} nextVersion=${playback.playbackRevision}`
      );
      this.roomRealtimePublisher.emitPlaybackPatch(roomId, playback);
      return playback;
    } catch (error) {
      this.logger.warn(
        `rejected playback update room=${roomId} actor=${userId} action=${payload.action} expectedVersion=${payload.expectedVersion} reason=${error instanceof Error ? error.message : "unknown"}`
      );
      this.rethrowPlaybackError(error);
    }
  }

  private rethrowPlaybackError(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Internal server error";

    if (message.includes("Playback state version conflict")) {
      this.metrics.incrementPlaybackConflict();
      throw new HttpException(
        createApiErrorResponse(errorCodes.playbackVersionConflict, message),
        HttpStatus.CONFLICT
      );
    }

    if (message.includes("Track owner is not online")) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.trackOwnerOffline, message),
        HttpStatus.CONFLICT
      );
    }

    if (message.includes("Queue item not found") || message.includes("Track not found")) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.roomNotFound, message),
        HttpStatus.NOT_FOUND
      );
    }

    if (message.includes("Only room members can perform this action")) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.unauthorizedRoomAction, message),
        HttpStatus.FORBIDDEN
      );
    }

    if (message.includes("Realtime sync unavailable")) {
      this.metrics.incrementRealtimeFailure();
      throw new ServiceUnavailableException(
        createApiErrorResponse(errorCodes.realtimeUnavailable, message)
      );
    }

    throw error instanceof Error ? error : new Error(message);
  }

  private async assertPlaybackRateLimit(roomId: string, userId: string, action: PlaybackAction) {
    const windowMs = 1_000;
    const limits =
      action === "seek"
        ? { perUser: 8, perRoom: 24 }
        : { perUser: 4, perRoom: 12 };

    if (!this.redis?.isAvailable()) {
      if (process.env.NODE_ENV === "test" && !this.redis) return;
      throw new ServiceUnavailableException(
        createApiErrorResponse(errorCodes.realtimeUnavailable, "Playback rate limit unavailable.")
      );
    }
    const [userCount, roomCount] = await Promise.all([
      this.redis.incrementWithTtlMs(`playback-rate:user:${userId}:${action}`, windowMs),
      this.redis.incrementWithTtlMs(`playback-rate:room:${roomId}:${action}`, windowMs)
    ]);
    if (userCount > limits.perUser || roomCount > limits.perRoom) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.rateLimited, "Playback control rate limit exceeded."),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

  }
}
