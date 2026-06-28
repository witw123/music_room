import { EventEmitter } from "node:events";

const mockRedisInstances: Array<{
  status: string;
  connect: jest.Mock;
  on: jest.Mock;
  off: jest.Mock;
  emit: (event: string, ...args: unknown[]) => boolean;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  quit: jest.Mock;
}> = [];

jest.mock("ioredis", () => {
  return {
    __esModule: true,
    default: class MockRedis extends EventEmitter {
      status = "wait";
      connect = jest.fn(async () => {
        this.status = "ready";
        this.emit("ready");
      });
      subscribe = jest.fn(async () => undefined);
      unsubscribe = jest.fn(async () => undefined);
      quit = jest.fn(async () => undefined);

      constructor() {
        super();
        mockRedisInstances.push(this as never);
      }
    }
  };
});

import { RedisService } from "./redis.service";

describe("RedisService", () => {
  beforeEach(() => {
    mockRedisInstances.length = 0;
  });

  it("keeps the subscriber message handler attached when Redis is unavailable during startup", async () => {
    const service = new RedisService();
    const subscriber = mockRedisInstances[1];
    subscriber.connect.mockRejectedValueOnce(new Error("Redis is down"));

    await service.onModuleInit();
    const handler = jest.fn();
    await service.subscribe("room.patch", handler);

    subscriber.status = "ready";
    subscriber.emit("ready");
    subscriber.emit("message", "room.patch", JSON.stringify({ roomId: "room_1" }));

    expect(handler).toHaveBeenCalledWith({ roomId: "room_1" });
  });
});
