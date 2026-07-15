import { describe, expect, it } from "vitest";
import { canDeleteLibraryTrack } from "./TrackListSection";

describe("TrackListSection helpers", () => {
  it("allows host-level library management while preserving member ownership limits", () => {
    const track = {
      ownerSessionId: "owner_1"
    };

    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "host_1",
        canManageLibraryTracks: true
      })
    ).toBe(true);
    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "owner_1",
        canManageLibraryTracks: false
      })
    ).toBe(true);
    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "member_2",
        canManageLibraryTracks: false
      })
    ).toBe(false);
  });
});
