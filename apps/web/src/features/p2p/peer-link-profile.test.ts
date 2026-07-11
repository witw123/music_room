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
});
