import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Ip,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { AuthService } from "./auth.service";

type AuthRateLimitBucket = {
  timestamps: number[];
};

@Controller("v1/auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly ipBuckets = new Map<string, AuthRateLimitBucket>();
  private readonly usernameBuckets = new Map<string, AuthRateLimitBucket>();

  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(
    @Body() body: { username?: string; password?: string; nickname?: string },
    @Req()
    request: {
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
    },
    @Ip() ipAddress?: string
  ) {
    const username = body.username ?? "";
    const clientIp = resolveClientIp(request, ipAddress);
    this.assertAuthRateLimit("register", clientIp, username);

    try {
      const session = await this.authService.register({
        username,
        password: body.password ?? "",
        nickname: body.nickname ?? ""
      });
      this.logger.log(
        this.buildAuthLog("register.accepted", clientIp, username, HttpStatus.CREATED)
      );
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid payload.";
      this.logger.warn(
        this.buildAuthLog("register.rejected", clientIp, username, HttpStatus.BAD_REQUEST, message)
      );
      if (message.includes("Username already exists")) {
        throw new ConflictException(message);
      }
      if (message.includes("Account storage is temporarily unavailable")) {
        throw new ServiceUnavailableException(message);
      }
      throw new BadRequestException(message);
    }
  }

  @Post("login")
  async login(
    @Body() body: { username?: string; password?: string },
    @Req()
    request: {
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
    },
    @Ip() ipAddress?: string
  ) {
    const username = body.username ?? "";
    const clientIp = resolveClientIp(request, ipAddress);
    this.assertAuthRateLimit("login", clientIp, username);

    try {
      const session = await this.authService.login({
        username,
        password: body.password ?? ""
      });
      this.logger.log(this.buildAuthLog("login.accepted", clientIp, username, HttpStatus.OK));
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unauthorized.";
      this.logger.warn(
        this.buildAuthLog("login.rejected", clientIp, username, HttpStatus.UNAUTHORIZED, message)
      );
      if (message.includes("Account storage is temporarily unavailable")) {
        throw new ServiceUnavailableException(message);
      }
      throw new UnauthorizedException(message);
    }
  }

  @Post("logout")
  async logout(@Headers("x-session-token") sessionToken: string | undefined) {
    return this.authService.logout(sessionToken);
  }

  @Get("me")
  async me(@Headers("x-session-token") sessionToken: string | undefined) {
    try {
      return await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  private assertAuthRateLimit(action: "register" | "login", clientIp: string, username: string) {
    const limits =
      action === "register"
        ? { perIp: 8, perUsername: 4, windowMs: 60_000 }
        : { perIp: 12, perUsername: 6, windowMs: 60_000 };
    const now = Date.now();
    const normalizedUsername = username.trim().toLowerCase() || "anonymous";

    const ipBucket = this.getRateLimitBucket(
      this.ipBuckets,
      `${action}:ip:${clientIp}`,
      now,
      limits.windowMs
    );
    const usernameBucket = this.getRateLimitBucket(
      this.usernameBuckets,
      `${action}:username:${normalizedUsername}`,
      now,
      limits.windowMs
    );

    if (ipBucket.timestamps.length >= limits.perIp || usernameBucket.timestamps.length >= limits.perUsername) {
      this.logger.warn(
        this.buildAuthLog(
          `${action}.rate-limited`,
          clientIp,
          normalizedUsername,
          HttpStatus.TOO_MANY_REQUESTS,
          "Auth rate limit exceeded."
        )
      );
      throw new HttpException("Auth rate limit exceeded.", HttpStatus.TOO_MANY_REQUESTS);
    }

    ipBucket.timestamps.push(now);
    usernameBucket.timestamps.push(now);
  }

  private getRateLimitBucket(
    buckets: Map<string, AuthRateLimitBucket>,
    key: string,
    now: number,
    windowMs: number
  ) {
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);
    buckets.set(key, bucket);
    return bucket;
  }

  private buildAuthLog(
    event: string,
    clientIp: string,
    username: string,
    statusCode: number,
    reason?: string
  ) {
    return JSON.stringify({
      event,
      statusCode,
      username: username.trim().toLowerCase() || "anonymous",
      clientIp,
      reason: reason ?? null,
      timestamp: new Date().toISOString()
    });
  }
}

function resolveClientIp(
  request: {
    ip?: string;
    headers?: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
  },
  ipAddress?: string
) {
  const forwardedHeader = request.headers?.["x-forwarded-for"];
  const forwarded = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  const realIpHeader = request.headers?.["x-real-ip"];
  const realIp = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader;
  if (realIp) {
    return realIp.trim();
  }

  return ipAddress?.trim() || request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
}
