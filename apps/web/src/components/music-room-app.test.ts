import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  getCachedFullLocalPlaybackLoadKey,
  getPlaybackSourceInitializationKey,
  hasPlayableFullLocalPlaybackTrack,
  resolveCachedFullLocalPlaybackLoadTarget,
  runPlaybackMutationAfterLocalPrime,
  selectFullLocalPlaybackTracks,
  shouldClearCachedFullLocalPlaybackTrack,
  shouldInitializePlaybackSource,
  startBestEffortPlaybackAudioUnlock,
  resolveStableCurrentTrack
} from "./music-room-app";

describe("selectFullLocalPlaybackTracks", () => {
  it("keeps only uploaded tracks plus the single cached track loaded for playback", () => {
    const uploadedFile = new File(["uploaded"], "uploaded.flac", { type: "audio/flac" });
    const cachedFile = new File(["cached"], "cached.flac", { type: "audio/flac" });

    const tracks = selectFullLocalPlaybackTracks({
      uploadedTracks: {
        track_uploaded: {
          file: uploadedFile,
          objectUrl: "blob:uploaded"
        }
      },
      cachedPlaybackTrack: {
        trackId: "track_cached",
        fileHash: "hash_cached",
        file: cachedFile,
        objectUrl: "blob:cached"
      }
    });

    expect(Object.keys(tracks).sort()).toEqual(["track_cached", "track_uploaded"]);
    expect(tracks.track_cached).toMatchObject({
      file: cachedFile,
      objectUrl: "blob:cached"
    });
  });
});

describe("hasPlayableFullLocalPlaybackTrack", () => {
  it("requires a loaded full-local playback source, not just cache metadata", () => {
    expect(
      hasPlayableFullLocalPlaybackTrack({
        currentPlaybackTrackId: "track_cached",
        fullLocalPlaybackTracks: {}
      })
    ).toBe(false);

    expect(
      hasPlayableFullLocalPlaybackTrack({
        currentPlaybackTrackId: "track_cached",
        fullLocalPlaybackTracks: {
          track_cached: {
            file: new File(["cached"], "cached.flac", { type: "audio/flac" }),
            objectUrl: "blob:cached"
          }
        }
      })
    ).toBe(true);
  });
});

describe("resolveStableCurrentTrack", () => {
  const track = {
    id: "track_cached",
    title: "Cached",
    artist: "Artist",
    album: null,
    durationMs: 120_000,
    bitrate: null,
    sizeBytes: 48_000_000,
    codec: "flac",
    mimeType: "audio/flac",
    fileHash: "hash_cached",
    artworkUrl: null,
    ownerSessionId: "host",
    ownerNickname: "Host",
    sourceType: "local_upload" as const,
    pieceManifest: {
      totalChunks: 12,
      chunkSize: 256_000,
      pieceMimeType: "audio/flac"
    },
    relayManifest: null
  };

  it("keeps the same currentTrack reference across equivalent snapshot refreshes", () => {
    const refreshedTrack = {
      ...track,
      pieceManifest: {
        totalChunks: 12,
        chunkSize: 256_000,
        pieceMimeType: "audio/flac"
      }
    };

    expect(resolveStableCurrentTrack(track, "track_cached", [refreshedTrack])).toBe(track);
  });

  it("returns the refreshed track when playback-relevant metadata changes", () => {
    const changedTrack = {
      ...track,
      fileHash: "hash_changed"
    };

    expect(resolveStableCurrentTrack(track, "track_cached", [changedTrack])).toBe(changedTrack);
  });
});

describe("playback snapshot dependency boundaries", () => {
  it("keeps room playback object refreshes out of dependency arrays", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const pageDerivedSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-page-derived.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const dependencySource = [appSource, pageDerivedSource]
      .flatMap((source) => [...source.matchAll(/\n\s*\}, \[\n(?<deps>[\s\S]*?)\n\s*\]\);/g)])
      .map((match) => match.groups?.deps ?? "")
      .join("\n");

    expect(appSource).not.toContain("[roomSnapshot?.room.playback]");
    expect(dependencySource).not.toMatch(/^\s+roomSnapshot\?\.room\.playback,\s*$/m);
    expect(dependencySource).not.toMatch(/^\s+roomPlayback,\s*$/m);
  });
});

describe("room page cached full-local playback boundary", () => {
  it("hosts cached full-local playback orchestration outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const cachedPlaybackSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-cached-full-local-playback.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("cachedFullLocalPlaybackLoadTargetRef");
    expect(appSource).not.toContain("replaceCachedFullLocalPlaybackTrack");
    expect(cachedPlaybackSource).toContain("export function useRoomCachedFullLocalPlayback");
  });
});

describe("room page playback actions boundary", () => {
  it("hosts playback action orchestration outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const playbackActionsSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-playback-actions.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("const ensureRoomAudioUnlocked = useCallback");
    expect(appSource).not.toContain("const primeFullLocalTrackPlayback = useCallback");
    expect(appSource).not.toContain("const armPlaybackStart = useCallback");
    expect(playbackActionsSource).toContain("export function useRoomPlaybackActions");
  });
});

describe("room page cache library actions boundary", () => {
  it("hosts cache and library action orchestration outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const cacheActionsSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-cache-library-actions.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("const handleStartManualCacheDownload = useCallback");
    expect(appSource).not.toContain("const handleDeleteCachedLibraryTrack = useCallback");
    expect(appSource).not.toContain("const handleAddCachedLibraryTrackToLibrary = useCallback");
    expect(cacheActionsSource).toContain("export function useRoomCacheLibraryActions");
  });
});

describe("getPlaybackSourceInitializationKey", () => {
  it("keeps runtime fallback state when equivalent room track metadata is refreshed", () => {
    const firstKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey: "track_cached|host|1",
      currentPlaybackTrackId: "track_cached",
      currentTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        mimeType: "audio/flac",
        codec: "flac",
        title: "Cached"
      },
      currentProgressiveEngineTypeForSource: "pcm",
      hasPlayableFullLocalTrack: false
    });
    const refreshedKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey: "track_cached|host|1",
      currentPlaybackTrackId: "track_cached",
      currentTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        mimeType: "audio/flac",
        codec: "flac",
        title: "Cached"
      },
      currentProgressiveEngineTypeForSource: "pcm",
      hasPlayableFullLocalTrack: false
    });

    expect(refreshedKey).toBe(firstKey);
    expect(
      shouldInitializePlaybackSource({
        previousInitializationKey: firstKey,
        nextInitializationKey: refreshedKey
      })
    ).toBe(false);
  });

  it("keeps the current source when full cache becomes playable during the same surface", () => {
    const pendingCacheKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey: "track_cached|host|1",
      currentPlaybackTrackId: "track_cached",
      currentTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        mimeType: "audio/flac",
        codec: "flac",
        title: "Cached"
      },
      currentProgressiveEngineTypeForSource: "pcm",
      hasPlayableFullLocalTrack: false
    });
    const readyCacheKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey: "track_cached|host|1",
      currentPlaybackTrackId: "track_cached",
      currentTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        mimeType: "audio/flac",
        codec: "flac",
        title: "Cached"
      },
      currentProgressiveEngineTypeForSource: "pcm",
      hasPlayableFullLocalTrack: true
    });

    expect(
      shouldInitializePlaybackSource({
        previousInitializationKey: pendingCacheKey,
        nextInitializationKey: readyCacheKey
      })
    ).toBe(false);
  });
});

describe("resolveCachedFullLocalPlaybackLoadTarget", () => {
  it("uses a stable load key when equivalent room track objects are refreshed", () => {
    const cachedTrack = {
      fileHash: "hash_cached",
      title: "Cached",
      artist: "Artist",
      mimeType: "audio/flac",
      durationMs: 120_000,
      sizeBytes: 48_000_000,
      cachedAt: "2026-07-04T00:00:00.000Z",
      sourceTrackIds: ["track_cached"],
      sourceRoomIds: ["room_1"],
      lastSourceTrackId: "track_cached",
      lastSourceRoomId: "room_1",
      lastOwnerNickname: "Host"
    };
    const firstTarget = resolveCachedFullLocalPlaybackLoadTarget({
      currentPlaybackTrackId: "track_cached",
      currentTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        durationMs: 120_000,
        sizeBytes: 48_000_000
      },
      uploadedTrack: null,
      cachedPlaybackTrack: null,
      cacheLibraryTracks: [cachedTrack]
    });
    const refreshedTarget = resolveCachedFullLocalPlaybackLoadTarget({
      currentPlaybackTrackId: "track_cached",
      currentTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        durationMs: 120_000,
        sizeBytes: 48_000_000
      },
      uploadedTrack: null,
      cachedPlaybackTrack: null,
      cacheLibraryTracks: [cachedTrack]
    });

    expect(getCachedFullLocalPlaybackLoadKey(firstTarget)).toBe("track_cached:hash_cached");
    expect(getCachedFullLocalPlaybackLoadKey(refreshedTarget)).toBe("track_cached:hash_cached");
  });
});

describe("shouldClearCachedFullLocalPlaybackTrack", () => {
  it("keeps the currently loaded cached full-local track while it still matches playback", () => {
    expect(
      shouldClearCachedFullLocalPlaybackTrack({
        currentPlaybackTrackId: "track_cached",
        currentTrackFileHash: "hash_cached",
        uploadedTrack: null,
        cachedPlaybackTrack: {
          trackId: "track_cached",
          fileHash: "hash_cached",
          file: new File(["cached"], "cached.flac", { type: "audio/flac" }),
          objectUrl: "blob:cached"
        }
      })
    ).toBe(false);
  });
});

describe("runPlaybackMutationAfterLocalPrime", () => {
  it("does not wait for local audio priming before mutating room playback", async () => {
    const primeLocalPlayback = vi.fn(() => new Promise(() => undefined));
    const mutatePlayback = vi.fn(async () => "mutated");

    const result = await runPlaybackMutationAfterLocalPrime({
      primeLocalPlayback,
      mutatePlayback
    });

    expect(result).toBe("mutated");
    expect(primeLocalPlayback).toHaveBeenCalledTimes(1);
    expect(mutatePlayback).toHaveBeenCalledTimes(1);
  });

  it("does not wait for audio unlock before allowing playback flow to continue", () => {
    const unlockAudio = vi.fn(() => new Promise(() => undefined));

    startBestEffortPlaybackAudioUnlock({ unlockAudio });

    expect(unlockAudio).toHaveBeenCalledTimes(1);
  });
});
