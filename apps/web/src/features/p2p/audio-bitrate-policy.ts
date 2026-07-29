// Keep RTP audio independent from the encoded playback asset. The sender
// always uses the highest bitrate supported by this project's Opus policy.
export const maximumAudioBitrateKbps = 510;
export const preferredAudioRtpBitrateKbps = maximumAudioBitrateKbps;

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
