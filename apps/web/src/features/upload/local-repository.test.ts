import { describe, expect, it } from "vitest";
import {
  createRepositoryTrackRecord,
  LocalRepository
} from "./local-repository";

class MemoryFileHandle {
  readonly kind = "file" as const;
  blob = new Blob();

  constructor(public readonly name: string) {}

  async getFile() {
    return new File([this.blob], this.name);
  }

  async createWritable() {
    let pending = this.blob;
    return {
      write: async (value: Blob | string) => {
        pending = typeof value === "string" ? new Blob([value]) : value;
      },
      close: async () => {
        this.blob = pending;
      },
      abort: async () => undefined
    };
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  private readonly directories = new Map<string, MemoryDirectoryHandle>();
  private readonly files = new Map<string, MemoryFileHandle>();

  constructor(public readonly name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const directory = new MemoryDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const file = new MemoryFileHandle(name);
    this.files.set(name, file);
    return file;
  }

  async removeEntry(name: string) {
    if (this.files.delete(name) || this.directories.delete(name)) return;
    throw new DOMException("missing", "NotFoundError");
  }

  async *values() {
    yield* this.directories.values();
    yield* this.files.values();
  }
}

describe("LocalRepository", () => {
  it("creates a repository and persists source, track, and playlist records", async () => {
    const root = new MemoryDirectoryHandle("Music Room") as unknown as FileSystemDirectoryHandle;
    const repository = await LocalRepository.open(root);
    const sourcePath = await repository.writeManagedSource({
      file: new Blob(["audio"], { type: "audio/mpeg" }),
      fileHash: "a".repeat(64),
      mimeType: "audio/mpeg"
    });
    const track = createRepositoryTrackRecord({
      fileHash: "a".repeat(64),
      title: "Song",
      artist: "Artist",
      mimeType: "audio/mpeg",
      durationMs: 1_000,
      sizeBytes: 5,
      source: { kind: "managed", relativePath: sourcePath },
      retention: "library"
    });
    await repository.writeTrack(track);
    await repository.writePlaylist({
      schemaVersion: 1,
      id: "playlist-1",
      title: "Favorites",
      description: null,
      trackRefs: [{ kind: "content", fileHash: "a".repeat(64) }],
      createdAt: track.createdAt,
      updatedAt: track.updatedAt
    });

    expect(await repository.readPath(sourcePath)).not.toBeNull();
    expect((await repository.listTracks()).map((item) => item.fileHash)).toEqual(["a".repeat(64)]);
    expect((await repository.listPlaylists()).map((item) => item.id)).toEqual(["playlist-1"]);
  });

  it("persists playback units under the profile and asset id", async () => {
    const root = new MemoryDirectoryHandle("Music Room") as unknown as FileSystemDirectoryHandle;
    const repository = await LocalRepository.open(root);
    const assetId = "b".repeat(64);
    const sourceFileHash = "c".repeat(64);
    const manifest = {
      assetId,
      kind: "playback" as const,
      sourceFileHash,
      profileId: "opus-music-v2" as const,
      codec: "opus" as const,
      container: "audio/ogg" as const,
      sampleRate: 48_000 as const,
      channels: 1 as const,
      bitrate: 96_000 as const,
      durationMs: 2_000,
      segmentDurationMs: 2_000 as const,
      seekPrerollMs: 80 as const,
      unitCount: 1,
      merkleRoot: "d".repeat(64),
      encoder: { name: "@audio/opus-encode" as const, version: "2.0.0" as const }
    };
    const descriptor = {
      assetId,
      kind: "playback" as const,
      unitIndex: 0,
      payloadBytes: 3,
      contentHash: "e".repeat(64),
      proof: [],
      startMs: 0,
      durationMs: 2_000,
      trimStartSamples: 0,
      trimEndSamples: 0
    };
    await repository.writePlaybackAsset({
      manifest,
      units: [{ descriptor, payload: new Uint8Array([1, 2, 3]).buffer }]
    });

    const persisted = await repository.listPlaybackAssets();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.manifest.assetId).toBe(assetId);
    const file = await repository.readPlaybackUnit(persisted[0]!.units[0]!);
    expect(file).not.toBeNull();
    expect([...new Uint8Array(await file!.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
