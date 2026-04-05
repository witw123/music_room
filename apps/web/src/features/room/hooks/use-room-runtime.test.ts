import { describe, expect, it } from "vitest";
import {
  resolveListenerMediaRecoveryAction,
  resolveListenerMediaRecoveryReason
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
    ).toBe("restart-peer");
  });

  it("retries play once before escalating to a peer restart", () => {
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
    ).toBe("restart-peer");
  });
});
