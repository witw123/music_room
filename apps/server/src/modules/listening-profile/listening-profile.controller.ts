import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import {
  recordListeningProfileEventSchema,
  saveListeningAudioFeaturesSchema
} from "@music-room/shared";
import { z } from "zod";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { ListeningProfileService } from "./listening-profile.service";

const featureParamsSchema = z.object({
  trackKey: z.string().trim().min(1).max(512)
}).strict();

@Controller("v1/listening-profile")
export class ListeningProfileController {
  constructor(
    private readonly listeningProfile: ListeningProfileService,
    private readonly auth: AuthService
  ) {}

  @Get()
  async getProfile(@Headers("x-session-token") sessionToken?: string) {
    return this.listeningProfile.getProfile(await this.getCurrentUserId(sessionToken));
  }

  @Post("events")
  async recordEvent(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: unknown
  ) {
    return this.listeningProfile.recordEvent(
      await this.getCurrentUserId(sessionToken),
      parseRequestBody(recordListeningProfileEventSchema, body)
    );
  }

  @Get("audio-features/:trackKey")
  async getAudioFeatures(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Param() params: Record<string, unknown>
  ) {
    await this.getCurrentUserId(sessionToken);
    return this.listeningProfile.getAudioFeature(
      parseRequestBody(featureParamsSchema, params).trackKey
    );
  }

  @Post("audio-features")
  async saveAudioFeatures(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: unknown
  ) {
    await this.getCurrentUserId(sessionToken);
    return this.listeningProfile.saveAudioFeature(
      parseRequestBody(saveListeningAudioFeaturesSchema, body)
    );
  }

  @Delete()
  async clear(@Headers("x-session-token") sessionToken?: string) {
    return this.listeningProfile.clearProfile(await this.getCurrentUserId(sessionToken));
  }

  private async getCurrentUserId(sessionToken?: string) {
    try {
      return (await this.auth.getAuthSessionByTokenOrThrow(sessionToken)).userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
