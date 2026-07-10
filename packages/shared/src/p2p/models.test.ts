import { describe, expect, it } from "vitest";
import { progressivePlaybackStatusSchema } from "./models";

describe("progressive playback diagnostics", () => {
  it("accepts signed drift and server clock calibration metrics", () => {
    const result = progressivePlaybackStatusSchema.safeParse({
      activeSource: "progressive-local",
      engineType: "pcm",
      contiguousBufferedMs: 0,
      aheadBufferedMs: 0,
      schedulerPolicy: null,
      startupReady: false,
      fallbackReason: null,
      averageDriftMs: -42,
      maxDriftMs: 75,
      serverClockOffsetMs: -1_250,
      serverClockRoundTripMs: 38
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        averageDriftMs: -42,
        serverClockOffsetMs: -1_250,
        serverClockRoundTripMs: 38
      });
    }
  });
});
