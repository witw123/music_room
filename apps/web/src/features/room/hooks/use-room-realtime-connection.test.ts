import { describe, expect, it } from "vitest";
import type { PlaybackSnapshot, RoomSnapshot } from "@music-room/shared";
import {
  buildRoomSubscribePayload,
  isSocketDisconnectGraceActive,
  shouldResyncSnapshotForPlaybackPatch,
  shouldSuppressPlaybackWatchdogEscalation
} from "./use-room-realtime-connection";

function createPlayback(overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
  return {
    status: "paused",
    currentTrackId: null,
    currentQueueItemId: null,
    sourceSessionId: null,
    sourcePeerId: null,
    sourceTrackId: null,
    positionMs: 0,
    startedAt: null,
    queueVersion: 1,
    playbackRevision: 1,
    mediaEpoch: 1,
    ...overrides
  };
}

function createSnapshot(overrides: {
  tracks?: RoomSnapshot["tracks"];
  playback?: Partial<PlaybackSnapshot>;
} = {}): RoomSnapshot {
  return {
    room: {
      id: "room_1",
      hostId: "host",
      joinCode: "ABC123",
      visibility: "public",
      members: [],
      presenceRevision: 1,
      roomRevision: 1,
      playback: createPlayback(overrides.playback)
    },
    tracks: overrides.tracks ?? [],
    queue: [],
    playlists: []
  };
}

describe("isSocketDisconnectGraceActive", () => {
  it("stays active before the grace window expires", () => {
    expect(isSocketDisconnectGraceActive(12_000, 10_000)).toBe(true);
  });

  it("stops being active after the grace window expires", () => {
    expect(isSocketDisconnectGraceActive(12_000, 12_001)).toBe(false);
    expect(isSocketDisconnectGraceActive(null, 12_001)).toBe(false);
  });
});

describe("shouldSuppressPlaybackWatchdogEscalation", () => {
  it("suppresses watchdog escalation while the page is backgrounded", () => {
    expect(
      shouldSuppressPlaybackWatchdogEscalation({
        recoverySuppressedReason: "page-hidden",
        socketDisconnectGraceActive: false
      })
    ).toBe(true);
  });

  it("suppresses watchdog escalation during socket disconnect grace", () => {
    expect(
      shouldSuppressPlaybackWatchdogEscalation({
        recoverySuppressedReason: null,
        socketDisconnectGraceActive: true
      })
    ).toBe(true);
  });

  it("allows escalation once no suppression signal remains", () => {
    expect(
      shouldSuppressPlaybackWatchdogEscalation({
        recoverySuppressedReason: null,
        socketDisconnectGraceActive: false
      })
    ).toBe(false);
  });
});

describe("buildRoomSubscribePayload", () => {
  it("includes the authenticated session id required by the signaling gateway", () => {
    expect(
      buildRoomSubscribePayload({
        roomId: "room_1",
        peerId: "peer_1",
        sessionId: "user_1"
      })
    ).toEqual({
      roomId: "room_1",
      peerId: "peer_1",
      sessionId: "user_1"
    });
  });
});

describe("shouldResyncSnapshotForPlaybackPatch", () => {
  it("requests a snapshot when playback points at a track missing from local metadata", () => {
    expect(
      shouldResyncSnapshotForPlaybackPatch({
        currentSnapshot: createSnapshot(),
        playback: createPlayback({
          status: "playing",
          currentTrackId: "track_live",
          playbackRevision: 2,
          queueVersion: 2
        })
      })
    ).toBe(true);
  });

  it("requests a snapshot when playback has a track but no room snapshot is loaded yet", () => {
    expect(
      shouldResyncSnapshotForPlaybackPatch({
        currentSnapshot: null,
        playback: createPlayback({
          status: "playing",
          currentTrackId: "track_live",
          playbackRevision: 2,
          queueVersion: 2
        })
      })
    ).toBe(true);
  });

  it("skips snapshot resync when the playback track metadata is already present", () => {
    expect(
      shouldResyncSnapshotForPlaybackPatch({
        currentSnapshot: createSnapshot({
          tracks: [
            {
              id: "track_live",
              ownerSessionId: "host",
              title: "Live Track",
              artist: "Artist",
              album: null,
              durationMs: 120_000,
              bitrate: 320_000,
              fileHash: "hash_live",
              mimeType: "audio/flac",
              codec: "flac",
              sizeBytes: 1024,
              artworkUrl: null,
              ownerNickname: "Host",
              sourceType: "local_upload"
            }
          ]
        }),
        playback: createPlayback({
          status: "playing",
          currentTrackId: "track_live",
          playbackRevision: 2,
          queueVersion: 2
        })
      })
    ).toBe(false);
  });
});
