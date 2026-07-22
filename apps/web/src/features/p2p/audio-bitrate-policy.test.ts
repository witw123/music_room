import { describe, expect, it } from "vitest";
import {
  maximumAudioBitrateKbps,
  resolveAdaptiveAudioBitrateKbps,
  resolveAggregateAudioBitratesKbps
} from "./audio-bitrate-policy";

describe("resolveAdaptiveAudioBitrateKbps", () => {
  it("keeps a healthy 192 kbps link at the requested quality", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: 192,
      currentKbps: 192,
      availableOutgoingBitrateKbps: 1_200,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(192);
  });

  it("backs off quickly when the path cannot reserve the audio budget", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: 192,
      currentKbps: 192,
      availableOutgoingBitrateKbps: 160,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(128);
  });

  it("uses a severe quality signal even when bandwidth is unavailable", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: 192,
      currentKbps: 192,
      availableOutgoingBitrateKbps: null,
      packetLossRate: 6,
      jitterMs: 8,
      roundTripTimeMs: 45
    })).toBe(128);
  });

  it("ramps back up instead of jumping to the full target", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: 192,
      currentKbps: 96,
      availableOutgoingBitrateKbps: 1_200,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(112);
  });

  it("never drops below the music-safe floor", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: 192,
      currentKbps: 192,
      availableOutgoingBitrateKbps: 20,
      packetLossRate: 10,
      jitterMs: 80,
      roundTripTimeMs: 400
    })).toBe(64);
  });

  it("caps every request at the Opus 510 kbps ceiling", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: 1_000,
      currentKbps: 1_000,
      availableOutgoingBitrateKbps: 10_000,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(maximumAudioBitrateKbps);
  });

  it("ramps a healthy link upward toward 510 kbps", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: maximumAudioBitrateKbps,
      currentKbps: 192,
      availableOutgoingBitrateKbps: 5_000,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(208);

    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: maximumAudioBitrateKbps,
      currentKbps: 496,
      availableOutgoingBitrateKbps: 5_000,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(maximumAudioBitrateKbps);
  });

  it("does not round a near-limit shared budget above its capacity", () => {
    expect(resolveAdaptiveAudioBitrateKbps({
      requestedKbps: maximumAudioBitrateKbps,
      currentKbps: maximumAudioBitrateKbps,
      availableOutgoingBitrateKbps: 627,
      packetLossRate: 0,
      jitterMs: 4,
      roundTripTimeMs: 45
    })).toBe(496);
  });

  it("keeps every sender at the requested bitrate when shared capacity is sufficient", () => {
    const result = resolveAggregateAudioBitratesKbps([
      createAggregateInput("peer_b", 1_200),
      createAggregateInput("peer_c", 1_200),
      createAggregateInput("peer_d", 1_200)
    ]);

    expect([...result.values()]).toEqual([192, 192, 192]);
  });

  it("shares a constrained source upload budget fairly", () => {
    const result = resolveAggregateAudioBitratesKbps([
      createAggregateInput("peer_b", 600),
      createAggregateInput("peer_c", 600),
      createAggregateInput("peer_d", 600)
    ]);

    expect([...result.values()]).toEqual([160, 160, 160]);
  });

  it("uses the lowest known path estimate for the shared source budget", () => {
    const result = resolveAggregateAudioBitratesKbps([
      createAggregateInput("peer_b", 1_200),
      createAggregateInput("peer_c", 1_200),
      createAggregateInput("peer_d", 400)
    ]);

    expect([...result.values()]).toEqual([104, 104, 104]);
  });

  it("keeps per-peer network degradation inside the shared allocation", () => {
    const result = resolveAggregateAudioBitratesKbps([
      createAggregateInput("peer_b", 600),
      createAggregateInput("peer_c", 600, { packetLossRate: 6 }),
      createAggregateInput("peer_d", 600)
    ]);

    expect(result.get("peer_b")).toBe(160);
    expect(result.get("peer_c")).toBe(128);
  });
});

function createAggregateInput(
  peerId: string,
  availableOutgoingBitrateKbps: number,
  overrides: Partial<Parameters<typeof resolveAggregateAudioBitratesKbps>[0][number]> = {}
) {
  return {
    peerId,
    requestedKbps: 192,
    currentKbps: 192,
    availableOutgoingBitrateKbps,
    packetLossRate: 0,
    jitterMs: 4,
    roundTripTimeMs: 45,
    ...overrides
  };
}
