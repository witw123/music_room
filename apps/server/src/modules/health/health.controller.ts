import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
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
  async readiness() {
    const [prismaReady, redisReady] = await Promise.all([
      this.prisma.checkHealth(),
      this.redis.checkHealth()
    ]);
    const isReady = prismaReady && redisReady;

    const payload = {
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
    if (!isReady) throw new ServiceUnavailableException(payload);
    return payload;
  }
}
