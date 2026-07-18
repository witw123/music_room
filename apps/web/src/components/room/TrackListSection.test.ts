import { describe, expect, it } from "vitest";
import { canDeleteLibraryTrack, filterLibraryTracks } from "./TrackListSection";

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

  it("filters tracks by the active uploader", () => {
    const tracks = [
      { id: "track_1", ownerSessionId: "owner_1" },
      { id: "track_2", ownerSessionId: "member_2" },
      { id: "track_3", ownerSessionId: "owner_1" }
    ];

    expect(filterLibraryTracks(tracks, "owner_1", "all").map((track) => track.id)).toEqual([
      "track_1",
      "track_2",
      "track_3"
    ]);
    expect(filterLibraryTracks(tracks, "owner_1", "mine").map((track) => track.id)).toEqual([
      "track_1",
      "track_3"
    ]);
    expect(filterLibraryTracks(tracks, "owner_1", "others").map((track) => track.id)).toEqual([
      "track_2"
    ]);
  });
});
