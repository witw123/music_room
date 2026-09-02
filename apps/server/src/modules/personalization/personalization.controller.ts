import { Body, Controller, Delete, Get, Headers, Optional, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import {
  coldStartTasteInputSchema,
  personalizationFeedbackSchema,
  personalizationRecommendationsQuerySchema,
  recordPersonalizationEventSchema,
  trackRadioQuerySchema
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { resolveClientIp } from "../../common/security/client-ip";
import { AbuseProtectionService } from "../../common/security/abuse-protection.service";
import { PersonalizationService } from "./personalization.service";

@Controller("v1/personalization")
export class PersonalizationController {
  constructor(
    private readonly personalization: PersonalizationService,
    private readonly auth: AuthService,
    @Optional()
    private readonly abuseProtection?: AbuseProtectionService
  ) {}

  private async assertRateLimit(
    scope: "profile" | "events" | "recommendations" | "feedback" | "exclusions" | "radio" | "cold-start",
    userId: string,
    request: { ip?: string; socket?: { remoteAddress?: string } },
    limits: { limit: number; windowMs: number }
  ) {
    await this.abuseProtection?.enforce(
      `personalization:${scope}`,
      [
        { name: "user", value: userId },
        { name: "ip", value: resolveClientIp(request) }
      ],
      limits
    );
  }

  @Get("profile")
  async getProfile(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } }
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("profile", userId, request, { limit: 120, windowMs: 60_000 });
    return this.personalization.getProfile(userId);
  }

  @Post("events")
  async recordEvent(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } },
    @Body() body: unknown
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("events", userId, request, { limit: 600, windowMs: 60_000 });
    return this.personalization.recordEvent(
      userId,
      parseRequestBody(recordPersonalizationEventSchema, body)
    );
  }

  @Get("recommendations")
  async getRecommendations(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } },
    @Query() query: Record<string, unknown>
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("recommendations", userId, request, { limit: 120, windowMs: 60_000 });
    return this.personalization.getRecommendations(
      userId,
      parseRequestBody(personalizationRecommendationsQuerySchema, query)
    );
  }

  @Post("feedback")
  async recordFeedback(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } },
    @Body() body: unknown
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("feedback", userId, request, { limit: 60, windowMs: 60_000 });
    return this.personalization.recordFeedback(
      userId,
      parseRequestBody(personalizationFeedbackSchema, body)
    );
  }

  @Get("exclusions")
  async listExclusions(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } }
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("exclusions", userId, request, { limit: 60, windowMs: 60_000 });
    return this.personalization.listExclusions(userId);
  }

  @Delete("exclusions/:kind/:key")
  async removeExclusion(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } },
    @Param("kind") kind: "track" | "artist",
    @Param("key") key: string
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("exclusions", userId, request, { limit: 60, windowMs: 60_000 });
    return this.personalization.removeExclusion(userId, kind, key);
  }

  @Post("radio")
  async getTrackRadio(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } },
    @Body() body: unknown
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("radio", userId, request, { limit: 30, windowMs: 60_000 });
    return this.personalization.getTrackRadio(
      userId,
      parseRequestBody(trackRadioQuerySchema, body)
    );
  }

  @Post("cold-start")
  async bootstrapColdStart(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } },
    @Body() body: unknown
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("cold-start", userId, request, { limit: 10, windowMs: 60_000 });
    return this.personalization.bootstrapColdStartProfile(
      userId,
      parseRequestBody(coldStartTasteInputSchema, body)
    );
  }

  @Delete("profile")
  async clearProfile(
    @Headers("x-session-token") token: string | undefined,
    @Req() request: { ip?: string; socket?: { remoteAddress?: string } }
  ) {
    const userId = await this.currentUserId(token);
    await this.assertRateLimit("profile", userId, request, { limit: 20, windowMs: 60_000 });
    return this.personalization.clearProfile(userId);
  }

  private async currentUserId(token?: string) {
    try {
      return (await this.auth.getAuthSessionByTokenOrThrow(token)).userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}

