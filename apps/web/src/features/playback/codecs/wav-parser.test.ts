import { describe, expect, it } from "vitest";
import { parseWavHeader, resolveWavByteRangeForSamples } from "./wav-parser";

function buildPcmWavHeader(input: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
}) {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + input.dataBytes, true);
  writeAscii(bytes, 8, "WAVE");
  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, input.channels, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, input.sampleRate * input.channels * input.bitsPerSample / 8, true);
  view.setUint16(32, input.channels * input.bitsPerSample / 8, true);
  view.setUint16(34, input.bitsPerSample, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, input.dataBytes, true);
  return bytes;
}

function writeAscii(target: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

describe("wav parser", () => {
  it("parses PCM WAV metadata needed for lossless byte-window playback", () => {
    const header = parseWavHeader(buildPcmWavHeader({
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
      dataBytes: 480_000
    }));

    expect(header).toMatchObject({
      format: "pcm",
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
      dataOffset: 44,
      dataBytes: 480_000,
      totalSamples: 120_000
    });
  });

  it("maps sample windows to byte ranges inside the WAV data chunk", () => {
    const header = parseWavHeader(buildPcmWavHeader({
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
      dataBytes: 480_000
    }))!;

    expect(resolveWavByteRangeForSamples(header, 48_000, 96_000)).toEqual({
      startByte: 192_044,
      endByte: 384_044
    });
  });
});
