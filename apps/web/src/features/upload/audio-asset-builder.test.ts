import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  playbackEncoderVersion,
  playbackProfileId,
  resolveEncodingConcurrency,
  resolveSupportedUploadFormat,
  slicePcmSegment
} from "./audio-asset-builder";

describe("audio asset preparation", () => {
  it("uses bounded decoding paths for supported upload formats", () => {
    const source = readFileSync(new URL("./audio-asset-builder.ts", import.meta.url), "utf8");

    expect(source).toContain("resolveWavPlaybackSource");
    expect(source).toContain("resolveCompressedPlaybackSource");
    expect(source).toContain("compressedDecodeWindowBytes");
    expect(source).not.toContain("maxDecodedPcmBytes");
    expect(source).not.toContain("assertFileFitsDecodeMemoryBudget");
  });

  it("publishes the server-compatible playback profile", () => {
    expect(playbackProfileId).toBe("opus-music-v3");
    expect(playbackEncoderVersion).toBe("3.0.0");
  });

  it("accepts only the supported room source formats", () => {
    expect(resolveSupportedUploadFormat({ name: "song.flac", type: "" })).toBe("flac");
    expect(resolveSupportedUploadFormat({ name: "song", type: "audio/wav" })).toBe("wav");
    expect(resolveSupportedUploadFormat({ name: "song.mp3", type: "audio/mpeg" })).toBe("mp3");
    expect(resolveSupportedUploadFormat({ name: "song.m4a", type: "audio/mp4" })).toBeNull();
  });

  it("keeps seek preroll as overlap metadata without shifting the room timeline", () => {
    const channel = Float32Array.from({ length: 48_000 * 5 }, (_, index) => index);
    const audioBuffer = {
      duration: 5,
      sampleRate: 48_000,
      numberOfChannels: 1,
      length: channel.length,
      getChannelData: () => channel
    };
    const firstSegment = slicePcmSegment(audioBuffer, 0);
    expect(firstSegment.channels[0]).toHaveLength(48_000 * 2);
    expect(firstSegment.trimStartSamples).toBe(0);
    expect(firstSegment.channels[0]?.[0]).toBe(0);
    expect(firstSegment.channels[0]?.[3_839]).toBe(channel[3_839]);
    expect(firstSegment.channels[0]?.[3_840]).toBe(channel[3_840]);

    const laterSegment = slicePcmSegment(audioBuffer, 1);
    expect(laterSegment.channels[0]).toHaveLength(48_000 * 2 + 3_840);
    expect(laterSegment.trimStartSamples).toBe(3_840);
    expect(laterSegment.channels[0]?.[0]).toBe(48_000 * 2 - 3_840);
  });

  it("bounds segment encoding concurrency by work and available CPU", () => {
    expect(resolveEncodingConcurrency(1, 16)).toBe(1);
    expect(resolveEncodingConcurrency(20, 16)).toBe(4);
    expect(resolveEncodingConcurrency(20, 2)).toBe(1);
  });
});
