import { describe, expect, it } from "vitest";
import {
  buildProgressiveHealthSnapshot,
  buildProgressiveTrackManifest,
  canUseProgressivePcm,
  canUseProgressiveMse,
  getAheadBufferedMs,
  getContiguousBufferedMs,
  getProgressiveEngineType,
  getProgressiveTrackManifestKey,
  getPriorityChunkIndexes,
  hasActivePlaybackIntent,
  isStartupReady,
  isTakeoverReady,
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

const playingPlayback = {
  status: "playing" as const,
  currentTrackId: "track_1",
  currentQueueItemId: "queue_1",
  sourceSessionId: "host_1",
  sourcePeerId: "peer_host",
  sourceTrackId: "track_1",
  positionMs: 10_000,
  startedAt: null,
  queueVersion: 1,
  playbackRevision: 1,
  mediaEpoch: 1
};

describe("progressive playback helpers", () => {
  it("prioritizes the whole decodable prefix for FLAC instead of jumping to the sliding playback window", () => {
    const manifest = {
      trackId: "track_flac",
      fileHash: "hash_flac",
      mimeType: "audio/flac",
      codec: "flac",
      sizeBytes: 240 * 128 * 1024,
      durationMs: 240_000,
      totalChunks: 240,
      chunkSize: 128 * 1024
    };

    const wantedChunks = getPriorityChunkIndexes({
      manifest,
      availableChunks: [],
      playbackPositionMs: 60_000,
      policy: "startup",
      lookBehindMs: 0,
      lookAheadMs: 72_000
    });

    expect(wantedChunks.slice(0, 40)).toEqual(
      Array.from({ length: 40 }, (_, index) => index)
    );
    expect(wantedChunks.indexOf(60)).toBeGreaterThan(59);
  });

  it("keeps the manifest identity stable when only local cache progress changes", () => {
    const initialKey = getProgressiveTrackManifestKey(track, availability, availability);
    const progressOnlyKey = getProgressiveTrackManifestKey(
      track,
      {
        ...availability,
        availableChunks: [0, 1, 2, 3, 4, 5, 6, 7],
        announcedAt: "2026-04-03T03:00:10.000Z"
      },
      {
        ...availability,
        availableChunks: [0, 1, 2, 3, 4, 5, 6, 7],
        announcedAt: "2026-04-03T03:00:10.000Z"
      }
    );
    const geometryKey = getProgressiveTrackManifestKey(
      track,
      {
        ...availability,
        totalChunks: 13
      },
      {
        ...availability,
        totalChunks: 13
      }
    );

    expect(progressOnlyKey).toBe(initialKey);
    expect(geometryKey).not.toBe(initialKey);
  });

  it("treats playing and buffering as active playback intent", () => {
    expect(hasActivePlaybackIntent({ ...playingPlayback, status: "playing" })).toBe(true);
    expect(hasActivePlaybackIntent({ ...playingPlayback, status: "buffering" })).toBe(true);
    expect(hasActivePlaybackIntent({ ...playingPlayback, status: "paused" })).toBe(false);
    expect(hasActivePlaybackIntent(null)).toBe(false);
  });

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

  it("reports current-window buffer but waits for a decodable prefix before startup", () => {
    const manifest = buildProgressiveTrackManifest(track, availability);
    expect(
      getAheadBufferedMs({
        manifest,
        availableChunks: [4, 5, 6],
        playbackPositionMs: 40_000
      })
    ).toBe(30_000);
    expect(
      isStartupReady({
        manifest,
        availableChunks: [4, 5, 6],
        playbackPositionMs: 40_000
      })
    ).toBe(false);
    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 1, 2, 3, 4],
        playbackPositionMs: 40_000
      })
    ).toBe(true);
  });

  it("falls back to immutable track piece manifest when availability has not arrived yet", () => {
    const manifest = buildProgressiveTrackManifest(
      {
        ...track,
        pieceManifest: {
          totalChunks: 337,
          chunkSize: 128 * 1024,
          pieceMimeType: "audio/flac"
        }
      },
      null
    );

    expect(manifest).toMatchObject({
      totalChunks: 337,
      chunkSize: 128 * 1024,
      mimeType: "audio/flac"
    });
  });

  it("prefers canonical availability hints over stale snapshot manifests", () => {
    const manifest = buildProgressiveTrackManifest(
      {
        ...track,
        pieceManifest: {
          totalChunks: 673,
          chunkSize: 64 * 1024,
          pieceMimeType: "audio/flac"
        }
      },
      null,
      {
        totalChunks: 169,
        chunkSize: 256 * 1024
      }
    );

    expect(manifest).toMatchObject({
      totalChunks: 169,
      chunkSize: 256 * 1024,
      mimeType: "audio/flac"
    });
  });

  it("keeps the room snapshot relay manifest authoritative over stale local availability", () => {
    const manifest = buildProgressiveTrackManifest(
      {
        ...track,
        sizeBytes: 169 * 256 * 1024,
        codec: "flac",
        mimeType: "audio/flac",
        pieceManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024,
          pieceMimeType: "audio/flac"
        },
        relayManifest: {
          totalChunks: 169,
          chunkSize: 256 * 1024,
          pieceMimeType: "audio/flac"
        }
      },
      {
        ...availability,
        totalChunks: 673,
        chunkSize: 64 * 1024,
        availableChunks: [0, 1, 2]
      }
    );

    expect(manifest).toMatchObject({
      totalChunks: 169,
      chunkSize: 256 * 1024
    });
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

  it("allows listener startup after roughly eight seconds of contiguous buffered audio", () => {
    const manifest = buildProgressiveTrackManifest(track, {
      ...availability,
      availableChunks: [0, 1, 2]
    });

    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 1, 2],
        playbackPositionMs: 22_000
      })
    ).toBe(true);
  });

  it("allows a shorter hot handoff window before cold startup is ready", () => {
    const manifest = buildProgressiveTrackManifest(track, {
      ...availability,
      availableChunks: [0, 1, 2, 3]
    });

    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 1, 2, 3],
        playbackPositionMs: 35_000
      })
    ).toBe(false);
    expect(
      isTakeoverReady({
        manifest,
        availableChunks: [0, 1, 2, 3],
        playbackPositionMs: 35_000
      })
    ).toBe(true);
  });

  it("allows earlier hot handoff with a smaller contiguous cache window", () => {
    const manifest = buildProgressiveTrackManifest(track, {
      ...availability,
      chunkSize: 96 * 1024,
      availableChunks: [0, 1, 2, 3]
    });

    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 1, 2, 3],
        playbackPositionMs: 36_000
      })
    ).toBe(false);
    expect(
      isTakeoverReady({
        manifest,
        availableChunks: [0, 1, 2, 3],
        playbackPositionMs: 36_000
      })
    ).toBe(true);
  });

  it("keeps late-join requests on the contiguous prefix until PCM can reach the live clock", () => {
    const flacTrack = {
      ...track,
      codec: "flac",
      mimeType: "audio/flac",
      durationMs: 300_000,
      sizeBytes: 60 * 1024 * 1024
    };
    const manifest = buildProgressiveTrackManifest(flacTrack, {
      ...availability,
      totalChunks: 100,
      chunkSize: 256 * 1024,
      availableChunks: [0, 1, 2, 3]
    })!;

    const wanted = getPriorityChunkIndexes({
      manifest,
      availableChunks: [0, 1, 2, 3],
      playbackPositionMs: 46_000,
      policy: "startup",
      lookAheadMs: 120_000
    });

    // Only contiguous prefix holes after owned [0..3], not mid-window scatter.
    expect(wanted[0]).toBe(4);
    expect(wanted.length).toBeGreaterThan(8);
    expect(
      wanted.every((chunkIndex, index) => index === 0 || chunkIndex === wanted[index - 1]! + 1)
    ).toBe(true);
    // Cap still lands at the required decodable prefix end, not sparse mid-track holes.
    expect(wanted[wanted.length - 1]).toBeLessThan(60);
  });

  it("fills the missing decode prefix before current-track startup requests", () => {
    const manifest = buildProgressiveTrackManifest(track, availability)!;
    expect(
      getPriorityChunkIndexes({
        manifest,
        availableChunks: [0, 1],
        playbackPositionMs: 40_000,
        policy: "startup"
      }).slice(0, 3)
    ).toEqual([2, 3, 4]);
  });

  it("treats FLAC startup as ready only from the continuous decodable prefix", () => {
    const manifest = buildProgressiveTrackManifest(
      {
        ...track,
        codec: "flac",
        mimeType: "audio/flac"
      },
      {
        ...availability,
        availableChunks: [0, 4, 5]
      }
    );

    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 4, 5],
        playbackPositionMs: 40_000
      })
    ).toBe(false);
    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 3, 4],
        playbackPositionMs: 40_000
      })
    ).toBe(false);
    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 3, 4, 5],
        playbackPositionMs: 40_000
      })
    ).toBe(false);
    expect(
      isStartupReady({
        manifest,
        availableChunks: [0, 1, 2, 3, 4, 5],
        playbackPositionMs: 40_000
      })
    ).toBe(true);
    expect(
      getPriorityChunkIndexes({
        manifest: manifest!,
        availableChunks: [],
        playbackPositionMs: 40_000,
        policy: "startup"
      }).slice(0, 4)
    ).toEqual([0, 1, 2, 3]);
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
      playbackRevision: 1,
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

  it("keeps filling when the comfort window can still outrun slow cache transfer", () => {
    const outrunChunks = Array.from({ length: 13 }, (_, index) => index);
    const manifest = buildProgressiveTrackManifest({
      ...track,
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    }, {
      ...availability,
      totalChunks: 24,
      availableChunks: outrunChunks
    });
    const playback = {
      status: "playing" as const,
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "host_1",
      sourcePeerId: "peer_host",
      sourceTrackId: "track_1",
      positionMs: 50_000,
      startedAt: null,
      queueVersion: 1,
      playbackRevision: 1,
      mediaEpoch: 1
    };

    expect(
      resolveSchedulerPolicy({
        playback,
        activeSource: "progressive-local",
        manifest,
        availableChunks: outrunChunks,
        fallbackReason: null,
        currentTrackComplete: false,
        currentPieceDownloadRateKbps: 20
      })
    ).toBe("outrun-recovery");

    const health = buildProgressiveHealthSnapshot({
      playback,
      activeSource: "progressive-local",
      manifest,
      localAvailability: {
        ...availability,
        totalChunks: 24,
        availableChunks: outrunChunks
      },
      fallbackReason: null,
      currentPieceDownloadRateKbps: 20
    });

    expect(health.schedulerPolicy).toBe("outrun-recovery");
    expect(health.estimatedFillTimeMs).not.toBeNull();
    expect(health.remainingPlaybackMs).toBe(70_000);
  });

  it("moves to outrun recovery after startup is ready but slow transfer can still underrun", () => {
    const manifest = buildProgressiveTrackManifest({
      ...track,
      codec: "flac",
      mimeType: "audio/flac",
      sizeBytes: 60 * 1024 * 1024
    }, {
      ...availability,
      totalChunks: 24,
      availableChunks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    });
    const playback = {
      status: "playing" as const,
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "host_1",
      sourcePeerId: "peer_host",
      sourceTrackId: "track_1",
      positionMs: 50_000,
      startedAt: null,
      queueVersion: 1,
      playbackRevision: 1,
      mediaEpoch: 1
    };

    expect(
      resolveSchedulerPolicy({
        playback,
        activeSource: "progressive-local",
        manifest,
        availableChunks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        fallbackReason: null,
        currentTrackComplete: false,
        currentPieceDownloadRateKbps: 20
      })
    ).toBe("outrun-recovery");
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

  it("uses PCM progressive playback for FLAC when WebCodecs audio is available", () => {
    const originalNavigator = globalThis.navigator;
    const originalWindow = globalThis.window;
    const originalAudioDecoder = (
      globalThis as typeof globalThis & { AudioDecoder?: unknown }
    ).AudioDecoder;
    const originalEncodedAudioChunk = (
      globalThis as typeof globalThis & { EncodedAudioChunk?: unknown }
    ).EncodedAudioChunk;

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
      }
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        AudioContext: class {}
      }
    });
    Object.defineProperty(globalThis, "AudioDecoder", {
      configurable: true,
      value: class {}
    });
    Object.defineProperty(globalThis, "EncodedAudioChunk", {
      configurable: true,
      value: class {}
    });

    try {
      const manifest = {
        trackId: "track_flac",
        fileHash: "hash_flac",
        mimeType: "audio/flac",
        codec: "flac",
        sizeBytes: 1,
        durationMs: 1_000,
        totalChunks: 4,
        chunkSize: 256 * 1024
      } as const;

      expect(canUseProgressivePcm(manifest)).toBe(true);
      expect(getProgressiveEngineType(manifest)).toBe("pcm");
    } finally {
      if (typeof originalNavigator === "undefined") {
        Reflect.deleteProperty(globalThis, "navigator");
      } else {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: originalNavigator
        });
      }

      if (typeof originalWindow === "undefined") {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow
        });
      }

      if (typeof originalAudioDecoder === "undefined") {
        Reflect.deleteProperty(globalThis, "AudioDecoder");
      } else {
        Object.defineProperty(globalThis, "AudioDecoder", {
          configurable: true,
          value: originalAudioDecoder
        });
      }

      if (typeof originalEncodedAudioChunk === "undefined") {
        Reflect.deleteProperty(globalThis, "EncodedAudioChunk");
      } else {
        Object.defineProperty(globalThis, "EncodedAudioChunk", {
          configurable: true,
          value: originalEncodedAudioChunk
        });
      }
    }
  });

  it("uses PCM progressive playback for WAV when AudioContext is available", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        AudioContext: class {}
      }
    });

    try {
      const manifest = {
        trackId: "track_wav",
        fileHash: "hash_wav",
        mimeType: "audio/wav",
        codec: "wav",
        sizeBytes: 1,
        durationMs: 1_000,
        totalChunks: 4,
        chunkSize: 256 * 1024
      } as const;

      expect(canUseProgressivePcm(manifest)).toBe(true);
      expect(getProgressiveEngineType(manifest)).toBe("pcm");
    } finally {
      if (typeof originalWindow === "undefined") {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow
        });
      }
    }
  });
});
