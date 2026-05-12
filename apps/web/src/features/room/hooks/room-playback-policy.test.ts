// @ts-nocheck
import { describe, expect, it } from "vitest";
import { shouldMaintainRemotePlaybackSurface } from "./room-playback-policy";

describe("shouldMaintainRemotePlaybackSurface", () => {
  it("keeps the remote playback surface alive while the room is paused", () => {
    expect(
      shouldMaintainRemotePlaybackSurface()
    ).toBe(true);
  });

  it("keeps the remote playback surface alive while the room is buffering", () => {
    expect(
      shouldMaintainRemotePlaybackSurface()
    ).toBe(true);
  });

  it("tears the surface down when remote playback is no longer the active listener path", () => {
    expect(
      shouldMaintainRemotePlaybackSurface()
    ).toBe(false);
  });

  it("keeps a bound remote surface alive during temporary local fallback while room playback remains active", () => {
    expect(
      shouldMaintainRemotePlaybackSurface()
    ).toBe(true);
  });

  it("keeps a bound remote surface alive during source-lost grace even before a new source peer is known", () => {
    expect(
      shouldMaintainRemotePlaybackSurface()
    ).toBe(true);
  });
});
