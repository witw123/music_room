import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Ip,
  Optional,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { loginRequestSchema, registerRequestSchema } from "@music-room/shared";
import { RedisService } from "../../infra/redis/redis.service";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "./auth.service";
import {
  buildCookie,
  csrfCookieName,
  getSessionTokenFromCookie,
  resolveSameSite,
  sessionCookieName,
  sessionTtlMs
} from "../../common/auth/session-cookie";

type AuthRateLimitBucket = {
  timestamps: number[];
};

type AuthRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  res?: { getHeader(name: string): unknown; setHeader(name: string, value: string | string[]): void };
};

@Controller("v1/auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly ipBuckets = new Map<string, AuthRateLimitBucket>();
  private readonly usernameBuckets = new Map<string, AuthRateLimitBucket>();

  constructor(
    private readonly authService: AuthService,
    @Optional()
    private readonly redisService?: RedisService
  ) {}

  @Post("register")
  async register(
    @Body() body: { username?: string; password?: string; nickname?: string },
    @Req()
    request: AuthRequest,
    @Ip() ipAddress?: string
  ) {
    const payload = parseRequestBody(registerRequestSchema, body);
    const username = payload.username;
    const clientIp = resolveClientIp(request, ipAddress);
    await this.assertAuthRateLimit("register", clientIp, username);

    try {
      const created = await this.authService.register({
        username,
        password: payload.password,
        nickname: payload.nickname
      });
      this.logger.log(
        this.buildAuthLog("register.accepted", clientIp, username, HttpStatus.CREATED)
      );
      this.setSessionCookie(request, created.token);
      const { token: _token, ...session } = created;
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
    request: AuthRequest,
    @Ip() ipAddress?: string
  ) {
    const payload = parseRequestBody(loginRequestSchema, body);
    const username = payload.username;
    const clientIp = resolveClientIp(request, ipAddress);
    await this.assertAuthRateLimit("login", clientIp, username);

    try {
      const created = await this.authService.login({
        username,
        password: payload.password
      });
      this.logger.log(this.buildAuthLog("login.accepted", clientIp, username, HttpStatus.OK));
      this.setSessionCookie(request, created.token);
      const { token: _token, ...session } = created;
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

  @Post("csrf")
  issueCsrf(@Req() request: AuthRequest) {
    const token = randomBytes(32).toString("base64url");
    this.appendCookie(
      request,
      buildCookie(csrfCookieName, token, {
        maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
        sameSite: resolveSameSite(readHeader(request, "origin"))
      })
    );
    return { csrfToken: token };
  }

  @Post("logout")
  async logout(@Req() request: AuthRequest) {
    const result = await this.authService.logout(
      getSessionTokenFromCookie(readHeader(request, "cookie"))
    );
    this.appendCookie(request, buildCookie(sessionCookieName, "", { maxAgeSeconds: 0 }));
    return result;
  }

  @Get("me")
  async me(@Req() request: AuthRequest) {
    try {
      return await this.authService.getAuthSessionByTokenOrThrow(
        getSessionTokenFromCookie(readHeader(request, "cookie"))
      );
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }

  private setSessionCookie(request: AuthRequest, token: string) {
    this.appendCookie(
      request,
      buildCookie(sessionCookieName, token, {
        maxAgeSeconds: Math.floor(sessionTtlMs / 1000),
        sameSite: resolveSameSite(readHeader(request, "origin"))
      })
    );
  }

  private appendCookie(request: AuthRequest, cookie: string) {
    const response = request.res;
    if (!response) return;
    const current = response.getHeader("set-cookie");
    const values = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
    response.setHeader("set-cookie", [...values, cookie]);
  }

  private async assertAuthRateLimit(action: "register" | "login", clientIp: string, username: string) {
    const limits =
      action === "register"
        ? { perIp: 8, perUsername: 4, windowMs: 60_000 }
        : { perIp: 12, perUsername: 6, windowMs: 60_000 };
    const now = Date.now();
    const normalizedUsername = username.trim().toLowerCase() || "anonymous";

    const redisLimited = await this.tryAssertRedisRateLimit(
      action,
      clientIp,
      normalizedUsername,
      limits
    );
    if (redisLimited === "accepted") {
      return;
    }

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

  private async tryAssertRedisRateLimit(
    action: "register" | "login",
    clientIp: string,
    normalizedUsername: string,
    limits: { perIp: number; perUsername: number; windowMs: number }
  ): Promise<"accepted" | "fallback"> {
    if (
      !this.redisService ||
      (typeof this.redisService.isAvailable === "function" && !this.redisService.isAvailable())
    ) {
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Auth rate limit storage is temporarily unavailable.");
      }
      return "fallback";
    }

    try {
      const [ipCount, usernameCount] = await Promise.all([
        this.incrementRedisRateLimitKey(`auth:${action}:ip:${clientIp}`, limits.windowMs),
        this.incrementRedisRateLimitKey(
          `auth:${action}:username:${normalizedUsername}`,
          limits.windowMs
        )
      ]);

      if (ipCount > limits.perIp || usernameCount > limits.perUsername) {
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

      return "accepted";
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (process.env.NODE_ENV === "production") {
        throw new ServiceUnavailableException("Auth rate limit storage is temporarily unavailable.");
      }
      this.logger.warn(`Auth redis rate limit unavailable; falling back to memory. ${String(error)}`);
      return "fallback";
    }
  }

  private async incrementRedisRateLimitKey(key: string, windowMs: number) {
    if (!this.redisService) {
      throw new Error("Redis service unavailable.");
    }

    return this.redisService.incrementWithTtlMs(key, windowMs);
  }

  private getRateLimitBucket(
    buckets: Map<string, AuthRateLimitBucket>,
    key: string,
    now: number,
    windowMs: number
  ) {
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (bucket.timestamps.length === 0) buckets.delete(key);
    buckets.set(key, bucket);
    if (buckets.size > 10_000) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (oldestKey) buckets.delete(oldestKey);
    }
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
  request: AuthRequest,
  ipAddress?: string
) {
  return ipAddress?.trim() || request.ip?.trim() || request.socket?.remoteAddress?.trim() || "unknown";
}

function readHeader(request: AuthRequest, name: string) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}
