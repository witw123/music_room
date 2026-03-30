import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma/index";

const reconnectIntervalMs = 5000;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;
  private connectPromise: Promise<boolean> | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  async onModuleInit() {
    const connected = await this.ensureAvailable();
    if (!connected) {
      this.logger.warn("Prisma unavailable during startup; retrying in background.");
      this.startReconnectLoop();
    }
  }

  async onModuleDestroy() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connected) {
      await this.$disconnect();
      this.connected = false;
    }
  }

  isAvailable() {
    return this.connected;
  }

  async ensureAvailable() {
    if (this.connected) {
      return true;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.tryConnect().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
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

  private async tryConnect() {
    try {
      await this.$connect();
      if (!this.connected) {
        this.logger.log("Prisma connected");
      }
      this.connected = true;
      this.stopReconnectLoop();
      return true;
    } catch (error) {
      this.connected = false;
      this.logger.warn(`Prisma connect attempt failed. ${String(error)}`);
      this.startReconnectLoop();
      return false;
    }
  }

  private startReconnectLoop() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setInterval(() => {
      void this.ensureAvailable();
    }, reconnectIntervalMs);
  }

  private stopReconnectLoop() {
    if (!this.reconnectTimer) {
      return;
    }

    clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
