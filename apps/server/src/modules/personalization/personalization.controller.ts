import { Body, Controller, Delete, Get, Headers, Param, Post, Query, UnauthorizedException } from "@nestjs/common";
import {
  personalizationFeedbackSchema,
  personalizationRecommendationsQuerySchema,
  recordPersonalizationEventSchema
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { PersonalizationService } from "./personalization.service";

@Controller("v1/personalization")
export class PersonalizationController {
  constructor(
    private readonly personalization: PersonalizationService,
    private readonly auth: AuthService
  ) {}

  @Get("profile")
  async getProfile(@Headers("x-session-token") token?: string) {
    return this.personalization.getProfile(await this.currentUserId(token));
  }

  @Post("events")
  async recordEvent(@Headers("x-session-token") token: string | undefined, @Body() body: unknown) {
    return this.personalization.recordEvent(
      await this.currentUserId(token),
      parseRequestBody(recordPersonalizationEventSchema, body)
    );
  }

  @Post("provider-sync")
  async syncProviders(@Headers("x-session-token") token?: string) {
    return this.personalization.syncProviders(await this.currentUserId(token), true);
  }

  @Get("recommendations")
  async getRecommendations(
    @Headers("x-session-token") token: string | undefined,
    @Query() query: Record<string, unknown>
  ) {
    return this.personalization.getRecommendations(
      await this.currentUserId(token),
      parseRequestBody(personalizationRecommendationsQuerySchema, query)
    );
  }

  @Post("feedback")
  async recordFeedback(@Headers("x-session-token") token: string | undefined, @Body() body: unknown) {
    return this.personalization.recordFeedback(
      await this.currentUserId(token),
      parseRequestBody(personalizationFeedbackSchema, body)
    );
  }

  @Get("exclusions")
  async listExclusions(@Headers("x-session-token") token?: string) {
    return this.personalization.listExclusions(await this.currentUserId(token));
  }

  @Delete("exclusions/:kind/:key")
  async removeExclusion(
    @Headers("x-session-token") token: string | undefined,
    @Param("kind") kind: "track" | "artist",
    @Param("key") key: string
  ) {
    return this.personalization.removeExclusion(await this.currentUserId(token), kind, key);
  }

  @Delete("profile")
  async clearProfile(@Headers("x-session-token") token?: string) {
    return this.personalization.clearProfile(await this.currentUserId(token));
  }

  private async currentUserId(token?: string) {
    try {
      return (await this.auth.getAuthSessionByTokenOrThrow(token)).userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
