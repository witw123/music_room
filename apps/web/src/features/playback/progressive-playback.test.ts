import { describe, expect, it } from "vitest";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  canUseProgressiveMse,
  getAheadBufferedMs,
  getContiguousBufferedMs,
  getPriorityChunkIndexes,
  isStartupReady,
  resolveSchedulerPolicy
} from "./progressive-playback";

const track = {
  id: "track_1",
  title: "Track",
  artist: "Artist",
  album: null,
  durationMs: 120_000,
  bitrate: null,
  sizeBytes: 12 * 1024 * 1024,
  codec: "mpeg",
  mimeType: "audio/mpeg",
  fileHash: "hash_1",
  artworkUrl: null,
  ownerSessionId: "host_1",
  ownerNickname: "Host",
  sourceType: "local_upload" as const
};

const availability = {
  roomId: "room_1",
  trackId: "track_1",
  ownerPeerId: "peer_local",
  nickname: "Host",
  totalChunks: 12,
  chunkSize: 256 * 1024,
  availableChunks: [0, 1, 2, 3, 4, 5],
  source: "local_cache" as const,
  announcedAt: "2026-04-03T03:00:00.000Z"
};

describe("progressive playback helpers", () => {
  it("calculates contiguous and ahead buffer from local chunk availability", () => {
    const manifest = buildProgressiveTrackManifest(track, availability);
    expect(getContiguousBufferedMs(manifest, availability.availableChunks)).toBe(60_000);
    expect(
      getAheadBufferedMs({
        manifest,
        availableChunks: availability.availableChunks,
        playbackPositionMs: 30_000
      })
    ).toBe(30_000);
  });

  it("treats a long enough contiguous prefix as startup ready", () => {
    const manifest = buildProgressiveTrackManifest(track, availability);
    expect(
      isStartupReady({
        manifest,
        availableChunks: availability.availableChunks,
        playbackPositionMs: 20_000
      })
    ).toBe(true);
  });

  it("keeps current-track requests focused on the startup prefix", () => {
    const manifest = buildProgressiveTrackManifest(track, availability)!;
    expect(
      getPriorityChunkIndexes({
        manifest,
        availableChunks: [0, 1],
        playbackPositionMs: 40_000,
        policy: "startup"
      }).slice(0, 4)
    ).toEqual([2, 3, 4, 5]);
  });

  it("moves from startup to background once the current track is complete", () => {
    const manifest = buildProgressiveTrackManifest(track, availability);
    const playback = {
      status: "playing" as const,
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "host_1",
      sourcePeerId: "peer_host",
      sourceTrackId: "track_1",
      positionMs: 10_000,
      startedAt: null,
      queueVersion: 1,
      mediaEpoch: 1
    };

    expect(
      resolveSchedulerPolicy({
        playback,
        activeSource: "progressive-local",
        manifest,
        availableChunks: Array.from({ length: 12 }, (_, index) => index),
        fallbackReason: null,
        currentTrackComplete: true
      })
    ).toBe("background");

    expect(
      buildProgressiveHealthSnapshot({
        playback,
        activeSource: "progressive-local",
        manifest,
        localAvailability: {
          ...availability,
          availableChunks: Array.from({ length: 12 }, (_, index) => index)
        },
        fallbackReason: null
      }).schedulerPolicy
    ).toBe("background");
  });

  it("only enables MSE progressive playback for stream-safe mime types", () => {
    const originalMediaSource = globalThis.MediaSource;
    Object.defineProperty(globalThis, "MediaSource", {
      configurable: true,
      value: {
        isTypeSupported: (mimeType: string) => mimeType === "audio/mpeg"
      }
    });

    try {
      expect(canUseProgressiveMse("audio/mpeg")).toBe(true);
      expect(canUseProgressiveMse("audio/mp4")).toBe(false);
    } finally {
      if (typeof originalMediaSource === "undefined") {
        Reflect.deleteProperty(globalThis, "MediaSource");
      } else {
        Object.defineProperty(globalThis, "MediaSource", {
          configurable: true,
          value: originalMediaSource
        });
      }
    }
  });
});
