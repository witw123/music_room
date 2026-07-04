import { describe, expect, it } from "vitest";
import type { PlaybackSnapshot, RoomSnapshot } from "@music-room/shared";
import {
  buildRoomSubscribePayload,
  hasSubscribeBootstrapFullLocalTrack,
  isSocketDisconnectGraceActive,
  shouldQueueIncomingAvailability,
  shouldExitRoomOnSnapshotMissing,
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

describe("hasSubscribeBootstrapFullLocalTrack", () => {
  it("treats a loaded full-local cache as bootstrap-ready even without a live upload binding", () => {
    expect(
      hasSubscribeBootstrapFullLocalTrack({
        enableTrackCaching: true,
        currentTrackId: "track_cached",
        uploadedTracks: {},
        fullLocalPlaybackTracks: {
          track_cached: {
            objectUrl: "blob:cached"
          }
        }
      })
    ).toBe(true);
  });

  it("does not mark bootstrap data ready when caching is disabled or the track is missing", () => {
    expect(
      hasSubscribeBootstrapFullLocalTrack({
        enableTrackCaching: false,
        currentTrackId: "track_cached",
        uploadedTracks: {
          track_cached: {
            objectUrl: "blob:uploaded"
          }
        },
        fullLocalPlaybackTracks: {}
      })
    ).toBe(false);

    expect(
      hasSubscribeBootstrapFullLocalTrack({
        enableTrackCaching: true,
        currentTrackId: "track_cached",
        uploadedTracks: {},
        fullLocalPlaybackTracks: {}
      })
    ).toBe(false);
  });
});

describe("shouldExitRoomOnSnapshotMissing", () => {
  it("exits the current room when the server reports its snapshot missing", () => {
    expect(
      shouldExitRoomOnSnapshotMissing({
        currentRoomId: "room_1",
        missingRoomId: "room_1"
      })
    ).toBe(true);
  });

  it("treats legacy missing payloads without a room id as current-room failures", () => {
    expect(
      shouldExitRoomOnSnapshotMissing({
        currentRoomId: "room_1",
        missingRoomId: null
      })
    ).toBe(true);
  });

  it("ignores missing snapshots for other rooms", () => {
    expect(
      shouldExitRoomOnSnapshotMissing({
        currentRoomId: "room_1",
        missingRoomId: "room_2"
      })
    ).toBe(false);
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

describe("shouldQueueIncomingAvailability", () => {
  it("accepts availability for the active room even when manual caching is disabled", () => {
    expect(
      shouldQueueIncomingAvailability({
        announcementRoomId: "room_1",
        runtimeRoomId: "room_1",
        activeRouteRoomId: "room_1"
      })
    ).toBe(true);
  });

  it("ignores availability for inactive rooms", () => {
    expect(
      shouldQueueIncomingAvailability({
        announcementRoomId: "room_2",
        runtimeRoomId: "room_1",
        activeRouteRoomId: "room_1"
      })
    ).toBe(false);
  });
});
