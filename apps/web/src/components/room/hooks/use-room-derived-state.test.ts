import { describe, expect, it } from "vitest";
import type {
  PeerDiagnosticsSnapshot,
  PeerRecentEvent,
  RoomSnapshot,
  TrackAvailabilityAnnouncement
} from "@music-room/shared";
import { createPeerSnapshot } from "@/features/p2p/diagnostics";
import {
  countPeersWithinActiveMembers,
  buildAvailabilitySummary,
  filterAvailabilityAnnouncementsByActivePeers,
  filterAvailabilityAnnouncementsByCurrentRoomPeers,
  filterVisiblePeerDiagnostics,
  getActiveMemberPeerIds,
  getLocalPlaybackStatus,
  resolveDerivedAvailabilityByTrack,
  resolveCurrentRoomTrackManifest,
  selectWorkspacePeerDiagnostics
} from "./use-room-derived-state";

describe("use-room-derived-state helpers", () => {
  it("builds availability summaries from active peers without recreating room-wide state elsewhere", () => {
    const activePeerIds = new Set(["peer_host", "peer_listener"]);
    const track = {
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
        totalChunks: 10,
        chunkSize: 256 * 1024,
        pieceMimeType: "audio/flac"
      }
    } satisfies RoomSnapshot["tracks"][number];

    expect(
      buildAvailabilitySummary({
        tracks: [track],
        availabilityByTrack: {
          track_1: {
            peer_host: {
              roomId: "room_1",
              trackId: "track_1",
              ownerPeerId: "peer_host",
              nickname: "Host",
              totalChunks: 10,
              chunkSize: 256 * 1024,
              availableChunks: [0, 1, 2, 3],
              source: "live_upload",
              announcedAt: "2026-04-04T00:00:00.000Z"
            },
            peer_departed: {
              roomId: "room_1",
              trackId: "track_1",
              ownerPeerId: "peer_departed",
              nickname: "Departed",
              totalChunks: 10,
              chunkSize: 256 * 1024,
              availableChunks: [0, 1, 2, 3, 4],
              source: "local_cache",
              announcedAt: "2026-04-04T00:01:00.000Z"
            }
          }
        },
        roomId: "room_1",
        activeMemberPeerIds: activePeerIds,
        localPeerId: "peer_host"
      })
    ).toEqual([
      {
        track,
        peerCount: 1,
        localChunkCount: 4,
        totalChunks: 10,
        sources: ["Host (live_upload)"]
      }
    ]);
  });

  it("keeps peer diagnostics out of inactive workspace tabs", () => {
    const diagnostics = [
      { peerId: "peer_host", updatedAt: "2026-04-04T00:00:00.000Z" }
    ] as PeerDiagnosticsSnapshot[];
    const recentEvents = [
      {
        id: "event_1",
        peerId: "peer_host",
        event: "connected",
        channelKind: "data",
        direction: "local",
        summary: "connected",
        timestamp: "2026-04-04T00:00:00.000Z",
        level: "info"
      }
    ] satisfies PeerRecentEvent[];

    expect(
      selectWorkspacePeerDiagnostics({
        activeDashboardTab: "queue",
        visiblePeerDiagnostics: diagnostics,
        visiblePeerRecentEvents: recentEvents
      })
    ).toEqual({
      peerDiagnostics: [],
      peerRecentEvents: []
    });

    expect(
      selectWorkspacePeerDiagnostics({
        activeDashboardTab: "members",
        visiblePeerDiagnostics: diagnostics,
        visiblePeerRecentEvents: recentEvents
      })
    ).toEqual({
      peerDiagnostics: diagnostics,
      peerRecentEvents: recentEvents
    });
  });

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

    expect(
      buildAvailabilitySummary({
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
        availabilityByTrack: availability,
        roomId: "room_1",
        activeMemberPeerIds: new Set(["peer_host", "peer_listener"]),
        localPeerId: "peer_listener"
      })[0]
    ).toMatchObject({
      peerCount: 1,
      totalChunks: 169,
      sources: ["Host (live_upload)"]
    });
  });

  it("synthesizes current playback source availability for the cache summary", () => {
    const track = {
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
    } satisfies RoomSnapshot["tracks"][number];
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
              presenceState: "offline"
            },
            {
              id: "source",
              nickname: "Source",
              role: "member",
              joinedAt: "2026-04-04T00:01:00.000Z",
              peerId: "peer_source",
              presenceState: "online"
            },
            {
              id: "listener",
              nickname: "Listener",
              role: "member",
              joinedAt: "2026-04-04T00:02:00.000Z",
              peerId: "peer_listener",
              presenceState: "online"
            }
          ],
          playback: {
            status: "playing",
            currentTrackId: "track_1",
            currentQueueItemId: "queue_1",
            sourceSessionId: "source",
            sourcePeerId: "peer_source",
            sourceTrackId: "track_1",
            positionMs: 0,
            startedAt: "2026-04-04T00:02:30.000Z",
            queueVersion: 1,
            playbackRevision: 2,
            mediaEpoch: 1
          },
          presenceRevision: 1,
          roomRevision: 1
        },
        tracks: [track],
        queue: [],
        playlists: []
      },
      availabilityByTrack: {},
      localPeerId: "peer_listener"
    });

    expect(
      buildAvailabilitySummary({
        tracks: [track],
        availabilityByTrack: availability,
        roomId: "room_1",
        activeMemberPeerIds: new Set(["peer_source", "peer_listener"]),
        localPeerId: "peer_listener"
      })[0]
    ).toMatchObject({
      peerCount: 1,
      totalChunks: 169,
      sources: ["Source (live_upload)"]
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

  it("filters out legacy synthetic media diagnostic rows", () => {
    const diagnostics = [
      { peerId: "system", updatedAt: "2026-04-04T00:00:00.000Z" },
      { peerId: "legacy-media", updatedAt: "2026-04-04T00:00:01.000Z", mediaConnectionState: "connecting" },
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
    ).toEqual([diagnostics[0], diagnostics[2]]);
  });

  it("does not report a data-link failure from media state alone", () => {
    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "failed",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback: null,
        dataReadyCount: 0,
        pieceDownloadRateKbps: null,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "等待缓存链路",
      tone: "neutral",
      badgeText: "idle"
    });
  });

  it("treats ready native blob full-local playback as audible without PCM frames", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "full-local",
      engineType: "pcm",
      contiguousBufferedMs: 319_900,
      aheadBufferedMs: 310_100,
      schedulerPolicy: "background",
      startupReady: true,
      fullLocalReady: true,
      fullLocalPlaybackMode: "native-blob",
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 4,
      localAudioCurrentSrc: "blob:http://localhost/track",
      localAudioHasSrcObject: false,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmDirectOutputConnected: null
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 0,
        pieceDownloadRateKbps: null,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "完整缓存播放",
      tone: "success",
      badgeText: "full-local"
    });
  });

  it("does not keep ready native blob full-local playback in waiting state when paused diagnostics lag", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "full-local",
      engineType: "pcm",
      contiguousBufferedMs: 319_900,
      aheadBufferedMs: 310_100,
      schedulerPolicy: "background",
      startupReady: true,
      fullLocalReady: true,
      fullLocalPlaybackMode: "native-blob",
      localAudioPaused: true,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 4,
      localAudioCurrentSrc: "blob:http://localhost/track",
      localAudioHasSrcObject: false,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmDirectOutputConnected: null
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 0,
        pieceDownloadRateKbps: null,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "完整缓存播放",
      tone: "success",
      badgeText: "full-local"
    });
  });

  it("treats playing full-local playback as audible even if src diagnostics lag", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "full-local",
      engineType: "pcm",
      contiguousBufferedMs: 319_900,
      aheadBufferedMs: 310_100,
      schedulerPolicy: "background",
      startupReady: true,
      fullLocalReady: true,
      fullLocalPlaybackMode: "none",
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 0,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: false,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmDirectOutputConnected: null
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 0,
        pieceDownloadRateKbps: null,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "完整缓存播放",
      tone: "success",
      badgeText: "full-local"
    });
  });

  it("reports ready lossless sliding-window playback as audible", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "lossless-local",
      engineType: "pcm",
      contiguousBufferedMs: 0,
      aheadBufferedMs: 12_000,
      schedulerPolicy: "steady",
      startupReady: true,
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 4,
      localAudioHasSrcObject: true,
      pcmHasOutputStream: true,
      pcmDirectOutputConnected: true,
      pcmDecodedSegmentCount: 2,
      pcmScheduledSegmentCount: 1
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 1,
        pieceDownloadRateKbps: 320,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "无损滑动窗口播放",
      tone: "success",
      badgeText: "lossless-local"
    });
  });

  it("reports missing PCM output before the shadow audio element mute state", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "progressive-local",
      engineType: "pcm",
      contiguousBufferedMs: 48_800,
      aheadBufferedMs: 28_500,
      schedulerPolicy: "catchup",
      startupReady: true,
      localAudioPaused: false,
      localAudioMuted: true,
      localAudioVolume: 1,
      localAudioReadyState: 0,
      localAudioCurrentSrc: null,
      localAudioHasSrcObject: false,
      pcmAudioContextState: null,
      pcmDirectOutputConnected: null,
      pcmDecodedSegmentCount: null,
      pcmScheduledSegmentCount: null,
      pcmLastBlockedReason: null
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 1,
        pieceDownloadRateKbps: 2618,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "缓存已就绪但未发声",
      tone: "warning",
      badgeText: "audio-wait",
      detail: "PCM 引擎尚未解码出可播放音频帧。"
    });
  });

  it("treats PCM media-stream output as audible without direct output", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "lossless-local",
      engineType: "pcm",
      contiguousBufferedMs: 0,
      aheadBufferedMs: 12_000,
      schedulerPolicy: "steady",
      startupReady: true,
      localAudioPaused: false,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 0,
      localAudioHasSrcObject: true,
      pcmAudioContextState: "running",
      pcmHasOutputStream: true,
      pcmDirectOutputConnected: false,
      pcmDecodedSegmentCount: 2,
      pcmScheduledSegmentCount: 1
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 1,
        pieceDownloadRateKbps: 320,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "无损滑动窗口播放",
      tone: "success",
      badgeText: "lossless-local"
    });
  });

  it("treats direct PCM output as audible even when the media element stays paused", () => {
    const cachePlayback = {
      ...createPeerSnapshot("system", "2026-04-04T00:00:00.000Z").progressivePlaybackStatus!,
      activeSource: "lossless-local",
      engineType: "pcm",
      contiguousBufferedMs: 0,
      aheadBufferedMs: 12_000,
      schedulerPolicy: "steady",
      startupReady: true,
      localAudioPaused: true,
      localAudioMuted: false,
      localAudioVolume: 0.72,
      localAudioReadyState: 0,
      localAudioHasSrcObject: false,
      pcmAudioContextState: "running",
      pcmHasOutputStream: true,
      pcmDirectOutputConnected: true,
      pcmDecodedSegmentCount: 2,
      pcmScheduledSegmentCount: 1
    } satisfies NonNullable<PeerDiagnosticsSnapshot["progressivePlaybackStatus"]>;

    expect(
      getLocalPlaybackStatus({
        presenceState: "online",
        mediaConnectionState: "live",
        isSourceOwner: false,
        audioUnlocked: true,
        sourceStartState: "live",
        lastSourceStartError: null,
        mediaConnectedPeersCount: 0,
        playbackStatus: "playing",
        cachePlayback,
        dataReadyCount: 1,
        pieceDownloadRateKbps: 320,
        pieceUploadRateKbps: null
      })
    ).toMatchObject({
      label: "无损滑动窗口播放",
      tone: "success",
      badgeText: "lossless-local"
    });
  });
});
