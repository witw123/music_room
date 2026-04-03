import { describe, expect, it } from "vitest";
import { extractApiErrorMessage } from "./music-room-api";

describe("music-room-api helpers", () => {
  it("extracts a string message from a json error payload", () => {
    expect(
      extractApiErrorMessage('{"statusCode":500,"message":"Internal server error"}')
    ).toBe("Internal server error");
  });

  it("extracts an array message from a json error payload", () => {
    expect(
      extractApiErrorMessage(
        '{"statusCode":400,"message":["title should not be empty","trackIds must be an array"]}'
      )
    ).toBe("title should not be empty, trackIds must be an array");
  });

  it("falls back to plain text for non-json payloads", () => {
    expect(extractApiErrorMessage("Playback state version conflict.")).toBe(
      "Playback state version conflict."
    );
  });
});
