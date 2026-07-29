import { describe, expect, it } from "vitest";
import {
  maximumAudioBitrateKbps,
  preferredAudioRtpBitrateKbps,
  resolveFixedAudioBitrateKbps
} from "./audio-bitrate-policy";

describe("fixed RTP audio bitrate policy", () => {
  it("uses the project maximum as the preferred RTP target", () => {
    expect(preferredAudioRtpBitrateKbps).toBe(maximumAudioBitrateKbps);
    expect(maximumAudioBitrateKbps).toBe(510);
  });

  it("uses the same maximum for every valid request", () => {
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: 64 })).toBe(510);
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: 192 })).toBe(510);
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: 320 })).toBe(510);
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: 1_000 })).toBe(510);
  });

  it("does not change with network statistics because adaptation is disabled", () => {
    const requests = [64, 192, 320, 510];
    const results = requests.map((requestedKbps) =>
      resolveFixedAudioBitrateKbps({ requestedKbps })
    );

    expect(results).toEqual([510, 510, 510, 510]);
  });

  it("keeps invalid requests disabled", () => {
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: null })).toBeNull();
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: 0 })).toBeNull();
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: -1 })).toBeNull();
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: Number.NaN })).toBeNull();
    expect(resolveFixedAudioBitrateKbps({ requestedKbps: Number.POSITIVE_INFINITY })).toBeNull();
  });
});
