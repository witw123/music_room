import { describe, expect, it } from "vitest";
import {
  alignRoomLyricLines,
  getActiveRoomLyricIndex,
  getRoomLyricDisplayWords,
  getRoomLyricWordProgress,
  hasWordSyncedRoomLyrics,
  parseRoomLyrics,
  selectRoomLyrics
} from "@/features/playback/lyrics";

describe("room lyrics", () => {
  it("aligns auxiliary lyrics by timestamp instead of array index", () => {
    const primary = parseRoomLyrics("[00:01]Original one\n[00:03]Original two");
    const auxiliary = parseRoomLyrics("[00:03]Translation two\n[00:01]Translation one");

    expect(alignRoomLyricLines(primary, auxiliary).map((line) => line?.text)).toEqual([
      "Translation one",
      "Translation two"
    ]);
  });

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

  it("unwraps QQ QRC XML lyric content", () => {
    const lyrics = '<Lyric_1 LyricType="1" LyricContent="[0,1000](0,500,0)逐(500,500,0)字&#10;[1000,500](1000,500,0)歌词"/>';

    expect(parseRoomLyrics(lyrics)).toEqual([
      {
        id: "0:yrc",
        text: "逐字",
        timeMs: 0,
        words: [
          { text: "逐", timeMs: 0, durationMs: 500 },
          { text: "字", timeMs: 500, durationMs: 500 }
        ]
      },
      {
        id: "1:yrc",
        text: "歌词",
        timeMs: 1_000,
        words: [
          { text: "歌", timeMs: 1_000, durationMs: 250 },
          { text: "词", timeMs: 1_250, durationMs: 250 }
        ]
      }
    ]);
  });

  it("normalizes line-relative QRC timing and splits it into characters", () => {
    expect(parseRoomLyrics("[1000,1000](0,1000,0)逐字")[0]?.words).toEqual([
      { text: "逐", timeMs: 1_000, durationMs: 500 },
      { text: "字", timeMs: 1_500, durationMs: 500 }
    ]);
  });

  it("builds character-level display timing for line-synced lyrics", () => {
    const lines = parseRoomLyrics("[00:01.00]歌词\n[00:03.00]下一行");

    expect(getRoomLyricDisplayWords(lines, 0)).toEqual([
      { text: "歌", timeMs: 1_000, durationMs: 1_000 },
      { text: "词", timeMs: 2_000, durationMs: 1_000 }
    ]);
  });

  it("prefers provider word-synced lyrics over stored line-synced lyrics", () => {
    const lineSynced = "[00:01.00]普通歌词";
    const wordSynced = "[1000,1000](1000,500,0)逐(1500,500,0)字";

    expect(hasWordSyncedRoomLyrics(lineSynced)).toBe(false);
    expect(selectRoomLyrics({
      localLyrics: lineSynced,
      wordSyncedLyric: wordSynced,
      plainLyric: lineSynced
    })).toBe(wordSynced);
  });

  it("replaces a stored QQ encrypted payload with provider lyrics", () => {
    const encryptedPayload = "0F3B54CF70B40B084246660B2D7067338AC33B27799529B6FB1C53A563027ABD66B5BED7887C293947839BD941016030459E";
    const plainLyric = "[00:00.00]三年二班";

    expect(selectRoomLyrics({
      localLyrics: encryptedPayload,
      plainLyric
    })).toBe(plainLyric);
  });

  it("calculates progressive fill within one word", () => {
    const word = { text: "歌词", timeMs: 1_000, durationMs: 400 };

    expect(getRoomLyricWordProgress(word, 900)).toBe(0);
    expect(getRoomLyricWordProgress(word, 1_200)).toBe(0.5);
    expect(getRoomLyricWordProgress(word, 1_500)).toBe(1);
  });

  it("finds the last lyric line reached by playback", () => {
    const lines = parseRoomLyrics("[00:01]First\n[00:03]Second");

    expect(getActiveRoomLyricIndex(lines, 0)).toBe(-1);
    expect(getActiveRoomLyricIndex(lines, 3_000)).toBe(1);
  });
});
