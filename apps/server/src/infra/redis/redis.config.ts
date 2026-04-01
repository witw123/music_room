import type { RedisOptions } from "ioredis";

export type RedisConnectionMode = "single" | "sentinel";

type RedisClientArgs = [string, RedisOptions] | [RedisOptions];

export function buildRedisClientArgs(
  env: NodeJS.ProcessEnv = process.env
): RedisClientArgs {
  const sharedOptions: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  };

  const mode = getRedisConnectionMode(env);
  if (mode === "sentinel") {
    const sentinels = parseSentinels(env.REDIS_SENTINELS);
    const masterName = env.REDIS_SENTINEL_MASTER_NAME?.trim();

    if (sentinels.length === 0 || !masterName) {
      throw new Error(
        "Redis Sentinel mode requires REDIS_SENTINELS and REDIS_SENTINEL_MASTER_NAME."
      );
    }

    const db = parseDatabaseIndex(env.REDIS_DB);
    return [
      {
        ...sharedOptions,
        name: masterName,
        sentinels,
        db,
        username: env.REDIS_USERNAME?.trim() || undefined,
        password: env.REDIS_PASSWORD?.trim() || undefined,
        sentinelUsername: env.REDIS_SENTINEL_USERNAME?.trim() || undefined,
        sentinelPassword: env.REDIS_SENTINEL_PASSWORD?.trim() || undefined
      }
    ];
  }

  return [env.REDIS_URL ?? "redis://localhost:6379", sharedOptions];
}

export function getRedisConnectionMode(
  env: NodeJS.ProcessEnv = process.env
): RedisConnectionMode {
  if (env.REDIS_MODE?.trim().toLowerCase() === "sentinel") {
    return "sentinel";
  }

  return env.REDIS_SENTINELS?.trim() ? "sentinel" : "single";
}

function parseSentinels(input?: string | null) {
  if (!input) {
    return [];
  }

  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, portValue] = entry.split(":");
      const port = Number.parseInt(portValue ?? "26379", 10);
      if (!host || !Number.isFinite(port) || port <= 0) {
        throw new Error(`Invalid Redis sentinel address: ${entry}`);
      }
      return { host, port };
    });
}

function parseDatabaseIndex(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
