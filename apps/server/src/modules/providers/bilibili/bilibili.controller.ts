import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { parseRequestBody } from "../../../common/validation/zod-validation";
import {
  bilibiliBvidSchema,
  bilibiliImportFavoriteBodySchema,
  bilibiliRankingQuerySchema,
  bilibiliResolveAudioQuerySchema,
  bilibiliSearchQuerySchema
} from "./bilibili.schemas";
import { BilibiliService } from "./bilibili.service";

@Controller("v1/providers/bilibili")
export class BilibiliController {
  constructor(private readonly service: BilibiliService) {}

  @Get("search")
  async search(@Query() query: Record<string, unknown>) {
    const payload = parseRequestBody(bilibiliSearchQuerySchema, query);
    return this.service.search(payload.keyword, payload.page, payload.pageSize, payload.tid);
  }

  @Get("ranking")
  async getRanking(@Query() query: Record<string, unknown>) {
    const payload = parseRequestBody(bilibiliRankingQuerySchema, query);
    return this.service.getRanking(payload.subType);
  }

  @Post("favorites/import")
  async importFavorite(
    @Body() body: Record<string, unknown>,
    @Query("page") pageQuery?: string,
    @Query("pageSize") pageSizeQuery?: string
  ) {
    const payload = parseRequestBody(bilibiliImportFavoriteBodySchema, body);
    const page = pageQuery ? parseInt(pageQuery, 10) || 1 : 1;
    const pageSize = pageSizeQuery ? parseInt(pageSizeQuery, 10) || 30 : 30;
    return this.service.importFavorite(payload.url, page, pageSize);
  }

  @Get("view/:bvid")
  async getView(@Param("bvid") bvid: string) {
    const parsedBvid = bilibiliBvidSchema.safeParse(bvid);
    if (!parsedBvid.success) {
      throw new HttpException("无效的 B 站视频 ID", HttpStatus.BAD_REQUEST);
    }
    return this.service.getVideoDetail(parsedBvid.data);
  }

  @Get("tracks/:trackId")
  async getTrack(
    @Param("trackId") trackId: string,
    @Query("cid") cidQuery?: string
  ) {
    const { bvid, cid } = this.parseTrackId(trackId, cidQuery);
    return this.service.resolveTrack(bvid, cid);
  }

  @Get("tracks/:trackId/lyrics")
  async getLyrics(
    @Param("trackId") trackId: string,
    @Query("cid") cidQuery?: string
  ) {
    const { bvid, cid } = this.parseTrackId(trackId, cidQuery);
    return this.service.getLyrics(bvid, cid);
  }

  @Get("tracks/:trackId/audio-url")
  async getAudioUrl(
    @Param("trackId") trackId: string,
    @Query() query: Record<string, unknown>
  ) {
    const payload = parseRequestBody(bilibiliResolveAudioQuerySchema, query);
    const { bvid, cid } = this.parseTrackId(trackId, payload.cid?.toString());
    return this.service.resolveAudio(bvid, cid, payload.quality);
  }

  @Get("tracks/:trackId/audio")
  async getAudioStream(
    @Param("trackId") trackId: string,
    @Query() query: Record<string, unknown>,
    @Headers("range") range: string | undefined,
    @Req() _req: Request,
    @Res() res: Response
  ) {
    const payload = parseRequestBody(bilibiliResolveAudioQuerySchema, query);
    const { bvid, cid } = this.parseTrackId(trackId, payload.cid?.toString());

    const streamResult = await this.service.openAudioStream(
      bvid,
      cid,
      payload.quality,
      range
    );

    // 设置响应状态码（200 或 206）
    res.status(streamResult.status);

    // 透传关键流媒体响应头
    for (const [key, value] of Object.entries(streamResult.headers)) {
      if (
        key === "content-range" ||
        key === "content-length" ||
        key === "content-type" ||
        key === "accept-ranges"
      ) {
        res.setHeader(key, value);
      }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!streamResult.body) {
      res.end();
      return;
    }

    // 将 Fetch ReadableStream 桥接到 Node.js Response
    const nodeStream = Readable.fromWeb(streamResult.body as import("node:stream/web").ReadableStream);
    nodeStream.pipe(res);
  }

  private parseTrackId(trackId: string, fallbackCid?: string): { bvid: string; cid?: number } {
    const colonIndex = trackId.indexOf(":");
    if (colonIndex > 0) {
      const bvid = trackId.slice(0, colonIndex);
      const cidNum = parseInt(trackId.slice(colonIndex + 1), 10);
      return { bvid, cid: isNaN(cidNum) ? undefined : cidNum };
    }
    const cidNum = fallbackCid ? parseInt(fallbackCid, 10) : undefined;
    return { bvid: trackId, cid: cidNum && !isNaN(cidNum) ? cidNum : undefined };
  }
}
