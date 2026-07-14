export type PeerLinkProfile =
  | "fast-direct"
  | "standard-direct"
  | "relay-udp"
  | "constrained"
  | "severe";

export type PeerLinkProfileInput = {
  currentRoundTripTimeMs?: number | null;
  incomingRateKbps?: number | null;
  outgoingRateKbps?: number | null;
  transportReceiveBitrateKbps?: number | null;
  transportSendBitrateKbps?: number | null;
  availableOutgoingBitrateKbps?: number | null;
  downloadRateKbps?: number | null;
  uploadRateKbps?: number | null;
  candidateType?: string | null;
  protocol?: string | null;
  relayProtocol?: string | null;
  transportScore?: "healthy" | "degraded" | "unstable" | "failed" | null;
  bufferedAmountBytes?: number | null;
  mediaTrackActive?: boolean;
  mediaBitrateKbps?: number | null;
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

export function isPeerTransportAllowed(input: PeerLinkProfileInput) {
  const candidateType = normalizeCandidateType(input.candidateType);
  const protocol = normalizeProtocol(input.relayProtocol ?? input.protocol);
  if (!candidateType) {
    // Candidate-pair stats arrive after the data channel can become usable.
    // Permit that cold-start window, then enforce UDP-only routing once the
    // selected candidate is known.
    return true;
  }
  if (candidateType === "relay") {
    return protocol === null || protocol === "udp" || protocol === "tcp" || protocol === "tls";
  }
  return (
    candidateType === "direct" ||
    candidateType === "host" ||
    candidateType === "srflx" ||
    candidateType === "prflx"
  );
}

export function resolvePeerLinkProfile(
  input: PeerLinkProfileInput,
  direction: "incoming" | "outgoing" = "incoming"
): PeerLinkProfile {
  const bufferedAmountBytes = finitePositive(input.bufferedAmountBytes) ?? 0;
  const roundTripTimeMs = finitePositive(input.currentRoundTripTimeMs);
  const incomingRateKbps = resolveIncomingRateKbps(input);
  const outgoingRateKbps = resolveOutgoingRateKbps(input);
  const transferRateKbps = direction === "outgoing" ? outgoingRateKbps : incomingRateKbps;
  const protocol = normalizeProtocol(input.relayProtocol ?? input.protocol);
  const isRelay = normalizeCandidateType(input.candidateType) === "relay";
  const isDirectCandidate =
    !isRelay && normalizeCandidateType(input.candidateType) !== null;

  if (
    input.transportScore === "failed" ||
    input.transportScore === "unstable"
  ) {
    return "severe";
  }

  // ICE can report a relay candidate before relayProtocol is available. Do
  // not treat that transitional state as UDP and open a large send window.
  if (isRelay && protocol === "udp") {
    return "relay-udp";
  }

  // Direct peers with only a temporarily low measured rate should not collapse
  // into constrained mode — that creates a self-reinforcing slow window during
  // cold start (slow sample -> tiny in-flight -> slower sample).
  const severelySlowMeasuredRate =
    transferRateKbps !== null &&
    transferRateKbps < 800 &&
    !isDirectCandidate;

  if (
    input.transportScore === "degraded" ||
    (isRelay && protocol !== "udp") ||
    protocol === "tcp" ||
    bufferedAmountBytes >= 8 * 1024 * 1024 ||
    (roundTripTimeMs !== null && roundTripTimeMs >= 320) ||
    severelySlowMeasuredRate
  ) {
    return "constrained";
  }

  if (isRelay && protocol === "udp") {
    return "relay-udp";
  }

  if (
    protocol !== "tcp" &&
    bufferedAmountBytes < 256 * 1024 &&
    roundTripTimeMs !== null &&
    roundTripTimeMs <= 140 &&
    transferRateKbps !== null &&
    transferRateKbps >= 3_000
  ) {
    return "fast-direct";
  }

  return "standard-direct";
}

export function resolvePeerSendBudget(input: PeerLinkProfileInput): PeerSendBudget {
  const profile = resolvePeerLinkProfile(input, "outgoing");
  const adaptiveWindow = resolvePeerTransferWindow(input, 256 * 1024, "outgoing");
  const adaptiveBulkWatermark = clamp(
    adaptiveWindow.targetInFlightBytes,
    1024 * 1024,
    32 * 1024 * 1024
  );
  let budget: PeerSendBudget;
  if (profile === "fast-direct") {
    budget = {
      highWatermarkBytes: Math.min(32 * 1024 * 1024, Math.max(16 * 1024 * 1024, adaptiveBulkWatermark)),
      bulkHighWatermarkBytes: Math.min(16 * 1024 * 1024, Math.max(8 * 1024 * 1024, adaptiveBulkWatermark)),
      maxPayloadBytes: 240 * 1024
    };
  } else if (profile === "relay-udp") {
    budget = {
      // Relay still needs headroom to pipeline SCTP over TURN; keep below
      // direct but high enough to saturate modest WAN uplinks.
      highWatermarkBytes: Math.min(16 * 1024 * 1024, Math.max(8 * 1024 * 1024, adaptiveBulkWatermark)),
      bulkHighWatermarkBytes: Math.min(8 * 1024 * 1024, Math.max(4 * 1024 * 1024, adaptiveBulkWatermark)),
      maxPayloadBytes: 160 * 1024
    };
  } else if (profile === "standard-direct") {
    budget = {
      highWatermarkBytes: Math.min(32 * 1024 * 1024, Math.max(8 * 1024 * 1024, adaptiveBulkWatermark)),
      bulkHighWatermarkBytes: Math.min(16 * 1024 * 1024, Math.max(4 * 1024 * 1024, adaptiveBulkWatermark)),
      maxPayloadBytes: 192 * 1024
    };
  } else {
    budget = {
      highWatermarkBytes: Math.min(16 * 1024 * 1024, Math.max(4 * 1024 * 1024, adaptiveBulkWatermark)),
      bulkHighWatermarkBytes: Math.min(8 * 1024 * 1024, adaptiveBulkWatermark),
      maxPayloadBytes: 128 * 1024
    };
  }

  if (!input.mediaTrackActive) {
    return budget;
  }

  // RTP Opus shares the ICE/SCTP congestion controller with the manual
  // original-file channel. While audio is live, pause bulk transfer entirely
  // so the sender's full uplink and TURN allocation remain available to RTP.
  const bulkHighWatermarkBytes = 0;

  return {
    ...budget,
    bulkHighWatermarkBytes,
    maxPayloadBytes: Math.min(budget.maxPayloadBytes, 64 * 1024)
  };
}

export function resolvePeerTransferWindow(
  input: PeerLinkProfileInput,
  chunkSize: number,
  direction: "incoming" | "outgoing" = "incoming"
): PeerTransferWindow {
  const normalizedChunkSize = clamp(Math.round(chunkSize || 0), 16 * 1024, 4 * 1024 * 1024);
  const rttMs = finitePositive(input.currentRoundTripTimeMs) ?? 180;
  const outgoingRateKbps = resolveOutgoingRateKbps(input);
  const availableOutgoingRateKbps = finitePositive(input.availableOutgoingBitrateKbps);
  const transferRateKbps =
    direction === "outgoing"
      ? outgoingRateKbps === null || availableOutgoingRateKbps === null
        ? outgoingRateKbps
        : Math.min(outgoingRateKbps, availableOutgoingRateKbps)
      : resolveIncomingRateKbps(input);
  const profile = resolvePeerLinkProfile(input, direction);
  const bytesPerSecond = transferRateKbps === null ? null : transferRateKbps * 1000 / 8;
  // Cold-start optimistic BDP when rate is unknown/low. Using a tiny measured
  // rate as the sole BDP input keeps only a few chunks in flight and never
  // saturates direct LAN links during progressive startup.
  const optimisticFloorBytes =
    profile === "fast-direct"
      ? 16 * 1024 * 1024
      : profile === "standard-direct"
        ? 16 * 1024 * 1024
        : profile === "relay-udp"
          ? 8 * 1024 * 1024
          : 2 * 1024 * 1024;
  const measuredBdpBytes =
    bytesPerSecond === null ? null : bytesPerSecond * rttMs / 1000;
  const bandwidthDelayProduct =
    measuredBdpBytes === null
      ? optimisticFloorBytes
      : Math.max(measuredBdpBytes, optimisticFloorBytes / 2);
  const minInFlightBytes =
    profile === "constrained" || profile === "severe"
      ? Math.max(2 * 1024 * 1024, 6 * normalizedChunkSize)
      : Math.max(optimisticFloorBytes, 8 * normalizedChunkSize);
  const targetInFlightBytes = clamp(
    Math.ceil(Math.max(minInFlightBytes, bandwidthDelayProduct * 4)),
    minInFlightBytes,
    32 * 1024 * 1024
  );
  const transferTimeMs = bytesPerSecond === null
    ? rttMs * 2
    : normalizedChunkSize / Math.max(1, bytesPerSecond) * 1000;
  const minimumTimeoutMs = profile === "relay-udp" || profile === "constrained" ? 3_000 : 1_500;
  return {
    targetInFlightBytes,
    maxPendingChunks: clamp(
      Math.ceil(targetInFlightBytes / normalizedChunkSize),
      profile === "constrained" ? 6 : 12,
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

function resolveIncomingRateKbps(input: PeerLinkProfileInput) {
  if ("incomingRateKbps" in input) {
    return (
      finitePositive(input.incomingRateKbps) ??
      finitePositive(input.transportReceiveBitrateKbps)
    );
  }
  return (
    finitePositive(input.incomingRateKbps) ??
    finitePositive(input.transportReceiveBitrateKbps) ??
    finitePositive(input.downloadRateKbps)
  );
}

function resolveOutgoingRateKbps(input: PeerLinkProfileInput) {
  if ("outgoingRateKbps" in input) {
    return (
      finitePositive(input.outgoingRateKbps) ??
      finitePositive(input.transportSendBitrateKbps)
    );
  }
  return (
    finitePositive(input.outgoingRateKbps) ??
    finitePositive(input.transportSendBitrateKbps) ??
    finitePositive(input.uploadRateKbps)
  );
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
