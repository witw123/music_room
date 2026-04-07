import { describe, expect, it } from "vitest";
import {
  resolveListenerMediaRecoveryAction,
  resolveListenerMediaRecoveryReason,
  shouldRedirectRoomRouteToAuth,
  shouldForcePieceSyncRecovery
} from "./use-room-runtime";

describe("resolveListenerMediaRecoveryReason", () => {
  const traceKey = "track_a|3|peer_source|peer_listener";

  it("requests recovery when the connection is up but no track arrived", () => {
    expect(
      resolveListenerMediaRecoveryReason({
        traceKey,
        lastTrackTraceKey: null,
        lastBoundTraceKey: null,
        lastPlayAttemptTraceKey: null,
        lastPlayAttemptResult: null,
        lastPlayingTraceKey: null,
        remoteAudioPaused: null,
        hasBoundSrcObject: false,
        remoteTrackMuted: null,
        remoteTrackEnabled: null,
        remoteTrackReadyState: null
      })
    ).toBe("connected-but-no-track");
  });

  it("requests recovery when track arrived but the audio element was not rebound", () => {
    expect(
      resolveListenerMediaRecoveryReason({
        traceKey,
        lastTrackTraceKey: traceKey,
        lastBoundTraceKey: null,
        lastPlayAttemptTraceKey: null,
        lastPlayAttemptResult: null,
        lastPlayingTraceKey: null,
        remoteAudioPaused: null,
        hasBoundSrcObject: false,
        remoteTrackMuted: null,
        remoteTrackEnabled: null,
        remoteTrackReadyState: null
      })
    ).toBe("track-received-but-not-bound");
  });

  it("requests recovery when binding succeeded but playback never started", () => {
    expect(
      resolveListenerMediaRecoveryReason({
        traceKey,
        lastTrackTraceKey: traceKey,
        lastBoundTraceKey: traceKey,
        lastPlayAttemptTraceKey: traceKey,
        lastPlayAttemptResult: "rejected",
        lastPlayingTraceKey: null,
        remoteAudioPaused: true,
        hasBoundSrcObject: true,
        remoteTrackMuted: false,
        remoteTrackEnabled: true,
        remoteTrackReadyState: "live"
      })
    ).toBe("bound-but-not-playing");
  });

  it("requests recovery when the bound remote track is muted or ended", () => {
    expect(
      resolveListenerMediaRecoveryReason({
        traceKey,
        lastTrackTraceKey: traceKey,
        lastBoundTraceKey: traceKey,
        lastPlayAttemptTraceKey: traceKey,
        lastPlayAttemptResult: "ok",
        lastPlayingTraceKey: traceKey,
        remoteAudioPaused: false,
        hasBoundSrcObject: true,
        remoteTrackMuted: true,
        remoteTrackEnabled: true,
        remoteTrackReadyState: "live"
      })
    ).toBe("bound-but-muted-track");
  });

  it("does not request recovery after the current trace has already entered playing", () => {
    expect(
      resolveListenerMediaRecoveryReason({
        traceKey,
        lastTrackTraceKey: traceKey,
        lastBoundTraceKey: traceKey,
        lastPlayAttemptTraceKey: traceKey,
        lastPlayAttemptResult: "ok",
        lastPlayingTraceKey: traceKey,
        remoteAudioPaused: false,
        hasBoundSrcObject: true,
        remoteTrackMuted: false,
        remoteTrackEnabled: true,
        remoteTrackReadyState: "live"
      })
    ).toBeNull();
  });

  it("rebinds before restarting when track arrived but the element was not rebound yet", () => {
    expect(
      resolveListenerMediaRecoveryAction({
        reason: "track-received-but-not-bound",
        bindAttempts: 0,
        playAttempts: 0
      })
    ).toBe("rebind-element");
    expect(
      resolveListenerMediaRecoveryAction({
        reason: "track-received-but-not-bound",
        bindAttempts: 2,
        playAttempts: 0
      })
    ).toBe("rebind-element");
  });

  it("retries play instead of escalating to a peer restart", () => {
    expect(
      resolveListenerMediaRecoveryAction({
        reason: "bound-but-not-playing",
        bindAttempts: 1,
        playAttempts: 0
      })
    ).toBe("retry-play");
    expect(
      resolveListenerMediaRecoveryAction({
        reason: "bound-but-not-playing",
        bindAttempts: 1,
        playAttempts: 2
      })
    ).toBe("retry-play");
  });
});

describe("shouldForcePieceSyncRecovery", () => {
  it("does not force data peer recovery during steady remote playback when the current track is fully buffered", () => {
    expect(
      shouldForcePieceSyncRecovery({
        playbackStatus: "playing",
        currentTrackId: "track_a",
        activePlaybackSource: "remote-stream",
        bufferHealth: "healthy",
        localAvailableChunks: 120,
        totalChunks: 120,
        lastPieceActivityAtMs: 0,
        now: 60_000
      })
    ).toBe(false);
  });

  it("forces data peer recovery only when remote playback is active, buffering is incomplete, and inactivity is prolonged", () => {
    expect(
      shouldForcePieceSyncRecovery({
        playbackStatus: "playing",
        currentTrackId: "track_a",
        activePlaybackSource: "remote-stream",
        bufferHealth: "critical",
        localAvailableChunks: 24,
        totalChunks: 120,
        lastPieceActivityAtMs: 0,
        now: 25_000
      })
    ).toBe(true);
  });

  it("does not force data peer recovery for local playback sources", () => {
    expect(
      shouldForcePieceSyncRecovery({
        playbackStatus: "playing",
        currentTrackId: "track_a",
        activePlaybackSource: "full-local",
        bufferHealth: "critical",
        localAvailableChunks: 24,
        totalChunks: 120,
        lastPieceActivityAtMs: 0,
        now: 25_000
      })
    ).toBe(false);
  });
});

describe("shouldRedirectRoomRouteToAuth", () => {
  it("redirects to auth only for an unauthenticated room route outside an exit flow", () => {
    expect(
      shouldRedirectRoomRouteToAuth({
        workspaceOnly: true,
        initialRoomId: "room_123",
        hydrated: true,
        hasActiveSession: false,
        isNavigatingRoomExit: false,
        suppressRoomRecovery: false
      })
    ).toBe(true);
  });

  it("does not redirect to auth while the room is exiting back to workspace home", () => {
    expect(
      shouldRedirectRoomRouteToAuth({
        workspaceOnly: true,
        initialRoomId: "room_123",
        hydrated: true,
        hasActiveSession: false,
        isNavigatingRoomExit: true,
        suppressRoomRecovery: true
      })
    ).toBe(false);
  });
});
