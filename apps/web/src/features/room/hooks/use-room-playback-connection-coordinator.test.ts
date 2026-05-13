import { describe, expect, it } from "vitest";
import {
  resolvePlaybackConnectionKey,
  resolvePlaybackRecoveryDropReason
} from "./use-room-playback-connection-coordinator";

describe("resolvePlaybackConnectionKey", () => {
  it("changes when transportEpoch changes for the same playback source", () => {
    expect(
      resolvePlaybackConnectionKey({
        roomId: "room_1",
        sourcePeerId: "peer_source",
        mediaEpoch: 7,
        transportEpoch: 2
      })
    ).toBe("room_1|peer_source|7|2");

    expect(
      resolvePlaybackConnectionKey({
        roomId: "room_1",
        sourcePeerId: "peer_source",
        mediaEpoch: 7,
        transportEpoch: 3
      })
    ).toBe("room_1|peer_source|7|3");
  });
});

describe("resolvePlaybackRecoveryDropReason", () => {
  it("drops recovery actions that target a stale playback connection key", () => {
    expect(
      resolvePlaybackRecoveryDropReason({
        playbackConnectionKey: "room_1|peer_source|7|2",
        currentPlaybackConnectionKey: "room_1|peer_source|7|3",
        activeAction: null,
        nextActionType: "restart-data-peer",
        now: Date.parse("2026-04-14T00:00:00.000Z")
      })
    ).toBe("stale-connection-key");
  });

  it("drops lower-priority actions while a higher-priority action is still running", () => {
    expect(
      resolvePlaybackRecoveryDropReason({
        playbackConnectionKey: "room_1|peer_source|7|3",
        currentPlaybackConnectionKey: "room_1|peer_source|7|3",
        activeAction: {
          actionId: "recovery_1",
          playbackConnectionKey: "room_1|peer_source|7|3",
          actionType: "full-resubscribe",
          peerId: "peer_source",
          startedAt: "2026-04-14T00:00:00.000Z",
          expiresAt: "2026-04-14T00:00:08.000Z",
          result: "running",
          reason: "watchdog-room-stalled"
        },
        nextActionType: "restart-data-peer",
        now: Date.parse("2026-04-14T00:00:01.000Z")
      })
    ).toBe("lower-priority-running");
  });
});
