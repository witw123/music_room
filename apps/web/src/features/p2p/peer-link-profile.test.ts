import { describe, expect, it } from "vitest";
import {
  resolvePeerLinkProfile,
  resolvePeerSendBudget,
  resolvePeerTransferWindow
} from "./peer-link-profile";

describe("external peer link profile", () => {
  it("keeps a healthy high-latency UDP relay in the relay profile", () => {
    expect(
      resolvePeerLinkProfile({
        candidateType: "relay",
        protocol: "udp",
        currentRoundTripTimeMs: 480,
        bufferedAmountBytes: 2 * 1024 * 1024,
        transportScore: "healthy"
      })
    ).toBe("relay-udp");
  });

  it("does not assume an unknown relay protocol is udp", () => {
    expect(
      resolvePeerLinkProfile({
        candidateType: "relay",
        relayProtocol: null,
        currentRoundTripTimeMs: 80,
        downloadRateKbps: 5_000
      })
    ).toBe("constrained");
  });

  it("keeps enough bulk queue to saturate a constrained external link", () => {
    const budget = resolvePeerSendBudget({
      currentRoundTripTimeMs: 320,
      downloadRateKbps: 1_200,
      transportScore: "degraded"
    });

    expect(budget.bulkHighWatermarkBytes).toBeGreaterThanOrEqual(1024 * 1024);
    expect(budget.maxPayloadBytes).toBeGreaterThanOrEqual(128 * 1024);
  });

  it("sizes the in-flight window from the measured bandwidth-delay product", () => {
    const window = resolvePeerTransferWindow({
      candidateType: "relay",
      protocol: "udp",
      currentRoundTripTimeMs: 240,
      downloadRateKbps: 80_000,
      transportScore: "healthy"
    }, 256 * 1024);

    expect(window.targetInFlightBytes).toBeGreaterThanOrEqual(6_000_000);
    expect(window.maxPendingChunks).toBeGreaterThan(13);
    expect(window.requestTimeoutMs).toBeGreaterThanOrEqual(3_000);
  });

  it("does not classify a healthy direct peer as constrained on a temporarily low measured rate", () => {
    expect(
      resolvePeerLinkProfile({
        candidateType: "prflx",
        protocol: "udp",
        currentRoundTripTimeMs: 80,
        downloadRateKbps: 1_200,
        transportScore: "healthy"
      })
    ).toBe("standard-direct");
  });

    it("opens a larger cold-start window and send budget for healthy relay-udp peers", () => {
    const input = {
      candidateType: "relay" as const,
      protocol: "udp",
      currentRoundTripTimeMs: 200,
      downloadRateKbps: null as number | null,
      transportScore: "healthy" as const
    };
    const window = resolvePeerTransferWindow(input, 256 * 1024);
    const budget = resolvePeerSendBudget({
      ...input,
      downloadRateKbps: 8_000
    });

    expect(window.targetInFlightBytes).toBeGreaterThanOrEqual(6 * 1024 * 1024);
    expect(window.maxPendingChunks).toBeGreaterThanOrEqual(12);
    expect(budget.maxPayloadBytes).toBeGreaterThanOrEqual(160 * 1024);
    expect(budget.bulkHighWatermarkBytes).toBeGreaterThanOrEqual(4 * 1024 * 1024);
  });

  it("keeps a cold-start optimistic in-flight floor for direct peers with unknown rate", () => {
    const window = resolvePeerTransferWindow({
      candidateType: "prflx",
      protocol: "udp",
      currentRoundTripTimeMs: 80,
      downloadRateKbps: null,
      transportScore: "healthy"
    }, 256 * 1024);

    expect(window.targetInFlightBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(window.maxPendingChunks).toBeGreaterThanOrEqual(12);
  });

  it("does not collapse the transfer window when a direct peer is only measuring ~0.3 MB/s", () => {
    const window = resolvePeerTransferWindow({
      candidateType: "prflx",
      protocol: "udp",
      currentRoundTripTimeMs: 100,
      downloadRateKbps: 2_400,
      transportScore: "healthy"
    }, 256 * 1024);

    // 0.3 MB/s * 100ms RTT is tiny; optimistic floor should still open a useful window.
    expect(window.targetInFlightBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(window.maxPendingChunks).toBeGreaterThanOrEqual(16);
  });
});
