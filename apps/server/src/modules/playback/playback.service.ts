import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RoomService } from "../room/room.service";
import { RoomRealtimePublisher } from "../room/services/room-realtime.publisher";

const WATCHDOG_INTERVAL_MS = 100;

@Injectable()
export class PlaybackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaybackService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;

  constructor(
    private readonly roomService: RoomService,
    private readonly roomRealtimePublisher: RoomRealtimePublisher
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, WATCHDOG_INTERVAL_MS);
    // Avoid keeping the process alive solely for the watchdog in tests.
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.tickInFlight) {
      return;
    }
    this.tickInFlight = true;
    try {
      const advanced = await this.roomService.advanceEndedPlaybacks();
      for (const item of advanced) {
        this.roomRealtimePublisher.emitPlaybackPatch(item.roomId, item.playback);
        this.logger.log(
          `watchdog advanced playback room=${item.roomId} revision=${item.playback.playbackRevision} status=${item.playback.status}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `playback watchdog tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.tickInFlight = false;
    }
  }
}
