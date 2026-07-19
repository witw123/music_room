import { describe, expect, it } from "vitest";
import { getActiveRoomLyricIndex, parseRoomLyrics } from "./room-lyrics";

describe("room lyrics", () => {
  it("parses LRC timestamps and ignores metadata tags", () => {
    const lines = parseRoomLyrics("[ti:Demo]\n[00:01.20]First\n[00:02]Second");

    expect(lines).toEqual([
      { id: "1:0", text: "First", timeMs: 1_200 },
      { id: "2:0", text: "Second", timeMs: 2_000 }
    ]);
  });

  it("finds the last lyric line reached by playback", () => {
    const lines = parseRoomLyrics("[00:01]First\n[00:03]Second");

    expect(getActiveRoomLyricIndex(lines, 0)).toBe(-1);
    expect(getActiveRoomLyricIndex(lines, 3_000)).toBe(1);
  });
});
