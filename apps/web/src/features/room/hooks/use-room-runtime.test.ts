import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildActivePlaybackCacheWindow,
  buildManualCachePendingPieceClearer,
  buildManualCachePendingPieceDeferrer,
  resolveSourceLocalPlaybackTrack,
  resolveActivePlaybackCacheWindowPosition,
  buildRoomExitHref,
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds,
  isCurrentPlaybackSourceDevice,
  shouldAcceptIncomingPeerSignal,
  shouldAcceptIncomingPeerSignalRecoveryGeneration,
  shouldForceManualCacheBootstrap,
  shouldKickSourcePlaybackFromRealtimeEvent,
  resolveRuntimeManualCacheTrackIds,
  shouldStartPlaybackDemandCacheForPlayback,
  shouldWaitForSourceAudioElementTrack,
  shouldReannounceManualCacheAvailability,
  resolveSourceAvailabilityReannounceTrackId,
  resolveRemoteAvailabilityRequestTrackId,
  shouldRedirectRoomRouteToAuth,
  resetInitialRoomRecoveryAttemptOnCancellation,
  shouldStartRoomRealtimeRuntime,
  shouldSuppressRoomRecoveryAfterFailure
} from "./use-room-runtime";

describe("pure cache room runtime helpers", () => {
  it("routes room deletion exits to the workspace instead of an auth redirect back to the deleted room", () => {
    expect(
      buildRoomExitHref({
        activeSession: { userId: "user_1" },
        workspaceEntryHref: "/app",
        authEntryHref: "/auth?redirectTo=%2Froom%2Froom_1"
      })
    ).toBe("/app");
  });

  it("routes unauthenticated room exits through auth", () => {
    expect(
      buildRoomExitHref({
        activeSession: null,
        workspaceEntryHref: "/app",
        authEntryHref: "/auth?redirectTo=%2Froom%2Froom_1"
      })
    ).toBe("/auth?redirectTo=%2Froom%2Froom_1");
  });

  it("keeps a reloaded room route in place while stored session credentials can still recover", () => {
    expect(
      shouldRedirectRoomRouteToAuth({
        workspaceOnly: true,
        initialRoomId: "room_1",
        hydrated: true,
        hasActiveSession: false,
        hasStoredSession: true,
        isNavigatingRoomExit: false,
        suppressRoomRecovery: false
      })
    ).toBe(false);
  });

  it("redirects a reloaded room route when no active or stored session exists", () => {
    expect(
      shouldRedirectRoomRouteToAuth({
        workspaceOnly: true,
        initialRoomId: "room_1",
        hydrated: true,
        hasActiveSession: false,
        hasStoredSession: false,
        isNavigatingRoomExit: false,
        suppressRoomRecovery: false
      })
    ).toBe(true);
  });

  it("suppresses room recovery after an uncancelled recovery failure", () => {
    expect(shouldSuppressRoomRecoveryAfterFailure({ cancelled: false })).toBe(true);
    expect(shouldSuppressRoomRecoveryAfterFailure({ cancelled: true })).toBe(false);
  });

  it("allows initial room recovery to retry when an effect cleanup cancels the first attempt", () => {
    const recoveryRef = { current: "user_1:room_1" };

    resetInitialRoomRecoveryAttemptOnCancellation({
      completed: false,
      recoveryKey: "user_1:room_1",
      initialRecoveryAttemptRef: recoveryRef
    });

    expect(recoveryRef.current).toBeNull();
  });

  it("keeps completed initial room recovery attempts marked", () => {
    const recoveryRef = { current: "user_1:room_1" };

    resetInitialRoomRecoveryAttemptOnCancellation({
      completed: true,
      recoveryKey: "user_1:room_1",
      initialRecoveryAttemptRef: recoveryRef
    });

    expect(recoveryRef.current).toBe("user_1:room_1");
  });

  it("waits for the source owner's audio element only when full-local playback is active", () => {
    expect(
      shouldWaitForSourceAudioElementTrack({
        playbackTrackId: "track_2",
        playbackStatus: "playing",
        activePlaybackSource: "full-local",
        uploadedTrackObjectUrl: "blob:track-2",
        isCurrentSourceOwner: true,
        audioCurrentSrc: "blob:track-1",
        audioSrcObjectPresent: false
      })
    ).toBe(true);
    expect(
      shouldWaitForSourceAudioElementTrack({
        playbackTrackId: "track_2",
        playbackStatus: "playing",
        activePlaybackSource: "full-local",
        uploadedTrackObjectUrl: "blob:track-2",
        isCurrentSourceOwner: true,
        audioCurrentSrc: "blob:track-2",
        audioSrcObjectPresent: false
      })
    ).toBe(false);
    expect(
      shouldWaitForSourceAudioElementTrack({
        playbackTrackId: "track_2",
        playbackStatus: "playing",
        activePlaybackSource: "progressive-local",
        uploadedTrackObjectUrl: "blob:track-2",
        isCurrentSourceOwner: true,
        audioCurrentSrc: "",
        audioSrcObjectPresent: true
      })
    ).toBe(false);
    expect(
      shouldWaitForSourceAudioElementTrack({
        playbackTrackId: "track_2",
        playbackStatus: "playing",
        activePlaybackSource: "lossless-local",
        uploadedTrackObjectUrl: "blob:track-2",
        isCurrentSourceOwner: false,
        audioCurrentSrc: "",
        audioSrcObjectPresent: true
      })
    ).toBe(false);
  });

  it("resolves source-owner local playback from the full local cache library", () => {
    expect(
      resolveSourceLocalPlaybackTrack({
        trackId: "track_1",
        uploadedTracks: {},
        fullLocalPlaybackTracks: {
          track_1: {
            objectUrl: "blob:cached-track-1"
          }
        }
      })
    ).toMatchObject({
      objectUrl: "blob:cached-track-1"
    });
  });

  it("accepts data peer signals and rejects legacy media signals", () => {
    const dataSignal = {
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data" as const,
      type: "offer" as const,
      payload: {}
    };
    const mediaSignal = {
      ...dataSignal,
      channelKind: "media" as const
    };

    expect(shouldAcceptIncomingPeerSignal({ payload: dataSignal })).toBe(true);
    expect(shouldAcceptIncomingPeerSignal({ payload: mediaSignal as unknown as typeof dataSignal })).toBe(false);
  });

  it("reannounces manual cache availability when listener set changes", () => {
    expect(
      shouldReannounceManualCacheAvailability({
        enableManualTrackCaching: true,
        roomId: "room_1",
        roomListenerSetHash: "peer_a|peer_b",
        uploadedTrackIds: ["track_2", "track_1"],
        lastBroadcastKey: null
      })
    ).toBe("room_1|peer_a|peer_b|track_1,track_2|");
  });

  it("reannounces track availability when manual caching is disabled", () => {
    expect(
      shouldReannounceManualCacheAvailability({
        enableManualTrackCaching: false,
        roomId: "room_1",
        roomListenerSetHash: "peer_a|peer_b",
        uploadedTrackIds: ["track_1"],
        lastBroadcastKey: null
      })
    ).toBe("room_1|peer_a|peer_b|track_1|");
  });

  it("reannounces when a room track becomes backed by a local file", () => {
    expect(
      shouldReannounceManualCacheAvailability({
        enableManualTrackCaching: true,
        roomId: "room_1",
        roomListenerSetHash: "peer_a|peer_b",
        uploadedTrackIds: ["track_1"],
        sourceReadyTrackIds: ["track_1"],
        lastBroadcastKey: "room_1|peer_a|peer_b|track_1|"
      })
    ).toBe("room_1|peer_a|peer_b|track_1|track_1");
  });

  it("forces availability reannounce whenever this member is the selected source", () => {
    expect(
      resolveSourceAvailabilityReannounceTrackId({
        activeSessionId: "user_1",
        playback: {
          sourceSessionId: "user_1",
          currentTrackId: "track_1"
        }
      })
    ).toBe("track_1");
    expect(
      resolveSourceAvailabilityReannounceTrackId({
        activeSessionId: "user_2",
        playback: {
          sourceSessionId: "user_1",
          currentTrackId: "track_1"
        }
      })
    ).toBeNull();
  });

  it("requests remote availability on track and replay epoch changes", () => {
    const previousPlayback = {
      currentTrackId: "track_1",
      sourceSessionId: "user_2",
      sourcePeerId: "peer_2",
      mediaEpoch: 4
    };
    expect(
      resolveRemoteAvailabilityRequestTrackId({
        activeSessionId: "user_1",
        previousPlayback,
        nextPlayback: {
          currentTrackId: "track_2",
          sourceSessionId: "user_2",
          sourcePeerId: "peer_2",
          mediaEpoch: 5
        }
      })
    ).toBe("track_2");
    expect(
      resolveRemoteAvailabilityRequestTrackId({
        activeSessionId: "user_1",
        previousPlayback,
        nextPlayback: { ...previousPlayback }
      })
    ).toBeNull();
  });

  it("forces manual cache bootstrap when providers are not connected", () => {
    expect(
      shouldForceManualCacheBootstrap({
        enableManualTrackCaching: true,
        manualCacheTrackIds: ["track_1"],
        providerPeerIds: ["peer_source"],
        connectedPeerIds: [],
        lastBootstrapKey: null
      })
    ).toBe("track_1|peer_source");
  });

  it("resolves provider peers from availability", () => {
    expect(
      resolveManualCacheProviderPeerIds({
        manualCacheTrackIds: ["track_1"],
        localPeerId: "peer_local",
        availabilityByTrack: {
          track_1: {
            peer_source: {
              roomId: "room_1",
              trackId: "track_1",
              ownerPeerId: "peer_source",
              nickname: "Host",
              totalChunks: 2,
              chunkSize: 1,
              availableChunks: [0, 1],
              source: "local_cache",
              announcedAt: "2026-04-14T00:00:00.000Z"
            }
          }
        }
      })
    ).toEqual(["peer_source"]);
  });

  it("resolves uploader peer ids from room members", () => {
    expect(
      resolveManualCacheUploaderPeerIds({
        manualCacheTrackIds: ["track_1"],
        localPeerId: "peer_local",
        roomSnapshot: {
          room: {
            id: "room_1",
            joinCode: "ABC123",
            hostId: "host",
            visibility: "private",
            roomRevision: 1,
            presenceRevision: 1,
            members: [
              {
                id: "host",
                nickname: "Host",
                role: "host",
                joinedAt: "2026-04-14T00:00:00.000Z",
                peerId: "peer_source",
                presenceState: "online"
              }
            ],
            playback: {
              status: "playing",
              currentTrackId: "track_1",
              currentQueueItemId: "queue_1",
              sourceSessionId: "host",
              sourcePeerId: "peer_source",
              sourceTrackId: "track_1",
              positionMs: 0,
              startedAt: null,
              queueVersion: 1,
              playbackRevision: 1,
              mediaEpoch: 1
            }
          },
          tracks: [
            {
              id: "track_1",
              title: "Track",
              artist: "Artist",
              album: null,
              durationMs: 1000,
              bitrate: null,
              sizeBytes: 100,
              codec: "flac",
              mimeType: "audio/flac",
              fileHash: "hash_1",
              artworkUrl: null,
              ownerSessionId: "host",
              ownerNickname: "Host",
              sourceType: "local_upload"
            }
          ],
          queue: [],
          playlists: []
        }
      })
    ).toEqual(["peer_source"]);
  });

  it("kicks local source playback when the source owner receives a new playing epoch", () => {
    expect(
      shouldKickSourcePlaybackFromRealtimeEvent({
        activeSessionId: "host",
        previousPlayback: {
          status: "paused",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: null,
          queueVersion: 1,
          playbackRevision: 1,
          mediaEpoch: 1
        },
        nextPlayback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: null,
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 2
        }
      })
    ).toBe(true);
  });

  it("starts playback-demand caching for a listener when a remote track starts playing", () => {
    expect(
      shouldStartPlaybackDemandCacheForPlayback({
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: "2026-04-14T00:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 3
        },
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: [],
        enableManualTrackCaching: true
      })
    ).toBe(true);
  });

  it("starts playback-demand caching for a listener while a remote track is buffering", () => {
    expect(
      shouldStartPlaybackDemandCacheForPlayback({
        playback: {
          status: "buffering",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: null,
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 3
        },
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: [],
        enableManualTrackCaching: true
      })
    ).toBe(true);
  });

  it("does not start playback-demand caching on the source owner or for an already tracked cache task", () => {
    const playback = {
      status: "playing" as const,
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "host",
      sourcePeerId: "peer_source",
      sourceTrackId: "track_1",
      positionMs: 0,
      startedAt: "2026-04-14T00:00:00.000Z",
      queueVersion: 1,
      playbackRevision: 2,
      mediaEpoch: 3
    };

    expect(
      shouldStartPlaybackDemandCacheForPlayback({
        playback,
        peerId: "peer_source",
        activeSessionId: "host",
        manualCacheTrackIds: [],
        enableManualTrackCaching: true
      })
    ).toBe(false);

    expect(
      shouldStartPlaybackDemandCacheForPlayback({
        playback,
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: [],
        hasLocalFullTrack: true,
        enableManualTrackCaching: true
      })
    ).toBe(false);

    expect(
      shouldStartPlaybackDemandCacheForPlayback({
        playback,
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: ["track_1"],
        enableManualTrackCaching: true
      })
    ).toBe(false);
  });

  it("starts playback-demand caching for another device signed in as the same user", () => {
    const playback = {
      status: "playing" as const,
      currentTrackId: "track_1",
      currentQueueItemId: "queue_1",
      sourceSessionId: "user_shared",
      sourcePeerId: "peer_source",
      sourceTrackId: "track_1",
      positionMs: 0,
      startedAt: "2026-04-14T00:00:00.000Z",
      queueVersion: 1,
      playbackRevision: 2,
      mediaEpoch: 3
    };

    expect(
      isCurrentPlaybackSourceDevice({
        playback,
        peerId: "peer_listener",
        activeSessionId: "user_shared"
      })
    ).toBe(false);

    expect(
      shouldStartPlaybackDemandCacheForPlayback({
        playback,
        peerId: "peer_listener",
        activeSessionId: "user_shared",
        manualCacheTrackIds: [],
        enableManualTrackCaching: true
      })
    ).toBe(true);

    expect(
      resolveRuntimeManualCacheTrackIds({
        playback,
        peerId: "peer_listener",
        activeSessionId: "user_shared",
        manualCacheTrackIds: [],
        hasLocalFullTrack: false,
        enableManualTrackCaching: true
      })
    ).toEqual(["track_1"]);
  });

  it("keeps the current remote playback track active for downloader refs", () => {
    expect(
      resolveRuntimeManualCacheTrackIds({
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: "2026-04-14T00:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 3
        },
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: [],
        hasLocalFullTrack: false,
        enableManualTrackCaching: true
      })
    ).toEqual(["track_1"]);
  });

  it("keeps playback-demand runtime caching active while the listener is still playing after a full local file is playable", () => {
    expect(
      resolveRuntimeManualCacheTrackIds({
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: "2026-04-14T00:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 3
        },
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: [],
        hasLocalFullTrack: true,
        enableManualTrackCaching: true
      })
    ).toEqual(["track_1"]);
  });

  it("keeps an explicit manual cache task after the same listener has full local playback", () => {
    expect(
      resolveRuntimeManualCacheTrackIds({
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: "2026-04-14T00:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 3
        },
        peerId: "peer_listener",
        activeSessionId: "listener",
        manualCacheTrackIds: ["track_1"],
        hasLocalFullTrack: true,
        enableManualTrackCaching: true
      })
    ).toEqual(["track_1"]);
  });

  it("keeps playback cache active for a selected source device when its local full file is missing", () => {
    expect(
      resolveRuntimeManualCacheTrackIds({
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: "2026-04-14T00:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 2,
          mediaEpoch: 3
        },
        peerId: "peer_source",
        activeSessionId: "host",
        manualCacheTrackIds: [],
        hasLocalFullTrack: false,
        enableManualTrackCaching: true
      })
    ).toEqual(["track_1"]);
  });

  it("builds an active playback cache window for current listener downloads", () => {
    expect(
      buildActivePlaybackCacheWindow({
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 15_000,
          startedAt: null,
          queueVersion: 1,
          playbackRevision: 4,
          mediaEpoch: 7
        },
        positionMs: 18_500,
        policy: "catchup"
      })
    ).toEqual({
      trackId: "track_1",
      positionMs: 18_500,
      revision: 4,
      mediaEpoch: 7,
      status: "playing",
      policy: "catchup"
    });
  });

  it("builds an active playback cache window while the current listener is buffering", () => {
    expect(
      buildActivePlaybackCacheWindow({
        playback: {
          status: "buffering",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 20_000,
          startedAt: null,
          queueVersion: 1,
          playbackRevision: 4,
          mediaEpoch: 7
        },
        positionMs: null,
        policy: "catchup"
      })
    ).toEqual({
      trackId: "track_1",
      positionMs: 20_000,
      revision: 4,
      mediaEpoch: 7,
      status: "buffering",
      policy: "catchup"
    });
  });

  it("uses the room playback clock for cache windows before local playback has started", () => {
    expect(
      resolveActivePlaybackCacheWindowPosition({
        localPlaybackPositionMs: null,
        mediaConnectionState: "buffering",
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 10_000,
          startedAt: "2026-06-28T10:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 4,
          mediaEpoch: 7
        },
        durationMs: 120_000,
        schedulerPlaybackBucketMs: 0,
        now: new Date("2026-06-28T10:00:05.000Z").getTime()
      })
    ).toBe(15_000);
  });

  it("pins cache requests to the local PCM position while progressive playback is buffering", () => {
    expect(
      resolveActivePlaybackCacheWindowPosition({
        localPlaybackPositionMs: 0,
        mediaConnectionState: "buffering",
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 10_000,
          startedAt: "2026-06-28T10:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 4,
          mediaEpoch: 7
        },
        durationMs: 120_000,
        schedulerPlaybackBucketMs: 0,
        now: new Date("2026-06-28T10:00:05.000Z").getTime()
      })
    ).toBe(0);
  });

  it("uses the local playback clock once local playback is live", () => {
    expect(
      resolveActivePlaybackCacheWindowPosition({
        localPlaybackPositionMs: 16_000,
        mediaConnectionState: "live",
        playback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 10_000,
          startedAt: "2026-06-28T10:00:00.000Z",
          queueVersion: 1,
          playbackRevision: 4,
          mediaEpoch: 7
        },
        durationMs: 120_000,
        schedulerPlaybackBucketMs: 0,
        now: new Date("2026-06-28T10:00:05.000Z").getTime()
      })
    ).toBe(16_000);
  });

  it("routes realtime piece completion to the current manual cache pending clearer", () => {
    const calls: Array<[string, number]> = [];
    const clearPendingPieceRef = {
      current: (trackId: string, chunkIndex: number) => {
        calls.push([trackId, chunkIndex]);
      }
    };

    const clearPendingPiece = buildManualCachePendingPieceClearer(clearPendingPieceRef);
    clearPendingPiece("track_1", 7);

    expect(calls).toEqual([["track_1", 7]]);
  });

  it("routes realtime piece unavailable notifications to a short manual cache pending deferral", () => {
    const calls: Array<[string, number, number]> = [];
    const deferPendingPieceRef = {
      current: (trackId: string, chunkIndex: number, options: { delayMs: number }) => {
        calls.push([trackId, chunkIndex, options.delayMs]);
      }
    };

    const deferPendingPiece = buildManualCachePendingPieceDeferrer(deferPendingPieceRef);
    deferPendingPiece("track_1", 7, { delayMs: 12_345 });

    expect(calls).toEqual([["track_1", 7, 12_345]]);
  });

  it("does not kick local source playback from a stale realtime playback event", () => {
    expect(
      shouldKickSourcePlaybackFromRealtimeEvent({
        activeSessionId: "host",
        previousPlayback: {
          status: "playing",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 30_000,
          startedAt: "2026-01-01T00:00:00.000Z",
          queueVersion: 4,
          playbackRevision: 4,
          mediaEpoch: 2
        },
        nextPlayback: {
          status: "paused",
          currentTrackId: "track_1",
          currentQueueItemId: "queue_1",
          sourceSessionId: "host",
          sourcePeerId: "peer_source",
          sourceTrackId: "track_1",
          positionMs: 0,
          startedAt: null,
          queueVersion: 3,
          playbackRevision: 3,
          mediaEpoch: 1
        }
      })
    ).toBe(false);
  });

  it("waits for a stable peer id before starting the room realtime runtime", () => {
    expect(
      shouldStartRoomRealtimeRuntime({
        roomId: "room_1",
        hydrated: true,
        iceConfigResolved: true,
        peerId: ""
      })
    ).toBe(false);

    expect(
      shouldStartRoomRealtimeRuntime({
        roomId: "room_1",
        hydrated: true,
        iceConfigResolved: true,
        peerId: "peer_1"
      })
    ).toBe(true);
  });

  it("drops stale recovery-generation peer signals", () => {
    expect(
      shouldAcceptIncomingPeerSignalRecoveryGeneration({
        payloadRecoveryGeneration: 2,
        currentRecoveryGeneration: 3
      })
    ).toBe(false);
  });
});

describe("room runtime snapshot dependency boundaries", () => {
  it("keeps snapshot playback and track array object refreshes out of dependency arrays", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-room-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const dependencySource = [...source.matchAll(/\n\s*\}, \[\n(?<deps>[\s\S]*?)\n\s*\]\);/g)]
      .map((match) => match.groups?.deps ?? "")
      .join("\n");

    expect(dependencySource).not.toMatch(/^\s+roomSnapshot\?\.room\.playback,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+roomSnapshot\?\.tracks,\s*$/m);
  });

  it("keeps playback runtime state out of the realtime socket runtime dependencies", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "use-room-runtime.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const runtimeEffect = source.match(
      /return createRoomRealtimeRuntime\([\s\S]*?\n\s*\}, \[\n(?<deps>[\s\S]*?)\n\s*\]\);/
    );

    expect(runtimeEffect?.groups?.deps ?? "").not.toMatch(
      /\b(roomPlaybackCurrentTrackId|roomPlaybackStatus|bufferHealth|isPageVisible|audioUnlocked)\b/
    );
  });
});
