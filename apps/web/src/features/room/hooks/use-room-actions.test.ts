import { describe, expect, it, vi } from "vitest";
import {
  runBestEffortRoomLeave,
  shouldResetPlayerAfterQueueRemoval,
  shouldResetPlayerAfterTrackRemoval
} from "./use-room-actions";

describe("player cleanup after removal", () => {
  it("resets only when the removed queue item is currently playing", () => {
    expect(shouldResetPlayerAfterQueueRemoval("queue_1", "queue_1")).toBe(true);
    expect(shouldResetPlayerAfterQueueRemoval("queue_2", "queue_1")).toBe(false);
  });

  it("resets only when the removed library track is currently playing", () => {
    expect(shouldResetPlayerAfterTrackRemoval("track_1", "track_1")).toBe(true);
    expect(shouldResetPlayerAfterTrackRemoval("track_2", "track_1")).toBe(false);
  });
});

describe("runBestEffortRoomLeave", () => {
  it("completes the local room exit even when the remote leave request fails", async () => {
    const completeLocalExit = vi.fn(async () => undefined);
    const remoteError = new Error("network timeout");

    const result = await runBestEffortRoomLeave({
      roomId: "room_1",
      leaveRemote: vi.fn(async () => {
        throw remoteError;
      }),
      completeLocalExit
    });

    expect(result).toEqual({
      remoteStatus: "failed",
      remoteError
    });
    expect(completeLocalExit).toHaveBeenCalledTimes(1);
  });

  it("does not wait indefinitely for a hung remote leave request before completing local exit", async () => {
    vi.useFakeTimers();
    const completeLocalExit = vi.fn(async () => undefined);

    try {
      const resultPromise = runBestEffortRoomLeave({
        roomId: "room_1",
        leaveRemote: vi.fn(() => new Promise(() => undefined)),
        completeLocalExit,
        remoteWaitMs: 25
      });

      await Promise.resolve();
      expect(completeLocalExit).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(25);
      await expect(resultPromise).resolves.toEqual({
        remoteStatus: "pending",
        remoteError: null
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
