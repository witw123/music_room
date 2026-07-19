import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { QqMusicAccountService } from "./qqmusic-account.service";
import { QqMusicApiClient } from "./qqmusic-api.client";
import { QqMusicController } from "./qqmusic.controller";
import { QqMusicCryptoService } from "./qqmusic-crypto.service";
import { QqMusicService } from "./qqmusic.service";
@Module({ imports: [AuthModule], controllers: [QqMusicController], providers: [QqMusicAccountService, QqMusicApiClient, QqMusicCryptoService, QqMusicService], exports: [QqMusicService] })
export class QqMusicModule {}
