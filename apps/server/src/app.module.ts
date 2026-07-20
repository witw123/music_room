import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { PlaybackModule } from "./modules/playback/playback.module";
import { PlaylistModule } from "./modules/playlist/playlist.module";
import { QueueModule } from "./modules/queue/queue.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { RoomModule } from "./modules/room/room.module";
import { SignalingModule } from "./modules/signaling/signaling.module";
import { TrackModule } from "./modules/track/track.module";
import { ConfigFactoryModule } from "./infra/config/config.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { RedisModule } from "./infra/redis/redis.module";
import { MetricsModule } from "./common/metrics/metrics.module";
import { NeteaseModule } from "./modules/providers/netease/netease.module";
import { QqMusicModule } from "./modules/providers/qqmusic/qqmusic.module";
import { AdminModule } from "./modules/admin/admin.module";
import { FavoritesModule } from "./modules/favorites/favorites.module";

@Module({
  imports: [
    // The server is usually launched from apps/server in the workspace. Load
    // the workspace .env explicitly so Prisma, Redis and admin flags are
    // available before their providers are constructed.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]
    }),
    ConfigFactoryModule,
    PrismaModule,
    RedisModule,
    MetricsModule,
    AuthModule,
    HealthModule,
    PlaybackModule,
    PlaylistModule,
    QueueModule,
    RealtimeModule,
    RoomModule,
    SignalingModule,
    TrackModule,
    NeteaseModule,
    QqMusicModule,
    AdminModule,
    FavoritesModule
  ]
})
export class AppModule {}
