import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
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
  neteaseQualitySchema,
  neteaseAlbumIdSchema,
  neteaseCatalogPageQuerySchema,
  neteasePlaylistIdSchema,
  neteaseSearchQuerySchema,
  neteaseTrackIdSchema
} from "./netease.schemas";
import { NeteaseService } from "./netease.service";

@Controller("v1/providers/netease")
export class NeteaseController {
  constructor(
    private readonly service: NeteaseService,
    private readonly auth: AuthService
  ) {}

  @Get("account")
  async getAccount(@Headers("x-session-token") sessionToken: string | undefined) {
    return this.service.getAccountStatus(await this.getCurrentUserId(sessionToken));
  }

  @Post("account/qr/start")
  async startQr(@Headers("x-session-token") sessionToken: string | undefined) {
    return this.service.startQrLogin(await this.getCurrentUserId(sessionToken));
  }

  @Get("account/qr/:attemptId/status")
  async getQrStatus(
    @Param("attemptId") attemptId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    return this.service.checkQrLogin(await this.getCurrentUserId(sessionToken), attemptId);
  }

  @Delete("account")
  async disconnect(@Headers("x-session-token") sessionToken: string | undefined) {
    return this.service.disconnectAccount(await this.getCurrentUserId(sessionToken));
  }

  @Get("search")
  async search(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const payload = parseRequestBody(neteaseSearchQuerySchema, query);
    return this.service.searchTracks(userId, payload);
  }

  @Get("tracks/:trackId")
  async getTrack(
    @Param("trackId") trackId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    return this.service.getTrack(userId, neteaseTrackIdSchema.parse(trackId));
  }

  @Get("tracks/:trackId/audio")
  async audio(
    @Param("trackId") trackId: string,
    @Query("quality") quality: string | undefined,
    @Headers("range") range: string | undefined,
    @Headers("x-session-token") sessionToken: string | undefined,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const parsedTrackId = neteaseTrackIdSchema.safeParse(trackId);
    if (!parsedTrackId.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid NetEase track id."),
        HttpStatus.BAD_REQUEST
      );
    }
    const parsedQuality = neteaseQualitySchema.safeParse(
      quality ?? process.env.NETEASE_DEFAULT_QUALITY ?? "exhigh"
    );
    if (!parsedQuality.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid NetEase audio quality."),
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.service.openAudio(userId, parsedTrackId.data, parsedQuality.data, range);
    const upstream = result.upstream;
    response.status(upstream.status);
    response.setHeader("Content-Type", result.mimeType);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="netease-${parsedTrackId.data}.${result.fileType}"`
    );
    const contentLength = upstream.headers.get("content-length") ??
      (result.contentLength ? String(result.contentLength) : null);
    if (contentLength) response.setHeader("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) response.setHeader("Content-Range", contentRange);

    if (!upstream.body) {
      response.end();
      return;
    }

    const { Readable } = await import("node:stream");
    let transferredBytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        transferredBytes += chunk.byteLength;
        if (transferredBytes > result.maxBytes) {
          callback(new Error("NetEase audio exceeded the configured import size."));
          return;
        }
        callback(null, chunk);
      }
    });
    limiter.on("error", () => {
      void upstream.body?.cancel().catch(() => undefined);
      if (!response.destroyed) response.destroy();
    });
    Readable.fromWeb(upstream.body as never).pipe(limiter).pipe(response);
    request.on("close", () => {
      if (!response.writableEnded) {
        void upstream.body?.cancel().catch(() => undefined);
      }
    });
  }

  @Get("tracks/:trackId/lyrics")
  async lyrics(
    @Param("trackId") trackId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const userId = await this.getCurrentUserId(sessionToken);
    const parsed = neteaseTrackIdSchema.safeParse(trackId);
    if (!parsed.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid NetEase track id."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.getLyrics(userId, parsed.data);
  }

  @Get("playlists")
  async playlists(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    return this.service.listPlaylists(
      await this.getCurrentUserId(sessionToken),
      parseRequestBody(neteaseCatalogPageQuerySchema, query)
    );
  }

  @Get("playlists/:playlistId")
  async playlist(
    @Param("playlistId") playlistId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const parsed = neteasePlaylistIdSchema.safeParse(playlistId);
    if (!parsed.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid NetEase playlist id."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.getPlaylist(await this.getCurrentUserId(sessionToken), parsed.data);
  }

  @Get("albums/:albumId")
  async album(
    @Param("albumId") albumId: string,
    @Headers("x-session-token") sessionToken: string | undefined
  ) {
    const parsed = neteaseAlbumIdSchema.safeParse(albumId);
    if (!parsed.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid NetEase album id."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.getAlbum(await this.getCurrentUserId(sessionToken), parsed.data);
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
