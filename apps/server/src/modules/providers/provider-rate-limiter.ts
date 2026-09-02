import { HttpException, HttpStatus } from "@nestjs/common";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";

/**
 * In-memory sliding-window rate limiter shared by the provider services
 * (NetEase / QQ Music). Buckets live per service instance; the key is
 * expected to encode the user (e.g. `search:${userId}`) so limits apply per
 * user per action.
 */
export class ProviderRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly options: {
      /** Default window when a call does not pass one explicitly. */
      defaultWindowMs?: number;
      /** Provider name used in the error message. */
      providerLabel: string;
    }
  ) {}

  assert(key: string, limit: number, windowMs = this.options.defaultWindowMs ?? 60_000): void {
    const now = Date.now();
    const live = (this.buckets.get(key) ?? []).filter(
      (timestamp) => now - timestamp < windowMs
    );
    if (live.length >= limit) {
      throw new HttpException(
        createApiErrorResponse(
          errorCodes.rateLimited,
          `${this.options.providerLabel} request rate limit exceeded.`
        ),
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    live.push(now);
    this.buckets.set(key, live);
  }
}
