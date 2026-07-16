import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Transform } from "node:stream";
import { createApiErrorResponse, errorCodes } from "@music-room/shared";
import { AuthService } from "../../auth/auth.service";
import { parseRequestBody } from "../../../common/validation/zod-validation";
import {
  spotifyQualitySchema,
  spotifySearchQuerySchema,
  spotifyTrackIdSchema
} from "./spotify.schemas";
import { SpotifyService } from "./spotify.service";
import { ZotifyDownloadService } from "./zotify-download.service";

@Controller("v1/providers/spotify")
export class SpotifyController {
  constructor(
    private readonly service: SpotifyService,
    private readonly downloads: ZotifyDownloadService,
    private readonly auth: AuthService
  ) {}

  @Get("account")
  async getAccount(@Headers("x-session-token") sessionToken: string | undefined) {
    return this.service.getAccountStatus(await this.getCurrentUserId(sessionToken));
  }

  @Get("search")
  async search(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(spotifySearchQuerySchema, query);
    return this.service.searchTracks(userId, payload);
  }

  @Get("tracks/:trackId")
  async getTrack(
    @Param("trackId") trackId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.service.getTrack(userId, spotifyTrackIdSchema.parse(trackId));
  }

  @Get("tracks/:trackId/audio")
  async audio(
    @Param("trackId") trackId: string,
    @Query("quality") quality: string | undefined,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const parsedTrackId = spotifyTrackIdSchema.safeParse(trackId);
    if (!parsedTrackId.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid Spotify track id."),
        HttpStatus.BAD_REQUEST
      );
    }
    const parsedQuality = spotifyQualitySchema.safeParse(
      quality ?? process.env.SPOTIFY_DEFAULT_QUALITY ?? "high"
    );
    if (!parsedQuality.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid Spotify audio quality."),
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.service.openAudio(userId, parsedTrackId.data, parsedQuality.data);
    response.status(200);
    response.setHeader("Content-Type", result.mimeType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="spotify-${parsedTrackId.data}.${result.fileType}"`
    );
    response.setHeader("Content-Length", String(result.contentLength));

    const stream = this.downloads.createReadStream(result.filePath);
    let transferredBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferredBytes += chunk.byteLength;
        if (transferredBytes > result.maxBytes) {
          callback(new Error("Spotify audio exceeded the configured import size."));
          return;
        }
        callback(null, chunk);
      }
    });

    const abort = () => {
      stream.destroy();
      if (!response.destroyed) response.destroy();
    };
    limiter.on("error", abort);
    stream.on("error", abort);
    request.on("close", () => {
      if (!response.writableEnded) abort();
    });
    stream.pipe(limiter).pipe(response);
  }

  private async getCurrentUserId(sessionToken: string | undefined) {
    if (!sessionToken) {
      throw new UnauthorizedException(
        createApiErrorResponse(errorCodes.unauthorized, "Authentication required.")
      );
    }
    try {
      const session = await this.auth.getAuthSessionByTokenOrThrow(sessionToken);
      return session.userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
