import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPlaybackService } from "./room-playback.service";

function playbackAsset(assetId: string, durationMs: number) {
  return {
    assetId,
    kind: "playback" as const,
    sourceFileHash: "b".repeat(64),
    profileId: "opus-music-v2" as const,
    codec: "opus" as const,
    container: "audio/ogg" as const,
    sampleRate: 48_000 as const,
    channels: 2 as const,
    bitrate: 192_000 as const,
    durationMs,
    segmentDurationMs: 2_000 as const,
    seekPrerollMs: 80 as const,
    unitCount: Math.ceil(durationMs / 2_000),
    merkleRoot: "c".repeat(64),
    encoder: {
      name: "@audio/opus-encode" as const,
      version: "2.0.0" as const
    }
  };
}

function track(id: string, ownerSessionId: string, durationMs: number): TrackMeta {
  return {
    id,
    title: id,
    artist: "Artist",
    album: null,
    durationMs,
    bitrate: null,
    fileHash: id,
    artworkUrl: null,
    ownerSessionId,
    ownerNickname: ownerSessionId,
    sourceType: "local_upload",
    playbackAsset: playbackAsset(id === "track_1" ? "1".repeat(64) : "2".repeat(64), durationMs)
  };
}

function record(positionMs: number, nextOwnerSessionId = "owner"): RoomRecord {
  const first = track("track_1", "owner", 5_000);
  const second = track("track_2", nextOwnerSessionId, 6_000);
  const startAt = "2026-07-20T00:00:00.000Z";
  const playback: PlaybackSnapshot = {
    status: "playing",
    currentTrackId: first.id,
    currentQueueItemId: "queue_1",
    playbackAssetId: first.playbackAsset!.assetId,
    startAt,
    sourceSessionId: "owner",
    sourcePeerId: "peer-owner",
    sourceTrackId: first.id,
    positionMs,
    startedAt: startAt,
    queueVersion: 1,
    playbackRevision: 1,
    mediaEpoch: 1,
    playbackMode: "sequence"
  };

  return {
    room: {
      id: "room_1",
      hostId: "owner",
      joinCode: "ROOM01",
      name: "Room",
      description: null,
      hasPassword: false,
      visibility: "private",
      members: [],
      playback,
      presenceRevision: 1,
      roomRevision: 1
    },
    tracks: [first, second],
    queue: [
      {
        id: "queue_1",
        trackId: first.id,
        requestedBy: "owner",
        requestedById: "owner",
        position: 0,
        createdAt: "2026-07-19T00:00:00.000Z"
      },
      {
        id: "queue_2",
        trackId: second.id,
        requestedBy: "owner",
        requestedById: "owner",
        position: 1,
        createdAt: "2026-07-19T00:00:01.000Z"
      }
    ]
  };
}

describe("RoomPlaybackService gapless playback", () => {
  it("calculates the transition from the unplayed portion after a seek", async () => {
    const service = new RoomPlaybackService({} as never);
    const snapshot = await service.buildPlaybackForSnapshot(
      record(3_000),
      new Map([["owner", "peer-owner"]])
    );

    expect(snapshot.gaplessNext?.transitionAt).toBe("2026-07-20T00:00:02.000Z");
  });

  it("does not advertise a gapless transition when the next owner differs", async () => {
    const service = new RoomPlaybackService({} as never);
    const snapshot = await service.buildPlaybackForSnapshot(
      record(0, "another-owner"),
      new Map([
        ["owner", "peer-owner"],
        ["another-owner", "peer-another"]
      ])
    );

    expect(snapshot.gaplessNext).toBeNull();
  });
});
