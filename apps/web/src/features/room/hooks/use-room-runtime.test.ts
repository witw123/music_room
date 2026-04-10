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
  shouldAcceptIncomingPeerSignalRecoveryGeneration,
  shouldManagePublishedMediaTransport,
  shouldResumeRemotePlaybackAfterAudioUnlock,
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
