import { describe, expect, it } from "vitest";
import { resolveSlidingWindowFormat } from "./format-detection";

describe("resolveSlidingWindowFormat", () => {
  it("routes FLAC and WAV to lossless playback and MP3 to original-quality playback", () => {
    expect(resolveSlidingWindowFormat({ mimeType: "audio/flac", codec: "flac", title: "a.flac" })).toBe("flac");
    expect(resolveSlidingWindowFormat({ mimeType: "audio/wav", codec: "wav", title: "a.wav" })).toBe("wav");
    expect(resolveSlidingWindowFormat({ mimeType: "audio/mpeg", codec: "mpeg", title: "a.mp3" })).toBe("mp3");
  });

  it("falls back to the filename extension when metadata is incomplete", () => {
    expect(resolveSlidingWindowFormat({ mimeType: null, codec: null, title: "Track.FLAC" })).toBe("flac");
    expect(resolveSlidingWindowFormat({ mimeType: "", codec: "", title: "Track.WAV" })).toBe("wav");
    expect(resolveSlidingWindowFormat({ mimeType: null, codec: null, title: "Track.MP3" })).toBe("mp3");
  });

  it("rejects formats that are not in the supported playback contract", () => {
    expect(resolveSlidingWindowFormat({ mimeType: "audio/mp4", codec: "aac", title: "a.m4a" })).toBe("unsupported");
    expect(resolveSlidingWindowFormat({ mimeType: "audio/ogg", codec: "opus", title: "a.ogg" })).toBe("unsupported");
  });
});
