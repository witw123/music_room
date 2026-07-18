import { describe, expect, it } from "vitest";
import { getNextPlaybackMode } from "./playback-mode";

describe("getNextPlaybackMode", () => {
  it("cycles through sequence, shuffle, and single-track repeat", () => {
    expect(getNextPlaybackMode("sequence")).toBe("shuffle");
    expect(getNextPlaybackMode("shuffle")).toBe("single");
    expect(getNextPlaybackMode("single")).toBe("sequence");
  });
});
