import { describe, expect, it } from "vitest";
import { playerFeatureBoundary } from "./index";

describe("player feature boundary", () => {
  it("describes the player feature ownership", () => {
    expect(playerFeatureBoundary).toBe(
      "Player feature owns playback control, synchronization, and buffering."
    );
  });
});
