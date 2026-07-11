import { describe, expect, it } from "vitest";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import { buildDiagnosticsViewModel } from "./diagnostics-view-model";

function createPlayback() {
  return createPeerSnapshot("system").progressivePlaybackStatus!;
}

describe("buildDiagnosticsViewModel", () => {
  it("does not report lossless playback as audible before PCM reaches the output", () => {
    const playback = {
      ...createPlayback(),
      activeSource: "lossless-local" as const,
      engineType: "pcm" as const,
      pcmAudioContextState: "running" as const,
      pcmContiguousChunkCount: 0,
      pcmDecodedSegmentCount: 0,
      pcmScheduledSegmentCount: 0,
      pcmDirectOutputConnected: true
    };

    const result = buildDiagnosticsViewModel({ playback });

    expect(result.audibility).toMatchObject({
      label: "等待 PCM 数据",
      tone: "warning"
    });
    expect(result.playbackMode).toBe("边缓存无损");
  });

  it("distinguishes browser permission from an empty PCM cache", () => {
    const result = buildDiagnosticsViewModel({
      playback: {
        ...createPlayback(),
        activeSource: "lossless-local",
        engineType: "pcm",
        pendingPlaybackIntent: "play-button"
      }
    });

    expect(result.audibility.label).toBe("等待音频授权");
    expect(result.activeIssue).toContain("浏览器");
  });

  it("requires decoded and scheduled PCM on a connected output before reporting sound", () => {
    const result = buildDiagnosticsViewModel({
      playback: {
        ...createPlayback(),
        activeSource: "lossless-local",
        engineType: "pcm",
        pcmAudioContextState: "running",
        pcmDecodedSegmentCount: 2,
        pcmScheduledSegmentCount: 1,
        pcmDirectOutputConnected: true,
        pcmLastBlockedReason: "engine-failed"
      }
    });

    expect(result.audibility).toMatchObject({ label: "正在发声", tone: "success" });
    expect(result.activeIssue).toBeNull();
  });

  it("trusts an actively playing full-local blob over stale readiness and intent flags", () => {
    const result = buildDiagnosticsViewModel({
      playback: {
        ...createPlayback(),
        activeSource: "full-local",
        fullLocalReady: false,
        fullLocalPlaybackMode: "native-blob",
        localAudioCurrentSrc: "blob:cached-track",
        localAudioReadyState: 4,
        localAudioPaused: false,
        localAudioMuted: false,
        localAudioVolume: 1,
        pendingPlaybackIntent: "曲库点播 track_1"
      }
    });

    expect(result.audibility).toMatchObject({ label: "正在发声", tone: "success" });
    expect(result.activeIssue).toBeNull();
  });

  it("separates a complete piece announcement from PCM-readable continuity", () => {
    const result = buildDiagnosticsViewModel({
      playback: {
        ...createPlayback(),
        activeSource: "lossless-local",
        engineType: "pcm",
        pcmContiguousChunkCount: 0
      },
      currentTrack: { visibleChunks: 262, totalChunks: 262 }
    });

    expect(result.cache.progressLabel).toBe("已声明完整分片 · PCM 尚未读取");
    expect(result.cache.pcmContiguousChunks).toBe(0);
  });

  it("only marks fresh positive rates as active transfer", () => {
    expect(
      buildDiagnosticsViewModel({
        transfer: { downloadRateKbps: 0, uploadRateKbps: 0, sampleAgeMs: 100 }
      }).transfer.active
    ).toBe(false);

    expect(
      buildDiagnosticsViewModel({
        transfer: { downloadRateKbps: 800, uploadRateKbps: 0, sampleAgeMs: 6_001 }
      }).transfer.active
    ).toBe(false);

    const activeTransfer = buildDiagnosticsViewModel({
        transfer: { downloadRateKbps: 800, uploadRateKbps: 0, sampleAgeMs: 500 }
      }).transfer;
    expect(activeTransfer.active).toBe(true);
    expect(activeTransfer.downloadLabel).toBe("0.10 MB/s");
    expect(activeTransfer.uploadLabel).toBe("0.00 MB/s");
  });

  it("preserves an exact zero DataChannel count", () => {
    const result = buildDiagnosticsViewModel({
      dataLink: { openCount: 0, connectedPeerCount: 3 }
    });

    expect(result.dataLink.openCount).toBe(0);
    expect(result.dataLink.label).toBe("数据通道未就绪");
  });

  it("does not call stale or missing drift samples synchronized", () => {
    const playback = {
      ...createPlayback(),
      averageDriftMs: 20,
      maxDriftMs: 30
    };

    expect(
      buildDiagnosticsViewModel({ playback, playbackSampleAgeMs: 6_001 }).sync.label
    ).toBe("暂无有效样本");
    expect(
      buildDiagnosticsViewModel({
        playback: { ...playback, averageDriftMs: null, maxDriftMs: null },
        playbackSampleAgeMs: 100
      }).sync.label
    ).toBe("暂无有效样本");
  });

  it("grades fresh drift using audible playback tolerances", () => {
    const playback = { ...createPlayback(), activeSource: "lossless-local" as const };

    expect(
      buildDiagnosticsViewModel({
        playback: { ...playback, averageDriftMs: 20, maxDriftMs: 35 },
        playbackSampleAgeMs: 100
      }).sync.label
    ).toBe("同步正常");
    expect(
      buildDiagnosticsViewModel({
        playback: { ...playback, averageDriftMs: 90, maxDriftMs: 240 },
        playbackSampleAgeMs: 100
      }).sync.label
    ).toBe("同步偏差较大");
    expect(
      buildDiagnosticsViewModel({
        playback: { ...playback, averageDriftMs: 500, maxDriftMs: 900 },
        playbackSampleAgeMs: 100
      }).sync.label
    ).toBe("同步严重偏差");
  });
});
