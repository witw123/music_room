import { describe, expect, it } from "vitest";
import {
  isSegmentedPlaybackAudible,
  recordReceiverAudioProgress,
  resolveRoomAudioPath,
  resolveRemoteAudioTimelineKey,
  resolveReceiverPlaybackState,
  resolveRoomAudioPositionMs
} from "./use-room-segmented-playback-runtime";

describe("receiver audio progress", () => {
  it("does not refresh progress for a playing event without clock movement", () => {
    const health = {
      lastProgressAtMs: 1_000,
      lastCurrentTime: 0,
      hasStarted: false,
      waitingSinceMs: 2_000
    };

    recordReceiverAudioProgress({
      health,
      event: "playing",
      currentTime: 0,
      nowMs: 8_000
    });

    expect(health).toEqual({
      lastProgressAtMs: 1_000,
      lastCurrentTime: 0,
      hasStarted: true,
      waitingSinceMs: 2_000
    });
  });

  it("clears waiting only after the media clock advances", () => {
    const health = {
      lastProgressAtMs: 1_000,
      lastCurrentTime: 0,
      hasStarted: true,
      waitingSinceMs: 2_000
    };

    recordReceiverAudioProgress({
      health,
      event: "progress",
      currentTime: 0.1,
      nowMs: 8_000
    });

    expect(health.lastProgressAtMs).toBe(8_000);
    expect(health.waitingSinceMs).toBeNull();
  });
});

describe("receiver playback state", () => {
  it("keeps an already-playing receiver live during a short RTP gap", () => {
    expect(resolveReceiverPlaybackState({
      receiverRtpActive: false,
      hasStarted: true,
      missingMediaSinceMs: 10_000,
      nowMs: 11_500
    })).toBe("live");
  });

  it("keeps a started receiver live when the browser reports a zero RTP window", () => {
    expect(resolveReceiverPlaybackState({
      receiverRtpActive: false,
      hasStarted: true,
      missingMediaSinceMs: null,
      nowMs: 11_500
    })).toBe("live");
  });

  it("shows buffering only after the receiver gap exceeds the grace period", () => {
    expect(resolveReceiverPlaybackState({
      receiverRtpActive: false,
      hasStarted: true,
      missingMediaSinceMs: 10_000,
      nowMs: 13_000
    })).toBe("buffering");
  });

  it("keeps startup buffering until the first playback progress event", () => {
    expect(resolveReceiverPlaybackState({
      receiverRtpActive: false,
      hasStarted: false,
      missingMediaSinceMs: null,
      nowMs: 10_000
    })).toBe("buffering");
  });
});

describe("segmented playback audible state", () => {
  it("does not turn a live quiet source into waiting audio", () => {
    expect(isSegmentedPlaybackAudible({
      state: "live",
      isCurrentSource: true,
      sourceHealth: "source-ready"
    })).toBe(true);
  });

  it("still requires a live source track for the source member", () => {
    expect(isSegmentedPlaybackAudible({
      state: "live",
      isCurrentSource: true,
      sourceHealth: "source-silent"
    })).toBe(false);
  });

  it("treats a live native local file as audible for the source member", () => {
    expect(isSegmentedPlaybackAudible({
      state: "live",
      isCurrentSource: true,
      nativeLocalAudio: true
    })).toBe(true);
  });
});

describe("room audio path", () => {
  it("distinguishes local files from a remote listener stream", () => {
    expect(resolveRoomAudioPath({
      isCurrentSource: false,
      nativeLocalAudio: true,
      localFallback: false
    })).toBe("local-file");
    expect(resolveRoomAudioPath({
      isCurrentSource: false,
      nativeLocalAudio: false,
      localFallback: false
    })).toBe("remote-stream");
  });
});

describe("local room audio clock", () => {
  it("uses the room clock to advance a playing local file", () => {
    expect(resolveRoomAudioPositionMs({
      status: "playing",
      positionMs: 12_000,
      startedAt: "2026-07-22T00:00:10.000Z",
      startAt: "2026-07-22T00:00:10.000Z"
    }, Date.parse("2026-07-22T00:00:13.500Z"))).toBe(15_500);
  });

  it("keeps paused local audio at the server position", () => {
    expect(resolveRoomAudioPositionMs({
      status: "paused",
      positionMs: 12_000,
      startedAt: "2026-07-22T00:00:10.000Z",
      startAt: "2026-07-22T00:00:10.000Z"
    }, Date.parse("2026-07-22T00:00:13.500Z"))).toBe(12_000);
  });
});

describe("remote room audio timeline", () => {
  it("changes when a playing seek creates a new room clock anchor", () => {
    const initial = {
      currentTrackId: "track-1",
      mediaEpoch: 2,
      status: "playing" as const,
      positionMs: 1_000,
      playbackRevision: 7,
      startAt: "2026-07-22T00:00:10.000Z",
      startedAt: "2026-07-22T00:00:10.000Z"
    };
    const seeked = {
      ...initial,
      positionMs: 42_000,
      playbackRevision: 8,
      startAt: "2026-07-22T00:00:51.000Z",
      startedAt: "2026-07-22T00:00:51.000Z"
    };

    expect(resolveRemoteAudioTimelineKey(initial)).not.toBe(
      resolveRemoteAudioTimelineKey(seeked)
    );
  });

  it("does not change on ordinary clock progress within one timeline", () => {
    const initial = {
      currentTrackId: "track-1",
      mediaEpoch: 2,
      status: "playing" as const,
      positionMs: 1_000,
      playbackRevision: 7,
      startAt: "2026-07-22T00:00:10.000Z",
      startedAt: "2026-07-22T00:00:10.000Z"
    };

    expect(resolveRemoteAudioTimelineKey(initial)).toBe(
      resolveRemoteAudioTimelineKey({ ...initial, positionMs: 1_250 })
    );
  });
});
