export type PeerLinkProfile =
  | "fast-direct"
  | "standard-direct"
  | "relay-udp"
  | "constrained"
  | "severe";

export type PeerLinkProfileInput = {
  currentRoundTripTimeMs?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  candidateType?: string | null;
  protocol?: string | null;
  relayProtocol?: string | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  bufferedAmountBytes?: number | null;
};

export type PeerSendBudget = {
  highWatermarkBytes: number;
  bulkHighWatermarkBytes: number;
  maxPayloadBytes: number;
};

export function resolvePeerLinkProfile(input: PeerLinkProfileInput): PeerLinkProfile {
  const bufferedAmountBytes = finitePositive(input.bufferedAmountBytes) ?? 0;
  const roundTripTimeMs = finitePositive(input.currentRoundTripTimeMs);
  const transferRateKbps =
    finitePositive(input.downloadRateKbps) ?? finitePositive(input.uploadRateKbps);
  const protocol = normalizeProtocol(input.relayProtocol ?? input.protocol);
  const isRelay = normalizeCandidateType(input.candidateType) === "relay";
  const isTcp = protocol === "tcp";

  if (
    input.transportScore === "failed" ||
    input.transportScore === "unstable"
  ) {
    return "severe";
  }

  if (isRelay && !isTcp) {
    return "relay-udp";
  }

  if (
    input.transportScore === "degraded" ||
    isTcp ||
    bufferedAmountBytes >= 8 * 1024 * 1024 ||
    (roundTripTimeMs !== null && roundTripTimeMs >= 250) ||
    (transferRateKbps !== null && transferRateKbps < 1_500)
  ) {
    return "constrained";
  }

  if (isRelay) {
    return "relay-udp";
  }

  if (
    !isTcp &&
    bufferedAmountBytes < 128 * 1024 &&
    roundTripTimeMs !== null &&
    roundTripTimeMs <= 120 &&
    transferRateKbps !== null &&
    transferRateKbps >= 4_000
  ) {
    return "fast-direct";
  }

  return "standard-direct";
}

export function resolvePeerSendBudget(input: PeerLinkProfileInput): PeerSendBudget {
  const profile = resolvePeerLinkProfile(input);
  if (profile === "fast-direct") {
    return {
      highWatermarkBytes: 16 * 1024 * 1024,
      bulkHighWatermarkBytes: 8 * 1024 * 1024,
      maxPayloadBytes: 240 * 1024
    };
  }

  if (profile === "relay-udp") {
    return {
      highWatermarkBytes: 4 * 1024 * 1024,
      bulkHighWatermarkBytes: 1024 * 1024,
      maxPayloadBytes: 128 * 1024
    };
  }

  if (profile === "standard-direct") {
    return {
      highWatermarkBytes: 8 * 1024 * 1024,
      bulkHighWatermarkBytes: 4 * 1024 * 1024,
      maxPayloadBytes: 192 * 1024
    };
  }

  return {
    highWatermarkBytes: 4 * 1024 * 1024,
    bulkHighWatermarkBytes: 1024 * 1024,
    maxPayloadBytes: 128 * 1024
  };
}

export function isSeverePeerLink(input: PeerLinkProfileInput) {
  return resolvePeerLinkProfile(input) === "severe";
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizeCandidateType(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? null;
}

function normalizeProtocol(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? null;
}
