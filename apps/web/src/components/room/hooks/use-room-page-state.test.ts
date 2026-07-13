import { describe, expect, it } from "vitest";
import {
  createInitialRoomPageState,
  roomPageStateReducer
} from "./use-room-page-state";

describe("roomPageStateReducer", () => {
  it("initializes browser visibility and default playback controls", () => {
    expect(createInitialRoomPageState({ documentHidden: true })).toMatchObject({
      activeDashboardTab: "queue",
      audioUnlocked: false,
      bufferHealth: "healthy",
      connectedPeers: [],
      iceConfig: null,
      iceConfigResolved: false,
      isPageVisible: false,
      isRecoveringRoom: false,
      isNavigatingRoomExit: false,
      lastSourceStartError: null,
      mediaConnectedPeers: [],
      mediaConnectionState: "idle",
      playbackStartIntent: null,
      roomRecoveryState: {
        phase: "joining",
        mode: "steady",
        generation: null,
        bootstrapStartedAt: null,
        bootstrapSourcePeerId: null,
        pendingSnapshot: false,
        pendingData: false,
        pendingMedia: false,
        listenerBootstrapAttempts: null,
        fullLocalRecoveryActive: false
      },
      volume: 0.72,
      schedulerPlaybackBucketMs: 0,
      schedulerMode: "normal",
      playerResetEpoch: 0,
      audioBlockedOverlay: false,
      isDiagnosticsPanelOpen: false,
      sourceStartState: "idle",
      suppressRoomRecovery: false
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

  it("updates runtime assembly state without losing other page state", () => {
    const initial = createInitialRoomPageState({ documentHidden: false });
    const withPeers = roomPageStateReducer(initial, {
      type: "set",
      key: "connectedPeers",
      value: ["peer_a"]
    });
    const withMorePeers = roomPageStateReducer(withPeers, {
      type: "set",
      key: "connectedPeers",
      value: (current) => [...current, "peer_b"]
    });
    const withRecovery = roomPageStateReducer(withMorePeers, {
      type: "set",
      key: "isRecoveringRoom",
      value: true
    });
    const withAudioError = roomPageStateReducer(withRecovery, {
      type: "set",
      key: "lastSourceStartError",
      value: "blocked"
    });

    expect(withMorePeers.connectedPeers).toEqual(["peer_a", "peer_b"]);
    expect(withAudioError).toMatchObject({
      isRecoveringRoom: true,
      lastSourceStartError: "blocked",
      volume: 0.72
    });
  });

  it("updates recovery state through the reducer", () => {
    const initial = createInitialRoomPageState({ documentHidden: false });
    const withRecovery = roomPageStateReducer(initial, {
      type: "set",
      key: "roomRecoveryState",
      value: (current) => ({
        ...current,
        phase: "steady",
        fullLocalRecoveryActive: true
      })
    });

    expect(withRecovery).toMatchObject({
      roomRecoveryState: {
        phase: "steady",
        fullLocalRecoveryActive: true
      }
    });
  });
});
