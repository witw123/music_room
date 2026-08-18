import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop lyrics integration", () => {
  it("connects both player sources to the shared lyrics provider", () => {
    const playerSource = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");
    const controllerSource = readFileSync(new URL("./BottomPlayerController.tsx", import.meta.url), "utf8");
    const localPlayerSource = readFileSync(new URL("./AppPersistentPlayer.tsx", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("./PersistentRoomRuntime.tsx", import.meta.url), "utf8");

    expect(playerSource).toContain("useDesktopLyricsRegistration");
    expect(controllerSource).toContain('desktopLyricsSource="room"');
    expect(localPlayerSource).toContain('desktopLyricsSource="local"');
    expect(runtimeSource).toContain("<DesktopLyricsProvider>");
    expect(runtimeSource).toContain("<DesktopLyricsOverlay />");
  });

  it("keeps lyrics controls outside the room stage and reuses provider lyric APIs", () => {
    const shellSource = readFileSync(new URL("./room/RoomAppShell.tsx", import.meta.url), "utf8");
    const stageSource = readFileSync(new URL("./room/RoomStage.tsx", import.meta.url), "utf8");
    const contextSource = readFileSync(new URL("../features/playback/desktop-lyrics-context.tsx", import.meta.url), "utf8");
    const overlaySource = readFileSync(new URL("./DesktopLyricsOverlay.tsx", import.meta.url), "utf8");

    expect(shellSource).not.toContain("isLyricsOpen");
    expect(shellSource).not.toContain("onToggleLyrics");
    expect(stageSource).not.toContain("isLyricsOpen");
    expect(contextSource).toContain("lyricRequestCache");
    expect(contextSource).toContain("getNeteaseLyrics");
    expect(contextSource).toContain("getQqMusicLyrics");
    expect(overlaySource).toContain("上一首");
    expect(overlaySource).toContain("下一首");
    expect(overlaySource).toContain("关闭桌面歌词");
    expect(overlaySource).toContain("safe-area-inset-bottom");
  });
});
