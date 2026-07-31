import { describe, expect, it } from "vitest";
import {
  recordReceiverAudioProgress,
  resolveReceiverPlaybackState,
  shouldRecoverStalledReceiverAudio
} from "@/features/room/playback/receiver-audio-health";
import {
  isSegmentedPlaybackAudible,
  resolvePlaybackBarrierState
} from "@/features/room/playback/playback-barrier";
import {
  resolveCacheReadinessState,
  resolveRoomAudioPath,
  resolveRoomAudioPositionMs,
  resolveRemoteAudioTimelineKey,
  shouldDisableSourcePlayback,
  shouldWaitForLocalAudioContext
} from "@/features/room/playback/room-audio-path";

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
  it("recovers a receiver whose element claims to play but its clock is frozen", () => {
    expect(shouldRecoverStalledReceiverAudio({
      boundAtMs: 1_000,
      hasStarted: true,
      lastProgressAtMs: 4_000,
      nowMs: 9_500
    })).toBe(true);
  });

  it("does not recover before startup grace or without a started element", () => {
    expect(shouldRecoverStalledReceiverAudio({
      boundAtMs: 8_000,
      hasStarted: false,
      lastProgressAtMs: 8_000,
      nowMs: 9_000
    })).toBe(false);
    expect(shouldRecoverStalledReceiverAudio({
      boundAtMs: 1_000,
      hasStarted: true,
      lastProgressAtMs: 8_000,
      nowMs: 9_000
    })).toBe(false);
  });

  it("recovers a started element whose receiver track is live but has no RTP", () => {
    expect(shouldRecoverStalledReceiverAudio({
      boundAtMs: 1_000,
      hasStarted: true,
      lastProgressAtMs: 1_000,
      receiverRtpActive: false,
      audioPaused: false,
      nowMs: 3_500
    })).toBe(true);
  });

  it("does not treat an autoplay-paused element as a media failure", () => {
    expect(shouldRecoverStalledReceiverAudio({
      boundAtMs: 1_000,
      hasStarted: true,
      lastProgressAtMs: 1_000,
      receiverRtpActive: false,
      audioPaused: true,
      nowMs: 8_000
    })).toBe(false);
  });

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

  it("reports buffering when RTP is live but the media clock has stalled", () => {
    expect(resolveReceiverPlaybackState({
      receiverRtpActive: true,
      hasStarted: true,
      lastProgressAtMs: 10_000,
      missingMediaSinceMs: null,
      nowMs: 13_000
    })).toBe("buffering");
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

describe("room playback cache barrier", () => {
  const playback = {
    currentTrackId: "track-1",
    mediaEpoch: 4,
    status: "playing"
  } as never;
  const member = (id: string) => ({
    id,
    peerId: `peer-${id}`,
    presenceState: "online"
  });
  const readiness = (
    sessionId: string,
    state: "waiting" | "ready",
    barrier: "waiting" | "open",
    resumeAt: string | null = null,
    holdPositionMs: number | null = null
  ) => ({
    roomId: "room-1",
    sessionId,
    peerId: `peer-${sessionId}`,
    trackId: "track-1",
    mediaEpoch: 4,
    cacheEnabled: true,
    state,
    barrier,
    resumeAt,
    holdPositionMs,
    updatedAt: `${sessionId === "one" ? "2026-07-27T00:00:01.000Z" : "2026-07-27T00:00:02.000Z"}`
  });

  it("blocks until every online member is ready", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [readiness("one", "ready", "open"), readiness("two", "waiting", "waiting")],
      nowMs: Date.parse("2026-07-27T00:00:03.000Z")
    }).blocked).toBe(true);
  });

  it("keeps the shared hold position while the barrier is waiting", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [
        readiness("one", "ready", "waiting", null, 12_500),
        readiness("two", "waiting", "waiting", null, 12_500)
      ],
      nowMs: Date.parse("2026-07-27T00:00:20.000Z")
    })).toMatchObject({
      blocked: true,
      holdPositionMs: 12_500,
      resumeAtMs: null
    });
  });

  it("waits for the shared resume time after the barrier opens", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [
        readiness("one", "ready", "open", "2026-07-27T00:00:05.000Z", 12_500),
        readiness("two", "ready", "open", "2026-07-27T00:00:05.000Z", 12_500)
      ],
      nowMs: Date.parse("2026-07-27T00:00:04.000Z")
    })).toMatchObject({ blocked: true, holdPositionMs: 12_500 });
  });

  it("opens after the shared resume time", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [
        readiness("one", "ready", "open", "2026-07-27T00:00:05.000Z", 12_500),
        readiness("two", "ready", "open", "2026-07-27T00:00:05.000Z", 12_500)
      ],
      nowMs: Date.parse("2026-07-27T00:00:06.000Z")
    })).toMatchObject({ blocked: false, holdPositionMs: 12_500 });
  });

  it("waits for a solo cache participant while its cache is loading", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one")] as never,
      readiness: [readiness("one", "waiting", "waiting")],
      nowMs: Date.parse("2026-07-27T00:00:04.000Z")
    })).toMatchObject({
      blocked: true,
      holdPositionMs: 0,
      resumeAtMs: null
    });
  });

  it("excludes a cache participant that waited past the barrier timeout", () => {
    const stalled = readiness("one", "waiting", "waiting");
    const ready = readiness("two", "ready", "open");
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [stalled, ready],
      nowMs: Date.parse("2026-07-27T00:00:04.000Z"),
      staleWaitingSessionIds: new Set(["one"])
    }).blocked).toBe(false);
  });

  it("releases the hold when the only cache participant times out", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one")] as never,
      readiness: [readiness("one", "waiting", "waiting")],
      nowMs: Date.parse("2026-07-27T00:00:04.000Z"),
      staleWaitingSessionIds: new Set(["one"])
    }).blocked).toBe(false);
  });

  it("does not create a barrier when every cache participant already has the track", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [
        readiness("one", "ready", "open"),
        readiness("two", "ready", "open")
      ],
      nowMs: Date.parse("2026-07-27T00:00:04.000Z")
    }).blocked).toBe(false);
  });

  it("does not wait for an online member using normal streaming playback", () => {
    const streamingMember = {
      ...readiness("two", "ready", "open"),
      cacheEnabled: false
    };
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two")] as never,
      readiness: [
        readiness("one", "ready", "open", "2026-07-27T00:00:05.000Z"),
        streamingMember
      ],
      nowMs: Date.parse("2026-07-27T00:00:06.000Z")
    }).blocked).toBe(false);
  });

  it("applies a cache barrier to streaming members without making them blockers", () => {
    expect(resolvePlaybackBarrierState({
      playback,
      activeMembers: [member("one"), member("two"), member("three")] as never,
      readiness: [
        readiness("one", "waiting", "waiting", null, 12_500),
        readiness("two", "waiting", "waiting", null, 12_500)
      ],
      nowMs: Date.parse("2026-07-27T00:00:04.000Z")
    }).blocked).toBe(true);
  });
});

describe("cache readiness reporting", () => {
  it("does not block the room while checking an already-cached local file", () => {
    expect(resolveCacheReadinessState({
      cacheEnabled: true,
      localReady: false,
      isPreparingProviderCache: false,
      localAudioStatus: "checking"
    })).toBe("ready");
  });

  it("only reports waiting during an actual provider-cache download", () => {
    expect(resolveCacheReadinessState({
      cacheEnabled: true,
      localReady: false,
      isPreparingProviderCache: true,
      localAudioStatus: "missing"
    })).toBe("waiting");
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

describe("provider cache source transition", () => {
  it("keeps segmented source playback during cache lookup and download", () => {
    expect(shouldDisableSourcePlayback({
      isCurrentSource: true,
      localAudioStatus: "checking"
    })).toBe(false);
    expect(shouldDisableSourcePlayback({
      isCurrentSource: true,
      localAudioStatus: "missing"
    })).toBe(false);
  });

  it("switches the source to a local file only after it is available", () => {
    expect(shouldDisableSourcePlayback({
      isCurrentSource: true,
      localAudioStatus: "available"
    })).toBe(true);
  });

  it("never disables the room source for a listener", () => {
    expect(shouldDisableSourcePlayback({
      isCurrentSource: false,
      localAudioStatus: "available"
    })).toBe(false);
  });
});

describe("native local audio context requirement", () => {
  it("does not block a listener's own cache when the shared context is suspended", () => {
    expect(shouldWaitForLocalAudioContext({
      isCurrentSource: false,
      audioUnlocked: false,
      audioContextState: "suspended"
    })).toBe(false);
  });

  it("keeps the source cache behind the broadcast audio context", () => {
    expect(shouldWaitForLocalAudioContext({
      isCurrentSource: true,
      audioUnlocked: false,
      audioContextState: "suspended"
    })).toBe(true);
    expect(shouldWaitForLocalAudioContext({
      isCurrentSource: true,
      audioUnlocked: true,
      audioContextState: "running"
    })).toBe(false);
  });
});

describe("listener audio output ownership", () => {
  it("does not require the shared audio graph for a listener cache by default", () => {
    expect(shouldWaitForLocalAudioContext({
      isCurrentSource: false,
      audioUnlocked: false,
      audioContextState: "suspended"
    })).toBe(false);
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

  it("freezes local audio at the barrier hold position", () => {
    expect(resolveRoomAudioPositionMs({
      status: "playing",
      positionMs: 12_000,
      startedAt: "2026-07-22T00:00:10.000Z",
      startAt: "2026-07-22T00:00:10.000Z"
    }, Date.parse("2026-07-22T00:01:00.000Z"), {
      holdPositionMs: 18_250,
      resumeAtMs: null
    })).toBe(18_250);
  });

  it("resumes local audio from the held position instead of the stale room anchor", () => {
    expect(resolveRoomAudioPositionMs({
      status: "playing",
      positionMs: 12_000,
      startedAt: "2026-07-22T00:00:10.000Z",
      startAt: "2026-07-22T00:00:10.000Z"
    }, Date.parse("2026-07-22T00:00:16.000Z"), {
      holdPositionMs: 18_250,
      resumeAtMs: Date.parse("2026-07-22T00:00:15.000Z")
    })).toBe(19_250);
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
