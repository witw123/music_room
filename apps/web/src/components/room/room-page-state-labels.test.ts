import { describe, expect, it } from "vitest";
import { getSourceModeLabel } from "./RoomStage";
import { resolveCurrentSourceNickname } from "./RoomWorkspace";

describe("room page state labels", () => {
  const track = { id: "track_1", playbackAsset: { assetId: "asset_1" } } as never;

  it("shows the active cached provider instead of the original uploader", () => {
    expect(resolveCurrentSourceNickname([
      { id: "uploader", nickname: "Uploader" },
      { id: "provider", nickname: "Provider" }
    ], "provider")).toBe("Provider");
  });

  it("reports the single v4 playback path", () => {
    expect(getSourceModeLabel("live", track)).toBe("分段 Opus 播放");
    expect(getSourceModeLabel("buffering", track)).toBe("正在缓冲");
  });

  it("surfaces v4 connection failures and rejects legacy tracks", () => {
    expect(getSourceModeLabel("failed", track)).toBe("音源暂不可用");
    expect(getSourceModeLabel("live", { id: "legacy" } as never)).toBe("不支持的旧版曲目");
  });
});
