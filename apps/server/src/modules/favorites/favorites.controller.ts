import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Put,
  UnauthorizedException
} from "@nestjs/common";
import { z } from "zod";
import { providerAlbumSummarySchema, providerSchema } from "@music-room/shared";
import { parseRequestBody } from "../../common/validation/zod-validation";
import { AuthService } from "../auth/auth.service";
import { FavoritesService } from "./favorites.service";

const saveFavoriteAlbumSchema = providerAlbumSummarySchema;
const providerAlbumParamSchema = z.object({
  provider: providerSchema,
  providerAlbumId: z.string().trim().min(1).max(128)
});

@Controller("v1/favorites/albums")
export class FavoritesController {
  constructor(
    private readonly favorites: FavoritesService,
    private readonly auth: AuthService
  ) {}

  @Get()
  async list(@Headers("x-session-token") sessionToken?: string) {
    return this.favorites.listAlbums(await this.getCurrentUserId(sessionToken));
  }

  @Put()
  async save(
    @Headers("x-session-token") sessionToken: string | undefined,
    @Body() body: unknown
  ) {
    const album = parseRequestBody(saveFavoriteAlbumSchema, body);
    return this.favorites.saveAlbum(await this.getCurrentUserId(sessionToken), album);
  }

  @Delete(":provider/:providerAlbumId")
  async remove(
    @Param() params: Record<string, unknown>,
    @Headers("x-session-token") sessionToken?: string
  ) {
    const parsed = parseRequestBody(providerAlbumParamSchema, params);
    return this.favorites.removeAlbum(
      await this.getCurrentUserId(sessionToken),
      parsed.provider,
      parsed.providerAlbumId
    );
  }

  private async getCurrentUserId(sessionToken?: string) {
    try {
      return (await this.auth.getAuthSessionByTokenOrThrow(sessionToken)).userId;
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "Unauthorized.");
    }
  }
}
