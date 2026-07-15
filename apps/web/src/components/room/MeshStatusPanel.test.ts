import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MeshStatusPanel.tsx", import.meta.url), "utf8");

describe("MeshStatusPanel WebRTC diagnostics", () => {
  it("shows unique connection details without repeating the member summary", () => {
    expect(source).toContain("连接诊断");
    expect(source).toContain("唯一诊断样本");
    expect(source).toContain("连接路径");
    expect(source).toContain("音频轨道");
    expect(source).toContain("查看详情");
  });

  it("removes legacy playback and full-track cache values", () => {
    expect(source).not.toContain("PCM");
    expect(source).not.toContain("legacy playback source");
    expect(source).not.toContain("完整本地缓存");
    expect(source).not.toContain("缓存播放链路");
    expect(source).not.toContain("预估满曲");
    expect(source).not.toContain("尚未建立");
  });
});
