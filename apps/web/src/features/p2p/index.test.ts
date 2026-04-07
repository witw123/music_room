import { describe, expect, it } from "vitest";
import {
  assembleTrackFileFromPieces,
  buildCanonicalTrackPieceManifest,
  currentTrackChunkRequestLimit,
  defaultChunkSize,
  getStaticWebRTCIceServers,
  getMissingChunkIndexes,
  parseIceConfigResponse,
  hashArrayBuffer,
  selectCanonicalTrackAvailabilityAnnouncement,
  selectChunkSource,
  summarizeTrackAvailability,
  upcomingTrackChunkRequestLimit
} from "./index";

describe("p2p helpers", () => {
  it("returns missing chunk indexes in ascending order", () => {
    expect(getMissingChunkIndexes(6, [0, 2, 5])).toEqual([1, 3, 4]);
  });

  it("respects the missing chunk request limit", () => {
    expect(getMissingChunkIndexes(8, [0, 1], 3)).toEqual([2, 3, 4]);
  });

  it("uses conservative chunk sizing and wider fetch windows for larger tracks", () => {
    expect(defaultChunkSize).toBe(128 * 1024);
    expect(currentTrackChunkRequestLimit).toBe(24);
    expect(upcomingTrackChunkRequestLimit).toBe(8);
  });

  it("builds device-independent canonical manifests for standard and large lossless tracks", () => {
    expect(
      buildCanonicalTrackPieceManifest({
        file: new Blob([new Uint8Array(512 * 1024)], { type: "audio/mpeg" }),
        mimeType: "audio/mpeg",
        codec: "mpeg",
        sizeBytes: 512 * 1024
      })
    ).toMatchObject({
      chunkSize: 128 * 1024,
      totalChunks: 4,
      pieceMimeType: "audio/mpeg"
    });

    expect(
      buildCanonicalTrackPieceManifest({
        file: new Blob([new Uint8Array(26 * 1024 * 1024)], { type: "audio/flac" }),
        mimeType: "audio/flac",
        codec: "flac",
        sizeBytes: 26 * 1024 * 1024
      })
    ).toMatchObject({
      chunkSize: 256 * 1024,
      totalChunks: 104
    });
  });

  it("summarizes local chunk progress and source count", () => {
    const summary = summarizeTrackAvailability(
      "track_1",
      [
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_local",
          nickname: "Host",
          totalChunks: 4,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1],
          source: "live_upload",
          announcedAt: new Date().toISOString()
        },
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_remote",
          nickname: "Listener",
          totalChunks: 4,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1, 2, 3],
          source: "local_cache",
          announcedAt: new Date().toISOString()
        }
      ],
      "peer_local"
    );

    expect(summary).toMatchObject({
      trackId: "track_1",
      peerCount: 2,
      localChunkCount: 2,
      totalChunks: 4,
      completionRatio: 0.5
    });
    expect(summary.sources).toEqual([
      "Host (live_upload)",
      "Listener (local_cache)"
    ]);
  });

  it("prefers the connected peer with the fullest chunk set", () => {
    const selected = selectChunkSource(
      [
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_local",
          nickname: "Host",
          totalChunks: 8,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1],
          source: "live_upload",
          announcedAt: "2026-03-28T10:00:00.000Z"
        },
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_a",
          nickname: "Peer A",
          totalChunks: 8,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1, 2],
          source: "local_cache",
          announcedAt: "2026-03-28T10:01:00.000Z"
        },
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_b",
          nickname: "Peer B",
          totalChunks: 8,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1, 2, 3, 4],
          source: "local_cache",
          announcedAt: "2026-03-28T10:00:30.000Z"
        }
      ],
      ["peer_a", "peer_b"],
      "peer_local"
    );

    expect(selected?.ownerPeerId).toBe("peer_b");
  });

  it("skips excluded peers when selecting a chunk source", () => {
    const selected = selectChunkSource(
      [
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_local",
          nickname: "Host",
          totalChunks: 8,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1],
          source: "live_upload",
          announcedAt: "2026-03-28T10:00:00.000Z"
        },
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_a",
          nickname: "Peer A",
          totalChunks: 8,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1, 2, 3, 4],
          source: "local_cache",
          announcedAt: "2026-03-28T10:01:00.000Z"
        },
        {
          roomId: "room_1",
          trackId: "track_1",
          ownerPeerId: "peer_b",
          nickname: "Peer B",
          totalChunks: 8,
          chunkSize: defaultChunkSize,
          availableChunks: [0, 1, 2],
          source: "local_cache",
          announcedAt: "2026-03-28T10:00:30.000Z"
        }
      ],
      ["peer_a", "peer_b"],
      "peer_local",
      ["peer_a"]
    );

    expect(selected?.ownerPeerId).toBe("peer_b");
  });

  it("prefers runtime availability with larger chunk geometry when resolving canonical manifest", () => {
    const selected = selectCanonicalTrackAvailabilityAnnouncement([
      {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_old",
        nickname: "Old",
        totalChunks: 673,
        chunkSize: 64 * 1024,
        availableChunks: [0, 1, 2],
        source: "local_cache",
        announcedAt: "2026-04-07T10:00:00.000Z"
      },
      {
        roomId: "room_1",
        trackId: "track_1",
        ownerPeerId: "peer_new",
        nickname: "New",
        totalChunks: 169,
        chunkSize: 256 * 1024,
        availableChunks: [0, 1, 2],
        source: "local_cache",
        announcedAt: "2026-04-07T10:00:01.000Z"
      }
    ]);

    expect(selected).toMatchObject({
      ownerPeerId: "peer_new",
      totalChunks: 169,
      chunkSize: 256 * 1024
    });
  });

  it("assembles a complete track only when the final file hash matches", async () => {
    const encoder = new TextEncoder();
    const pieces = [
      { chunkIndex: 0, payload: encoder.encode("hello ").buffer as ArrayBuffer },
      { chunkIndex: 1, payload: encoder.encode("world").buffer as ArrayBuffer }
    ];
    const expectedHash = await hashArrayBuffer(
      encoder.encode("hello world").buffer as ArrayBuffer
    );

    const assembled = await assembleTrackFileFromPieces({
      pieces,
      totalChunks: 2,
      mimeType: "audio/mpeg",
      title: "demo",
      expectedFileHash: expectedHash
    });

    expect(assembled).not.toBeNull();
    expect(await assembled?.blob.text()).toBe("hello world");
  });

  it("rejects an assembled track when the final file hash does not match", async () => {
    const encoder = new TextEncoder();
    const pieces = [
      { chunkIndex: 0, payload: encoder.encode("bad ").buffer as ArrayBuffer },
      { chunkIndex: 1, payload: encoder.encode("hash").buffer as ArrayBuffer }
    ];

    const assembled = await assembleTrackFileFromPieces({
      pieces,
      totalChunks: 2,
      mimeType: "audio/mpeg",
      title: "demo",
      expectedFileHash: "nope"
    });

    expect(assembled).toBeNull();
  });

  it("parses a valid ice config response", () => {
    const parsed = parseIceConfigResponse({
      iceServers: [{ urls: "stun:stun.example.com:3478" }],
      ttlSeconds: 3600,
      source: "ephemeral"
    });

    expect(parsed).toEqual({
      iceServers: [{ urls: "stun:stun.example.com:3478" }],
      ttlSeconds: 3600,
      source: "ephemeral"
    });
  });

  it("keeps static env parsing available for fallback", () => {
    process.env.NEXT_PUBLIC_STUN_URL = "stun:stun.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_URL = "turn:turn.example.com:3478";
    process.env.NEXT_PUBLIC_TURN_USERNAME = "music-room";
    process.env.NEXT_PUBLIC_TURN_CREDENTIAL = "secret";

    expect(getStaticWebRTCIceServers()).toEqual([
      { urls: "stun:stun.example.com:3478" },
      {
        urls: "turn:turn.example.com:3478",
        username: "music-room",
        credential: "secret"
      }
    ]);
  });
});
