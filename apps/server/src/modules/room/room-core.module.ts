import { Module } from "@nestjs/common";
import type { RoomRecord } from "./room.types";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";
import { RoomRecordRepository } from "./repositories/room-record.repository";
import { RoomPlaybackService } from "./services/room-playback.service";
import { RoomPresenceService } from "./services/room-presence.service";
import { RoomRealtimePublisher } from "./services/room-realtime.publisher";
import { RoomSnapshotService } from "./services/room-snapshot.service";
import { RoomService } from "./room.service";
import { RoomRealtimeBroadcaster } from "../signaling/room-realtime.broadcaster";

const ROOM_RECORDS = Symbol("ROOM_RECORDS");
const ROOM_PRESENCE = Symbol("ROOM_PRESENCE");

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

@Module({
  imports: [AuthModule],
  providers: [
    {
      provide: ROOM_RECORDS,
      useFactory: () => new Map<string, RoomRecord>()
    },
    {
      provide: ROOM_PRESENCE,
      useFactory: () => new Map() satisfies RoomPresenceStore
    },
    {
      provide: RoomRecordRepository,
      inject: [ROOM_RECORDS, PrismaService, RedisService],
      useFactory: (
        rooms: Map<string, RoomRecord>,
        prisma: PrismaService,
        redis: RedisService
      ) => new RoomRecordRepository(rooms, prisma, redis, "music-room:rooms", 43_200, 604_800)
    },
    {
      provide: RoomPresenceService,
      inject: [RedisService, ROOM_PRESENCE],
      useFactory: (redis: RedisService, presence: RoomPresenceStore) =>
        new RoomPresenceService(redis, presence, 60)
    },
    {
      provide: RoomPlaybackService,
      inject: [RoomPresenceService],
      useFactory: (presence: RoomPresenceService) => new RoomPlaybackService(presence)
    },
    {
      provide: RoomSnapshotService,
      inject: [RoomPresenceService, RoomPlaybackService],
      useFactory: (presence: RoomPresenceService, playback: RoomPlaybackService) =>
        new RoomSnapshotService(presence, playback)
    },
    RoomRealtimeBroadcaster,
    RoomService,
    RoomRealtimePublisher
  ],
  exports: [
    RoomService,
    RoomRealtimePublisher,
    RoomRealtimeBroadcaster
  ]
})
export class RoomCoreModule {}
