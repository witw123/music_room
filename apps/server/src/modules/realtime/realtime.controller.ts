import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { RealtimeService } from "./realtime.service";

@Controller("v1/realtime")
export class RealtimeController {
  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly authService: AuthService
  ) {}

  @Get("ice-config")
  async getIceConfig(@Headers("x-session-token") sessionToken: string | undefined) {
    try {
      const session = await this.authService.getAuthSessionByTokenOrThrow(sessionToken);
      return this.realtimeService.buildIceConfig(session.userId);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
