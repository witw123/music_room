import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma/index";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("Prisma connected");
    } catch (error) {
      this.logger.warn(
        `Prisma unavailable during startup; continuing in degraded mode. ${String(error)}`
      );
    }
  }
}
