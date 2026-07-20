import {
  Controller,
  Delete,
  Get,
  Header,
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
  qqMusicAlbumIdSchema,
  qqMusicCatalogPageQuerySchema,
  qqMusicPlaylistIdSchema,
  qqMusicQualitySchema,
  qqMusicSearchQuerySchema,
  qqMusicTrackIdSchema
} from "./qqmusic.schemas";
import { QqMusicService } from "./qqmusic.service";

@Controller("v1/providers/qqmusic")
export class QqMusicController {
  constructor(
    private readonly service: QqMusicService,
    private readonly auth: AuthService
  ) {}

  @Get("account")
  async getAccount(@Headers("x-session-token") token?: string) {
    return this.service.getAccountStatus(await this.user(token));
  }

  @Post("account/qr/start")
  async startQr(@Headers("x-session-token") token?: string) {
    return this.service.startQrLogin(await this.user(token));
  }

  @Get("account/qr/:attemptId/status")
  async qrStatus(@Param("attemptId") id: string, @Headers("x-session-token") token?: string) {
    return this.service.checkQrLogin(await this.user(token), id);
  }

  @Delete("account")
  async disconnect(@Headers("x-session-token") token?: string) {
    return this.service.disconnectAccount(await this.user(token));
  }

  @Get("search")
  async search(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") token?: string
  ) {
    return this.service.searchTracks(
      await this.user(token),
      parseRequestBody(qqMusicSearchQuerySchema, query)
    );
  }

  @Get("tracks/:trackId")
  async track(@Param("trackId") id: string, @Headers("x-session-token") token?: string) {
    return this.service.getTrack(await this.user(token), qqMusicTrackIdSchema.parse(id));
  }

  @Get("search/playlists")
  async searchPlaylists(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") token?: string
  ) {
    return this.service.searchPlaylists(
      await this.user(token),
      parseRequestBody(qqMusicSearchQuerySchema, query)
    );
  }

  @Get("search/albums")
  async searchAlbums(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") token?: string
  ) {
    return this.service.searchAlbums(
      await this.user(token),
      parseRequestBody(qqMusicSearchQuerySchema, query)
    );
  }

  @Get("tracks/:trackId/audio-url")
  @Header("Cache-Control", "no-store")
  async audioUrl(
    @Param("trackId") id: string,
    @Query("quality") quality: string | undefined,
    @Headers("x-session-token") token?: string
  ) {
    const parsedId = qqMusicTrackIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music track id."),
        HttpStatus.BAD_REQUEST
      );
    }
    const parsedQuality = qqMusicQualitySchema.safeParse(
      quality ?? process.env.QQMUSIC_DEFAULT_QUALITY ?? "exhigh"
    );
    if (!parsedQuality.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music audio quality."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.resolveAudio(await this.user(token), parsedId.data, parsedQuality.data);
  }

  @Get("tracks/:trackId/audio")
  async audio(
    @Param("trackId") id: string,
    @Query("quality") quality: string | undefined,
    @Headers("range") range: string | undefined,
    @Headers("x-session-token") token: string | undefined,
    @Req() request: Request,
    @Res() response: Response
  ) {
    const userId = await this.user(token);
    const parsedId = qqMusicTrackIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music track id."),
        HttpStatus.BAD_REQUEST
      );
    }
    const parsedQuality = qqMusicQualitySchema.safeParse(
      quality ?? process.env.QQMUSIC_DEFAULT_QUALITY ?? "exhigh"
    );
    if (!parsedQuality.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music audio quality."),
        HttpStatus.BAD_REQUEST
      );
    }

    const result = await this.service.openAudio(userId, parsedId.data, parsedQuality.data, range);
    await this.streamAudio(request, response, result, parsedId.data);
  }

  @Get("tracks/:trackId/lyrics")
  async lyrics(@Param("trackId") id: string, @Headers("x-session-token") token?: string) {
    const parsed = qqMusicTrackIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music track id."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.getLyrics(await this.user(token), parsed.data);
  }

  @Get("playlists")
  async playlists(
    @Query() query: Record<string, unknown>,
    @Headers("x-session-token") token?: string
  ) {
    return this.service.listPlaylists(
      await this.user(token),
      parseRequestBody(qqMusicCatalogPageQuerySchema, query)
    );
  }

  @Get("playlists/:playlistId")
  async playlist(@Param("playlistId") id: string, @Headers("x-session-token") token?: string) {
    const parsed = qqMusicPlaylistIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music playlist id."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.getPlaylist(await this.user(token), parsed.data);
  }

  @Get("albums/:albumId")
  async album(@Param("albumId") id: string, @Headers("x-session-token") token?: string) {
    const parsed = qqMusicAlbumIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new HttpException(
        createApiErrorResponse(errorCodes.validationFailed, "Invalid QQ Music album id."),
        HttpStatus.BAD_REQUEST
      );
    }
    return this.service.getAlbum(await this.user(token), parsed.data);
  }

  private async streamAudio(
    request: Request,
    response: Response,
    result: Awaited<ReturnType<QqMusicService["openAudio"]>>,
    trackId: string
  ) {
    const upstream = result.upstream;
    response
      .status(upstream.status)
      .setHeader("Content-Type", result.mimeType)
      .setHeader("Cache-Control", "no-store")
      .setHeader("Accept-Ranges", "bytes")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="qqmusic-${trackId}.${result.fileType}"`
      );
    const length = upstream.headers.get("content-length") ??
      (result.contentLength ? String(result.contentLength) : null);
    if (length) response.setHeader("Content-Length", length);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) response.setHeader("Content-Range", contentRange);

    if (!upstream.body) {
      response.end();
      return;
    }

    const { Readable } = await import("node:stream");
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength;
        if (bytes > result.maxBytes) {
          callback(new Error("QQ Music audio exceeded the configured import size."));
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

  private async user(token?: string) {
    try {
      return (await this.auth.getAuthSessionByTokenOrThrow(token)).userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
