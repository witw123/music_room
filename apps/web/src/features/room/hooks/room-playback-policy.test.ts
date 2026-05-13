import { describe, expect, it } from "vitest";
import { shouldMaintainRemotePlaybackSurface } from "./room-playback-policy";

describe("shouldMaintainRemotePlaybackSurface", () => {
  it("does not maintain a remote playback surface in the local-cache playback model", () => {
    expect(
      shouldMaintainRemotePlaybackSurface()
    ).toBe(false);
  });
});
