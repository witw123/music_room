import { describe, expect, it } from "vitest";
import { calculatePieceTransferRateKbps } from "./use-room-runtime-observability";

describe("piece transfer rate sampling", () => {
  it("measures bytes from their request start instead of dividing the first piece by 1ms", () => {
    expect(
      calculatePieceTransferRateKbps([
        { startedAtMs: 0, timestampMs: 100, bytes: 125_000 },
        { startedAtMs: 100, timestampMs: 200, bytes: 125_000 }
      ])
    ).toBe(10_000);
  });

  it("does not invent a rate for one upload sample without a start time", () => {
    expect(
      calculatePieceTransferRateKbps([
        { timestampMs: 100, bytes: 256 * 1024 }
      ])
    ).toBe(0);
  });

  it("excludes the first unknown-duration upload from the measured interval", () => {
    expect(
      calculatePieceTransferRateKbps([
        { timestampMs: 100, bytes: 125_000 },
        { timestampMs: 200, bytes: 125_000 }
      ])
    ).toBe(10_000);
  });
});
