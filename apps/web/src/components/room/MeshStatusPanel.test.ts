import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MeshStatusPanel.tsx", import.meta.url), "utf8");

describe("MeshStatusPanel diagnostics layers", () => {
  it("renders a concise default summary and four readable developer groups", () => {
    expect(source).toContain("实际播放");
    expect(source).toContain("播放模式");
    expect(source).toContain("缓存可读性");
    expect(source).toContain("缓冲健康");
    expect(source).toContain("同步状态");
    expect(source).toContain("开发详情");
    expect(source).toContain('title="音频与 PCM"');
    expect(source).toContain('title="缓存传输"');
    expect(source).toContain('title="同步"');
    expect(source).toContain('title="数据链路"');
  });

  it("shows the exact open DataChannel count without connection fallback", () => {
    expect(source).toContain("Data: {dataReadyCount}");
    expect(source).not.toContain("dataReadyCount || connectedPeersCount");
  });

  it("does not render internal identifiers or raw browser element fields", () => {
    expect(source).not.toContain("playback.playbackSurfaceKey");
    expect(source).not.toContain("playback.playbackTimelineKey");
    expect(source).not.toContain("{peer.peerId}</strong>");
    expect(source).not.toContain("<span>{event.peerId}</span>");
    expect(source).not.toContain("本地 readyState");
    expect(source).not.toContain("本地 srcObject");
    expect(source).not.toContain("调度: {playback.schedulerPolicy");
    expect(source).not.toContain("恢复阶段: {playback.recoveryPhase");
  });
});
