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
  metingProviderParamSchema,
  metingQualitySchema,
  metingSearchQuerySchema,
  metingTrackIdSchema
} from "./meting.schemas";
import { MetingService } from "./meting.service";

@Controller("v1/providers")
export class MetingController {
  constructor(
    private readonly service: MetingService,
    private readonly auth: AuthService
  ) {}

  @Get(":provider/search")
  async search(
    @Param("provider") provider: string,
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.service.searchTracks(
      this.parseProvider(provider),
      userId,
      parseRequestBody(metingSearchQuerySchema, query)
    );
  }

  @Get(":provider/tracks/:trackId")
  async getTrack(
    @Param("provider") provider: string,
    @Param("trackId") trackId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.service.getTrack(
      this.parseProvider(provider),
      userId,
      this.parseTrackId(trackId)
    );
  }

  @Get(":provider/tracks/:trackId/audio")
  async audio(
    @Param("provider") provider: string,
    @Param("trackId") trackId: string,
    @Query("quality") quality: string | undefined,
    @Headers("range") range: string | undefined,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const parsedProvider = this.parseProvider(provider);
    const parsedTrackId = this.parseTrackId(trackId);
    const parsedQuality = metingQualitySchema.safeParse(
      quality ?? process.env.METING_DEFAULT_QUALITY ?? "exhigh"
    );
    if (!parsedQuality.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid Meting audio quality."),
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.service.openAudio(
      parsedProvider,
      userId,
      parsedTrackId,
      parsedQuality.data,
      range
    );
    response.status(result.upstream.status);
    response.setHeader("Content-Type", result.mimeType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${parsedProvider}-${parsedTrackId}.${result.fileType}"`
    );
    const contentLength = result.upstream.headers.get("content-length") ??
      (result.contentLength ? String(result.contentLength) : null);
    if (contentLength) response.setHeader("Content-Length", contentLength);
    const contentRange = result.upstream.headers.get("content-range");
    if (contentRange) response.setHeader("Content-Range", contentRange);

    if (!result.upstream.body) {
      response.end();
      return;
    }

    const { Readable } = await import("node:stream");
    let transferredBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferredBytes += chunk.byteLength;
        if (transferredBytes > result.maxBytes) {
          callback(new Error("Meting audio exceeded the configured import size."));
          return;
        }
        callback(null, chunk);
      }
    });
    limiter.on("error", () => {
      void result.upstream.body?.cancel().catch(() => undefined);
      if (!response.destroyed) response.destroy();
    });
    Readable.fromWeb(result.upstream.body as never).pipe(limiter).pipe(response);
    request.on("close", () => {
      if (!response.writableEnded) {
        void result.upstream.body?.cancel().catch(() => undefined);
      }
    });
  }

  private parseProvider(value: string) {
    const parsed = metingProviderParamSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new HttpException(
      createApiErrorResponse(errorCodes.validationFailed, "Invalid Meting provider."),
      HttpStatus.BAD_REQUEST
    );
  }

  private parseTrackId(value: string) {
    const parsed = metingTrackIdSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new HttpException(
      createApiErrorResponse(errorCodes.validationFailed, "Invalid provider track id."),
      HttpStatus.BAD_REQUEST
    );
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
