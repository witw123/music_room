import { describe, expect, it } from "vitest";
import {
  applyCachedLibraryRoomImportResult,
  buildCachedLibraryTrackUpsertRecord,
  buildCachedLibraryFileName,
  deleteRoomTrackArtifacts,
  deleteCachedLibraryTrackEntry,
  deleteUploadedTrackArtifacts,
  exportCachedLibraryTrackFile,
  importCachedLibraryTrackToRoom,
  loadCacheLibrarySnapshot,
  selectCachedLibraryTracksForRoomAutoImport,
  claimRoomEntryCacheAutoImport,
  startCacheDownload,
  toCachedLibraryFile,
  toCachedLibraryTrack,
  toCachedLibraryTrackFile
} from "./cache-library";
import type { UploadedTrack } from "@/features/upload/audio-utils";

describe("cache-library adapters", () => {
  const roomTrack = {
    id: "track_1",
    title: "Cached",
    artist: "Artist",
    album: null,
    durationMs: 120_000,
    bitrate: null,
    sizeBytes: 4096,
    codec: "flac",
    mimeType: "audio/flac",
    fileHash: "hash_1",
    artworkUrl: null,
    ownerSessionId: "user_1",
    ownerNickname: "Host",
    sourceType: "local_upload" as const,
    pieceManifest: {
      totalChunks: 2,
      chunkSize: 1024,
      pieceMimeType: "audio/flac"
    },
    relayManifest: null
  };

  it("claims automatic cache import only once per active room entry", () => {
    expect(
      claimRoomEntryCacheAutoImport({
        cacheLibraryHydrated: false,
        entryKey: "room_1:user_1",
        claimedEntryKey: null
      })
    ).toEqual({ shouldRun: false, nextClaimedEntryKey: null });
    expect(
      claimRoomEntryCacheAutoImport({
        cacheLibraryHydrated: true,
        entryKey: "room_1:user_1",
        claimedEntryKey: null
      })
    ).toEqual({ shouldRun: true, nextClaimedEntryKey: "room_1:user_1" });
    expect(
      claimRoomEntryCacheAutoImport({
        cacheLibraryHydrated: true,
        entryKey: "room_1:user_1",
        claimedEntryKey: "room_1:user_1"
      })
    ).toEqual({ shouldRun: false, nextClaimedEntryKey: "room_1:user_1" });
  });

  it("builds stable file names from cached track metadata", () => {
    expect(
      buildCachedLibraryFileName({
        title: "A/B:Tone?",
        mimeType: "audio/flac",
        fileHash: "hash_1"
      })
    ).toBe("A B Tone.flac");
  });

  it("converts cached records into UI library entries and files", async () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });
    const record = {
      fileHash: "hash_1",
      title: "Cached",
      artist: "Artist",
      mimeType: "audio/flac",
      durationMs: 120_000,
      sizeBytes: 4096,
      cachedAt: "2026-07-04T00:00:00.000Z",
      sourceTrackIds: ["track_1"],
      sourceRoomIds: ["room_1"],
      lastSourceTrackId: "track_1",
      lastSourceRoomId: "room_1",
      lastOwnerNickname: "Host",
      file
    };

    expect(toCachedLibraryTrack(record)).toMatchObject({
      fileHash: "hash_1",
      title: "Cached",
      sourceTrackIds: ["track_1"]
    });
    expect(toCachedLibraryTrackFile(record).file).toBe(file);
    expect(toCachedLibraryFile({ file, title: "Cached", mimeType: "audio/flac", fileHash: "hash_1" })).toBe(file);
    await expect(
      toCachedLibraryFile({
        file: new Blob(["cached"], { type: "audio/flac" }),
        title: "Cached",
        mimeType: "audio/flac",
        fileHash: "hash_1"
      }).text()
    ).resolves.toBe("cached");
  });

  it("loads cache library snapshots with track list, count, and lookup map", async () => {
    const snapshot = await loadCacheLibrarySnapshot({
      listCachedLibraryTrackSummaries: async () => [
        {
          fileHash: "hash_1",
          title: "Cached",
          artist: "Artist",
          mimeType: "audio/flac",
          durationMs: 120_000,
          sizeBytes: 4096,
          cachedAt: "2026-07-04T00:00:00.000Z",
          sourceTrackIds: ["track_1"],
          sourceRoomIds: ["room_1"],
          lastSourceTrackId: "track_1",
          lastSourceRoomId: "room_1",
          lastOwnerNickname: "Host"
        }
      ],
      getCachedLibraryTrackCount: async () => 1
    });

    expect(snapshot.count).toBe(1);
    expect(snapshot.tracks).toHaveLength(1);
    expect(snapshot.tracksByHash.get("hash_1")?.title).toBe("Cached");
  });

  it("builds cache library upsert records for room tracks", () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });

    expect(
      buildCachedLibraryTrackUpsertRecord({
        track: {
          id: "track_1",
          title: "Cached",
          artist: "Artist",
          mimeType: null,
          durationMs: 120_000,
          sizeBytes: null,
          fileHash: "hash_1",
          ownerNickname: "Host"
        },
        roomId: "room_1",
        file
      })
    ).toMatchObject({
      fileHash: "hash_1",
      artist: "Artist",
      mimeType: "audio/flac",
      sizeBytes: file.size,
      sourceTrackIds: ["track_1"],
      sourceRoomIds: ["room_1"]
    });
  });

  it("selects only the active member's cached room-history tracks for automatic room import", () => {
    const selected = selectCachedLibraryTracksForRoomAutoImport({
      activeSessionNickname: "Member",
      activeSessionUserId: "user_1",
      roomId: "room_1",
      roomTracks: [
        {
          fileHash: "hash_existing",
          ownerSessionId: "user_1"
        },
        {
          fileHash: "hash_other_member",
          ownerSessionId: "user_2"
        }
      ],
      cachedLibraryTracks: [
        {
          fileHash: "hash_restore",
          title: "Restore",
          artist: "Artist",
          mimeType: "audio/flac",
          durationMs: 120_000,
          sizeBytes: 4096,
          cachedAt: "2026-07-04T00:00:00.000Z",
          sourceTrackIds: ["track_restore"],
          sourceRoomIds: ["room_1"],
          lastSourceTrackId: "track_restore",
          lastSourceRoomId: "room_1",
          lastOwnerNickname: "Member"
        },
        {
          fileHash: "hash_existing",
          title: "Already Registered",
          artist: "Artist",
          mimeType: "audio/flac",
          durationMs: 120_000,
          sizeBytes: 4096,
          cachedAt: "2026-07-04T00:00:00.000Z",
          sourceTrackIds: ["track_existing"],
          sourceRoomIds: ["room_1"],
          lastSourceTrackId: "track_existing",
          lastSourceRoomId: "room_1",
          lastOwnerNickname: "Member"
        },
        {
          fileHash: "hash_other_member",
          title: "Other Member Cached",
          artist: "Artist",
          mimeType: "audio/flac",
          durationMs: 120_000,
          sizeBytes: 4096,
          cachedAt: "2026-07-04T00:00:00.000Z",
          sourceTrackIds: ["track_other_member"],
          sourceRoomIds: ["room_1"],
          lastSourceTrackId: "track_other_member",
          lastSourceRoomId: "room_1",
          lastOwnerNickname: "Other"
        },
        {
          fileHash: "hash_other_room",
          title: "Other Room",
          artist: "Artist",
          mimeType: "audio/flac",
          durationMs: 120_000,
          sizeBytes: 4096,
          cachedAt: "2026-07-04T00:00:00.000Z",
          sourceTrackIds: ["track_other_room"],
          sourceRoomIds: ["room_2"],
          lastSourceTrackId: "track_other_room",
          lastSourceRoomId: "room_2",
          lastOwnerNickname: "Member"
        }
      ]
    });

    expect(selected).toEqual(["hash_restore"]);
  });

  it("deletes cache library entries and their source pieces", async () => {
    const deletedPiecesForTracks: string[][] = [];
    const result = await deleteCachedLibraryTrackEntry({
      fileHash: "hash_1",
      deleteCachedLibraryTrackRecord: async () => ({
        fileHash: "hash_1",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 4096,
        cachedAt: "2026-07-04T00:00:00.000Z",
        sourceTrackIds: ["track_1", "track_2"],
        sourceRoomIds: ["room_1"],
        lastSourceTrackId: "track_1",
        lastSourceRoomId: "room_1",
        lastOwnerNickname: "Host",
        file: new File(["cached"], "cached.flac", { type: "audio/flac" })
      }),
      deleteCachedPiecesForTracks: async (trackIds) => {
        deletedPiecesForTracks.push([...trackIds]);
      }
    });

    expect(result.affectedTrackIds).toEqual(["track_1", "track_2"]);
    expect(deletedPiecesForTracks).toEqual([["track_1", "track_2"]]);
  });

  it("exports cached files through injected browser download effects", async () => {
    const clicked: string[] = [];
    const revoked: string[] = [];
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });

    await exportCachedLibraryTrackFile({
      fileHash: "hash_1",
      loadCachedLibraryTrackFile: async () => ({
        fileHash: "hash_1",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 4096,
        cachedAt: "2026-07-04T00:00:00.000Z",
        sourceTrackIds: ["track_1"],
        sourceRoomIds: ["room_1"],
        lastSourceTrackId: "track_1",
        lastSourceRoomId: "room_1",
        lastOwnerNickname: "Host",
        file
      }),
      createObjectUrl: () => "blob:cached",
      clickDownload: (href, filename) => clicked.push(`${href}|${filename}`),
      revokeObjectUrl: (href) => revoked.push(href),
      defer: (callback) => callback()
    });

    expect(clicked).toEqual(["blob:cached|Cached.flac"]);
    expect(revoked).toEqual(["blob:cached"]);
  });

  it("deletes uploaded track artifacts through injected cache effects", async () => {
    const deletedPieces: string[] = [];
    const deletedTasks: string[] = [];

    const result = await deleteUploadedTrackArtifacts({
      trackId: "track_1",
      roomId: "room_1",
      deleteCachedPiecesForTrack: async (trackId) => {
        deletedPieces.push(trackId);
      },
      deleteManualCacheTask: async (roomId, trackId) => {
        deletedTasks.push(`${roomId}:${trackId}`);
      }
    });

    expect(result.removedTrackIds).toEqual(["track_1"]);
    expect(deletedPieces).toEqual(["track_1"]);
    expect(deletedTasks).toEqual(["room_1:track_1"]);
  });

  it("deletes room track artifacts once for each unique track", async () => {
    const deletedPieceGroups: string[][] = [];
    const deletedTaskGroups: string[][] = [];

    const result = await deleteRoomTrackArtifacts({
      trackIds: ["track_1", "track_2", "track_1", ""],
      roomId: "room_1",
      deleteCachedPiecesForTracks: async (trackIds) => {
        deletedPieceGroups.push([...trackIds]);
      },
      deleteManualCacheTasksForTracks: async (roomId, trackIds) => {
        deletedTaskGroups.push([roomId, ...trackIds]);
      }
    });

    expect(result.removedTrackIds).toEqual(["track_1", "track_2"]);
    expect(deletedPieceGroups).toEqual([["track_1", "track_2"]]);
    expect(deletedTaskGroups).toEqual([["room_1", "track_1", "track_2"]]);
  });

  it("imports cached library tracks into the room through injected upload effects", async () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });
    const registeredTrack = {
      id: "track_registered",
      title: "Cached",
      artist: "Artist",
      album: null,
      durationMs: 120_000,
      bitrate: null,
      sizeBytes: 4096,
      codec: "flac",
      mimeType: "audio/flac",
      fileHash: "hash_1",
      artworkUrl: null,
      ownerSessionId: "user_1",
      ownerNickname: "Host",
      sourceType: "local_upload" as const,
      pieceManifest: {
        totalChunks: 2,
        chunkSize: 1024,
        pieceMimeType: "audio/flac"
      },
      relayManifest: null
    };
    const objectUrls: string[] = [];
    const revokedUrls: string[] = [];
    const registeredPayloads: string[] = [];
    const syncedRooms: string[] = [];

    const result = await importCachedLibraryTrackToRoom({
      fileHash: "hash_1",
      activeSession: {
        userId: "user_1",
        nickname: "Host"
      },
      roomId: "room_1",
      roomTracks: [],
      loadCachedLibraryTrackFile: async () => ({
        fileHash: "hash_1",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 4096,
        cachedAt: "2026-07-04T00:00:00.000Z",
        sourceTrackIds: ["track_source"],
        sourceRoomIds: ["room_source"],
        lastSourceTrackId: "track_source",
        lastSourceRoomId: "room_source",
        lastOwnerNickname: "Host",
        file
      }),
      createObjectUrl: (nextFile) => {
        objectUrls.push(nextFile.name);
        return `blob:${objectUrls.length}`;
      },
      revokeObjectUrl: (href) => {
        revokedUrls.push(href);
      },
      buildTrackMeta: async () => registeredTrack,
      buildRegisterTrackPayload: (track) => ({ title: track.title }),
      registerTrack: async (roomId, payload) => {
        const registerPayload = payload as { title: string };
        registeredPayloads.push(`${roomId}:${registerPayload.title}`);
        return registeredTrack;
      },
      syncRoomSnapshot: async (roomId) => {
        syncedRooms.push(roomId);
      }
    });

    expect(result).toEqual({
      trackId: "track_registered",
      upload: {
        file,
        objectUrl: "blob:2",
        origin: "cached-library-import"
      }
    });
    expect(objectUrls).toEqual(["cached.flac", "cached.flac"]);
    expect(revokedUrls).toEqual(["blob:1"]);
    expect(registeredPayloads).toEqual(["room_1:Cached"]);
    expect(syncedRooms).toEqual(["room_1"]);
  });

  it("applies cached library room import results to uploaded track state", () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });
    let uploadedTracks: Record<string, UploadedTrack> = {
      track_existing: {
        file: new File(["existing"], "existing.flac", { type: "audio/flac" }),
        objectUrl: "blob:existing",
        origin: "live-upload" as const
      }
    };

    const trackId = applyCachedLibraryRoomImportResult({
      result: {
        trackId: "track_imported",
        upload: {
          file,
          objectUrl: "blob:imported",
          origin: "live-upload"
        }
      },
      setUploadedTracks: (updater) => {
        uploadedTracks = updater(uploadedTracks);
      }
    });

    expect(trackId).toBe("track_imported");
    expect(uploadedTracks).toMatchObject({
      track_existing: {
        objectUrl: "blob:existing"
      },
      track_imported: {
        objectUrl: "blob:imported",
        origin: "live-upload"
      }
    });
    expect(
      applyCachedLibraryRoomImportResult({
        result: null,
        setUploadedTracks: () => {
          throw new Error("empty imports should not update uploads");
        }
      })
    ).toBeNull();
  });

  it("starts cache downloads as ready when a usable full cached file exists", async () => {
    const file = new File(["cached"], "cached.flac", { type: "audio/flac" });

    const result = await startCacheDownload({
      manualTrackCachingEnabled: true,
      trackId: "track_1",
      mode: "manual",
      roomTracks: [roomTrack],
      peerId: "peer_1",
      cachedLibraryTracksByHash: new Map([
        [
          "hash_1",
          {
            fileHash: "hash_1",
            title: "Cached",
            artist: "Artist",
            mimeType: "audio/flac",
            durationMs: 120_000,
            sizeBytes: 4096,
            cachedAt: "2026-07-04T00:00:00.000Z",
            sourceTrackIds: ["track_1"],
            sourceRoomIds: ["room_1"],
            lastSourceTrackId: "track_1",
            lastSourceRoomId: "room_1",
            lastOwnerNickname: "Host"
          }
        ]
      ]),
      getCachedLibraryTrackSummary: async () => null,
      getCachedLibraryTrack: async () => ({
        fileHash: "hash_1",
        title: "Cached",
        artist: "Artist",
        mimeType: "audio/flac",
        durationMs: 120_000,
        sizeBytes: 4096,
        cachedAt: "2026-07-04T00:00:00.000Z",
        sourceTrackIds: ["track_1"],
        sourceRoomIds: ["room_1"],
        lastSourceTrackId: "track_1",
        lastSourceRoomId: "room_1",
        lastOwnerNickname: "Host",
        file
      }),
      getTrackPieceManifestByFileHash: async () => null,
      getTrackPieceManifest: async () => null,
      deleteCachedPiecesForTrack: async () => undefined,
      getCachedPiecesForTrack: async () => []
    });

    expect(result.taskPatch).toMatchObject({
      status: "ready",
      mode: "manual",
      fileHash: "hash_1",
      completedChunks: 2,
      totalChunks: 2,
      mimeType: "audio/flac"
    });
    expect(result.chunkIndexes).toBeNull();
    expect(result.assembleRequest).toBeNull();
  });

  it("clears incompatible cached pieces before starting a new cache task", async () => {
    const deletedTracks: string[] = [];

    const result = await startCacheDownload({
      manualTrackCachingEnabled: true,
      trackId: "track_1",
      mode: "manual",
      roomTracks: [roomTrack],
      peerId: "peer_1",
      cachedLibraryTracksByHash: new Map(),
      getCachedLibraryTrackSummary: async () => null,
      getCachedLibraryTrack: async () => null,
      getTrackPieceManifestByFileHash: async () => ({
        trackId: "track_1",
        fileHash: "hash_1",
        mimeType: "audio/flac",
        codec: "flac",
        sizeBytes: 4096,
        durationMs: 120_000,
        totalChunks: 3,
        chunkSize: 2048,
        updatedAt: "2026-07-04T00:00:00.000Z"
      }),
      getTrackPieceManifest: async () => null,
      deleteCachedPiecesForTrack: async (trackId) => {
        deletedTracks.push(trackId);
      },
      getCachedPiecesForTrack: async () => []
    });

    expect(deletedTracks).toEqual(["track_1"]);
    expect(result.shouldClearChunkIndexes).toBe(true);
    expect(result.chunkIndexes).toEqual(new Set());
    expect(result.taskPatch).toMatchObject({
      status: "queued",
      mode: "manual",
      fileHash: "hash_1",
      completedChunks: 0,
      totalChunks: 2,
      manifestSource: "snapshot",
      integrityMode: "weak"
    });
    expect(result.statusMessage).toBe("已开始缓存《Cached》。");
  });
});
