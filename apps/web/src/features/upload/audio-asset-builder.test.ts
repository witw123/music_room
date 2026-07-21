import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertDecodedPcmWithinMemoryBudget,
  estimateDecodedPcmBytes,
  maxDecodedPcmBytes,
  playbackEncoderVersion,
  playbackProfileId,
  prepareIndependentOpusSegment,
  resolveEncodingConcurrency,
  resolveSupportedUploadFormat,
  slicePcmSegment
} from "./audio-asset-builder";

describe("audio asset preparation", () => {
  it("uses one browser decode path for every supported upload format", () => {
    const source = readFileSync(new URL("./audio-asset-builder.ts", import.meta.url), "utf8");

    expect(source).toContain("const audioBuffer = await decodeAudioFile(input.file);");
    expect(source).toContain("return await encodePlaybackAsset(input, audioBuffer);");
    expect(source).toContain("maxDecodedPcmBytes = 256 * 1024 * 1024");
    expect(source).not.toContain("AudioDecoder");
    expect(source).not.toContain("resolveWavPlaybackSource");
    expect(source).not.toContain("resolveCompressedPlaybackSource");
    expect(source).not.toContain("StreamingSincResampler");
  });

  it("publishes the server-compatible playback profile", () => {
    expect(playbackProfileId).toBe("opus-music-v3");
    expect(playbackEncoderVersion).toBe("3.3.0");
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
    expect(firstSegment.channels[0]).toHaveLength(48_000 * 2 + 312);
    expect(firstSegment.trimStartSamples).toBe(0);
    expect(firstSegment.channels[0]?.[0]).toBe(0);
    expect(firstSegment.channels[0]?.[3_839]).toBe(channel[3_839]);
    expect(firstSegment.channels[0]?.[3_840]).toBe(channel[3_840]);
    expect(firstSegment.channels[0]?.[48_000 * 2]).toBe(channel[48_000 * 2]);

    const laterSegment = slicePcmSegment(audioBuffer, 1);
    expect(laterSegment.channels[0]).toHaveLength(48_000 * 2 + 3_840 + 312);
    expect(laterSegment.trimStartSamples).toBe(3_840);
    expect(laterSegment.channels[0]?.[0]).toBe(48_000 * 2 - 3_840);
    expect(laterSegment.channels[0]?.[3_840 + 48_000 * 2]).toBe(channel[48_000 * 4]);
  });

  it("keeps real post-roll and only repeats the last sample at EOF", () => {
    const postRoll = Float32Array.from({ length: 48_000 * 2 + 312 }, (_, index) =>
      index < 48_000 * 2 ? Math.sin(index / 11) : 0.25
    );
    const prepared = prepareIndependentOpusSegment({
      channels: [postRoll],
      trimStartSamples: 0,
      contentSamples: 48_000 * 2
    });

    expect(prepared.channels[0]).toHaveLength(postRoll.length);
    expect(prepared.channels[0]?.at(-1)).toBe(0.25);
    expect(prepared.trimStartSamples).toBe(0);
    expect(prepared.trimEndSamples).toBe(648);

    const eof = prepareIndependentOpusSegment({
      channels: [postRoll.subarray(0, 48_000 * 2)],
      trimStartSamples: 0,
      contentSamples: 48_000 * 2
    });
    expect(eof.channels[0]).toHaveLength(48_000 * 2 + 312);
    expect(eof.channels[0]?.at(-1)).toBe(eof.channels[0]?.at(-2));
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
