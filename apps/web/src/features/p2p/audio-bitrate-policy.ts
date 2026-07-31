// Keep RTP audio independent from the encoded playback asset. The sender
// always uses the highest bitrate supported by this project's Opus policy.
export const maximumAudioBitrateKbps = 510;
export const preferredAudioRtpBitrateKbps = maximumAudioBitrateKbps;
export const degradedAudioBitrateKbps = 288;
export const minimumAudioBitrateKbps = 160;

export type FixedAudioBitrateInput = {
  requestedKbps: number | null;
};

/**
 * Resolve the RTP target without consulting network statistics or fanout.
 * A non-positive/invalid request disables the local RTP source; every valid
 * request uses the fixed project maximum.
 */
export function resolveFixedAudioBitrateKbps(input: FixedAudioBitrateInput) {
  if (
    typeof input.requestedKbps !== "number" ||
    !Number.isFinite(input.requestedKbps) ||
    input.requestedKbps <= 0
  ) {
    return null;
  }
  return maximumAudioBitrateKbps;
}

export type AdaptiveAudioBitrateInput = {
  lossRate: number;
  jitterMs: number;
  availableOutgoingBitrateKbps: number | null;
};

/**
 * Choose a per-listener RTP Opus bitrate from the live quality of that peer's
 * connection. Weak links are fed less bitrate so the browser's congestion
 * control keeps a larger share of the path for FEC and retransmission instead
 * of over-filling a degrading pipe with high-rate audio that then drops.
 * Thresholds mirror `observePeerTransport`'s degraded/unstable window bands.
 */
export function resolveAdaptiveAudioBitrateKbps(input: AdaptiveAudioBitrateInput) {
  const { lossRate, jitterMs, availableOutgoingBitrateKbps } = input;
  const availableKbps = availableOutgoingBitrateKbps;
  if (
    lossRate >= 8 ||
    jitterMs >= 40 ||
    (availableKbps !== null && availableKbps > 0 && availableKbps < 220)
  ) {
    return minimumAudioBitrateKbps;
  }
  if (
    lossRate >= 3 ||
    jitterMs >= 20 ||
    (availableKbps !== null && availableKbps < 400)
  ) {
    return degradedAudioBitrateKbps;
  }
  return maximumAudioBitrateKbps;
}
