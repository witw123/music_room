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
  qqMusicAlbumIdSchema,
  qqMusicCatalogPageQuerySchema,
  qqMusicPlaylistIdSchema,
  qqMusicQualitySchema,
  qqMusicSearchQuerySchema,
  qqMusicTrackIdSchema
} from "./qqmusic.schemas";
import { QqMusicService } from "./qqmusic.service";
import {
  RoomDownloadLockService,
  type RoomDownloadLease
} from "../../room/services/room-download-lock.service";

@Controller("v1/providers/qqmusic")
export class QqMusicController {
  constructor(
    private readonly service: QqMusicService,
    private readonly auth: AuthService,
    private readonly roomDownloadLock: RoomDownloadLockService
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

  @Get("tracks/:trackId/audio")
  async audio(
    @Param("trackId") id: string,
    @Query("quality") quality: string | undefined,
    @Query("roomId") roomId: string | undefined,
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

    const downloadLease = roomId?.trim()
      ? await this.roomDownloadLock.acquire(roomId.trim(), userId, {
          provider: "qqmusic",
          trackId: parsedId.data
        })
      : null;

    try {
      const result = await this.service.openAudio(userId, parsedId.data, parsedQuality.data, range);
      await this.streamAudio(request, response, result, downloadLease, parsedId.data);
    } catch (error) {
      if (downloadLease) {
        await this.roomDownloadLock.release(downloadLease);
      }
      throw error;
    }
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
    downloadLease: RoomDownloadLease | null,
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
      if (downloadLease) {
        await this.roomDownloadLock.release(downloadLease);
      }
      return;
    }

    const { Readable } = await import("node:stream");
    const stopKeepAlive = downloadLease
      ? this.roomDownloadLock.startKeepAlive(downloadLease)
      : null;
    const release = () => {
      stopKeepAlive?.();
      if (downloadLease) {
        void this.roomDownloadLock.release(downloadLease);
      }
    };
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
      release();
    });
    Readable.fromWeb(upstream.body as never).pipe(limiter).pipe(response);
    response.once("finish", release);
    response.once("close", release);
    request.on("close", () => {
      if (!response.writableEnded) {
        void upstream.body?.cancel().catch(() => undefined);
        release();
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
