import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecommendationEventRecord } from "@/features/library/indexeddb";

const storage = vi.hoisted(() => {
  let records: Array<Record<string, unknown>> = [];
  const table = {
    put: vi.fn(async (record: Record<string, unknown>) => {
      const index = records.findIndex((item) => item.id === record.id);
      if (index >= 0) records[index] = record;
      else records.push(record);
    }),
    where: vi.fn(() => ({
      equals: (userId: string) => ({
        toArray: async () => records.filter((record) => record.userId === userId),
        delete: async () => {
          records = records.filter((record) => record.userId !== userId);
        }
      })
    })),
    bulkDelete: vi.fn(async (ids: string[]) => {
      const removed = new Set(ids);
      records = records.filter((record) => !removed.has(record.id as string));
    })
  };
  return {
    database: { recommendationEvents: table },
    records: () => records,
    reset: () => {
      records = [];
      vi.clearAllMocks();
    },
    seed: (nextRecords: Array<Record<string, unknown>>) => {
      records = nextRecords;
    }
  };
});

vi.mock("@/features/library/indexeddb", () => ({
  musicRoomDatabase: storage.database
}));

import {
  clearRecommendationProfile,
  getRecommendationProfile,
  recordRecommendationFeedback
} from "./recommendation-store";

describe("recommendation event storage", () => {
  afterEach(() => {
    storage.reset();
  });

  it("isolates profiles by account and clears only the selected account", async () => {
    await record("host_1", "netease:one", "Artist One");
    await record("host_2", "netease:two", "Artist Two");

    await expect(getRecommendationProfile("host_1")).resolves.toMatchObject({
      userId: "host_1",
      trackAffinity: expect.any(Map)
    });
    await clearRecommendationProfile("host_1");

    expect(storage.records().map((item) => item.userId)).toEqual(["host_2"]);
  });

  it("trims the oldest events after the per-account limit", async () => {
    storage.seed(Array.from({ length: 2_000 }, (_, index) => ({
      id: `host_1:completion:${index}`,
      userId: "host_1",
      candidateKey: `netease:${index}`,
      title: `Track ${index}`,
      artist: "Artist",
      artistKey: "artist",
      source: "netease",
      eventType: "completion",
      contextKey: "radio:room_1",
      occurredAt: index
    } satisfies RecommendationEventRecord)));

    await record("host_1", "netease:new", "New Artist");

    expect(storage.records()).toHaveLength(2_000);
    expect(storage.records().some((record) => record.id === "host_1:completion:0")).toBe(false);
  });
});

async function record(userId: string, key: string, artist: string) {
  await recordRecommendationFeedback({
    userId,
    candidate: {
      key,
      title: key,
      artist,
      source: "netease",
      baseScore: 0,
      availabilityScore: 1
    },
    eventType: "favorite",
    dedupeKey: key
  });
}
