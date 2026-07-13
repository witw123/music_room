import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  @Get()
  check() {
    return {
      status: "ok",
      service: "music-room-server"
    };
  }

  @Get("readiness")
  readiness() {
    const prismaReady = this.prisma.isAvailable();
    const redisReady = this.redis.isPubSubAvailable();
    const isReady = prismaReady && redisReady;

    return {
      status: isReady ? "ready" : "degraded",
      service: "music-room-server",
      checks: {
        prisma: prismaReady ? "up" : "down",
        redis: redisReady ? "up" : "down"
      },
      metadata: {
        redisMode: this.redis.getMode()
      }
    };
  }
}
