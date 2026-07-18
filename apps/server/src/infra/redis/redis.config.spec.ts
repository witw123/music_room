import { buildRedisClientArgs, getRedisConnectionMode } from "./redis.config";

describe("redis.config", () => {
  it("uses single-instance mode by default", () => {
    expect(getRedisConnectionMode({ REDIS_URL: "redis://localhost:6379" })).toBe("single");
    expect(buildRedisClientArgs({ REDIS_URL: "redis://localhost:6379" })).toEqual([
      "redis://localhost:6379",
      expect.objectContaining({
        lazyConnect: true,
        maxRetriesPerRequest: 1
      })
    ]);
  });

  it("passes single-instance authentication separately from the Redis URL", () => {
    expect(buildRedisClientArgs({
      REDIS_URL: "redis://redis:6379",
      REDIS_USERNAME: "default",
      REDIS_PASSWORD: "redis-password"
    })).toEqual([
      "redis://redis:6379",
      expect.objectContaining({
        username: "default",
        password: "redis-password"
      })
    ]);
  });

  it("uses sentinel mode when REDIS_MODE=sentinel", () => {
    const args = buildRedisClientArgs({
      REDIS_MODE: "sentinel",
      REDIS_SENTINELS: "10.0.0.10:26379,10.0.0.11:26379",
      REDIS_SENTINEL_MASTER_NAME: "mymaster",
      REDIS_PASSWORD: "redis-password",
      REDIS_SENTINEL_PASSWORD: "sentinel-password",
      REDIS_DB: "2"
    });

    expect(getRedisConnectionMode({
      REDIS_MODE: "sentinel"
    })).toBe("sentinel");
    expect(args).toEqual([
      expect.objectContaining({
        name: "mymaster",
        db: 2,
        password: "redis-password",
        sentinelPassword: "sentinel-password",
        sentinels: [
          { host: "10.0.0.10", port: 26379 },
          { host: "10.0.0.11", port: 26379 }
        ]
      })
    ]);
  });

  it("rejects invalid sentinel configuration", () => {
    expect(() =>
      buildRedisClientArgs({
        REDIS_MODE: "sentinel",
        REDIS_SENTINELS: "",
        REDIS_SENTINEL_MASTER_NAME: ""
      })
    ).toThrow("Redis Sentinel mode requires REDIS_SENTINELS and REDIS_SENTINEL_MASTER_NAME.");
  });
});
