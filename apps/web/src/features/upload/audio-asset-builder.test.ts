import { describe, expect, it } from "vitest";
import {
  assertDecodedPcmWithinMemoryBudget,
  estimateDecodedPcmBytes,
  maxDecodedPcmBytes,
  playbackEncoderVersion,
  playbackProfileId,
  resolveEncodingConcurrency,
  resolveSupportedUploadFormat,
  slicePcmSegment
} from "./audio-asset-builder";

describe("audio asset preparation", () => {
  it("publishes the server-compatible playback profile", () => {
    expect(playbackProfileId).toBe("opus-music-v2");
    expect(playbackEncoderVersion).toBe("2.0.0");
  });

  it("accepts only the supported room source formats", () => {
    expect(resolveSupportedUploadFormat({ name: "song.flac", type: "" })).toBe("flac");
    expect(resolveSupportedUploadFormat({ name: "song", type: "audio/wav" })).toBe("wav");
    expect(resolveSupportedUploadFormat({ name: "song.mp3", type: "audio/mpeg" })).toBe("mp3");
    expect(resolveSupportedUploadFormat({ name: "song.m4a", type: "audio/mp4" })).toBeNull();
  });

  it("adds codec preroll without changing the room timeline", () => {
    const channel = Float32Array.from({ length: 48_000 * 5 }, (_, index) => index);
    const audioBuffer = {
      duration: 5,
      sampleRate: 48_000,
      numberOfChannels: 1,
      length: channel.length,
      getChannelData: () => channel
    };
    const firstSegment = slicePcmSegment(audioBuffer, 0);
    expect(firstSegment.channels[0]).toHaveLength(48_000 * 2 + 3_840);
    expect(firstSegment.trimStartSamples).toBe(0);
    expect(firstSegment.channels[0]?.[0]).toBe(0);
    expect(firstSegment.channels[0]?.[3_839]).toBe(0);
    expect(firstSegment.channels[0]?.[3_840]).toBe(channel[0]);

    const laterSegment = slicePcmSegment(audioBuffer, 1);
    expect(laterSegment.channels[0]).toHaveLength(48_000 * 2 + 3_840);
    expect(laterSegment.trimStartSamples).toBe(3_840);
    expect(laterSegment.channels[0]?.[0]).toBe(48_000 * 2 - 3_840);
  });

  it("rejects audio whose decoded PCM would exceed the browser memory budget", () => {
    expect(estimateDecodedPcmBytes({ durationSeconds: 600, channels: 2 }))
      .toBeLessThan(maxDecodedPcmBytes);
    expect(() =>
      assertDecodedPcmWithinMemoryBudget({ durationSeconds: 720, channels: 2 })
    ).toThrow(/256 MB/);
  });

  it("bounds segment encoding concurrency by work and available CPU", () => {
    expect(resolveEncodingConcurrency(1, 16)).toBe(1);
    expect(resolveEncodingConcurrency(20, 16)).toBe(4);
    expect(resolveEncodingConcurrency(20, 2)).toBe(1);
  });
});
