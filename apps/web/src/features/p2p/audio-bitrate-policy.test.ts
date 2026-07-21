import { describe, expect, it } from "vitest";
import { resolveAdaptiveAudioBitrateKbps } from "./audio-bitrate-policy";

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
});
