import { describe, expect, it } from "vitest";
import {
  consumePlaybackStartIntent,
  createPlaybackStartIntent,
  doesAudiblePlaybackSatisfyStartIntent,
  doesPlaybackMatchStartIntent,
  failPlaybackStartIntent,
  isPlaybackStartIntentPending
} from "./playback-start-intent";

const playingPlayback = {
  status: "playing" as const,
  currentTrackId: "track_2",
  currentQueueItemId: "queue_2",
  sourceSessionId: "host_1",
  sourcePeerId: "peer_host",
  sourceTrackId: "track_2",
  positionMs: 2_000,
  startedAt: "2026-04-03T09:00:00.000Z",
  queueVersion: 2,
  playbackRevision: 2,
  mediaEpoch: 2
};

describe("playback start intent helpers", () => {
  it("matches queue playback intents against the accepted playback snapshot", () => {
    const intent = createPlaybackStartIntent({
      reason: "queue-item",
      queueItemId: "queue_2",
      trackId: "track_2",
      targetPlaybackRevision: 2,
      previousQueueVersion: 1,
      previousMediaEpoch: 1,
      now: 1_000
    });

    expect(isPlaybackStartIntentPending(intent, 1_500)).toBe(true);
    expect(doesPlaybackMatchStartIntent(intent, playingPlayback, 1_500)).toBe(true);
  });

  it("matches playback intents while the accepted playback snapshot is buffering", () => {
    const intent = createPlaybackStartIntent({
      reason: "queue-item",
      queueItemId: "queue_2",
      trackId: "track_2",
      targetPlaybackRevision: 2,
      previousQueueVersion: 1,
      previousMediaEpoch: 1,
      now: 1_000
    });

    expect(
      doesPlaybackMatchStartIntent(
        intent,
        {
          ...playingPlayback,
          status: "buffering",
          startedAt: null
        },
        1_500
      )
    ).toBe(true);
  });

  it("requires the next track to differ when previous or next was requested", () => {
    const intent = createPlaybackStartIntent({
      reason: "next",
      previousTrackId: "track_1",
      targetPlaybackRevision: 2,
      previousQueueVersion: 1,
      previousMediaEpoch: 1,
      now: 1_000
    });

    expect(
      doesPlaybackMatchStartIntent(intent, { ...playingPlayback, currentTrackId: "track_1" }, 1_500)
    ).toBe(false);
    expect(doesPlaybackMatchStartIntent(intent, playingPlayback, 1_500)).toBe(true);
  });

  it("does not consume the intent against a stale playback version", () => {
    const intent = createPlaybackStartIntent({
      reason: "track",
      trackId: "track_2",
      targetPlaybackRevision: 3,
      previousQueueVersion: 2,
      previousMediaEpoch: 2,
      now: 1_000
    });

    expect(doesPlaybackMatchStartIntent(intent, playingPlayback, 1_500)).toBe(false);
    expect(
      doesPlaybackMatchStartIntent(
        intent,
        {
          ...playingPlayback,
          queueVersion: 3,
          playbackRevision: 3
        },
        1_500
      )
    ).toBe(true);
  });

  it("accepts confirmed audible playback for the intended track while revisions catch up", () => {
    const intent = createPlaybackStartIntent({
      reason: "track",
      trackId: "track_2",
      targetPlaybackRevision: 3,
      previousQueueVersion: 2,
      previousMediaEpoch: 2,
      now: 1_000
    });

    expect(doesPlaybackMatchStartIntent(intent, playingPlayback, 1_500)).toBe(false);
    expect(doesAudiblePlaybackSatisfyStartIntent(intent, playingPlayback, 1_500)).toBe(true);
    expect(
      doesAudiblePlaybackSatisfyStartIntent(
        intent,
        { ...playingPlayback, currentTrackId: "track_other" },
        1_500
      )
    ).toBe(false);
  });

  it("records matched source and failures without clearing the intent immediately", () => {
    const intent = createPlaybackStartIntent({
      reason: "resume-current",
      trackId: "track_2",
      now: 1_000
    });

    const failed = failPlaybackStartIntent(intent, "autoplay-blocked");
    expect(failed.lastFailure).toBe("autoplay-blocked");

    const consumed = consumePlaybackStartIntent(failed, "full-local", 1_500);
    expect(consumed.matchedSource).toBe("full-local");
    expect(consumed.consumedAt).toBe(1_500);
  });
});
