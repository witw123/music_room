import { describe, expect, it } from "vitest";
import { shouldPollRemoteStartupGate } from "./use-progressive-runtime";

describe("shouldPollRemoteStartupGate", () => {
  it("keeps polling while remote-stream playback is waiting for current data", () => {
    expect(shouldPollRemoteStartupGate("remote-stream", "playing", 1)).toBe(true);
  });

  it("stops polling once the remote audio element has current data", () => {
    expect(shouldPollRemoteStartupGate("remote-stream", "playing", 2)).toBe(false);
  });

  it("does not poll outside active remote-stream playback", () => {
    expect(shouldPollRemoteStartupGate("full-local", "playing", 0)).toBe(false);
    expect(shouldPollRemoteStartupGate("remote-stream", "paused", 0)).toBe(false);
  });
});
