import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  getCachedFullLocalPlaybackLoadKey,
  getCachedFullLocalPlaybackLoadMissKey,
  getPlaybackSourceInitializationKey,
  hasPlayableFullLocalPlaybackTrack,
  resolveCachedFullLocalPlaybackLoadTarget,
  shouldNotifyCachedFullLocalPlaybackLoadMiss,
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

  it("retries cached full-local file loading when the cache library refreshes for the same playback track", () => {
    const cachedPlaybackSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-cached-full-local-playback.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const effectBlocks = [...cachedPlaybackSource.matchAll(/useEffect\(\(\) => \{[\s\S]*?cachedTrackFile[\s\S]*?\n\s*\}, \[\n(?<deps>[\s\S]*?)\n\s*\]\);/g)];
    const loadEffectDeps = effectBlocks
      .map((match) => match.groups?.deps ?? "")
      .find((deps) => deps.includes("cachedFullLocalPlaybackLoadKey"));

    expect(loadEffectDeps).toContain("cacheLibraryTracks");
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

describe("room page playback effects boundary", () => {
  it("hosts playback effect orchestration outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const playbackEffectsSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-playback-effects.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("getPlaybackSourceInitializationKey({");
    expect(appSource).not.toContain("resolvePlaybackSourceResetReason({");
    expect(appSource).not.toContain("consumeRoomSnapshotHandoff(initialRoomId)");
    expect(playbackEffectsSource).toContain("export function useRoomPlaybackEffects");
  });
});

describe("room page room actions boundary", () => {
  it("hosts room action assembly outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const roomActionsSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-page-room-actions.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("const resetPlayerSurface = useCallback");
    expect(appSource).not.toContain("useRoomActions({");
    expect(appSource).not.toContain("useRoomLifecycleActions({");
    expect(roomActionsSource).toContain("export function useRoomPageRoomActions");
  });
});

describe("room page workspace view model boundary", () => {
  it("hosts workspace derived view state outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const workspaceViewModelSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "room/hooks/use-room-workspace-view-model.ts"
      ),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("useRoomDerivedState({");
    expect(appSource).not.toContain("selectWorkspacePeerDiagnostics({");
    expect(workspaceViewModelSource).toContain("export function useRoomWorkspaceViewModel");
  });
});

describe("room page playback engine type boundary", () => {
  it("hosts current playback source engine derivation outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const pageDerivedSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-page-derived.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("buildProgressiveTrackManifest(");
    expect(appSource).not.toContain("getProgressiveEngineType(");
    expect(pageDerivedSource).toContain("export function useCurrentProgressiveEngineTypeForSource");
  });
});

describe("room page clipboard actions boundary", () => {
  it("hosts join code clipboard action outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const clipboardActionsSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-clipboard-actions.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("navigator.clipboard.writeText");
    expect(appSource).not.toContain("const handleCopyJoinCode = useCallback");
    expect(clipboardActionsSource).toContain("export function useRoomClipboardActions");
  });
});

describe("room page feature assembly shape", () => {
  it("keeps feature hook results bundled in the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toMatch(/const\s+\{[\s\S]*?\}\s*=\s*useRoomPageState\(/);
    expect(appSource).not.toMatch(/const\s+\{[\s\S]*?\}\s*=\s*useTrackUploads\(/);
    expect(appSource).not.toMatch(/const\s+\{[\s\S]*?\}\s*=\s*useRoomPageRoomActions\(/);
    expect(appSource).not.toMatch(/const\s+\{[\s\S]*?\}\s*=\s*useRoomPlaybackActions\(/);
    expect(appSource.split("\n").length).toBeLessThanOrEqual(520);
  });
});

describe("room page render shell boundary", () => {
  it("hosts the workspace render shell outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const shellSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/RoomAppShell.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("<AudioUnlockOverlay");
    expect(appSource).not.toContain("<RoomWorkspace");
    expect(appSource).not.toContain("<BottomPlayerController");
    expect(appSource.split("\n").length).toBeLessThanOrEqual(430);
    expect(shellSource).toContain("export function RoomAppShell");
  });
});

describe("room page app infrastructure boundary", () => {
  it("hosts app entry links and shared refs outside the app component", () => {
    const appSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "music-room-app.tsx"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const entriesSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-app-entries.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");
    const refsSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "room/hooks/use-room-app-refs.ts"),
      "utf8"
    ).replace(/\r\n/g, "\n");

    expect(appSource).not.toContain("getClientPlatformFromBrowser()");
    expect(appSource).not.toContain("useRef<HTMLAudioElement>");
    expect(appSource).toContain("useRoomAppEntries({");
    expect(appSource).toContain("useRoomAppRefs({");
    expect(appSource.split("\n").length).toBeLessThanOrEqual(400);
    expect(entriesSource).toContain("export function useRoomAppEntries");
    expect(refsSource).toContain("export function useRoomAppRefs");
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

  it("keeps the current playback source when full cache becomes playable during the same surface", () => {
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

    expect(readyCacheKey).toBe(pendingCacheKey);
    expect(
      shouldInitializePlaybackSource({
        previousInitializationKey: pendingCacheKey,
        nextInitializationKey: readyCacheKey
      })
    ).toBe(false);
  });

  it("reinitializes the playback source on the next surface so completed cache can be used then", () => {
    const currentSurfaceKey = getPlaybackSourceInitializationKey({
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
    const nextSurfaceKey = getPlaybackSourceInitializationKey({
      playbackSurfaceKey: "track_cached|host|2",
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

    expect(nextSurfaceKey).not.toBe(currentSurfaceKey);
    expect(
      shouldInitializePlaybackSource({
        previousInitializationKey: currentSurfaceKey,
        nextInitializationKey: nextSurfaceKey
      })
    ).toBe(true);
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

describe("cached full-local playback load miss recovery", () => {
  it("notifies playback-demand caching once when cache metadata exists but the file cannot be loaded", () => {
    const target = {
      trackId: "track_cached",
      fileHash: "hash_cached",
      cachedFileHash: "hash_cached",
      roomTrack: {
        id: "track_cached",
        fileHash: "hash_cached",
        durationMs: 120_000,
        sizeBytes: 48_000_000
      }
    };
    const notifiedMissKeys = new Set<string>();
    const missKey = getCachedFullLocalPlaybackLoadMissKey(target);

    expect(missKey).toBe("track_cached:hash_cached:hash_cached");
    expect(
      shouldNotifyCachedFullLocalPlaybackLoadMiss({
        target,
        cachedTrackFileLoaded: false,
        notifiedMissKeys
      })
    ).toBe(true);
    notifiedMissKeys.add(missKey!);
    expect(
      shouldNotifyCachedFullLocalPlaybackLoadMiss({
        target,
        cachedTrackFileLoaded: false,
        notifiedMissKeys
      })
    ).toBe(false);
    expect(
      shouldNotifyCachedFullLocalPlaybackLoadMiss({
        target: null,
        cachedTrackFileLoaded: false,
        notifiedMissKeys
      })
    ).toBe(false);
    expect(
      shouldNotifyCachedFullLocalPlaybackLoadMiss({
        target,
        cachedTrackFileLoaded: true,
        notifiedMissKeys
      })
    ).toBe(false);
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
