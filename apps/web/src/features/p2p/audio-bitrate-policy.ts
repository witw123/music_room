export const minimumAudioBitrateKbps = 64;
export const audioBitrateStepKbps = 8;
export const maximumAudioBitrateKbps = 510;
export const audioBitrateDegradationConfirmWindows = 2;

const audioCapacityShare = 0.8;
const additiveIncreaseKbps = 16;

export type AdaptiveAudioBitrateInput = {
  requestedKbps: number;
  currentKbps: number | null;
  availableOutgoingBitrateKbps: number | null;
  packetLossRate: number | null;
  jitterMs: number | null;
  roundTripTimeMs: number | null;
  aggregateTargetKbps?: number | null;
  degradedNetworkWindows?: number;
};

export type AggregateAudioBitrateInput = AdaptiveAudioBitrateInput & {
  peerId: string;
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
  const networkDegraded = hasDegradedNetwork(input);
  const severeNetwork = networkDegraded && (
    atLeast(input.packetLossRate, 5) ||
    atLeast(input.jitterMs, 50) ||
    atLeast(input.roundTripTimeMs, 250)
  );
  const degradedNetwork = networkDegraded;
  const availableKbps = finitePositive(input.availableOutgoingBitrateKbps);
  if (availableKbps !== null && degradedNetwork) {
    desiredKbps = Math.min(desiredKbps, availableKbps * audioCapacityShare);
  }
  const aggregateTargetKbps = finitePositive(input.aggregateTargetKbps ?? null);
  if (aggregateTargetKbps !== null) {
    desiredKbps = Math.min(desiredKbps, aggregateTargetKbps);
  }

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
  if (
    desired === maximumAudioBitrateKbps &&
    current >= maximumAudioBitrateKbps - audioBitrateStepKbps
  ) {
    return maximumAudioBitrateKbps;
  }
  if (desired > current + audioBitrateStepKbps) {
    return Math.min(desired, current + additiveIncreaseKbps);
  }
  return current;
}

/**
 * Resolve all source senders against one shared upload budget. Separate
 * RTCPeerConnections often report the same physical uplink independently;
 * using the lowest known estimate avoids multiplying that estimate by the
 * number of senders.
 */
export function resolveAggregateAudioBitratesKbps(
  inputs: readonly AggregateAudioBitrateInput[]
) {
  const activeInputs = inputs.filter((input) => normalizeBitrate(input.requestedKbps) !== null);
  if (activeInputs.length === 0) {
    return new Map<string, number | null>();
  }

  const knownAvailableKbps = activeInputs
    .map((input) => finitePositive(input.availableOutgoingBitrateKbps))
    .filter((value): value is number => value !== null);
  const sharedAvailableKbps = knownAvailableKbps.length > 0
    ? Math.min(...knownAvailableKbps) * audioCapacityShare
    : null;
  const requestedTotalKbps = activeInputs.reduce(
    (total, input) => total + (normalizeBitrate(input.requestedKbps) ?? 0),
    0
  );
  const fairShareKbps = sharedAvailableKbps === null
    ? null
    : activeInputs.some(hasDegradedNetwork)
      ? Math.min(requestedTotalKbps, sharedAvailableKbps) / activeInputs.length
      : null;

  return new Map(activeInputs.map((input) => [
    input.peerId,
    resolveAdaptiveAudioBitrateKbps({
      ...input,
      aggregateTargetKbps: fairShareKbps
    })
  ]));
}

function normalizeBitrate(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(maximumAudioBitrateKbps, Math.max(minimumAudioBitrateKbps, Math.round(value)));
}

function quantizeBitrate(value: number) {
  const clampedValue = Math.min(
    maximumAudioBitrateKbps,
    Math.max(minimumAudioBitrateKbps, value)
  );
  if (clampedValue >= maximumAudioBitrateKbps) {
    return maximumAudioBitrateKbps;
  }
  return Math.max(
    minimumAudioBitrateKbps,
    Math.floor(clampedValue / audioBitrateStepKbps) * audioBitrateStepKbps
  );
}

function finitePositive(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function atLeast(value: number | null, threshold: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= threshold;
}

function hasDegradedNetwork(input: AdaptiveAudioBitrateInput) {
  return hasAudioNetworkDegradationSignal(input) &&
    (input.degradedNetworkWindows === undefined ||
      input.degradedNetworkWindows >= audioBitrateDegradationConfirmWindows);
}

export function hasAudioNetworkDegradationSignal(
  input: Pick<AdaptiveAudioBitrateInput, "packetLossRate" | "jitterMs" | "roundTripTimeMs">
) {
  return atLeast(input.packetLossRate, 2.5) ||
    atLeast(input.jitterMs, 30) ||
    atLeast(input.roundTripTimeMs, 150);
}
