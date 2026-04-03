import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { RoomService } from "../room/room.service";
import { SignalingGateway } from "../signaling/signaling.gateway";

type PlaybackAction = "play" | "pause" | "seek" | "next" | "prev";

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
    private readonly signalingGateway: SignalingGateway,
    private readonly authService: AuthService
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
      positionMs?: number;
      expectedVersion?: number;
    }
  ) {
    const userId = await this.getCurrentUserId(sessionToken);

    if (!this.roomService.isRealtimeAvailable()) {
      this.logger.warn(
        `rejected playback update room=${roomId} actor=${userId} reason=realtime-unavailable`
      );
      throw new ServiceUnavailableException("Realtime sync unavailable.");
    }

    if (typeof body.expectedVersion !== "number") {
      this.logger.warn(
        `rejected playback update room=${roomId} actor=${userId} reason=missing-expected-version`
      );
      throw new HttpException("Playback state version conflict.", HttpStatus.CONFLICT);
    }

    this.assertPlaybackRateLimit(roomId, userId, body.action);

    try {
      const playback = await this.roomService.updatePlayback(roomId, {
        ...body,
        expectedVersion: body.expectedVersion,
        actorSessionId: userId
      });
      this.logger.log(
        `accepted playback update room=${roomId} actor=${userId} action=${body.action} expectedVersion=${body.expectedVersion} nextVersion=${playback.queueVersion}`
      );
      this.signalingGateway.emitPlaybackPatch(roomId, { playback });
      return playback;
    } catch (error) {
      this.logger.warn(
        `rejected playback update room=${roomId} actor=${userId} action=${body.action} expectedVersion=${body.expectedVersion} reason=${error instanceof Error ? error.message : "unknown"}`
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
      throw new HttpException(message, HttpStatus.CONFLICT);
    }

    if (message.includes("Track owner is not online")) {
      throw new HttpException(message, HttpStatus.CONFLICT);
    }

    if (message.includes("Queue item not found") || message.includes("Track not found")) {
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }

    if (message.includes("Only room members can perform this action")) {
      throw new HttpException(message, HttpStatus.FORBIDDEN);
    }

    if (message.includes("Realtime sync unavailable")) {
      throw new ServiceUnavailableException(message);
    }

    throw error instanceof Error ? error : new Error(message);
  }

  private assertPlaybackRateLimit(roomId: string, userId: string, action: PlaybackAction) {
    const now = Date.now();
    const windowMs = 1_000;
    const limits =
      action === "seek"
        ? { perUser: 8, perRoom: 24 }
        : { perUser: 4, perRoom: 12 };

    this.pruneRateLimitBucket(this.userRateLimits, `${userId}:${action}`, now, windowMs);
    this.pruneRateLimitBucket(this.roomRateLimits, `${roomId}:${action}`, now, windowMs);

    const userBucket = this.userRateLimits.get(`${userId}:${action}`)!;
    const roomBucket = this.roomRateLimits.get(`${roomId}:${action}`)!;

    if (userBucket.timestamps.length >= limits.perUser || roomBucket.timestamps.length >= limits.perRoom) {
      throw new HttpException(
        "Playback control rate limit exceeded.",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    userBucket.timestamps.push(now);
    roomBucket.timestamps.push(now);
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
