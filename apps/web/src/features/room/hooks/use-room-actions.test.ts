import { describe, expect, it, vi } from "vitest";
import {
  runBestEffortRoomLeave,
  shouldRetryPlaybackMutationAfterConflict,
  shouldResetPlayerAfterQueueRemoval,
  shouldResetPlayerAfterTrackRemoval
} from "./use-room-actions";

describe("player cleanup after removal", () => {
  it("resets only when the removed queue item is currently playing", () => {
    expect(
      shouldResetPlayerAfterQueueRemoval(
        { currentTrackId: "track_1" },
        { currentTrackId: null }
      )
    ).toBe(true);
    expect(
      shouldResetPlayerAfterQueueRemoval(
        { currentTrackId: "track_1" },
        { currentTrackId: "track_2" }
      )
    ).toBe(false);
    expect(
      shouldResetPlayerAfterQueueRemoval(
        { currentTrackId: null },
        { currentTrackId: null }
      )
    ).toBe(false);
  });

  it("resets only when the removed library track is currently playing", () => {
    expect(shouldResetPlayerAfterTrackRemoval("track_1", "track_1")).toBe(true);
    expect(shouldResetPlayerAfterTrackRemoval("track_2", "track_1")).toBe(false);
  });
});

describe("playback mutation conflict retry", () => {
  it("retries only while the active track and queue item are unchanged", () => {
    const expectedTarget = {
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1"
    };

    expect(
      shouldRetryPlaybackMutationAfterConflict(expectedTarget, expectedTarget)
    ).toBe(true);
    expect(
      shouldRetryPlaybackMutationAfterConflict(expectedTarget, {
        currentTrackId: "track_2",
        currentQueueItemId: "queue_2"
      })
    ).toBe(false);
    expect(
      shouldRetryPlaybackMutationAfterConflict(expectedTarget, {
        currentTrackId: "track_1",
        currentQueueItemId: "queue_2"
      })
    ).toBe(false);
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
