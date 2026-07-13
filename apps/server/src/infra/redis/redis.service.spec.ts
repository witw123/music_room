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
  eval: jest.Mock;
  mget: jest.Mock;
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
      eval = jest.fn(async () => 1);
      mget = jest.fn(async (...keys: string[]) => keys.map((key) => `value:${key}`));

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

  it("writes revision-guarded JSON through one atomic Redis script", async () => {
    const service = new RedisService();
    const publisher = mockRedisInstances[0];
    publisher.status = "ready";

    await expect(
      service.setJsonIfRevisionMatches(
        "music-room:room:room_1",
        { room: { roomRevision: 2 } },
        1,
        60
      )
    ).resolves.toBe(true);

    expect(publisher.eval).toHaveBeenCalledWith(
      expect.stringContaining("currentRevision"),
      1,
      "music-room:room:room_1",
      JSON.stringify({ room: { roomRevision: 2 } }),
      "1",
      "60"
    );
  });

  it("reports pubsub readiness separately and batches string reads", async () => {
    const service = new RedisService();
    const publisher = mockRedisInstances[0];
    const subscriber = mockRedisInstances[1];
    publisher.status = "ready";
    subscriber.status = "wait";

    expect(service.isAvailable()).toBe(true);
    expect(service.isPubSubAvailable()).toBe(false);

    subscriber.status = "ready";
    expect(service.isPubSubAvailable()).toBe(true);
    await expect(service.getStrings(["presence:a", "presence:b"])).resolves.toEqual([
      "value:presence:a",
      "value:presence:b"
    ]);
    expect(publisher.mget).toHaveBeenCalledWith("presence:a", "presence:b");
  });
});
