import { describe, expect, it } from "vitest";
import {
  resolveManualCacheProviderPeerIds,
  resolveManualCacheUploaderPeerIds,
  shouldAcceptIncomingDataSignal,
  shouldAcceptIncomingPeerSignalRecoveryGeneration,
  shouldForceManualCacheBootstrap,
  shouldKickSourcePlaybackFromRealtimeEvent,
  shouldReannounceManualCacheAvailability
} from "./use-room-runtime";

describe("pure cache room runtime helpers", () => {
  it("accepts only data peer signals", () => {
    const dataSignal = {
      roomId: "room_1",
      fromPeerId: "peer_a",
      toPeerId: "peer_b",
      channelKind: "data" as const,
      type: "offer" as const,
      payload: {}
    };

    expect(shouldAcceptIncomingDataSignal({ payload: dataSignal })).toBe(true);
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
    ).toBe("room_1|peer_a|peer_b|track_1,track_2");
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

  it("drops stale recovery-generation peer signals", () => {
    expect(
      shouldAcceptIncomingPeerSignalRecoveryGeneration({
        payloadRecoveryGeneration: 2,
        currentRecoveryGeneration: 3
      })
    ).toBe(false);
  });
});
