import { describe, expect, it } from "vitest";
import type { PeerDiagnosticsSnapshot, TrackAvailabilityAnnouncement } from "@music-room/shared";
import {
  countPeersWithinActiveMembers,
  filterAvailabilityAnnouncementsByActivePeers,
  filterAvailabilityAnnouncementsByCurrentRoomPeers,
  filterVisiblePeerDiagnostics,
  getActiveMemberPeerIds,
  isRemoteMediaPlaybackReady,
  resolveDerivedAvailabilityByTrack,
  resolveCurrentRoomTrackManifest
} from "./use-room-derived-state";

describe("use-room-derived-state helpers", () => {
  it("drops stale availability announcements from peers that are no longer active room members", () => {
    const activePeerIds = getActiveMemberPeerIds([
      {
        id: "host",
        nickname: "Host",
        role: "host",
        joinedAt: "2026-04-04T00:00:00.000Z",
        peerId: "peer_host_new",
        presenceState: "online"
      },
      {
        id: "member",
        nickname: "Member",
        role: "member",
        joinedAt: "2026-04-04T00:01:00.000Z",
        peerId: "peer_member",
        presenceState: "online"
      }
    ]);
    const trackAvailability: Record<string, TrackAvailabilityAnnouncement> = {
      peer_host_old: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host_old",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1, 2],
        source: "local_cache",
        announcedAt: "2026-04-04T00:00:00.000Z"
      },
      peer_host_new: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host_new",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1],
        source: "local_cache",
        announcedAt: "2026-04-04T00:02:00.000Z"
      }
    };

    expect(filterAvailabilityAnnouncementsByActivePeers(trackAvailability, activePeerIds)).toEqual([
      trackAvailability.peer_host_new
    ]);
  });

  it("counts only currently active peer connections in member diagnostics", () => {
    const activePeerIds = new Set(["peer_host", "peer_member"]);

    expect(countPeersWithinActiveMembers(["peer_host", "peer_departed"], activePeerIds)).toBe(1);
    expect(
      countPeersWithinActiveMembers(["peer_member", "peer_departed", "peer_host"], activePeerIds)
    ).toBe(2);
  });

  it("drops availability announcements from other rooms even when the peer id still matches", () => {
    const activePeerIds = new Set(["peer_host"]);
    const trackAvailability: Record<string, TrackAvailabilityAnnouncement> = {
      peer_host_room_1: {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_host",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1, 2],
        source: "local_cache",
        announcedAt: "2026-04-04T00:00:00.000Z"
      },
      peer_host_room_2: {
        roomId: "room_2",
        trackId: "track_1",
        ownerPeerId: "peer_host",
        nickname: "Host",
        totalChunks: 10,
        chunkSize: 1024,
        availableChunks: [0, 1, 2, 3],
        source: "local_cache",
        announcedAt: "2026-04-04T00:00:05.000Z"
      }
    };

    expect(
      filterAvailabilityAnnouncementsByCurrentRoomPeers(trackAvailability, "room_1", activePeerIds)
    ).toEqual([trackAvailability.peer_host_room_1]);
  });

  it("prefers current-room availability geometry over stale snapshot piece manifests", () => {
    const activePeerIds = new Set(["peer_host"]);

    expect(
      resolveCurrentRoomTrackManifest(
        {
          id: "track_1",
          title: "Track",
          artist: "Artist",
          album: null,
          durationMs: 120_000,
          bitrate: null,
          sizeBytes: 43_000_000,
          codec: "flac",
          mimeType: "audio/flac",
          fileHash: "hash_1",
          artworkUrl: null,
          ownerSessionId: "host",
          ownerNickname: "Host",
          sourceType: "local_upload",
          pieceManifest: {
            totalChunks: 673,
            chunkSize: 64 * 1024,
            pieceMimeType: "audio/flac"
          }
        },
        {
          peer_host: {
            roomId: "room_1",
            trackId: "track_1",
            ownerPeerId: "peer_host",
            nickname: "Host",
            totalChunks: 169,
            chunkSize: 256 * 1024,
            availableChunks: [0, 1, 2],
            source: "local_cache",
            announcedAt: "2026-04-07T00:00:00.000Z"
          }
        },
        "room_1",
        activePeerIds
      )
    ).toMatchObject({
      totalChunks: 169,
      chunkSize: 256 * 1024,
      source: "availability"
    });
  });

  it("synthesizes uploader availability from the current room manifest", () => {
    const availability = resolveDerivedAvailabilityByTrack({
        roomSnapshot: {
          room: {
            id: "room_1",
            hostId: "host",
            joinCode: "ABCD12",
            visibility: "private",
            members: [
              {
                id: "host",
                nickname: "Host",
                role: "host",
                joinedAt: "2026-04-04T00:00:00.000Z",
                peerId: "peer_host",
                presenceState: "online"
              },
              {
                id: "listener",
                nickname: "Listener",
                role: "member",
                joinedAt: "2026-04-04T00:01:00.000Z",
                peerId: "peer_listener",
                presenceState: "online"
              }
            ],
            playback: {
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
              mediaEpoch: 0
            },
            presenceRevision: 1,
            roomRevision: 1
          },
          tracks: [
            {
              id: "track_1",
              title: "Track",
              artist: "Artist",
              album: null,
              durationMs: 120_000,
              bitrate: null,
              sizeBytes: 43_000_000,
              codec: "flac",
              mimeType: "audio/flac",
              fileHash: "hash_1",
              artworkUrl: null,
              ownerSessionId: "host",
              ownerNickname: "Host",
              sourceType: "local_upload",
              relayManifest: {
                totalChunks: 169,
                chunkSize: 256 * 1024,
                pieceMimeType: "audio/flac"
              },
              pieceManifest: {
                totalChunks: 169,
                chunkSize: 256 * 1024,
                pieceMimeType: "audio/flac"
              }
            }
          ],
          queue: [],
          playlists: []
        },
        availabilityByTrack: {},
        localPeerId: "peer_listener"
      });

    expect(availability.track_1?.peer_host).toMatchObject({
      roomId: "room_1",
      trackId: "track_1",
      ownerPeerId: "peer_host",
      totalChunks: 169,
      chunkSize: 256 * 1024,
      source: "live_upload"
    });
  });

  it("hides diagnostics from peers that have already left the room", () => {
    const diagnostics = [
      { peerId: "system", updatedAt: "2026-04-04T00:00:00.000Z" },
      { peerId: "peer_host", updatedAt: "2026-04-04T00:00:00.000Z" },
      { peerId: "peer_departed", updatedAt: "2026-04-04T00:00:30.000Z", lastError: "timed out" }
    ] satisfies Array<
      Partial<PeerDiagnosticsSnapshot> & Pick<PeerDiagnosticsSnapshot, "peerId" | "updatedAt">
    >;

    expect(
      filterVisiblePeerDiagnostics(
        diagnostics as PeerDiagnosticsSnapshot[],
        new Set(["peer_host"]),
        null
      )
    ).toEqual([diagnostics[0], diagnostics[1]]);
  });

  it("keeps the synthetic remote-media row visible alongside real member peer diagnostics", () => {
    const diagnostics = [
      { peerId: "system", updatedAt: "2026-04-04T00:00:00.000Z" },
      { peerId: "remote-media", updatedAt: "2026-04-04T00:00:01.000Z", mediaConnectionState: "connecting" },
      {
        peerId: "peer_host",
        updatedAt: "2026-04-04T00:00:02.000Z",
        mediaConnectionState: "connected",
        dataChannelState: "open"
      }
    ] satisfies Array<
      Partial<PeerDiagnosticsSnapshot> & Pick<PeerDiagnosticsSnapshot, "peerId" | "updatedAt">
    >;

    expect(
      filterVisiblePeerDiagnostics(
        diagnostics as PeerDiagnosticsSnapshot[],
        new Set(["peer_host"]),
        null
      )
    ).toEqual([diagnostics[0], diagnostics[1], diagnostics[2]]);
  });

  it("only marks remote-media as ready after track, bind, and playback all succeed", () => {
    expect(
      isRemoteMediaPlaybackReady({
        peerId: "remote-media",
        remoteTrackStatus: {
          received: true,
          boundToAudioElement: true,
          lastTrackAt: null,
          lastBoundAt: null,
          lastAudioEvent: "playing",
          hasSrcObject: true,
          audioPaused: false,
          trackMuted: false,
          trackEnabled: true,
          trackReadyState: "live"
        }
      } as PeerDiagnosticsSnapshot)
    ).toBe(true);

    expect(
      isRemoteMediaPlaybackReady({
        peerId: "remote-media",
        remoteTrackStatus: {
          received: false,
          boundToAudioElement: true,
          lastTrackAt: null,
          lastBoundAt: null,
          lastAudioEvent: "playing",
          hasSrcObject: true,
          audioPaused: false,
          trackMuted: false,
          trackEnabled: true,
          trackReadyState: "live"
        }
      } as PeerDiagnosticsSnapshot)
    ).toBe(false);

    expect(
      isRemoteMediaPlaybackReady({
        peerId: "remote-media",
        remoteTrackStatus: {
          received: true,
          boundToAudioElement: true,
          lastTrackAt: null,
          lastBoundAt: null,
          lastAudioEvent: "playing",
          hasSrcObject: true,
          audioPaused: false,
          trackMuted: true,
          trackEnabled: true,
          trackReadyState: "live"
        }
      } as PeerDiagnosticsSnapshot)
    ).toBe(false);
  });
});
