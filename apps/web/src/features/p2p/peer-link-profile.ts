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

export type PeerTransferWindow = {
  targetInFlightBytes: number;
  maxPendingChunks: number;
  requestTimeoutMs: number;
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
  const adaptiveWindow = resolvePeerTransferWindow(input, 256 * 1024);
  const adaptiveBulkWatermark = clamp(
    adaptiveWindow.targetInFlightBytes,
    1024 * 1024,
    32 * 1024 * 1024
  );
  if (profile === "fast-direct") {
    return {
      highWatermarkBytes: Math.max(16 * 1024 * 1024, adaptiveBulkWatermark * 2),
      bulkHighWatermarkBytes: Math.max(8 * 1024 * 1024, adaptiveBulkWatermark),
      maxPayloadBytes: 240 * 1024
    };
  }

  if (profile === "relay-udp") {
    return {
      highWatermarkBytes: Math.max(4 * 1024 * 1024, adaptiveBulkWatermark * 2),
      bulkHighWatermarkBytes: adaptiveBulkWatermark,
      maxPayloadBytes: 128 * 1024
    };
  }

  if (profile === "standard-direct") {
    return {
      highWatermarkBytes: Math.max(8 * 1024 * 1024, adaptiveBulkWatermark * 2),
      bulkHighWatermarkBytes: Math.max(4 * 1024 * 1024, adaptiveBulkWatermark),
      maxPayloadBytes: 192 * 1024
    };
  }

  return {
    highWatermarkBytes: Math.max(4 * 1024 * 1024, adaptiveBulkWatermark * 2),
    bulkHighWatermarkBytes: adaptiveBulkWatermark,
    maxPayloadBytes: 128 * 1024
  };
}

export function resolvePeerTransferWindow(
  input: PeerLinkProfileInput,
  chunkSize: number
): PeerTransferWindow {
  const normalizedChunkSize = clamp(Math.round(chunkSize || 0), 16 * 1024, 4 * 1024 * 1024);
  const rttMs = finitePositive(input.currentRoundTripTimeMs) ?? 180;
  const transferRateKbps =
    finitePositive(input.downloadRateKbps) ?? finitePositive(input.uploadRateKbps);
  const bytesPerSecond = transferRateKbps === null ? null : transferRateKbps * 1000 / 8;
  const bandwidthDelayProduct = bytesPerSecond === null
    ? 2 * 1024 * 1024
    : bytesPerSecond * rttMs / 1000;
  const targetInFlightBytes = clamp(
    Math.ceil(Math.max(4 * normalizedChunkSize, bandwidthDelayProduct * 2.5)),
    1024 * 1024,
    64 * 1024 * 1024
  );
  const transferTimeMs = bytesPerSecond === null
    ? rttMs * 2
    : normalizedChunkSize / Math.max(1, bytesPerSecond) * 1000;
  const profile = resolvePeerLinkProfile(input);
  const minimumTimeoutMs = profile === "relay-udp" || profile === "constrained" ? 3_000 : 1_500;
  return {
    targetInFlightBytes,
    maxPendingChunks: clamp(
      Math.ceil(targetInFlightBytes / normalizedChunkSize),
      4,
      256
    ),
    requestTimeoutMs: clamp(
      Math.ceil(rttMs * 4 + transferTimeMs * 2),
      minimumTimeoutMs,
      45_000
    )
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
