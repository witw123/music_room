import { describe, expect, it } from "vitest";
import {
  assertDecodedPcmWithinMemoryBudget,
  estimateDecodedPcmBytes,
  maxDecodedPcmBytes,
  resolveSupportedUploadFormat,
  slicePcmSegment
} from "./audio-asset-builder";

describe("audio asset preparation", () => {
  it("accepts only the supported room source formats", () => {
    expect(resolveSupportedUploadFormat({ name: "song.flac", type: "" })).toBe("flac");
    expect(resolveSupportedUploadFormat({ name: "song", type: "audio/wav" })).toBe("wav");
    expect(resolveSupportedUploadFormat({ name: "song.mp3", type: "audio/mpeg" })).toBe("mp3");
    expect(resolveSupportedUploadFormat({ name: "song.m4a", type: "audio/mp4" })).toBeNull();
  });

  it("adds preroll without changing the room timeline", () => {
    const channel = Float32Array.from({ length: 48_000 * 5 }, (_, index) => index);
    const segment = slicePcmSegment({
      duration: 5,
      sampleRate: 48_000,
      numberOfChannels: 1,
      length: channel.length,
      getChannelData: () => channel
    }, 1);
    expect(segment.channels[0]).toHaveLength(48_000 * 2 + 48_000 * 0.08);
    expect(segment.trimStartSamples).toBe(3_840);
    expect(segment.channels[0]?.[0]).toBe(48_000 * 2 - 3_840);
  });

  it("rejects audio whose decoded PCM would exceed the browser memory budget", () => {
    expect(estimateDecodedPcmBytes({ durationSeconds: 600, channels: 2 }))
      .toBeLessThan(maxDecodedPcmBytes);
    expect(() =>
      assertDecodedPcmWithinMemoryBudget({ durationSeconds: 720, channels: 2 })
    ).toThrow(/256 MB/);
  });
});
