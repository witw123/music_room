type StatsRecord = RTCStats & Record<string, unknown>;

export type PeerConnectionStatsSample = {
  candidateType: string | null;
  protocol: string | null;
  currentRoundTripTimeMs: number | null;
  availableOutgoingBitrateKbps: number | null;
  mediaReceiveBitrateKbps: number | null;
  mediaSendBitrateKbps: number | null;
  packetsLost: number | null;
  jitterMs: number | null;
};

export type PeerConnectionStatsSnapshot = {
  inboundAudioBytes: number | null;
  inboundAudioTimestampMs: number | null;
  outboundAudioBytes: number | null;
  outboundAudioTimestampMs: number | null;
};

export async function samplePeerConnectionStats(
  connection: RTCPeerConnection,
  previousSnapshot: PeerConnectionStatsSnapshot | null = null
): Promise<{ sample: PeerConnectionStatsSample; snapshot: PeerConnectionStatsSnapshot } | null> {
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
    const outboundAudio = findFirstStat(
      statsById,
      (stat) => stat.type === "outbound-rtp" && getString(stat, "kind") === "audio"
    );
    const remoteInboundAudio = findFirstStat(
      statsById,
      (stat) => stat.type === "remote-inbound-rtp" && getString(stat, "kind") === "audio"
    );
    const inboundAudioBytes = getNumber(inboundAudio, "bytesReceived");
    const outboundAudioBytes = getNumber(outboundAudio, "bytesSent");
    const inboundAudioTimestampMs = getTimestampMs(inboundAudio);
    const outboundAudioTimestampMs = getTimestampMs(outboundAudio);

    return {
      sample: {
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
        mediaReceiveBitrateKbps: toBitrateKbps({
          currentBytes: inboundAudioBytes,
          currentTimestampMs: inboundAudioTimestampMs,
          previousBytes: previousSnapshot?.inboundAudioBytes ?? null,
          previousTimestampMs: previousSnapshot?.inboundAudioTimestampMs ?? null
        }),
        mediaSendBitrateKbps: toBitrateKbps({
          currentBytes: outboundAudioBytes,
          currentTimestampMs: outboundAudioTimestampMs,
          previousBytes: previousSnapshot?.outboundAudioBytes ?? null,
          previousTimestampMs: previousSnapshot?.outboundAudioTimestampMs ?? null
        }),
        packetsLost:
          getInt(inboundAudio, "packetsLost") ?? getInt(remoteInboundAudio, "packetsLost"),
        jitterMs: toMilliseconds(getNumber(inboundAudio, "jitter"))
      },
      snapshot: {
        inboundAudioBytes,
        inboundAudioTimestampMs,
        outboundAudioBytes,
        outboundAudioTimestampMs
      }
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

function getTimestampMs(stat: RTCStats | null | undefined) {
  return typeof stat?.timestamp === "number" && Number.isFinite(stat.timestamp)
    ? stat.timestamp
    : null;
}

function toMilliseconds(value: number | null) {
  return value === null ? null : Math.round(value * 1000);
}

function toKbps(value: number | null) {
  return value === null ? null : Math.round(value / 1000);
}

function toBitrateKbps(input: {
  currentBytes: number | null;
  currentTimestampMs: number | null;
  previousBytes: number | null;
  previousTimestampMs: number | null;
}) {
  if (
    input.currentBytes === null ||
    input.currentTimestampMs === null ||
    input.previousBytes === null ||
    input.previousTimestampMs === null
  ) {
    return null;
  }

  const byteDelta = input.currentBytes - input.previousBytes;
  const timeDeltaMs = input.currentTimestampMs - input.previousTimestampMs;
  if (byteDelta < 0 || timeDeltaMs <= 0) {
    return null;
  }

  return Math.round((byteDelta * 8) / timeDeltaMs);
}
