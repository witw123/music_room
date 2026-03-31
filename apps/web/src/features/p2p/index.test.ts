import { describe, expect, it } from "vitest";
import {
  assembleTrackFileFromPieces,
  currentTrackChunkRequestLimit,
  defaultChunkSize,
  getMissingChunkIndexes,
  hashArrayBuffer,
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
});
