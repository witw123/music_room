import { beforeEach, describe, expect, it, vi } from "vitest";

const indexedDbMocks = vi.hoisted(() => ({
  getAssetManifest: vi.fn(),
  getAssetUnit: vi.fn(),
  getTrackAssetLink: vi.fn(),
  upsertCachedLibraryTrack: vi.fn()
}));

const apiMocks = vi.hoisted(() => ({
  musicRoomApi: {
    downloadNeteaseTrack: vi.fn(),
    downloadQqMusicTrack: vi.fn(),
    getNeteaseLyrics: vi.fn(),
    getQqMusicLyrics: vi.fn()
  },
  resolveDownloadedAudioMimeType: vi.fn()
}));

const storageMocks = vi.hoisted(() => ({
  saveCachedAudioFileToLocalDirectory: vi.fn()
}));

const cacheLibraryMocks = vi.hoisted(() => ({
  buildCachedLibraryTrackUpsertRecord: vi.fn(),
  notifyCacheLibraryChanged: vi.fn()
}));

vi.mock("@/lib/storage/indexeddb", () => indexedDbMocks);
vi.mock("@/lib/network/music-room-api", () => apiMocks);
vi.mock("@/features/library/local-audio-storage", () => storageMocks);
vi.mock("@/features/library/cache-library", () => cacheLibraryMocks);
vi.mock("@/features/library/audio-asset-builder", () => ({
  playbackEncoderVersion: "3.4.0",
  playbackProfileId: "opus-music-v4"
}));

import type { PlaybackAssetManifest, RoomSnapshot, TrackMeta } from "@music-room/shared";
import { ensureOfflineProviderPlaybackAsset } from "./offline-source-fallback";

function buildTrack(overrides: Partial<TrackMeta> = {}) {
  return {
    id: "track_1",
    title: "Song",
    artist: "Artist",
    album: null,
    durationMs: 2_000,
    bitrate: null,
    sizeBytes: 5,
    codec: "mp3",
    mimeType: "audio/mpeg",
    fileHash: "b".repeat(64),
    artworkUrl: null,
    ownerSessionId: "owner_1",
    ownerNickname: "Owner",
    sourceType: "netease" as const,
    sourceRef: { provider: "netease" as const, trackId: "123" },
    ...overrides
  } satisfies TrackMeta;
}

function buildRoomSnapshot(track = buildTrack()) {
  return {
    room: {
      id: "room_1",
      playback: {
        status: "playing",
        currentTrackId: track.id,
        currentQueueItemId: null,
        sourceSessionId: track.ownerSessionId,
        sourcePeerId: "peer_owner",
        sourceTrackId: track.id,
        playbackAssetId: track.playbackAsset?.assetId ?? null,
        positionMs: 0,
        startedAt: "2026-07-24T00:00:00.000Z",
        startAt: "2026-07-24T00:00:00.000Z",
        playbackRevision: 1,
        mediaEpoch: 1,
        playbackMode: "sequence",
        queueVersion: 1,
        mediaState: "playing"
      },
      members: []
    },
    tracks: [track],
    queue: []
  } as unknown as RoomSnapshot;
}

function buildSource() {
  return {
    provider: "netease" as const,
    trackId: "123",
    label: "网易云音乐"
  };
}

function buildManifest(): PlaybackAssetManifest {
  return {
    assetId: "a".repeat(64),
    kind: "playback",
    sourceFileHash: "b".repeat(64),
    profileId: "opus-music-v4",
    codec: "opus",
    container: "audio/ogg",
    sampleRate: 48_000,
    channels: 2,
    bitrate: 256_000,
    durationMs: 2_000,
    segmentDurationMs: 2_000,
    seekPrerollMs: 80,
    unitCount: 1,
    merkleRoot: "c".repeat(64),
    encoder: {
      name: "@audio/opus-encode",
      version: "3.4.0"
    }
  };
}

function buildInput(overrides: Partial<Parameters<typeof ensureOfflineProviderPlaybackAsset>[0]> = {}) {
  return {
    roomSnapshot: buildRoomSnapshot(),
    track: buildTrack(),
    source: buildSource(),
    ...overrides
  };
}

describe("offline provider fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    indexedDbMocks.getTrackAssetLink.mockResolvedValue(null);
    indexedDbMocks.getAssetManifest.mockResolvedValue(null);
    indexedDbMocks.getAssetUnit.mockResolvedValue(null);
    apiMocks.musicRoomApi.getNeteaseLyrics.mockResolvedValue({ plainLyric: null });
    apiMocks.resolveDownloadedAudioMimeType.mockResolvedValue("audio/mpeg");
    storageMocks.saveCachedAudioFileToLocalDirectory.mockResolvedValue(null);
    cacheLibraryMocks.buildCachedLibraryTrackUpsertRecord.mockReturnValue({});
  });

  it("returns a complete local playback asset without downloading", async () => {
    const manifest = buildManifest();
    indexedDbMocks.getTrackAssetLink.mockResolvedValue({
      originalAssetId: "d".repeat(64),
      playbackAssetId: manifest.assetId
    });
    indexedDbMocks.getAssetManifest.mockResolvedValue({
      complete: true,
      manifest
    });
    indexedDbMocks.getAssetUnit.mockResolvedValue({
      unitIndex: 0,
      payloadBytes: 1,
      payload: new Uint8Array([1]).buffer
    });

    await expect(ensureOfflineProviderPlaybackAsset(buildInput())).resolves.toEqual({
      playbackAsset: manifest,
      fileHash: manifest.sourceFileHash,
      file: null
    });
    expect(apiMocks.musicRoomApi.downloadNeteaseTrack).not.toHaveBeenCalled();
  });

  it("falls back to an existing segmented asset when forced provider caching fails", async () => {
    const manifest = buildManifest();
    indexedDbMocks.getTrackAssetLink.mockResolvedValue({
      originalAssetId: "d".repeat(64),
      playbackAssetId: manifest.assetId
    });
    indexedDbMocks.getAssetManifest.mockResolvedValue({
      complete: true,
      manifest
    });
    indexedDbMocks.getAssetUnit.mockResolvedValue({
      unitIndex: 0,
      payloadBytes: 1,
      payload: new Uint8Array([1]).buffer
    });
    apiMocks.musicRoomApi.downloadNeteaseTrack.mockRejectedValue(
      new Error("NetEase account is not available.")
    );

    await expect(ensureOfflineProviderPlaybackAsset({
      ...buildInput(),
      forceDownload: true
    })).resolves.toEqual({
      playbackAsset: manifest,
      fileHash: manifest.sourceFileHash,
      file: null
    });
  });

  it("keeps a shared download alive when the first caller is cancelled", async () => {
    let resolveDownload!: (value: { blob: Blob; contentType: string }) => void;
    const download = new Promise<{ blob: Blob; contentType: string }>((resolve) => {
      resolveDownload = resolve;
    });
    apiMocks.musicRoomApi.downloadNeteaseTrack.mockReturnValue(download);

    const controller = new AbortController();
    const first = ensureOfflineProviderPlaybackAsset({
      ...buildInput(),
      signal: controller.signal
    });
    await vi.waitFor(() => expect(apiMocks.musicRoomApi.downloadNeteaseTrack).toHaveBeenCalledOnce());
    controller.abort();

    const second = ensureOfflineProviderPlaybackAsset(buildInput());
    resolveDownload({
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      contentType: "audio/mpeg"
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.file).toBeInstanceOf(File);
    expect(secondResult.file).toBe(firstResult.file);
    expect(apiMocks.musicRoomApi.downloadNeteaseTrack).toHaveBeenCalledOnce();
  });
});
