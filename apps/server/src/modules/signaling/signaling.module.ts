import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { RoomCoreModule } from "../room/room-core.module";
import { PeerSignalRelayService } from "./peer-signal-relay.service";
import { RealtimeRedisSubscriber } from "./realtime-redis-subscriber.service";
import { RoomPlaybackReadinessService } from "./room-playback-readiness.service";
import { RoomSessionLeaseService } from "./room-session-lease.service";
import { RoomSessionRegistryService } from "./room-session-registry.service";
import { SignalingGateway } from "./signaling.gateway";

@Module({
  imports: [AuthModule, RoomCoreModule, RealtimeModule],
  providers: [
    SignalingGateway,
    RoomSessionLeaseService,
    PeerSignalRelayService,
    RoomPlaybackReadinessService,
    RoomSessionRegistryService,
    RealtimeRedisSubscriber
  ],
  exports: [SignalingGateway]
})
export class SignalingModule {}
