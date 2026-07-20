import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Optional,
  Param,
  Patch,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { createApiErrorResponse, errorCodes, updatePlaybackRequestSchema } from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { MetricsService } from "../../common/metrics/metrics.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";
import { RoomService } from "../room/room.service";

type PlaybackAction = "play" | "pause" | "seek" | "next" | "prev" | "gapless-next" | "set-mode";

type PlaybackRateLimitBucket = {
  timestamps: number[];
};

@Controller("v1/rooms/:roomId/playback")
export class PlaybackController {
  private readonly logger = new Logger(PlaybackController.name);
  private readonly userRateLimits = new Map<string, PlaybackRateLimitBucket>();
  private readonly roomRateLimits = new Map<string, PlaybackRateLimitBucket>();

  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher,
    private readonly authService: AuthService,
    private readonly metrics: MetricsService,
    @Optional() private readonly redisService?: RedisService
  ) {}

  private async getCurrentUserId(sessionToken?: string) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  @Patch()
  async updatePlayback(
    @Param("roomId") roomId: string,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body()
    body: {
      action: PlaybackAction;
      trackId?: string;
      queueItemId?: string;
      playbackAssetId?: string;
      positionMs?: number;
      playbackMode?: import("@music-room/shared").PlaybackMode;
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

    if (
      message.includes("Playback state version conflict") ||
      message.includes("Room state revision conflict")
    ) {
      const conflictMessage = "Playback state version conflict.";
      this.metrics.incrementPlaybackConflict();
      throw new HttpException(
        createApiErrorResponse(errorCodes.playbackVersionConflict, conflictMessage),
        HttpStatus.CONFLICT
      );
    }

    if (message.includes("Track owner is not online")) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.trackOwnerOffline, message),
        HttpStatus.CONFLICT
      );
    }

    if (message.includes("Playback asset does not belong")) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, message),
        HttpStatus.BAD_REQUEST
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

    const redisResult = await this.tryRedisRateLimit(roomId, userId, action, limits, windowMs);
    if (redisResult === "limited") {
      throw new HttpException(
        createApiErrorResponse(errorCodes.rateLimited, "Playback control rate limit exceeded."),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    if (redisResult === "accepted") {
      return;
    }

    // Fallback to process-local buckets when Redis is unavailable.
    const now = Date.now();
    this.pruneRateLimitBucket(this.userRateLimits, `${userId}:${action}`, now, windowMs);
    this.pruneRateLimitBucket(this.roomRateLimits, `${roomId}:${action}`, now, windowMs);

    const userBucket = this.userRateLimits.get(`${userId}:${action}`)!;
    const roomBucket = this.roomRateLimits.get(`${roomId}:${action}`)!;

    if (userBucket.timestamps.length >= limits.perUser || roomBucket.timestamps.length >= limits.perRoom) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.rateLimited, "Playback control rate limit exceeded."),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    userBucket.timestamps.push(now);
    roomBucket.timestamps.push(now);
  }

  private async tryRedisRateLimit(
    roomId: string,
    userId: string,
    action: PlaybackAction,
    limits: { perUser: number; perRoom: number },
    windowMs: number
  ): Promise<"accepted" | "limited" | "fallback"> {
    if (!this.redisService || typeof this.redisService.incrementWithTtlMs !== "function") {
      return "fallback";
    }

    try {
      const available =
        typeof this.redisService.isAvailable === "function"
          ? this.redisService.isAvailable()
          : true;
      if (!available) {
        return "fallback";
      }

      const [userCount, roomCount] = await Promise.all([
        this.redisService.incrementWithTtlMs(
          `music-room:rate:playback:user:${userId}:${action}`,
          windowMs
        ),
        this.redisService.incrementWithTtlMs(
          `music-room:rate:playback:room:${roomId}:${action}`,
          windowMs
        )
      ]);

      if (userCount > limits.perUser || roomCount > limits.perRoom) {
        return "limited";
      }
      return "accepted";
    } catch (error) {
      this.logger.warn(
        `Playback redis rate limit unavailable; falling back to memory. ${String(error)}`
      );
      return "fallback";
    }
  }

  private pruneRateLimitBucket(
    buckets: Map<string, PlaybackRateLimitBucket>,
    key: string,
    now: number,
    windowMs: number
  ) {
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);
    buckets.set(key, bucket);
  }
}
