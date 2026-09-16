import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { parseRequestBody } from "../../../common/validation/zod-validation";
import {
  alistGetFileBodySchema,
  alistListDirectoryBodySchema,
  alistStreamQuerySchema,
  alistTestConfigBodySchema
} from "./alist.schemas";
import { AlistService } from "./alist.service";

@Controller("v1/storage/alist")
export class AlistController {
  constructor(private readonly service: AlistService) {}

  @Post("test")
  async testConnection(@Body() body: Record<string, unknown>) {
    const payload = parseRequestBody(alistTestConfigBodySchema, body);
    return this.service.testConnection(payload.url, payload.mountPath, payload.token);
  }

  @Post("list")
  async listDirectory(@Body() body: Record<string, unknown>) {
    const payload = parseRequestBody(alistListDirectoryBodySchema, body);
    return this.service.listDirectory(
      payload.url,
      payload.path,
      payload.page,
      payload.perPage,
      payload.refresh,
      payload.token
    );
  }

  @Post("file")
  async getFile(@Body() body: Record<string, unknown>) {
    const payload = parseRequestBody(alistGetFileBodySchema, body);
    return this.service.getFileDetail(payload.url, payload.path, payload.token);
  }

  @Get("stream")
  async streamAudio(
    @Query() query: Record<string, unknown>,
    @Headers("range") range: string | undefined,
    @Req() _req: Request,
    @Res() res: Response
  ) {
    const payload = parseRequestBody(alistStreamQuerySchema, query);
    const streamResult = await this.service.fetchAudioStream(payload.url, range);

    res.status(streamResult.status);
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

    const nodeStream = Readable.fromWeb(streamResult.body as import("node:stream/web").ReadableStream);
    nodeStream.pipe(res);
  }
}
