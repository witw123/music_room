import { describe, expect, it } from "vitest";
import {
  applyUploadRuntimePruneForActiveTracks,
  applyUploadRuntimeTrackRemoval,
  cleanupUploadRuntimeRefs,
  pruneUploadRuntimeStateForActiveTracks,
  resolveRetainedCachePieceTrackIdsToConsume,
  removeUploadRuntimeTrackIds,
  syncUploadedTrackObjectUrls
} from "./upload-runtime-cleanup";

describe("upload runtime cleanup helpers", () => {
  it("prunes upload runtime state to active room tracks", () => {
    const chunkIndexesByTrack = new Map([
      ["track_keep", new Set([0, 1])],
      ["track_removed", new Set([0])]
    ]);
    const assemblingTrackIdsByTrack = new Set(["track_keep", "track_removed"]);

    const nextUploadedTracks = pruneUploadRuntimeStateForActiveTracks({
      activeTrackIds: new Set(["track_keep"]),
      uploadedTracks: {
        track_keep: "uploaded",
        track_removed: "removed"
      },
      chunkIndexesByTrack,
      assemblingTrackIdsByTrack
    });

    expect(nextUploadedTracks).toEqual({
      track_keep: "uploaded"
    });
    expect([...chunkIndexesByTrack.keys()]).toEqual(["track_keep"]);
    expect([...assemblingTrackIdsByTrack.keys()]).toEqual(["track_keep"]);
  });

  it("removes deleted tracks from uploads, tasks, and manual-cache runtime maps", () => {
    const chunkIndexesByTrack = new Map([
      ["track_keep", new Set([0])],
      ["track_removed", new Set([1])]
    ]);
    const assemblingTrackIdsByTrack = new Set(["track_keep", "track_removed"]);

    const result = removeUploadRuntimeTrackIds({
      trackIds: ["track_removed"],
      uploadedTracks: {
        track_keep: "uploaded",
        track_removed: "removed"
      },
      manualCacheTasks: {
        track_keep: "task",
        track_removed: "removed-task"
      },
      chunkIndexesByTrack,
      assemblingTrackIdsByTrack
    });

    expect(result.uploadedTracks).toEqual({
      track_keep: "uploaded"
    });
    expect(result.manualCacheTasks).toEqual({
      track_keep: "task"
    });
    expect([...chunkIndexesByTrack.keys()]).toEqual(["track_keep"]);
    expect([...assemblingTrackIdsByTrack.keys()]).toEqual(["track_keep"]);
  });

  it("preserves existing state references when no track ids are removed", () => {
    const uploadedTracks = {
      track_keep: "uploaded"
    };
    const manualCacheTasks = {
      track_keep: "task"
    };
    const result = removeUploadRuntimeTrackIds({
      trackIds: [],
      uploadedTracks,
      manualCacheTasks,
      chunkIndexesByTrack: new Map([["track_keep", new Set([0])]]),
      assemblingTrackIdsByTrack: new Set(["track_keep"])
    });

    expect(result.uploadedTracks).toBe(uploadedTracks);
    expect(result.manualCacheTasks).toBe(manualCacheTasks);
  });

  it("applies active-track pruning through upload state setters", () => {
    let uploadedTracks: Record<string, string> = {
      track_keep: "uploaded",
      track_removed: "removed"
    };
    const chunkIndexesByTrack = new Map([
      ["track_keep", new Set([0])],
      ["track_removed", new Set([1])]
    ]);
    const assemblingTrackIdsByTrack = new Set(["track_keep", "track_removed"]);

    applyUploadRuntimePruneForActiveTracks<string>({
      activeTrackIds: new Set(["track_keep"]),
      setUploadedTracks: (updater) => {
        uploadedTracks = updater(uploadedTracks);
      },
      chunkIndexesByTrack,
      assemblingTrackIdsByTrack
    });

    expect(uploadedTracks).toEqual({
      track_keep: "uploaded"
    });
    expect([...chunkIndexesByTrack.keys()]).toEqual(["track_keep"]);
    expect([...assemblingTrackIdsByTrack.keys()]).toEqual(["track_keep"]);
  });

  it("applies deleted track cleanup through upload and task state setters", () => {
    let uploadedTracks: Record<string, string> = {
      track_keep: "uploaded",
      track_removed: "removed"
    };
    let manualCacheTasks: Record<string, string> = {
      track_keep: "task",
      track_removed: "removed-task"
    };

    applyUploadRuntimeTrackRemoval<string, string>({
      trackIds: ["track_removed"],
      setUploadedTracks: (updater) => {
        uploadedTracks = updater(uploadedTracks);
      },
      setManualCacheTasks: (updater) => {
        manualCacheTasks = updater(manualCacheTasks);
      },
      chunkIndexesByTrack: new Map([
        ["track_keep", new Set([0])],
        ["track_removed", new Set([1])]
      ]),
      assemblingTrackIdsByTrack: new Set(["track_keep", "track_removed"])
    });

    expect(uploadedTracks).toEqual({
      track_keep: "uploaded"
    });
    expect(manualCacheTasks).toEqual({
      track_keep: "task"
    });
  });

  it("keeps retained cache pieces while the same track remains current", () => {
    expect(
      resolveRetainedCachePieceTrackIdsToConsume({
        retainedTrackIds: ["track_active", "track_old"],
        currentPlaybackTrackId: "track_active",
        playbackHasActiveIntent: true
      })
    ).toEqual(["track_old"]);

    expect(
      resolveRetainedCachePieceTrackIdsToConsume({
        retainedTrackIds: ["track_active"],
        currentPlaybackTrackId: "track_active",
        playbackHasActiveIntent: false
      })
    ).toEqual([]);

    expect(
      resolveRetainedCachePieceTrackIdsToConsume({
        retainedTrackIds: ["track_active"],
        currentPlaybackTrackId: null,
        playbackHasActiveIntent: false
      })
    ).toEqual(["track_active"]);
  });

  it("syncs uploaded track object urls and revokes stale urls", () => {
    const revokedUrls: string[] = [];
    const nextUrls = syncUploadedTrackObjectUrls({
      currentUrls: new Map([
        ["track_keep", "blob:keep"],
        ["track_changed", "blob:old"],
        ["track_removed", "blob:removed"]
      ]),
      uploadedTracks: {
        track_keep: {
          objectUrl: "blob:keep"
        },
        track_changed: {
          objectUrl: "blob:new"
        }
      },
      revokeObjectUrl: (objectUrl) => {
        revokedUrls.push(objectUrl);
      }
    });

    expect([...nextUrls.entries()]).toEqual([
      ["track_keep", "blob:keep"],
      ["track_changed", "blob:new"]
    ]);
    expect(revokedUrls).toEqual(["blob:old", "blob:removed"]);
  });

  it("cleans uploaded urls and cache library refs on unmount", () => {
    const revokedUrls: string[] = [];
    const uploadedTrackUrlsRef = {
      current: new Map([
        ["track_1", "blob:one"],
        ["track_2", "blob:two"]
      ])
    };
    const cacheLibraryTracksRef = {
      current: new Map([["hash_1", "cached"]])
    };

    cleanupUploadRuntimeRefs({
      uploadedTrackUrlsRef,
      cacheLibraryTracksRef,
      revokeObjectUrl: (objectUrl) => {
        revokedUrls.push(objectUrl);
      }
    });

    expect(revokedUrls).toEqual(["blob:one", "blob:two"]);
    expect(uploadedTrackUrlsRef.current.size).toBe(0);
    expect(cacheLibraryTracksRef.current.size).toBe(0);
  });
});
