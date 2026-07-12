import { describe, expect, it } from "vitest";
import { resolveAdaptiveStartupBufferMs } from "./playback-quality-policy";

describe("resolveAdaptiveStartupBufferMs", () => {
  it("keeps a healthy direct link at the base buffer", () => {
    expect(
      resolveAdaptiveStartupBufferMs({
        baseStartupBufferMs: 8_000,
        aggregatePieceDownloadRateKbps: 8_000,
        peerDiagnostics: [
          { currentRoundTripTimeMs: 45, dataCandidateType: "srflx", dataRelayProtocol: null }
        ],
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0
      })
    ).toBe(8_000);
  });

  it("raises the buffer for a UDP relay", () => {
    expect(
      resolveAdaptiveStartupBufferMs({
        baseStartupBufferMs: 8_000,
        aggregatePieceDownloadRateKbps: 5_000,
        peerDiagnostics: [
          { currentRoundTripTimeMs: 70, dataCandidateType: "relay", dataRelayProtocol: "udp" }
        ],
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0
      })
    ).toBe(12_000);
  });

  it("uses the maximum protection for a slow high-latency link", () => {
    expect(
      resolveAdaptiveStartupBufferMs({
        baseStartupBufferMs: 8_000,
        aggregatePieceDownloadRateKbps: 600,
        peerDiagnostics: [
          { currentRoundTripTimeMs: 360, dataCandidateType: "relay", dataRelayProtocol: "udp" }
        ],
        waitingEventsLast30s: 0,
        stalledEventsLast30s: 0
      })
    ).toBe(18_000);
  });

  it("adds recovery headroom after recent playback interruptions", () => {
    expect(
      resolveAdaptiveStartupBufferMs({
        baseStartupBufferMs: 8_000,
        aggregatePieceDownloadRateKbps: 8_000,
        peerDiagnostics: [],
        waitingEventsLast30s: 2,
        stalledEventsLast30s: 0
      })
    ).toBe(10_000);
  });
});
