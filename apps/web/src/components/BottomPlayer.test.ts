import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BottomPlayer source", () => {
  it("keeps the local audio element non-autoplaying", () => {
    const source = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");

    expect(source).toContain("ref={audioRef}");
    expect(source).toContain("playsInline");
    expect(source).not.toContain("autoPlay");
  });

  it("keeps the mobile footer height stable", () => {
    const source = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");
    const layoutSource = readFileSync(
      new URL("./bottom-player/bottom-player-layout.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("min-h-0");
    expect(layoutSource).toContain("min-h-[4.25rem]");
    expect(layoutSource).toContain('w-[5.4rem]');
    expect(layoutSource).toContain('w-[44px]');
  });

  it("prioritizes the live display clock over the playback snapshot", () => {
    const source = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");

    expect(source).toContain("seekDraft ?? renderedProgressMs");
    expect(source).not.toContain("seekDraft ?? snapshotProgressMs ?? progressMs");
  });

  it("keeps the progress bar pinned at the top edge of the player", () => {
    const source = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");

    expect(source).toContain('top-0 h-[2px]');
  });

  it("allows room-timeline seeking on the segmented source", () => {
    const playerSource = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");
    const controllerSource = readFileSync(
      new URL("./BottomPlayerController.tsx", import.meta.url),
      "utf8"
    );
    const layoutSource = readFileSync(
      new URL("./bottom-player/bottom-player-layout.tsx", import.meta.url),
      "utf8"
    );
    const shellSource = readFileSync(new URL("./room/RoomAppShell.tsx", import.meta.url), "utf8");

    expect(shellSource).toContain("canSeekPlayback={true}");
    expect(shellSource).not.toContain("activePlaybackSource");
    expect(controllerSource).toContain("canSeekPlayback={canSeekPlayback}");
    expect(controllerSource).toContain(
      "roomSnapshot.room.members.some((member) => member.id === activeSession.userId)"
    );
    expect(playerSource).toContain("canSeekPlayback && canControlPlayback");
    expect(layoutSource).toContain("disabled={!currentTrackDuration || !canSeekPlayback}");
  });

  it("commits range seeking for pointer and keyboard interaction", () => {
    const layoutSource = readFileSync(
      new URL("./bottom-player/bottom-player-layout.tsx", import.meta.url),
      "utf8"
    );

    expect(layoutSource).toContain("onPointerUp={commitSeek}");
    expect(layoutSource).toContain("onKeyUp={commitSeek}");
    expect(layoutSource).not.toContain("onMouseUp={commitSeek}");
    expect(layoutSource).not.toContain("onTouchEnd={commitSeek}");
  });

  it("exposes the mini player from both responsive player layouts", () => {
    const playerSource = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");
    const layoutSource = readFileSync(
      new URL("./bottom-player/bottom-player-layout.tsx", import.meta.url),
      "utf8"
    );
    const miniPlayerSource = readFileSync(
      new URL("./bottom-player/MiniPlayerOverlay.tsx", import.meta.url),
      "utf8"
    );

    expect(playerSource).toContain("const [isMiniOpen, setIsMiniOpen] = useState(false)");
    expect(playerSource).toContain("<MiniPlayerOverlay");
    expect(layoutSource.match(/<MiniPlayerToggleButton/g)?.length).toBe(2);
    expect(layoutSource).toContain('aria-label={isOpen ? "关闭迷你播放器" : "打开迷你播放器"}');
    expect(miniPlayerSource).toContain('data-testid="mini-player-overlay"');
    expect(miniPlayerSource).toContain('data-testid="mini-player-cover"');
    expect(miniPlayerSource).not.toContain("<MiniPlayButton");
    expect(miniPlayerSource).toContain("backgroundColor: palette.surface");
    expect(miniPlayerSource).toContain("borderColor: palette.border");
    expect(miniPlayerSource).toContain("accentColor={palette.accent}");
    expect(miniPlayerSource).toContain("left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] -translate-x-1/2");
    expect(miniPlayerSource).toContain("setPosition(null)");
    expect(miniPlayerSource).toContain("group-hover:opacity-100");
    expect(miniPlayerSource).toContain("group-focus-within:opacity-100");
    expect(miniPlayerSource).toContain("onPointerMove={handlePointerMove}");
    expect(miniPlayerSource).toContain("requestMiniPlayerWindow");
    expect(miniPlayerSource).toContain("createPortal(player, pipWindow.document.body)");
    expect(miniPlayerSource).toContain("const ownerWindow = pipWindow ?? window");
    expect(miniPlayerSource).toContain("panel.ownerDocument.defaultView ?? window");
    expect(playerSource).toContain("requestMiniPlayerWindow()");
    expect(playerSource).toContain("pipWindow={miniPlayerWindow}");
  });
});
