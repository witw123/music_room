import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  playbackEncoderVersion,
  prepareIndependentOpusSegment,
  playbackProfileId,
  resolveEncodingConcurrency,
  resolveSupportedUploadFormat,
  resampleChannelsToOpus,
  slicePcmSegment,
  StreamingSincResampler
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
    expect(playbackEncoderVersion).toBe("3.2.0");
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

  it("resamples across decoder chunks without a boundary discontinuity", () => {
    const resampler = new StreamingSincResampler(1, 96_000, 48_000);
    const first = resampler.append([new Float32Array(4_096).fill(0.25)]);
    const second = resampler.append([new Float32Array(4_096).fill(0.25)]);
    const last = resampler.finish();
    const output = [first, second, last].reduce(
      (result, chunk) => result + (chunk[0]?.length ?? 0),
      0
    );

    expect(output).toBe(4_096);
    for (const chunk of [first[0], second[0], last[0]]) {
      expect(chunk?.every((sample) => Math.abs(sample - 0.25) < 1e-5)).toBe(true);
    }

    const resampler44100 = new StreamingSincResampler(1, 44_100, 48_000);
    let resampled44100 = 0;
    for (let index = 0; index < 10; index += 1) {
      resampled44100 += resampler44100.append([
        new Float32Array(4_410).fill(0.25)
      ])[0]?.length ?? 0;
    }
    resampled44100 += resampler44100.finish()[0]?.length ?? 0;
    expect(resampled44100).toBe(48_000);
  });

  it("uses the same anti-aliased resampler for WAV-sized source chunks", () => {
    const input = Float32Array.from({ length: 96_000 }, (_, index) =>
      0.5 * Math.sin(2 * Math.PI * 32_000 * index / 96_000)
    );
    const output = resampleChannelsToOpus([input], 96_000)[0]!;

    expect(output).toHaveLength(48_000);
    const steadyState = output.subarray(1_000, 47_000);
    const rms = Math.sqrt(
      steadyState.reduce((sum, sample) => sum + sample * sample, 0) / steadyState.length
    );
    expect(rms).toBeLessThan(0.02);
  });

  it("bounds segment encoding concurrency by work and available CPU", () => {
    expect(resolveEncodingConcurrency(1, 16)).toBe(1);
    expect(resolveEncodingConcurrency(20, 16)).toBe(4);
    expect(resolveEncodingConcurrency(20, 2)).toBe(1);
  });
});
