import { describe, expect, it } from "vitest";
import {
  samplePeerConnectionStats,
  type PeerConnectionStatsSnapshot
} from "./connection-stats";

function buildStatsReport(stats: Array<Record<string, unknown>>) {
  return new Map(
    stats.map((stat) => [
      stat.id as string,
      stat as RTCStats & Record<string, unknown>
    ])
  );
}

describe("samplePeerConnectionStats", () => {
  it("derives short-window packet loss rate from cumulative WebRTC counters", async () => {
    const connection = {
      getStats: async () =>
        buildStatsReport([
          {
            id: "transport_1",
            type: "transport",
            timestamp: 1_000,
            selectedCandidatePairId: "pair_1"
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            timestamp: 1_000,
            state: "succeeded",
            currentRoundTripTime: 0.062,
            availableOutgoingBitrate: 320_000,
            localCandidateId: "local_1",
            remoteCandidateId: "remote_1"
          },
          {
            id: "local_1",
            type: "local-candidate",
            timestamp: 1_000,
            candidateType: "host",
            protocol: "udp"
          },
          {
            id: "remote_1",
            type: "remote-candidate",
            timestamp: 1_000,
            candidateType: "srflx",
            protocol: "udp"
          },
          {
            id: "inbound_1",
            type: "inbound-rtp",
            timestamp: 1_000,
            kind: "audio",
            bytesReceived: 10_000,
            packetsLost: 5,
            packetsReceived: 95,
            jitter: 0.004
          },
          {
            id: "outbound_1",
            type: "outbound-rtp",
            timestamp: 1_000,
            kind: "audio",
            bytesSent: 8_000
          }
        ])
    } as unknown as RTCPeerConnection;

    const firstSample = await samplePeerConnectionStats(connection, null);
    expect(firstSample?.sample.packetLossRate).toBeNull();

    const nextConnection = {
      getStats: async () =>
        buildStatsReport([
          {
            id: "transport_1",
            type: "transport",
            timestamp: 3_000,
            selectedCandidatePairId: "pair_1"
          },
          {
            id: "pair_1",
            type: "candidate-pair",
            timestamp: 3_000,
            state: "succeeded",
            currentRoundTripTime: 0.058,
            availableOutgoingBitrate: 420_000,
            localCandidateId: "local_1",
            remoteCandidateId: "remote_1"
          },
          {
            id: "local_1",
            type: "local-candidate",
            timestamp: 3_000,
            candidateType: "host",
            protocol: "udp"
          },
          {
            id: "remote_1",
            type: "remote-candidate",
            timestamp: 3_000,
            candidateType: "srflx",
            protocol: "udp"
          },
          {
            id: "inbound_1",
            type: "inbound-rtp",
            timestamp: 3_000,
            kind: "audio",
            bytesReceived: 40_000,
            packetsLost: 8,
            packetsReceived: 192,
            jitter: 0.003
          },
          {
            id: "outbound_1",
            type: "outbound-rtp",
            timestamp: 3_000,
            kind: "audio",
            bytesSent: 12_000
          }
        ])
    } as unknown as RTCPeerConnection;

    const secondSample = await samplePeerConnectionStats(
      nextConnection,
      firstSample?.snapshot as PeerConnectionStatsSnapshot
    );

    expect(secondSample?.sample.packetsLost).toBe(8);
    expect(secondSample?.sample.packetLossRate).toBe(3);
    expect(secondSample?.sample.mediaReceiveBitrateKbps).toBe(120);
  });
});
