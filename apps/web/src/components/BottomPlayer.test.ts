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

    expect(source).toContain("min-h-[6.5rem]");
    expect(layoutSource).toContain("min-h-[5.5rem]");
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

  it("prevents room seeks until complete local playback has taken over", () => {
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

    expect(shellSource).toContain('canSeekPlayback={pageState.activePlaybackSource === "full-local"}');
    expect(controllerSource).toContain("canSeekPlayback={canSeekPlayback}");
    expect(playerSource).toContain("canSeekPlayback && canControlPlayback");
    expect(layoutSource).toContain("disabled={!currentTrackDuration || !canSeekPlayback}");
  });
});
