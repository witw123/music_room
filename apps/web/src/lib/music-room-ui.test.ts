import { describe, expect, it } from "vitest";
import {
  formatDuration,
  normalizePlaylistTitle,
  removeTracksFromUploads,
  toUserFacingError
} from "./music-room-ui";

describe("music-room-ui helpers", () => {
  it("falls back to the default playlist title when the input is blank", () => {
    expect(normalizePlaylistTitle("   ")).toBe("Tonight Selects");
    expect(normalizePlaylistTitle(" 夜间精选 ")).toBe("夜间精选");
  });

  it("maps backend errors to user-facing Chinese copy", () => {
    expect(
      toUserFacingError(new Error("Nickname already exists in this room"))
    ).toBe("这个昵称已经在房间里被使用了，请换一个再加入。");
  });

  it("removes evicted uploads from the in-memory track map", () => {
    expect(
      removeTracksFromUploads(
        {
          a: { objectUrl: "blob:a" },
          b: { objectUrl: "blob:b" },
          c: { objectUrl: "blob:c" }
        },
        ["b", "c"]
      )
    ).toEqual({
      a: { objectUrl: "blob:a" }
    });
  });

  it("formats milliseconds into player-friendly timestamps", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(61_000)).toBe("1:01");
  });
});
