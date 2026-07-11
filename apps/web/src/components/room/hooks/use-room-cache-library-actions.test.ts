import { describe, expect, it } from "vitest";
import { selectReadyCachedLibraryDeleteLeases } from "./use-room-cache-library-actions";

describe("cached library delete leases", () => {
  it("keeps the playing file leased and releases other pending files", () => {
    expect(
      selectReadyCachedLibraryDeleteLeases(new Set(["playing", "old"]), "playing")
    ).toEqual(["old"]);
  });

  it("releases every lease after the playback surface is cleared", () => {
    expect(
      selectReadyCachedLibraryDeleteLeases(new Set(["playing", "old"]), null)
    ).toEqual(["playing", "old"]);
  });
});
