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
});
