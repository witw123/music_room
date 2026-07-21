export const minimumAudioBitrateKbps = 64;
export const audioBitrateStepKbps = 8;

const audioCapacityShare = 0.8;
const additiveIncreaseKbps = 16;

export type AdaptiveAudioBitrateInput = {
  requestedKbps: number;
  currentKbps: number | null;
  availableOutgoingBitrateKbps: number | null;
  packetLossRate: number | null;
  jitterMs: number | null;
  roundTripTimeMs: number | null;
};

/**
 * Select a per-peer RTP audio cap without making healthy links oscillate.
 * Decreases are immediate enough to protect playback; increases are additive
 * so a recovering path does not repeatedly overshoot its available capacity.
 */
export function resolveAdaptiveAudioBitrateKbps(input: AdaptiveAudioBitrateInput) {
  const requestedKbps = normalizeBitrate(input.requestedKbps);
  if (requestedKbps === null) {
    return null;
  }

  let desiredKbps = requestedKbps;
  const availableKbps = finitePositive(input.availableOutgoingBitrateKbps);
  if (availableKbps !== null) {
    desiredKbps = Math.min(desiredKbps, availableKbps * audioCapacityShare);
  }

  const severeNetwork =
    atLeast(input.packetLossRate, 5) ||
    atLeast(input.jitterMs, 50) ||
    atLeast(input.roundTripTimeMs, 250);
  const degradedNetwork =
    atLeast(input.packetLossRate, 2.5) ||
    atLeast(input.jitterMs, 30) ||
    atLeast(input.roundTripTimeMs, 150);

  if (severeNetwork) {
    desiredKbps = Math.min(desiredKbps, requestedKbps * 0.7);
  } else if (degradedNetwork) {
    desiredKbps = Math.min(desiredKbps, requestedKbps * 0.85);
  }

  const desired = quantizeBitrate(desiredKbps);
  const current = input.currentKbps === null
    ? requestedKbps
    : quantizeBitrate(input.currentKbps);

  if (desired < current - audioBitrateStepKbps) {
    return desired;
  }
  if (desired > current + audioBitrateStepKbps) {
    return Math.min(desired, current + additiveIncreaseKbps);
  }
  return current;
}

function normalizeBitrate(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.max(minimumAudioBitrateKbps, Math.round(value));
}

function quantizeBitrate(value: number) {
  return Math.max(
    minimumAudioBitrateKbps,
    Math.floor(Math.max(minimumAudioBitrateKbps, value) / audioBitrateStepKbps) * audioBitrateStepKbps
  );
}

function finitePositive(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function atLeast(value: number | null, threshold: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= threshold;
}
