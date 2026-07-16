import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { SpotifyController } from "./spotify.controller";
import { SpotifyService } from "./spotify.service";
import { SpotifyWebApiClient } from "./spotify-web-api.client";
import { ZotifyDownloadService } from "./zotify-download.service";

@Module({
  imports: [AuthModule],
  controllers: [SpotifyController],
  providers: [SpotifyService, SpotifyWebApiClient, ZotifyDownloadService],
  exports: [SpotifyService]
})
export class SpotifyModule {}
