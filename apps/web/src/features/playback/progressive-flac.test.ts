import { describe, expect, it } from "vitest";
import {
  extractFlacPacketsFromBitstream,
  parseFlacStreamInfo
} from "./progressive-flac";

describe("progressive flac helpers", () => {
  it("parses streaminfo and splits contiguous FLAC frames", () => {
    const streamInfoPayload = new Uint8Array(34);
    streamInfoPayload[0] = 0x10;
    streamInfoPayload[1] = 0x00;
    streamInfoPayload[2] = 0x10;
    streamInfoPayload[3] = 0x00;
    streamInfoPayload[10] = 0x0a;
    streamInfoPayload[11] = 0xc4;
    streamInfoPayload[12] = 0x42;
    streamInfoPayload[13] = 0xf0;
    streamInfoPayload[14] = 0x00;
    streamInfoPayload[15] = 0x00;
    streamInfoPayload[16] = 0x20;
    streamInfoPayload[17] = 0x00;

    const description = new Uint8Array([
      0x66, 0x4c, 0x61, 0x43,
      0x80, 0x00, 0x00, 0x22,
      ...streamInfoPayload
    ]);
    const frameA = buildFlacFrame(0, [0x11, 0x22, 0x33, 0x00, 0x00]);
    const frameB = buildFlacFrame(1, [0x44, 0x55, 0x66, 0x00, 0x00]);
    const bitstream = new Uint8Array([...description, ...frameA, ...frameB]);

    const streamInfo = parseFlacStreamInfo(bitstream);
    expect(streamInfo).toMatchObject({
      audioOffset: description.length,
      sampleRate: 44_100,
      numberOfChannels: 2,
      bitsPerSample: 16
    });

    const packetExtraction = extractFlacPacketsFromBitstream({
      bytes: bitstream,
      startOffset: 0,
      nextSampleIndex: 0,
      finalChunk: true
    });

    expect(packetExtraction.streamInfo?.audioOffset).toBe(description.length);
    expect(packetExtraction.packets).toHaveLength(2);
    expect(packetExtraction.packets[0]?.sampleCount).toBe(256);
    expect(packetExtraction.packets[1]?.timestampUs).toBe(
      Math.round((256 / 44_100) * 1_000_000)
    );
    expect(packetExtraction.nextOffset).toBe(bitstream.length);
    expect(packetExtraction.nextSampleIndex).toBe(512);
  });

  it("keeps the trailing frame pending until another sync word arrives", () => {
    const streamInfoPayload = new Uint8Array(34);
    streamInfoPayload[10] = 0x0a;
    streamInfoPayload[11] = 0xc4;
    streamInfoPayload[12] = 0x42;
    streamInfoPayload[13] = 0xf0;
    const description = new Uint8Array([
      0x66, 0x4c, 0x61, 0x43,
      0x80, 0x00, 0x00, 0x22,
      ...streamInfoPayload
    ]);
    const frameA = buildFlacFrame(0, [0x10, 0x11, 0x12, 0x00, 0x00]);
    const partialFrameB = buildFlacFrame(1, [0x20, 0x21]).slice(0, 5);
    const bitstream = new Uint8Array([...description, ...frameA, ...partialFrameB]);

    const packetExtraction = extractFlacPacketsFromBitstream({
      bytes: bitstream,
      startOffset: description.length,
      nextSampleIndex: 0,
      finalChunk: false
    });

    expect(packetExtraction.packets).toHaveLength(1);
    expect(packetExtraction.nextOffset).toBe(description.length + frameA.length);
    expect(packetExtraction.nextSampleIndex).toBe(256);
  });
});

function buildFlacFrame(frameNumber: number, bodyBytes: number[]) {
  const headerWithoutCrc = new Uint8Array([0xff, 0xf8, 0x80, 0x10, frameNumber & 0x7f]);
  const header = new Uint8Array([...headerWithoutCrc, computeCrc8(headerWithoutCrc)]);
  return new Uint8Array([...header, ...bodyBytes]);
}

function computeCrc8(bytes: Uint8Array) {
  let crc = 0;

  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((crc & 0x80) !== 0) {
        crc = ((crc << 1) ^ 0x07) & 0xff;
      } else {
        crc = (crc << 1) & 0xff;
      }
    }
  }

  return crc;
}
