import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { buildRedisClientArgs, getRedisConnectionMode, type RedisConnectionMode } from "./redis.config";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly messageHandlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly mode: RedisConnectionMode = getRedisConnectionMode();
  readonly client = createRedisClient();
  readonly subscriber = createRedisClient();
  private readonly handleSubscriberMessage = (messageChannel: string, message: string) => {
    const handlers = this.messageHandlers.get(messageChannel);
    if (!handlers?.size) {
      return;
    }

    try {
      const payload = JSON.parse(message) as unknown;
      handlers.forEach((handler) => handler(payload));
    } catch (error) {
      this.logger.warn(`Failed to parse redis message on ${messageChannel}: ${String(error)}`);
    }
  };

  async onModuleInit() {
    this.registerLifecycleLogging(this.client, "publisher");
    this.registerLifecycleLogging(this.subscriber, "subscriber");
    await this.connectSafely(this.client, "publisher");
    await this.connectSafely(this.subscriber, "subscriber");
    if (this.subscriber.status === "ready") {
      this.subscriber.on("message", this.handleSubscriberMessage);
    }
  }

  async onModuleDestroy() {
    this.subscriber.off("message", this.handleSubscriberMessage);
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }

  isAvailable() {
    return this.client.status === "ready";
  }

  getMode() {
    return this.mode;
  }

  async publish(channel: string, payload: unknown) {
    this.assertReady(this.client, "publisher");

    await this.client.publish(channel, JSON.stringify(payload));
  }

  async setJson(key: string, payload: unknown, ttlSeconds?: number) {
    this.assertReady(this.client, "publisher");

    const value = JSON.stringify(payload);
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async setString(key: string, value: string, ttlSeconds?: number) {
    this.assertReady(this.client, "publisher");

    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async getString(key: string) {
    this.assertReady(this.client, "publisher");

    return this.client.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    this.assertReady(this.client, "publisher");

    const value = await this.client.get(key);
    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  }

  async delete(key: string) {
    this.assertReady(this.client, "publisher");

    await this.client.del(key);
  }

  async addToSet(key: string, value: string) {
    this.assertReady(this.client, "publisher");

    await this.client.sadd(key, value);
  }

  async removeFromSet(key: string, value: string) {
    this.assertReady(this.client, "publisher");

    await this.client.srem(key, value);
  }

  async getSetMembers(key: string) {
    this.assertReady(this.client, "publisher");

    return this.client.smembers(key);
  }

  async incrementWithTtlMs(key: string, ttlMs: number) {
    this.assertReady(this.client, "publisher");

    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.pexpire(key, ttlMs);
    }
    return count;
  }

  async subscribe(channel: string, handler: (payload: unknown) => void) {
    // ioredis queues SUBSCRIBE commands until the lazy connection is actually ready.
    const handlers = this.messageHandlers.get(channel) ?? new Set<(payload: unknown) => void>();
    const shouldSubscribe = handlers.size === 0;
    handlers.add(handler);
    this.messageHandlers.set(channel, handlers);

    if (shouldSubscribe) {
      await this.subscriber.subscribe(channel);
    }

    return async () => {
      const nextHandlers = this.messageHandlers.get(channel);
      if (!nextHandlers) {
        return;
      }

      nextHandlers.delete(handler);
      if (nextHandlers.size > 0) {
        return;
      }

      this.messageHandlers.delete(channel);
      if (this.subscriber.status === "ready") {
        await this.subscriber.unsubscribe(channel);
      }
    };
  }

  private async connectSafely(client: Redis, label: string) {
    try {
      if (client.status === "wait" || client.status === "close" || client.status === "end") {
        await client.connect();
      }
      this.logger.log(`Redis ${label} connected (mode=${this.mode})`);
    } catch (error) {
      this.logger.warn(`Redis ${label} unavailable; continuing without pub/sub. ${String(error)}`);
    }
  }

  private registerLifecycleLogging(client: Redis, label: string) {
    client.on("ready", () => {
      this.logger.log(`Redis ${label} ready`);
    });
    client.on("error", (error) => {
      this.logger.warn(`Redis ${label} error: ${String(error)}`);
    });
    client.on("close", () => {
      this.logger.warn(`Redis ${label} connection closed`);
    });
    client.on("end", () => {
      this.logger.warn(`Redis ${label} connection ended`);
    });
    client.on("reconnecting", () => {
      this.logger.warn(`Redis ${label} reconnecting`);
    });
  }

  private assertReady(client: Redis, label: string) {
    if (client.status === "ready") {
      return;
    }

    throw new Error(`Redis unavailable (${label}).`);
  }
}

function createRedisClient() {
  const args = buildRedisClientArgs();
  return args.length === 1 ? new Redis(args[0]) : new Redis(args[0], args[1]);
}
