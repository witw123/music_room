import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BottomPlayer source", () => {
  it("enables autoplay on both local and remote audio elements", () => {
    const source = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");

    expect(source).toContain("ref={audioRef}");
    expect(source).toContain("ref={remoteAudioRef}");
    expect(source).toContain("autoPlay");
    expect(source).toContain("playsInline");
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

  it("renders the top waveform above the progress bar without intercepting pointer events", () => {
    const source = readFileSync(new URL("./BottomPlayer.tsx", import.meta.url), "utf8");
    const waveformSource = readFileSync(
      new URL("./bottom-player/PlayerTopWaveform.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain("<PlayerTopWaveform");
    expect(source).toContain('top-[13px]');
    expect(waveformSource).toContain("pointer-events-none");
    expect(waveformSource).toContain('data-testid="player-top-waveform"');
  });
});
