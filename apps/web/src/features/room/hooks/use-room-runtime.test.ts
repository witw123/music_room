import { describe, expect, it } from "vitest";
import {
  createPeerConnectionSupervisorState,
  notePeerSignalState,
  recordPeerPlayoutProgress
} from "@/features/p2p";
import {
  resolveListenerMediaRecoveryAction,
  resolveListenerMediaRecoveryReason,
  resolveMediaDiagnosticPeerId,
  resolvePeerConnectionNoProgressMs,
  shouldKickSourcePlaybackFromRealtimeEvent,
  shouldAcceptIncomingPeerSignalRecoveryGeneration,
  shouldManagePublishedMediaTransport,
  shouldReannounceManualCacheAvailability,
  shouldRecoverManualCacheDataPeers,
  shouldResumeRemotePlaybackAfterAudioUnlock,
  shouldRedirectRoomRouteToAuth,
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

describe("shouldReannounceManualCacheAvailability", () => {
  it("re-announces uploaded tracks when listeners are present and the broadcast key changed", () => {
    expect(
      shouldReannounceManualCacheAvailability({
        enableManualTrackCaching: true,
        roomId: "room_1",
        roomListenerCount: 2,
        uploadedTrackIds: ["track_b", "track_a"],
        lastBroadcastKey: null
      })
    ).toBe("room_1|2|track_a,track_b");
  });

  it("does not re-announce when nothing relevant changed", () => {
    expect(
      shouldReannounceManualCacheAvailability({
        enableManualTrackCaching: true,
        roomId: "room_1",
        roomListenerCount: 2,
        uploadedTrackIds: ["track_a", "track_b"],
        lastBroadcastKey: "room_1|2|track_a,track_b"
      })
    ).toBeNull();
  });
});

describe("shouldRecoverManualCacheDataPeers", () => {
  it("requests data peer recovery when a manual cache task has no connected remote peers", () => {
    expect(
      shouldRecoverManualCacheDataPeers({
        enableManualTrackCaching: true,
        manualCacheTrackIds: ["track_a"],
        remotePeerIds: ["peer_owner"],
        connectedPeerIds: [],
        availabilityByTrack: {},
        localPeerId: "peer_local"
      })
    ).toBe(true);
  });

  it("requests recovery when the task still has no remote availability owners", () => {
    expect(
      shouldRecoverManualCacheDataPeers({
        enableManualTrackCaching: true,
        manualCacheTrackIds: ["track_a"],
        remotePeerIds: ["peer_owner"],
        connectedPeerIds: ["peer_owner"],
        availabilityByTrack: {
          track_a: {
            peer_local: {
              roomId: "room_1",
              trackId: "track_a",
              ownerPeerId: "peer_local",
              nickname: "me",
              availableChunks: [0],
              totalChunks: 4,
              chunkSize: 128 * 1024,
              source: "local_cache",
              announcedAt: new Date(0).toISOString()
            }
          }
        },
        localPeerId: "peer_local"
      })
    ).toBe(true);
  });

  it("does not request recovery once a connected remote owner advertises the manual cache track", () => {
    expect(
      shouldRecoverManualCacheDataPeers({
        enableManualTrackCaching: true,
        manualCacheTrackIds: ["track_a"],
        remotePeerIds: ["peer_owner"],
        connectedPeerIds: ["peer_owner"],
        availabilityByTrack: {
          track_a: {
            peer_owner: {
              roomId: "room_1",
              trackId: "track_a",
              ownerPeerId: "peer_owner",
              nickname: "owner",
              availableChunks: [0, 1],
              totalChunks: 4,
              chunkSize: 128 * 1024,
              source: "live_upload",
              announcedAt: new Date(0).toISOString()
            }
          }
        },
        localPeerId: "peer_local"
      })
    ).toBe(false);
  });
});

describe("resolvePeerConnectionNoProgressMs", () => {
  it("tracks stalled host-to-listener media peers even when the listener is not the playback source", () => {
    const state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_listener",
      now: 1_000
    });

    expect(resolvePeerConnectionNoProgressMs(state, 9_500)).toBe(8_500);
  });

  it("uses recent transport or playout progress before falling back to signal state age", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_source",
      now: 1_000
    });
    state = recordPeerPlayoutProgress(state, 7_000);

    expect(resolvePeerConnectionNoProgressMs(state, 9_500)).toBe(2_500);
  });

  it("does not reset stalled checking duration on repeated signaling activity", () => {
    let state = createPeerConnectionSupervisorState({
      roomId: "room_1",
      peerId: "peer_source",
      now: 1_000
    });
    state = notePeerSignalState({
      state,
      mediaConnectionState: "connecting",
      mediaIceState: "checking",
      now: 2_000
    });
    state = notePeerSignalState({
      state,
      mediaConnectionState: "connecting",
      mediaIceState: "checking",
      now: 7_000
    });

    expect(resolvePeerConnectionNoProgressMs(state, 9_500)).toBe(7_500);
  });
});

describe("resolveMediaDiagnosticPeerId", () => {
  it("uses the media mesh callback peer before falling back to the playback source", () => {
    expect(
      resolveMediaDiagnosticPeerId({
        remotePeerId: "peer_listener",
        connectedPeerIds: [],
        currentSourcePeerId: "peer_source"
      })
    ).toBe("peer_listener");
  });

  it("falls back to connected peers, then source peer, then the synthetic remote row", () => {
    expect(
      resolveMediaDiagnosticPeerId({
        remotePeerId: null,
        connectedPeerIds: ["peer_connected"],
        currentSourcePeerId: "peer_source"
      })
    ).toBe("peer_connected");
    expect(
      resolveMediaDiagnosticPeerId({
        remotePeerId: null,
        connectedPeerIds: [],
        currentSourcePeerId: "peer_source"
      })
    ).toBe("peer_source");
    expect(
      resolveMediaDiagnosticPeerId({
        remotePeerId: null,
        connectedPeerIds: [],
        currentSourcePeerId: null
      })
    ).toBe("remote-media");
  });
});

describe("shouldResumeRemotePlaybackAfterAudioUnlock", () => {
  it("resumes listener remote playback once audio is unlocked and a paused remote stream is already bound", () => {
    expect(
      shouldResumeRemotePlaybackAfterAudioUnlock({
        audioUnlocked: true,
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        currentTrackId: "track_a",
        hasRemoteSrcObject: true,
        remoteAudioPaused: true
      })
    ).toBe(true);
  });

  it("does not resume when the listener is already audibly playing", () => {
    expect(
      shouldResumeRemotePlaybackAfterAudioUnlock({
        audioUnlocked: true,
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        currentTrackId: "track_a",
        hasRemoteSrcObject: true,
        remoteAudioPaused: false
      })
    ).toBe(false);
  });

  it("does not resume for local playback, room hosts, or missing bound streams", () => {
    expect(
      shouldResumeRemotePlaybackAfterAudioUnlock({
        audioUnlocked: true,
        isCurrentSourceOwner: true,
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        currentTrackId: "track_a",
        hasRemoteSrcObject: true,
        remoteAudioPaused: true
      })
    ).toBe(false);
    expect(
      shouldResumeRemotePlaybackAfterAudioUnlock({
        audioUnlocked: true,
        isCurrentSourceOwner: false,
        activePlaybackSource: "full-local",
        playbackStatus: "playing",
        currentTrackId: "track_a",
        hasRemoteSrcObject: true,
        remoteAudioPaused: true
      })
    ).toBe(false);
    expect(
      shouldResumeRemotePlaybackAfterAudioUnlock({
        audioUnlocked: true,
        isCurrentSourceOwner: false,
        activePlaybackSource: "remote-stream",
        playbackStatus: "playing",
        currentTrackId: "track_a",
        hasRemoteSrcObject: false,
        remoteAudioPaused: true
      })
    ).toBe(false);
  });
});

describe("shouldManagePublishedMediaTransport", () => {
  it("allows media publish management only for the current source owner", () => {
    expect(
      shouldManagePublishedMediaTransport({
        roomId: "room_a",
        peerId: "peer_source",
        isCurrentSourceOwner: true
      })
    ).toBe(true);
  });

  it("blocks media publish management for room hosts that are not the current source owner", () => {
    expect(
      shouldManagePublishedMediaTransport({
        roomId: "room_a",
        peerId: "peer_host",
        isCurrentSourceOwner: false
      })
    ).toBe(false);
  });

  it("blocks media publish management when room or peer identity is missing", () => {
    expect(
      shouldManagePublishedMediaTransport({
        roomId: null,
        peerId: "peer_source",
        isCurrentSourceOwner: true
      })
    ).toBe(false);
    expect(
      shouldManagePublishedMediaTransport({
        roomId: "room_a",
        peerId: null,
        isCurrentSourceOwner: true
      })
    ).toBe(false);
  });
});

describe("shouldKickSourcePlaybackFromRealtimeEvent", () => {
  const basePlayback = {
    status: "playing" as const,
    currentTrackId: "track_a",
    currentQueueItemId: "queue_a",
    startedAt: null,
    positionMs: 0,
    pauseRevision: 0,
    queueVersion: 1,
    mediaEpoch: 3,
    playbackRevision: 1,
    sourceSessionId: "member_1",
    sourcePeerId: "peer_member",
    sourceTrackId: "track_a"
  };

  it("does not re-kick source playback for presence-only patches while the same member remains source", () => {
    expect(
      shouldKickSourcePlaybackFromRealtimeEvent({
        previousPlayback: basePlayback,
        nextPlayback: {
          ...basePlayback
        },
        activeSessionId: "member_1"
      })
    ).toBe(false);
  });

  it("kicks source playback when the active source member changes track, media epoch, or ownership", () => {
    expect(
      shouldKickSourcePlaybackFromRealtimeEvent({
        previousPlayback: basePlayback,
        nextPlayback: {
          ...basePlayback,
          currentTrackId: "track_b"
        },
        activeSessionId: "member_1"
      })
    ).toBe(true);

    expect(
      shouldKickSourcePlaybackFromRealtimeEvent({
        previousPlayback: basePlayback,
        nextPlayback: {
          ...basePlayback,
          mediaEpoch: 4
        },
        activeSessionId: "member_1"
      })
    ).toBe(true);

    expect(
      shouldKickSourcePlaybackFromRealtimeEvent({
        previousPlayback: {
          ...basePlayback,
          sourceSessionId: "host_1",
          sourcePeerId: "peer_host"
        },
        nextPlayback: basePlayback,
        activeSessionId: "member_1"
      })
    ).toBe(true);
  });
});

describe("shouldAcceptIncomingPeerSignalRecoveryGeneration", () => {
  it("accepts signals when the payload generation matches the current recovery generation", () => {
    expect(
      shouldAcceptIncomingPeerSignalRecoveryGeneration({
        payloadRecoveryGeneration: 7,
        currentRecoveryGeneration: 7
      })
    ).toBe(true);
  });

  it("drops stale signals from an older recovery generation", () => {
    expect(
      shouldAcceptIncomingPeerSignalRecoveryGeneration({
        payloadRecoveryGeneration: 6,
        currentRecoveryGeneration: 7
      })
    ).toBe(false);
  });

  it("keeps rollout-compatible signals that do not carry a recovery generation yet", () => {
    expect(
      shouldAcceptIncomingPeerSignalRecoveryGeneration({
        payloadRecoveryGeneration: undefined,
        currentRecoveryGeneration: 7
      })
    ).toBe(true);
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
