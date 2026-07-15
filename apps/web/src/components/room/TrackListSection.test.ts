import { describe, expect, it } from "vitest";
import { canDeleteLibraryTrack } from "./TrackListSection";

describe("TrackListSection helpers", () => {
  it("allows only the original uploader to delete a library track", () => {
    const track = {
      ownerSessionId: "owner_1"
    };

    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "host_1",
      })
    ).toBe(false);
    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "owner_1",
      })
    ).toBe(true);
    expect(
      canDeleteLibraryTrack({
        track,
        activeSessionUserId: "member_2",
      })
    ).toBe(false);
  });
});
