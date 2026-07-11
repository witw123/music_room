import {
  Controller,
  Get,
  Headers,
  InternalServerErrorException,
  UnauthorizedException
} from "@nestjs/common";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";
import { MetricsService } from "../../common/metrics/metrics.service";
import { AuthService } from "../auth/auth.service";
import { RealtimeService } from "./realtime.service";
import { getSessionTokenFromCookie } from "../../common/auth/session-cookie";

@Controller("v1/realtime")
export class RealtimeController {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly authService: AuthService,
    private readonly metrics: MetricsService
  ) {}

  @Get("ice-config")
  async getIceConfig(
    @Headers("cookie") sessionToken: string | undefined,
    @Headers("host") host: string | undefined,
    @Headers("x-forwarded-host") forwardedHost: string | undefined
  ) {
    let userId: string;
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(getSessionTokenFromCookie(sessionToken));
      userId = session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }

    try {
      return this.realtimeService.buildIceConfig(userId, {
        requestHost: forwardedHost || host
      });
    } catch (error) {
      this.metrics.incrementIceFailure();
      throw new InternalServerErrorException(
        createApiErrorResponse(
          errorCodes.realtimeUnavailable,
          error instanceof Error ? error.message : "Failed to build ICE config."
        )
      );
    }
  }
}
