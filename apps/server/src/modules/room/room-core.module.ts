import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { AuthService } from "../auth/auth.service";
import { RoomRecordRepository } from "./repositories/room-record.repository";
import { RoomPlaybackService } from "./services/room-playback.service";
import { RoomPresenceService } from "./services/room-presence.service";
import { RoomRealtimePublisher } from "./services/room-realtime.publisher";
import { RoomSnapshotService } from "./services/room-snapshot.service";
import { RoomActivityService } from "./services/room-activity.service";
import { RoomContentService } from "./services/room-content.service";
import { RoomChatService } from "./services/room-chat.service";
import { RoomLifecycleService } from "./services/room-lifecycle.service";
import { RoomPresenceOrchestratorService } from "./services/room-presence-orchestrator.service";
import { buildRoomCoreServices, type RoomCoreServices } from "./room-graph";
import { RoomService } from "./room.service";

const ROOM_CORE_SERVICES = Symbol("ROOM_CORE_SERVICES");

/**
 * 房间域装配:全部子服务经 `buildRoomCoreServices` 一次性构造
 * (与单测的装配是同一个函数),再以各自的 class token 暴露给框架注入。
 */
@Module({
  imports: [AuthModule, RealtimeModule],
  providers: [
    {
      provide: ROOM_CORE_SERVICES,
      inject: [AuthService, PrismaService, RedisService],
      useFactory: (auth: AuthService, prisma: PrismaService, redis: RedisService) =>
        buildRoomCoreServices({ authService: auth, prisma, redis })
    },
    {
      provide: RoomRecordRepository,
      useFactory: (core: RoomCoreServices) => core.roomRecordRepository,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomPresenceService,
      useFactory: (core: RoomCoreServices) => core.roomPresenceService,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomPlaybackService,
      useFactory: (core: RoomCoreServices) => core.roomPlaybackService,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomSnapshotService,
      useFactory: (core: RoomCoreServices) => core.roomSnapshotService,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomActivityService,
      useFactory: (core: RoomCoreServices) => core.roomActivityService,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomPresenceOrchestratorService,
      useFactory: (core: RoomCoreServices) => core.presenceOrchestrator,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomContentService,
      useFactory: (core: RoomCoreServices) => core.contentService,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomLifecycleService,
      useFactory: (core: RoomCoreServices) => core.lifecycleService,
      inject: [ROOM_CORE_SERVICES]
    },
    {
      provide: RoomService,
      useFactory: (core: RoomCoreServices) => core.roomService,
      inject: [ROOM_CORE_SERVICES]
    },
    RoomChatService,
    RoomRealtimePublisher
  ],
  exports: [
    RoomService,
    RoomChatService,
    RoomPresenceService,
    RoomRealtimePublisher
  ]
})
export class RoomCoreModule {}
