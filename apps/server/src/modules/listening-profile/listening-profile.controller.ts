import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import {
  recordListeningProfileEventSchema,
  resolveListeningTrackMetadataSchema
} from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { ListeningProfileService } from "./listening-profile.service";

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

  @Post("metadata")
  async resolveMetadata(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: unknown
  ) {
    return this.listeningProfile.resolveTrackMetadata(
      await this.getCurrentUserId(sessionToken),
      parseRequestBody(resolveListeningTrackMetadataSchema, body)
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
