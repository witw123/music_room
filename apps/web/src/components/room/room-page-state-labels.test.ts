import { describe, expect, it } from "vitest";
import { getSourceModeLabel } from "./RoomStage";
import { resolveCurrentSourceNickname } from "./RoomWorkspace";

describe("room page state labels", () => {
  const track = { id: "track_1" } as never;

  it("shows the active cached provider instead of the original uploader", () => {
    expect(resolveCurrentSourceNickname([
      { id: "uploader", nickname: "Uploader" },
      { id: "provider", nickname: "Provider" }
    ], "provider")).toBe("Provider");
  });

  it("distinguishes progressive playback from a completed local cache", () => {
    expect(getSourceModeLabel("live", "progressive-local", false, track)).toBe("边缓存边播放");
    expect(getSourceModeLabel("live", "full-local", false, track)).toBe("完整缓存播放");
  });

  it("keeps completed cache playback independent from remote connection failures", () => {
    expect(getSourceModeLabel("failed", "full-local", false, track)).toBe("完整缓存播放");
    expect(getSourceModeLabel("failed", "progressive-local", false, track)).toBe("音源暂不可用");
  });
});
