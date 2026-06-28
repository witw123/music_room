import { describe, expect, it, vi } from "vitest";
import { runBestEffortRoomLeave } from "./use-room-actions";

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
