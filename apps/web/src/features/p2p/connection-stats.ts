type StatsRecord = RTCStats & Record<string, unknown>;

export type PeerConnectionStatsSample = {
  candidateType: string | null;
  protocol: string | null;
  currentRoundTripTimeMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
};

export async function samplePeerConnectionStats(
  connection: RTCPeerConnection
): Promise<PeerConnectionStatsSample | null> {
  try {
    const report = await connection.getStats();
    const statsById = new Map<string, StatsRecord>();

    report.forEach((stat) => {
      statsById.set(stat.id, stat as StatsRecord);
    });

    const selectedCandidatePair = findSelectedCandidatePair(statsById);
    const localCandidate = selectedCandidatePair
      ? getLinkedStat(statsById, selectedCandidatePair, "localCandidateId")
      : null;
    const remoteCandidate = selectedCandidatePair
      ? getLinkedStat(statsById, selectedCandidatePair, "remoteCandidateId")
      : null;
    const inboundAudio = findFirstStat(
      statsById,
      (stat) => stat.type === "inbound-rtp" && getString(stat, "kind") === "audio"
    );
    const remoteInboundAudio = findFirstStat(
      statsById,
      (stat) => stat.type === "remote-inbound-rtp" && getString(stat, "kind") === "audio"
    );

    return {
      candidateType:
        getString(localCandidate, "candidateType") ??
        getString(remoteCandidate, "candidateType") ??
        null,
      protocol:
        getString(localCandidate, "relayProtocol") ??
        getString(localCandidate, "protocol") ??
        getString(remoteCandidate, "protocol") ??
        null,
      currentRoundTripTimeMs:
        toMilliseconds(getNumber(remoteInboundAudio, "roundTripTime")) ??
        toMilliseconds(getNumber(selectedCandidatePair, "currentRoundTripTime")),
      availableOutgoingBitrateKbps: toKbps(
        getNumber(selectedCandidatePair, "availableOutgoingBitrate")
      ),
      packetsLost:
        getInt(inboundAudio, "packetsLost") ?? getInt(remoteInboundAudio, "packetsLost"),
      jitterMs: toMilliseconds(getNumber(inboundAudio, "jitter"))
    };
  } catch {
    return null;
  }
}

function findSelectedCandidatePair(statsById: Map<string, StatsRecord>) {
  const transport = findFirstStat(
    statsById,
    (stat) =>
      stat.type === "transport" &&
      typeof getString(stat, "selectedCandidatePairId") === "string"
  );
  const selectedPairFromTransport = transport
    ? getLinkedStat(statsById, transport, "selectedCandidatePairId")
    : null;

  if (selectedPairFromTransport) {
    return selectedPairFromTransport;
  }

  return (
    findFirstStat(
      statsById,
      (stat) =>
        stat.type === "candidate-pair" &&
        (getBoolean(stat, "selected") ||
          getBoolean(stat, "nominated") ||
          getString(stat, "state") === "succeeded")
    ) ?? null
  );
}

function findFirstStat(
  statsById: Map<string, StatsRecord>,
  predicate: (stat: StatsRecord) => boolean
) {
  for (const stat of statsById.values()) {
    if (predicate(stat)) {
      return stat;
    }
  }

  return null;
}

function getLinkedStat(
  statsById: Map<string, StatsRecord>,
  source: StatsRecord,
  key: string
) {
  const linkedId = getString(source, key);
  return linkedId ? statsById.get(linkedId) ?? null : null;
}

function getString(stat: StatsRecord | null | undefined, key: string) {
  const value = stat?.[key];
  return typeof value === "string" ? value : null;
}

function getNumber(stat: StatsRecord | null | undefined, key: string) {
  const value = stat?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getInt(stat: StatsRecord | null | undefined, key: string) {
  const value = getNumber(stat, key);
  return value === null ? null : Math.round(value);
}

function getBoolean(stat: StatsRecord | null | undefined, key: string) {
  const value = stat?.[key];
  return typeof value === "boolean" ? value : false;
}

function toMilliseconds(value: number | null) {
  return value === null ? null : Math.round(value * 1000);
}

function toKbps(value: number | null) {
  return value === null ? null : Math.round(value / 1000);
}
