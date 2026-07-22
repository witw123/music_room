import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMocks = vi.hoisted(() => ({
  deleteCachedLibraryTrackFile: vi.fn(),
  deleteOriginalAssetForTrack: vi.fn(),
  deleteLocalAudioCacheFileRecord: vi.fn(),
  getAssetManifest: vi.fn(),
  getAssetUnits: vi.fn(),
  getCachedLibraryTrack: vi.fn(),
  getCachedLibraryTrackSummary: vi.fn(),
  getLocalAudioDirectory: vi.fn(),
  getLocalAudioFileRecord: vi.fn(),
  getLocalAudioCacheFileRecord: vi.fn(),
  getTrackAssetLink: vi.fn(),
  listCachedLibraryTracks: vi.fn(),
  listCachedLibraryTrackSummaries: vi.fn(),
  listLocalAudioCacheFiles: vi.fn(),
  listLocalAudioFiles: vi.fn(),
  saveLocalAudioCacheFileRecord: vi.fn(),
  saveLocalAudioDirectory: vi.fn(),
  saveLocalAudioFileRecord: vi.fn()
}));

vi.mock("@/lib/indexeddb", () => indexedDbMocks);

import {
  ensureLocalAudioDirectoryWriteAccess,
  getOriginalAssetFile,
  getRoomLocalAudioFile,
  saveCachedAudioFileToLocalDirectory
} from "./local-audio-storage";

function createDirectoryHandle(input: {
  queryPermission: PermissionState;
  requestPermission: PermissionState;
}) {
  const writable = {
    write: vi.fn(),
    close: vi.fn(),
    abort: vi.fn()
  };
  const fileHandle = {
    createWritable: vi.fn().mockResolvedValue(writable)
  };
  const cacheDirectory = {
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn().mockImplementation(async (_name, options) => {
      if (!options?.create) {
        throw new DOMException("missing", "NotFoundError");
      }
      return fileHandle;
    }),
    removeEntry: vi.fn()
  };
  cacheDirectory.getDirectoryHandle.mockResolvedValue(cacheDirectory);
  const handle = {
    name: "Music Room",
    queryPermission: vi.fn().mockResolvedValue(input.queryPermission),
    requestPermission: vi.fn().mockResolvedValue(input.requestPermission),
    getDirectoryHandle: vi.fn().mockResolvedValue(cacheDirectory),
    getFileHandle: vi.fn().mockRejectedValue(new DOMException("missing", "NotFoundError"))
  };
  return { handle, writable };
}

describe("local audio cache persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    indexedDbMocks.getLocalAudioDirectory.mockResolvedValue(null);
    indexedDbMocks.getLocalAudioFileRecord.mockResolvedValue(null);
    indexedDbMocks.getCachedLibraryTrack.mockResolvedValue(null);
    indexedDbMocks.getTrackAssetLink.mockResolvedValue(null);
    indexedDbMocks.getCachedLibraryTrackSummary.mockResolvedValue(null);
  });

  it("uses the browser library copy for room-local playback", async () => {
    const file = new Blob(["audio"], { type: "audio/mpeg" });
    indexedDbMocks.getCachedLibraryTrack.mockResolvedValue({ file });

    await expect(getRoomLocalAudioFile({
      trackId: "track_1",
      fileHash: "hash_1",
      title: "Song",
      mimeType: "audio/mpeg"
    })).resolves.toBe(file);
  });

  it("rebuilds an owner source file from a complete original asset", async () => {
    indexedDbMocks.getAssetManifest.mockResolvedValue({
      kind: "original",
      complete: true,
      manifest: {
        assetId: "asset_1",
        kind: "original",
        fileHash: "hash_1",
        mimeType: "audio/mpeg",
        sizeBytes: 5,
        unitSize: 1024 * 1024,
        unitCount: 2,
        merkleRoot: "root_1"
      }
    });
    indexedDbMocks.getAssetUnits.mockResolvedValue([
      { unitIndex: 1, payload: new Uint8Array([3, 4]).buffer },
      { unitIndex: 0, payload: new Uint8Array([1, 2]).buffer }
    ]);

    const file = await getOriginalAssetFile({
      assetId: "asset_1",
      fileHash: "hash_1",
      title: "Song",
      mimeType: "audio/mpeg"
    });

    expect(file).not.toBeNull();
    expect(file?.name).toBe("Song [hash_1].mp3");
    expect([...new Uint8Array(await file!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  it("keeps IndexedDB as the normal fallback when no folder is configured", async () => {
    await expect(saveCachedAudioFileToLocalDirectory({
      file: new Blob(["audio"], { type: "audio/mpeg" }),
      fileHash: "hash_1",
      title: "Song",
      mimeType: "audio/mpeg"
    })).resolves.toBeNull();

    expect(indexedDbMocks.saveLocalAudioCacheFileRecord).not.toHaveBeenCalled();
    expect(indexedDbMocks.deleteCachedLibraryTrackFile).not.toHaveBeenCalled();
  });

  it("writes to cache and removes the browser source copy when a folder is configured", async () => {
    const { handle, writable } = createDirectoryHandle({
      queryPermission: "granted",
      requestPermission: "granted"
    });
    indexedDbMocks.getLocalAudioDirectory.mockResolvedValue({
      handle,
      name: "Music Room"
    });
    const file = new Blob(["audio"], { type: "audio/mpeg" });

    await expect(saveCachedAudioFileToLocalDirectory({
      file,
      fileHash: "hash_1",
      title: "Song",
      mimeType: "audio/mpeg"
    })).resolves.toMatchObject({ fileName: "Song [hash_1].mp3" });

    expect(writable.write).toHaveBeenCalledWith(file);
    expect(indexedDbMocks.saveLocalAudioCacheFileRecord).toHaveBeenCalledWith({
      fileHash: "hash_1",
      fileName: "Song [hash_1].mp3",
      relativePath: ".music-room/cache/provider/local_upload/ha/hash_1.mp3"
    });
    expect(indexedDbMocks.deleteCachedLibraryTrackFile).toHaveBeenCalledWith("hash_1");
  });

  it("fails instead of falling back when the configured folder is not writable", async () => {
    const { handle } = createDirectoryHandle({
      queryPermission: "denied",
      requestPermission: "denied"
    });
    indexedDbMocks.getLocalAudioDirectory.mockResolvedValue({
      handle,
      name: "Music Room"
    });

    await expect(ensureLocalAudioDirectoryWriteAccess()).rejects.toThrow(
      "请重新选择根文件夹"
    );
    expect(indexedDbMocks.deleteCachedLibraryTrackFile).not.toHaveBeenCalled();
  });
});
