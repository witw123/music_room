import type { AuthService } from "../auth/auth.service";
import type { PrismaService } from "../../infra/prisma/prisma.service";
import type { RedisService } from "../../infra/redis/redis.service";
import type { RoomRecord } from "./room.types";
import { RoomRecordRepository } from "./repositories/room-record.repository";
import { RoomActivityService } from "./services/room-activity.service";
import { RoomContentService } from "./services/room-content.service";
import { RoomLifecycleService } from "./services/room-lifecycle.service";
import { RoomPlaybackService } from "./services/room-playback.service";
import { RoomPresenceOrchestratorService } from "./services/room-presence-orchestrator.service";
import { RoomPresenceService, realtimePresenceTtlSeconds } from "./services/room-presence.service";
import { RoomSnapshotService } from "./services/room-snapshot.service";
import { RoomService } from "./room.service";

export const ROOM_REGISTRY_KEY = "music-room:rooms";
export const ROOM_CACHE_TTL_SECONDS = 43_200;
export const SESSION_RECENT_ROOM_TTL_SECONDS = 604_800;

type RoomPresenceStore = Map<
  string,
  Map<
    string,
    {
      peerId: string | null;
      presenceState: "online" | "reconnecting" | "offline";
      expiresAt: number;
    }
  >
>;

export type RoomCoreServices = {
  roomRecordRepository: RoomRecordRepository;
  roomPresenceService: RoomPresenceService;
  roomPlaybackService: RoomPlaybackService;
  roomSnapshotService: RoomSnapshotService;
  roomActivityService: RoomActivityService;
  presenceOrchestrator: RoomPresenceOrchestratorService;
  contentService: RoomContentService;
  lifecycleService: RoomLifecycleService;
  roomService: RoomService;
};

/**
 * 房间域完整依赖图的唯一装配点:生产(RoomCoreModule)与单测共用同一函数,
 * 保证测试态与生产态构造的是同一套状态模型,不存在第二套装配。
 * 内存态(rooms/presence)可注入以获得测试隔离,缺省新建。
 */
export function buildRoomCoreServices(input: {
  authService: AuthService;
  prisma: PrismaService;
  redis: RedisService;
  rooms?: Map<string, RoomRecord>;
  presence?: RoomPresenceStore;
}): RoomCoreServices {
  const rooms = input.rooms ?? new Map<string, RoomRecord>();
  const inMemoryPresence = input.presence ?? new Map();

  const roomRecordRepository = new RoomRecordRepository(
    rooms,
    input.prisma,
    input.redis,
    ROOM_REGISTRY_KEY,
    ROOM_CACHE_TTL_SECONDS,
    SESSION_RECENT_ROOM_TTL_SECONDS
  );
  const roomPresenceService = new RoomPresenceService(
    input.redis,
    inMemoryPresence,
    realtimePresenceTtlSeconds
  );
  const roomPlaybackService = new RoomPlaybackService(roomPresenceService);
  const roomSnapshotService = new RoomSnapshotService(roomPresenceService, roomPlaybackService);
  const roomActivityService = new RoomActivityService(input.prisma);
  const presenceOrchestrator = new RoomPresenceOrchestratorService(
    roomRecordRepository,
    roomPresenceService,
    roomPlaybackService,
    roomActivityService,
    input.redis
  );
  const contentService = new RoomContentService(input.authService, roomRecordRepository, roomPlaybackService);
  const lifecycleService = new RoomLifecycleService(
    input.authService,
    roomRecordRepository,
    roomPresenceService,
    roomPlaybackService,
    roomActivityService,
    roomSnapshotService,
    presenceOrchestrator
  );
  const roomService = new RoomService(
    input.authService,
    input.prisma,
    input.redis,
    roomRecordRepository,
    roomPresenceService,
    roomPlaybackService,
    roomSnapshotService,
    roomActivityService,
    presenceOrchestrator,
    contentService,
    lifecycleService
  );

  return {
    roomRecordRepository,
    roomPresenceService,
    roomPlaybackService,
    roomSnapshotService,
    roomActivityService,
    presenceOrchestrator,
    contentService,
    lifecycleService,
    roomService
  };
}

/**
 * 单测便捷装配:传入(通常是 mock 的)基础设施对象,得到完整的房间域服务束。
 * mock → 具体类型的收窄只在这一处发生,替代散落在各 spec 的 as never。
 */
export function createRoomCoreServices(input: {
  authService: AuthService;
  prisma: object;
  redis: object;
}): RoomCoreServices {
  return buildRoomCoreServices({
    authService: input.authService,
    prisma: input.prisma as PrismaService,
    redis: input.redis as RedisService
  });
}
