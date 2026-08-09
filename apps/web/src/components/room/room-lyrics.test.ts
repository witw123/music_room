import { describe, expect, it } from "vitest";
import { getActiveRoomLyricIndex, parseRoomLyrics } from "./room-lyrics";

describe("room lyrics", () => {
  it("parses LRC timestamps and ignores metadata tags", () => {
    const lines = parseRoomLyrics("[ti:Demo]\n[00:01.20]First\n[00:02]Second");

    expect(lines).toEqual([
      { id: "1:0", text: "First", timeMs: 1_200, words: [] },
      { id: "2:0", text: "Second", timeMs: 2_000, words: [] }
    ]);
  });

  it("parses YRC word timing", () => {
    expect(parseRoomLyrics("[1000,1200](1000,400,0)你(1400,600,0)好")).toEqual([
      {
        id: "0:yrc",
        text: "你好",
        timeMs: 1_000,
        words: [
          { text: "你", timeMs: 1_000, durationMs: 400 },
          { text: "好", timeMs: 1_400, durationMs: 600 }
        ]
      }
    ]);
  });

  it("finds the last lyric line reached by playback", () => {
    const lines = parseRoomLyrics("[00:01]First\n[00:03]Second");

    expect(getActiveRoomLyricIndex(lines, 0)).toBe(-1);
    expect(getActiveRoomLyricIndex(lines, 3_000)).toBe(1);
  });
});
