import { describe, expect, it } from "vitest";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import {
  buildWanLinkScore,
  buildWanLinkScoreFromPeerDiagnostic,
  estimateTrackFillEtaSeconds,
  formatEtaSeconds,
  resolveWanPathLabel
} from "./wan-link-score";

describe("wan link score helpers", () => {
  it("labels direct and relay paths in Chinese", () => {
    expect(
      resolveWanPathLabel({
        candidateType: "prflx",
        protocol: "udp",
        profile: "standard-direct"
      })
    ).toBe("直连·prflx (prflx/udp)");

    expect(
      resolveWanPathLabel({
        candidateType: "relay",
        relayProtocol: "udp",
        profile: "relay-udp"
      })
    ).toBe("中继 (relay/udp)");
  });

  it("estimates fill ETA from remaining bytes and download rate", () => {
    // 8 MB remaining at 8_000 kbps (= 1 MB/s) => ~8s
    expect(
      estimateTrackFillEtaSeconds({
        remainingBytes: 8 * 1024 * 1024,
        downloadRateKbps: 8_000
      })
    ).toBeCloseTo(8.388, 1);

    expect(formatEtaSeconds(3)).toBe("即将完成");
    expect(formatEtaSeconds(42)).toBe("约 42 秒");
    expect(formatEtaSeconds(125)).toMatch(/约 2 分/);
  });

  it("scores a healthy fast direct path higher than a relay path", () => {
    const direct = buildWanLinkScore({
      candidateType: "prflx",
      protocol: "udp",
      rttMs: 45,
      downloadRateKbps: 24_000,
      uploadRateKbps: 12_000,
      transportScore: "healthy",
      dataChannelState: "open",
      providers: [
        { peerId: "a", availableChunks: 100, totalChunks: 100 },
        { peerId: "b", availableChunks: 100, totalChunks: 100 }
      ],
      ownedChunks: 20,
      totalChunks: 100,
      chunkSizeBytes: 256 * 1024
    });

    const relay = buildWanLinkScore({
      candidateType: "relay",
      protocol: "udp",
      relayProtocol: "udp",
      rttMs: 220,
      downloadRateKbps: 2_400,
      uploadRateKbps: 1_200,
      transportScore: "healthy",
      dataChannelState: "open",
      providers: [{ peerId: "a", availableChunks: 40, totalChunks: 100 }],
      ownedChunks: 10,
      totalChunks: 100,
      chunkSizeBytes: 256 * 1024
    });

    expect(direct.score).toBeGreaterThan(relay.score);
    expect(direct.grade).toMatch(/A|B/);
    expect(direct.pathLabel).toContain("直连");
    expect(relay.pathLabel).toContain("中继");
    expect(relay.metrics.providerLabel).toContain("1 个供片源");
    expect(direct.metrics.providerLabel).toContain("2 个完整");
    expect(direct.metrics.fillEtaLabel).not.toBe("无法估计");
  });

  it("penalizes closed data channels and failed transport", () => {
    const healthy = buildWanLinkScore({
      candidateType: "host",
      protocol: "udp",
      rttMs: 30,
      downloadRateKbps: 12_000,
      transportScore: "healthy",
      dataChannelState: "open"
    });
    const failed = buildWanLinkScore({
      candidateType: "host",
      protocol: "udp",
      rttMs: 30,
      downloadRateKbps: 12_000,
      transportScore: "failed",
      dataChannelState: "closed"
    });

    expect(failed.score).toBeLessThan(healthy.score);
    expect(failed.grade).toMatch(/D|F/);
  });

  it("does not grade a playable complete local cache by its last sync rate", () => {
    const score = buildWanLinkScore({
      candidateType: "prflx",
      protocol: "udp",
      rttMs: 57,
      downloadRateKbps: 1_280,
      transportScore: "healthy",
      dataChannelState: "open",
      providers: [{ peerId: "peer_1", availableChunks: 124, totalChunks: 124 }],
      ownedChunks: 124,
      totalChunks: 124,
      localPlaybackComplete: true
    });

    expect(score.metrics.downloadLabel).toBe("本地完整");
    expect(score.grade).not.toBe("F");
    expect(score.tips.join(" ")).not.toContain("pcm-buffer-missing");
  });

  it("builds a score snapshot from peer diagnostics", () => {
    const diagnostic = createPeerSnapshot("peer_1", "2026-07-12T00:00:00.000Z");
    diagnostic.dataCandidateType = "relay";
    diagnostic.dataRelayProtocol = "udp";
    diagnostic.dataProtocol = "udp";
    diagnostic.dataChannelState = "open";
    diagnostic.currentRoundTripTimeMs = 180;
    diagnostic.pieceDownloadRateKbps = 6_000;
    diagnostic.pieceUploadRateKbps = 2_000;
    diagnostic.transportScore = "healthy";

    const score = buildWanLinkScoreFromPeerDiagnostic({
      diagnostic,
      providers: [
        { peerId: "peer_1", availableChunks: 50, totalChunks: 100 },
        { peerId: "peer_2", availableChunks: 100, totalChunks: 100 }
      ],
      ownedChunks: 12,
      totalChunks: 100,
      chunkSizeBytes: 256 * 1024
    });

    expect(score.profile).toBe("relay-udp");
    expect(score.pathLabel).toContain("中继");
    expect(score.metrics.rttLabel).toBe("180ms");
    expect(score.metrics.providerLabel).toContain("2 个供片源");
    expect(score.tips.length).toBeGreaterThan(0);
  });
});
