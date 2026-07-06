import { describe, expect, it } from "vitest";
import {
  createInitialRoomPageState,
  roomPageStateReducer
} from "./use-room-page-state";

describe("roomPageStateReducer", () => {
  it("initializes browser visibility and default playback controls", () => {
    expect(createInitialRoomPageState({ documentHidden: true })).toMatchObject({
      isPageVisible: false,
      volume: 0.72,
      schedulerPlaybackBucketMs: 0,
      playerResetEpoch: 0,
      audioBlockedOverlay: false,
      isDiagnosticsPanelOpen: false
    });
  });

  it("accepts direct values and updater functions like React setState", () => {
    const initial = createInitialRoomPageState({ documentHidden: false });
    const withBucket = roomPageStateReducer(initial, {
      type: "set",
      key: "schedulerPlaybackBucketMs",
      value: 12_000
    });
    const withSameBucket = roomPageStateReducer(withBucket, {
      type: "set",
      key: "schedulerPlaybackBucketMs",
      value: (current) => (current === 12_000 ? current : 0)
    });
    const withResetEpoch = roomPageStateReducer(withSameBucket, {
      type: "set",
      key: "playerResetEpoch",
      value: (current) => current + 1
    });

    expect(withSameBucket).toBe(withBucket);
    expect(withResetEpoch.playerResetEpoch).toBe(1);
  });
});
