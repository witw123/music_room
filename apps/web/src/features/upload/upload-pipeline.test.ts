import { describe, expect, it } from "vitest";
import type { TrackAvailabilityAnnouncement, TrackMeta } from "@music-room/shared";
import { processSelectedTrackFiles } from "./upload-pipeline";

const buildTrack = (id: string, fileHash: string): TrackMeta => ({
  id,
  title: id,
  artist: "Artist",
  album: null,
  durationMs: 120_000,
  bitrate: null,
  sizeBytes: 4096,
  codec: "flac",
  mimeType: "audio/flac",
  fileHash,
  artworkUrl: null,
  ownerSessionId: "user_1",
  ownerNickname: "Host",
  sourceType: "local_upload",
  pieceManifest: {
    totalChunks: 2,
    chunkSize: 1024,
    pieceMimeType: "audio/flac"
  },
  relayManifest: null
});

describe("processSelectedTrackFiles", () => {
  it("registers new files, skips existing or in-flight hashes, and publishes availability", async () => {
    const newFile = new File(["new"], "new.flac", { type: "audio/flac" });
    const existingFile = new File(["existing"], "existing.flac", { type: "audio/flac" });
    const busyFile = new File(["busy"], "busy.flac", { type: "audio/flac" });
    const registeredTrack = buildTrack("track_new", "hash_new");
    const inFlightUploadHashes = new Set(["user_1:hash_busy"]);
    const revokedUrls: string[] = [];
    const registeredPayloads: string[] = [];
    const persistedTracks: string[] = [];
    const publishedAvailability: string[] = [];

    const result = await processSelectedTrackFiles({
      files: [newFile, existingFile, busyFile],
      activeSession: {
        userId: "user_1",
        nickname: "Host"
      },
      roomId: "room_1",
      roomTracks: [buildTrack("track_existing", "hash_existing")],
      peerId: "peer_1",
      manualTrackCachingEnabled: true,
      inFlightUploadHashes,
      createObjectUrl: (file) => `blob:${file.name}`,
      revokeObjectUrl: (objectUrl) => {
        revokedUrls.push(objectUrl);
      },
      buildTrackMeta: async (file) => {
        const hashByName: Record<string, string> = {
          "new.flac": "hash_new",
          "existing.flac": "hash_existing",
          "busy.flac": "hash_busy"
        };
        return buildTrack(`draft_${file.name}`, hashByName[file.name]);
      },
      buildRegisterTrackPayload: (track) => ({ fileHash: track.fileHash }),
      registerTrack: async (roomId, payload) => {
        const registerPayload = payload as { fileHash: string };
        registeredPayloads.push(`${roomId}:${registerPayload.fileHash}`);
        return registeredTrack;
      },
      persistTrackIntoLibrary: async ({ track, roomId }) => {
        persistedTracks.push(`${roomId}:${track.id}`);
      },
      buildTrackAvailabilityFromFile: async (input) => ({
        roomId: input.roomId,
        trackId: input.trackId,
        ownerPeerId: input.peerId,
        nickname: input.nickname,
        totalChunks: 2,
        chunkSize: 1024,
        availableChunks: [0, 1],
        source: "live_upload",
        announcedAt: "2026-07-04T00:00:00.000Z"
      }),
      publishAvailability: (availability: TrackAvailabilityAnnouncement) => {
        publishedAvailability.push(`${availability.roomId}:${availability.trackId}`);
      }
    });

    expect(Object.keys(result.uploads)).toEqual(["track_new"]);
    expect(result.uploads.track_new).toEqual({
      file: newFile,
      objectUrl: "blob:new.flac",
      origin: "live-upload"
    });
    expect(result.registeredTracks).toEqual([registeredTrack]);
    expect(result.importedCount).toBe(1);
    expect(registeredPayloads).toEqual(["room_1:hash_new"]);
    expect(persistedTracks).toEqual(["room_1:track_new"]);
    expect(publishedAvailability).toEqual(["room_1:track_new"]);
    expect(revokedUrls).toEqual(["blob:existing.flac", "blob:busy.flac"]);
    expect([...inFlightUploadHashes]).toEqual(["user_1:hash_busy"]);
  });
});
