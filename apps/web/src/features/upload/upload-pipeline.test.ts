import { describe, expect, it } from "vitest";
import type { TrackMeta } from "@music-room/shared";
import type { UploadedTrack } from "@/features/upload/audio-utils";
import { applySelectedTrackFilesResult, processSelectedTrackFiles } from "./upload-pipeline";

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
  it("registers new files and skips existing or in-flight hashes", async () => {
    const newFile = new File(["new"], "new.flac", { type: "audio/flac" });
    const existingFile = new File(["existing"], "existing.flac", { type: "audio/flac" });
    const busyFile = new File(["busy"], "busy.flac", { type: "audio/flac" });
    const registeredTrack = buildTrack("track_new", "hash_new");
    const inFlightUploadHashes = new Set(["user_1:hash_busy"]);
    const revokedUrls: string[] = [];
    const registeredPayloads: string[] = [];
    const persistedTracks: string[] = [];
    const readyTracks: string[] = [];

    const result = await processSelectedTrackFiles({
      files: [newFile, existingFile, busyFile],
      activeSession: {
        userId: "user_1",
        nickname: "Host"
      },
      roomId: "room_1",
      roomTracks: [buildTrack("track_existing", "hash_existing")],
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
        expect(readyTracks).toEqual(["track_new"]);
        persistedTracks.push(`${roomId}:${track.id}`);
      },
      onTrackReady: (trackId) => {
        readyTracks.push(trackId);
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
    expect(readyTracks).toEqual(["track_new"]);
    expect(revokedUrls).toEqual(["blob:existing.flac", "blob:busy.flac"]);
    expect([...inFlightUploadHashes]).toEqual(["user_1:hash_busy"]);
  });

  it("revokes the object URL when audio preparation fails", async () => {
    const file = new File(["broken"], "broken.wav", { type: "audio/wav" });
    const revokedUrls: string[] = [];

    await expect(processSelectedTrackFiles({
      files: [file],
      activeSession: { userId: "user_1", nickname: "Host" },
      roomId: "room_1",
      roomTracks: [],
      manualTrackCachingEnabled: true,
      inFlightUploadHashes: new Set(),
      createObjectUrl: () => "blob:broken.wav",
      revokeObjectUrl: (objectUrl) => revokedUrls.push(objectUrl),
      buildTrackMeta: async () => {
        throw new Error("encoder failed");
      },
      buildRegisterTrackPayload: () => ({}),
      registerTrack: async () => buildTrack("unused", "unused"),
      persistTrackIntoLibrary: async () => undefined
    })).rejects.toThrow("encoder failed");

    expect(revokedUrls).toEqual(["blob:broken.wav"]);
  });
});

describe("applySelectedTrackFilesResult", () => {
  it("merges uploads, syncs rooms with registrations, and reports imported count", async () => {
    const file = new File(["new"], "new.flac", { type: "audio/flac" });
    let uploadedTracks: Record<string, UploadedTrack> = {
      track_existing: {
        file: new File(["existing"], "existing.flac", { type: "audio/flac" }),
        objectUrl: "blob:existing",
        origin: "live-upload" as const
      }
    };
    const syncedRooms: string[] = [];
    const statusMessages: string[] = [];

    await applySelectedTrackFilesResult({
      roomId: "room_1",
      result: {
        uploads: {
          track_new: {
            file,
            objectUrl: "blob:new",
            origin: "live-upload"
          }
        },
        registeredTracks: [buildTrack("track_new", "hash_new")],
        importedCount: 1
      },
      setUploadedTracks: (updater) => {
        uploadedTracks = updater(uploadedTracks);
      },
      syncRoomSnapshot: async (roomId) => {
        syncedRooms.push(roomId);
      },
      setStatusMessage: (message) => {
        statusMessages.push(message);
      }
    });

    expect(Object.keys(uploadedTracks).sort()).toEqual(["track_existing", "track_new"]);
    expect(uploadedTracks.track_new).toMatchObject({
      file,
      objectUrl: "blob:new",
      origin: "live-upload"
    });
    expect(syncedRooms).toEqual(["room_1"]);
    expect(statusMessages).toEqual(["1 首本地歌曲已导入房间曲库。"]);
  });
});
