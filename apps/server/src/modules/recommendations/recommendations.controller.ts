import { Controller, Get, Headers, Query, UnauthorizedException } from "@nestjs/common";
import { lastFmSimilarTracksQuerySchema } from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { RecommendationsService } from "./recommendations.service";

@Controller("v1/recommendations")
export class RecommendationsController {
  constructor(
    private readonly recommendations: RecommendationsService,
    private readonly auth: AuthService
  ) {}

  @Get("lastfm/similar-tracks")
  async getLastFmSimilarTracks(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(lastFmSimilarTracksQuerySchema, query);
    return this.recommendations.getLastFmSimilarTracks(userId, payload);
  }

  private async getCurrentUserId(sessionToken?: string) {
    try {
      const session = await this.auth.getAuthSessionByTokenOrThrow(sessionToken);
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
