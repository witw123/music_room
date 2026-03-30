import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma/index";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  async onModuleInit() {
    try {
      await this.$connect();
      this.connected = true;
      this.logger.log("Prisma connected");
    } catch (error) {
      this.logger.warn(
        `Prisma unavailable during startup; continuing in degraded mode. ${String(error)}`
      );
    }
  }

  isAvailable() {
    return this.connected;
  }

  get users() {
    return (this as unknown as { user: any }).user;
  }

  get userSessions() {
    return (this as unknown as { userSession: any }).userSession;
  }

  get roomStates() {
    return (this as unknown as { roomState: any }).roomState;
  }

  get playlists() {
    return (this as unknown as { playlist: any }).playlist;
  }
}
