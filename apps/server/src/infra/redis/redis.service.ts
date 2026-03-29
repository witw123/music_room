import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly messageHandlers = new Map<string, Set<(payload: unknown) => void>>();
  readonly client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
  readonly subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
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

  async publish(channel: string, payload: unknown) {
    if (this.client.status !== "ready") {
      return;
    }

    await this.client.publish(channel, JSON.stringify(payload));
  }

  async setJson(key: string, payload: unknown, ttlSeconds?: number) {
    if (this.client.status !== "ready") {
      return;
    }

    const value = JSON.stringify(payload);
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async setString(key: string, value: string, ttlSeconds?: number) {
    if (this.client.status !== "ready") {
      return;
    }

    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async getString(key: string) {
    if (this.client.status !== "ready") {
      return null;
    }

    return this.client.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (this.client.status !== "ready") {
      return null;
    }

    const value = await this.client.get(key);
    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  }

  async delete(key: string) {
    if (this.client.status !== "ready") {
      return;
    }

    await this.client.del(key);
  }

  async addToSet(key: string, value: string) {
    if (this.client.status !== "ready") {
      return;
    }

    await this.client.sadd(key, value);
  }

  async removeFromSet(key: string, value: string) {
    if (this.client.status !== "ready") {
      return;
    }

    await this.client.srem(key, value);
  }

  async getSetMembers(key: string) {
    if (this.client.status !== "ready") {
      return [];
    }

    return this.client.smembers(key);
  }

  async subscribe(channel: string, handler: (payload: unknown) => void) {
    if (this.subscriber.status !== "ready") {
      return () => undefined;
    }

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
      await client.connect();
      this.logger.log(`Redis ${label} connected`);
    } catch (error) {
      this.logger.warn(`Redis ${label} unavailable; continuing without pub/sub. ${String(error)}`);
    }
  }
}
