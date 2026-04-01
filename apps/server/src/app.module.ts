import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ConfigFactoryModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    HealthModule,
    PlaybackModule,
    PlaylistModule,
    QueueModule,
    RealtimeModule,
    RoomModule,
    SignalingModule,
    TrackModule
  ]
})
export class AppModule {}
