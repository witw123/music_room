import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infra/prisma/prisma.service";
import type { RecordPlaybackInput } from "./playback-history.controller";

const playbackHistoryDays = 30;

@Injectable()
export class PlaybackHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(userId: string, input: RecordPlaybackInput) {
    this.assertDatabaseAvailable();

    const now = new Date();
    const day = getUtcDay(now);
    await this.prisma.userPlaybackDaily.upsert({
      where: {
        userId_day_provider_providerTrackId: {
          userId,
          day,
          provider: input.provider,
          providerTrackId: input.providerTrackId
        }
      },
      update: {
        title: input.title,
        artist: input.artist,
        album: input.album,
        durationMs: input.durationMs,
        listenedMs: { increment: input.listenedMs },
        lastPlayedAt: now
      },
      create: {
        id: `playback_daily_${randomUUID()}`,
        userId,
        day,
        provider: input.provider,
        providerTrackId: input.providerTrackId,
        title: input.title,
        artist: input.artist,
        album: input.album,
        durationMs: input.durationMs,
        listenedMs: input.listenedMs,
        lastPlayedAt: now
      }
    });

    return { ok: true };
  }

  async getStats(userId: string) {
    this.assertDatabaseAvailable();

    const records = await this.prisma.userPlaybackDaily.findMany({
      where: {
        userId,
        day: { gte: getUtcDayOffset(new Date(), -(playbackHistoryDays - 1)) }
      },
      select: {
        provider: true,
        providerTrackId: true,
        listenedMs: true
      }
    });

    const tracks = new Set(records.map((record) => `${record.provider}:${record.providerTrackId}`));
    return {
      listenedMs: records.reduce((total, record) => total + record.listenedMs, 0),
      trackCount: tracks.size,
      rangeDays: playbackHistoryDays
    };
  }

  private assertDatabaseAvailable() {
    if (!this.prisma.isAvailable()) {
      throw new ServiceUnavailableException("Database is temporarily unavailable.");
    }
  }
}

function getUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function getUtcDayOffset(value: Date, dayOffset: number) {
  const day = getUtcDay(value);
  day.setUTCDate(day.getUTCDate() + dayOffset);
  return day;
}
