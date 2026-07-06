import { describe, expect, it } from "vitest";
import { buildNextManualCacheTask } from "./upload-ui-state";

describe("buildNextManualCacheTask", () => {
  it("builds a task from track defaults and patch fields", () => {
    expect(
      buildNextManualCacheTask({
        trackId: "track_1",
        existing: null,
        track: {
          fileHash: "hash_1",
          mimeType: "audio/flac"
        },
        patch: {
          status: "queued",
          mode: "manual",
          completedChunks: 2,
          totalChunks: 8
        },
        updatedAt: "2026-07-06T00:00:00.000Z"
      })
    ).toMatchObject({
      trackId: "track_1",
      status: "queued",
      mode: "manual",
      fileHash: "hash_1",
      completedChunks: 2,
      totalChunks: 8,
      mimeType: "audio/flac",
      updatedAt: "2026-07-06T00:00:00.000Z"
    });
  });

  it("returns null when a patch callback declines the update", () => {
    expect(
      buildNextManualCacheTask({
        trackId: "track_1",
        existing: null,
        track: null,
        patch: () => null,
        updatedAt: "2026-07-06T00:00:00.000Z"
      })
    ).toBeNull();
  });
});
