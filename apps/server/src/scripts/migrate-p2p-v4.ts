import Redis from "ioredis";
import { PrismaClient } from "../generated/prisma";
import { buildRedisClientArgs } from "../infra/redis/redis.config";

const execute = process.argv.includes("--execute");
const confirmed = process.argv.includes("--confirm=DELETE_ROOMS_AND_PLAYLISTS");
const roomRedisPatterns = [
  "music-room:rooms",
  "music-room:room:*",
  "music-room:join-code:*",
  "music-room:presence:*",
  "music-room:realtime-session:*",
  "music-room:availability:*",
  "music-room:asset-availability:v4:*",
  "music-room:session:*:recent-room"
] as const;

async function main() {
  if (execute && !confirmed) {
    throw new Error(
      "Refusing destructive migration without --confirm=DELETE_ROOMS_AND_PLAYLISTS."
    );
  }

  const prisma = new PrismaClient();
  const redisArgs = buildRedisClientArgs();
  const redis = redisArgs.length === 2
    ? new Redis(redisArgs[0], redisArgs[1])
    : new Redis(redisArgs[0]);
  try {
    const [roomCount, playlistCount, redisKeyPages] = await Promise.all([
      prisma.roomState.count(),
      prisma.playlist.count(),
      Promise.all(roomRedisPatterns.map(async (pattern) => ({
        pattern,
        keys: await scanKeys(redis, pattern)
      })))
    ]);
    const redisKeys = [...new Set(redisKeyPages.flatMap((page) => page.keys))].sort();
    const summary = {
      mode: execute ? "execute" : "dry-run",
      roomStates: roomCount,
      playlists: playlistCount,
      redisKeys: redisKeys.length,
      redisKeysByPattern: Object.fromEntries(
        redisKeyPages.map((page) => [page.pattern, page.keys.length])
      )
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!execute) {
      return;
    }

    await prisma.$transaction([
      prisma.playlist.deleteMany(),
      prisma.roomState.deleteMany()
    ]);
    for (let offset = 0; offset < redisKeys.length; offset += 500) {
      const batch = redisKeys.slice(offset, offset + 500);
      if (batch.length > 0) {
        await redis.del(...batch);
      }
    }
    process.stdout.write("P2P v4 room-state migration completed.\n");
  } finally {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  }
}

async function scanKeys(redis: Redis, pattern: string) {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, page] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== "0");
  return [...new Set(keys)].sort();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
