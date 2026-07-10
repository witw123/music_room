import { describe, expect, it } from "vitest";
import {
  normalizeSoftwareFlacOutput,
  resolveFlacDecoderStrategy
} from "./software-flac-decoder";

describe("software FLAC decoder", () => {
  it("uses the worker decoder when native FLAC exceeds the output sample rate range", () => {
    expect(
      resolveFlacDecoderStrategy({
        nativeConfigSupported: true,
        sourceSampleRate: 384_000,
        maxNativeSampleRate: 96_000
      })
    ).toBe("software");
    expect(
      resolveFlacDecoderStrategy({
        nativeConfigSupported: false,
        sourceSampleRate: 44_100,
        maxNativeSampleRate: 96_000
      })
    ).toBe("software");
  });

  it("resamples high-rate PCM to the AudioContext rate without changing its duration", async () => {
    const source = Float32Array.from({ length: 384 }, (_, index) => Math.sin(index / 8));
    const output = await normalizeSoftwareFlacOutput({
      channelData: [source, source.slice()],
      samplesDecoded: source.length,
      sampleRate: 384_000,
      targetSampleRate: 48_000
    });

    expect(output.sampleRate).toBe(48_000);
    expect(output.samplesDecoded).toBe(48);
    expect(output.channelData).toHaveLength(2);
    expect(output.channelData[0]).toHaveLength(48);
    expect(output.samplesDecoded / output.sampleRate).toBeCloseTo(
      source.length / 384_000,
      6
    );
  });
});
