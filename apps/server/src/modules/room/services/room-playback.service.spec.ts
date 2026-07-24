import type { PlaybackSnapshot, TrackMeta } from "@music-room/shared";
import type { RoomRecord } from "../room.types";
import { RoomPlaybackService } from "./room-playback.service";

function playbackAsset(assetId: string, durationMs: number) {
  return {
    assetId,
    kind: "playback" as const,
    sourceFileHash: "b".repeat(64),
    profileId: "opus-music-v3" as const,
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
      version: "3.3.0" as const
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

  it("keeps provider playback available while its owner is offline", async () => {
    const room = record(0);
    room.tracks[0] = {
      ...room.tracks[0]!,
      sourceType: "netease",
      sourceRef: { provider: "netease", trackId: "123" }
    };
    const service = new RoomPlaybackService({
      getActivePresence: async () => new Map()
    } as never);

    await service.updatePlayback(room, {
      action: "play",
      trackId: "track_1"
    });

    expect(room.room.playback.status).toBe("playing");
    expect(room.room.playback.sourceSessionId).toBe("owner");
    expect(room.room.playback.sourcePeerId).toBeNull();

    service.handleSourceDeparture(room, "owner");
    expect(room.room.playback.status).toBe("playing");
    expect(room.room.playback.sourcePeerId).toBeNull();
  });

  it("plays each unique track once per shuffle cycle and avoids a boundary repeat", async () => {
    const room = record(0);
    const extraTracks = ["track_3", "track_4"].map((id) => track(id, "owner", 7_000));
    room.tracks.push(...extraTracks);
    room.queue.push(
      ...extraTracks.map((item, index) => ({
        id: `queue_${index + 3}`,
        trackId: item.id,
        requestedBy: "owner",
        requestedById: "owner",
        position: index + 2,
        createdAt: `2026-07-19T00:00:0${index + 2}.000Z`
      }))
    );

    const service = new RoomPlaybackService({
      getActivePresence: async () => new Map([["owner", "peer-owner"]])
    } as never);
    await service.updatePlayback(room, { action: "set-mode", playbackMode: "shuffle" });

    const firstTrackId = room.room.playback.currentTrackId!;
    const cycle = [firstTrackId];
    for (let index = 0; index < room.queue.length - 1; index += 1) {
      const snapshot = await service.updatePlayback(room, { action: "next" });
      cycle.push(snapshot.currentTrackId!);
    }

    expect(new Set(cycle).size).toBe(room.queue.length);
    const lastTrackId = cycle.at(-1);
    const nextCycleTrack = await service.updatePlayback(room, { action: "next" });
    expect(nextCycleTrack.currentTrackId).not.toBe(lastTrackId);
    expect(cycle).toContain(nextCycleTrack.currentTrackId);
  });
});
