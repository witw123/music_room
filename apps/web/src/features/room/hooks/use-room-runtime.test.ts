import { describe, expect, it } from "vitest";
import { resolveListenerMediaRecoveryReason } from "./use-room-runtime";

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
        hasBoundSrcObject: false
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
        hasBoundSrcObject: false
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
        hasBoundSrcObject: true
      })
    ).toBe("bound-but-not-playing");
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
        hasBoundSrcObject: true
      })
    ).toBeNull();
  });
});
