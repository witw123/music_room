import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import { z } from "zod";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { PlaybackHistoryService } from "./playback-history.service";

const providerSchema = z.enum(["local_upload", "netease", "qqmusic"]);

const recordPlaybackSchema = z.object({
  provider: providerSchema,
  providerTrackId: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(240),
  artist: z.string().trim().min(1).max(240),
  album: z.string().trim().max(240).nullable(),
  durationMs: z.number().int().min(0).max(86_400_000),
  listenedMs: z.number().int().min(1).max(120_000)
}).strict();

export type RecordPlaybackInput = z.infer<typeof recordPlaybackSchema>;

@Controller("v1/playback-history")
export class PlaybackHistoryController {
  constructor(
    private readonly history: PlaybackHistoryService,
    private readonly auth: AuthService
  ) {}

  @Get("stats")
  async stats(@Headers("x-session-token") sessionToken?: string) {
    return this.history.getStats(await this.getCurrentUserId(sessionToken));
  }

  @Post()
  async record(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: unknown
  ) {
    const input = parseRequestBody(recordPlaybackSchema, body);
    return this.history.record(await this.getCurrentUserId(sessionToken), input);
  }

  private async getCurrentUserId(sessionToken?: string) {
    try {
      return (await this.auth.getAuthSessionByTokenOrThrow(sessionToken)).userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
