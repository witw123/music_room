import { createSHA256 } from "hash-wasm";
import {
  deleteLocalAudioFileRecord,
  deleteLocalPlaylistTrack,
  listLocalAudioFiles,
  listLocalPlaylistTracks,
  saveLocalAudioFileRecord,
  saveLocalPlaylistDirectory,
  upsertLocalPlaylistTrack,
  type LocalPlaylistTrackRecord
} from "@/features/library/indexeddb";
import {
  chooseLocalAudioSourceDirectory,
  getConfiguredLocalRepository,
  listLocalAudioFilesInDirectory,
  listSelectedLocalAudioFiles,
  yieldToBrowser
} from "@/features/library/local-audio-storage";
import { readEmbeddedAudioMetadata } from "@/features/library/audio-metadata";
import { createRepositoryTrackRecord } from "@/features/library/local-repository";
import { createLocalPlaylistSourceId } from "./local-playlist-mappers";

export const directoryScanSource = "directory-scan" as const;

let selectedDirectorySyncPromise: Promise<number> | null = null;
let selectedDirectorySyncController: AbortController | null = null;

export async function hashAudioBlob(blob: Blob): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const chunkSize = 4 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    hasher.update(new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer()));
  }
  return hasher.digest("hex");
}

export function inferAudioMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "flac") return "audio/flac";
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a" || extension === "aac") return "audio/mp4";
  if (extension === "ogg" || extension === "opus") return "audio/ogg";
  return "audio/mpeg";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Local directory scan was cancelled.", "AbortError");
  }
}

export async function readDirectoryTrackMetadata(file: File) {
  const fallback = {
    title: file.name.replace(/\.[^/.]+$/, ""),
    artist: "本地歌曲",
    album: null as string | null,
    durationMs: 0,
    artworkUrl: null as string | null,
    lyrics: null as string | null
  };

  const metadata = await readEmbeddedAudioMetadata(file);
  return {
    title: metadata.title ?? fallback.title,
    artist: metadata.artist ?? fallback.artist,
    album: metadata.album ?? fallback.album,
    durationMs: metadata.durationMs ?? fallback.durationMs,
    artworkUrl: metadata.artworkUrl ?? fallback.artworkUrl,
    lyrics: metadata.lyrics ?? fallback.lyrics
  };
}

export function syncSelectedLocalDirectoryTracks(options?: { signal?: AbortSignal }): Promise<number> {
  if (selectedDirectorySyncPromise) return selectedDirectorySyncPromise;

  const controller = new AbortController();
  selectedDirectorySyncController = controller;
  const abortFromCaller = () => controller.abort();
  if (options?.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", abortFromCaller, { once: true });
  }
  const syncPromise = performSelectedLocalDirectorySync({ signal: controller.signal });
  const settledPromise = syncPromise.finally(() => {
    options?.signal?.removeEventListener("abort", abortFromCaller);
    if (selectedDirectorySyncPromise === settledPromise) {
      selectedDirectorySyncPromise = null;
      selectedDirectorySyncController = null;
    }
  });
  selectedDirectorySyncPromise = settledPromise;
  return settledPromise;
}

export function cancelSelectedLocalDirectorySync(): void {
  selectedDirectorySyncController?.abort();
  selectedDirectorySyncController = null;
  selectedDirectorySyncPromise = null;
}

export async function performSelectedLocalDirectorySync(options?: { signal?: AbortSignal }): Promise<number> {
  const selectedFiles = await listSelectedLocalAudioFiles(options);
  if (!selectedFiles) {
    throw new Error("无法读取所选本地目录，请重新授权后重试。");
  }

  const [existingTracks, existingFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listLocalAudioFiles("saved")
  ]);
  const existingByHash = new Map(
    existingTracks
      .filter((track) => !!track.fileHash)
      .map((track) => [track.fileHash!, track])
  );
  const existingByFileName = new Map(
    existingTracks
      .filter((track) => track.source === directoryScanSource && !!track.fileName && !!track.fileHash)
      .map((track) => [track.fileName!, track])
  );
  const scanTimestamp = Date.now();

  const scannedTracks: Array<{ track: LocalPlaylistTrackRecord; fileHash: string; fileName: string }> = [];
  for (const [index, { file, fileName, lastModified }] of selectedFiles.entries()) {
    throwIfAborted(options?.signal);
    const previous = existingByFileName.get(fileName);
    const previousLastModified = previous?.lastModified ?? null;
    const canReuse =
      !!previous?.fileHash &&
      previous.sizeBytes === file.size &&
      previousLastModified !== null &&
      previousLastModified === lastModified;
    const fileHash = canReuse ? previous.fileHash! : await hashAudioBlob(file);
    const existing = existingByHash.get(fileHash) ?? previous;
    const metadata = canReuse
      ? {
          title: previous.title,
          artist: previous.artist,
          album: previous.album,
          durationMs: previous.durationMs,
          artworkUrl: previous.artworkUrl,
          lyrics: previous.lyrics
        }
      : await readDirectoryTrackMetadata(file);
    // IndexedDB returns tracks by updatedAt descending, so earlier scan entries get later timestamps.
    const now = existing?.updatedAt ?? new Date(scanTimestamp - index).toISOString();
    scannedTracks.push({
      track: {
        id: `local-file:${fileHash}`,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        durationMs: metadata.durationMs,
        mimeType: file.type || inferAudioMimeType(file.name),
        sizeBytes: file.size,
        artworkUrl: metadata.artworkUrl,
        lyrics: metadata.lyrics,
        provider: "local_upload" as const,
        providerTrackId: null,
        fileHash,
        fileName,
        lastModified,
        availableOffline: true,
        source: directoryScanSource,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      } satisfies LocalPlaylistTrackRecord,
      fileHash,
      fileName
    });
    await yieldToBrowser();
  }

  const currentHashes = new Set(scannedTracks.map((item) => item.fileHash));
  const staleTracks = existingTracks.filter(
    (track) => track.source === directoryScanSource && !!track.fileHash && !currentHashes.has(track.fileHash)
  );
  const staleFiles = existingFiles.filter(
    (file) => file.source === directoryScanSource && !currentHashes.has(file.fileHash)
  );

  await Promise.all([
    ...staleTracks.map((track) => deleteLocalPlaylistTrack(track.id)),
    ...staleFiles.map((file) => deleteLocalAudioFileRecord(file.fileHash, "saved"))
  ]);
  for (const { track, fileHash, fileName } of scannedTracks) {
    throwIfAborted(options?.signal);
    await Promise.all([
      upsertLocalPlaylistTrack(track, { persistRepository: false }),
      saveLocalAudioFileRecord({
        fileHash,
        fileName,
        lastModified: track.lastModified,
        storageKind: "saved",
        source: directoryScanSource
      })
    ]);
    await yieldToBrowser();
  }

  const repository = await getConfiguredLocalRepository();
  if (repository) {
    const repositoryTracks = await repository.listTracks();
    const staleRepositoryTracks = repositoryTracks.filter(
      (track) =>
        track.retention === "library" &&
        track.source.kind === "external" &&
        !!track.source.relativePath &&
        !currentHashes.has(track.fileHash)
    );
    for (const track of staleRepositoryTracks) {
      throwIfAborted(options?.signal);
      await repository.deleteTrack(track.fileHash, { updateCatalog: false });
    }
    for (const { track, fileName } of scannedTracks) {
      throwIfAborted(options?.signal);
      await repository.writeTrack(
        createRepositoryTrackRecord({
          fileHash: track.fileHash!,
          title: track.title,
          artist: track.artist,
          album: track.album,
          artworkUrl: track.artworkUrl,
          lyrics: track.lyrics,
          provider: track.provider,
          mimeType: track.mimeType,
          durationMs: track.durationMs,
          sizeBytes: track.sizeBytes,
          source: {
            kind: "external",
            relativePath: fileName,
            sizeBytes: track.sizeBytes,
            lastModified: track.lastModified
          },
          retention: "library"
        }),
        { updateCatalog: false }
      );
    }
    await repository.commitCatalogChanges();
  }

  return scannedTracks.length;
}

export async function importLocalPlaylistDirectoryTracks(existingSourceDirectoryId?: string | null) {
  const directory = await chooseLocalAudioSourceDirectory();
  const selectedFiles = await listLocalAudioFilesInDirectory(directory);
  if (!selectedFiles) {
    throw new Error("无法读取所选本地目录，请重新授权后重试。");
  }

  const sourceDirectoryId = existingSourceDirectoryId || createLocalPlaylistSourceId();
  await saveLocalPlaylistDirectory({
    id: sourceDirectoryId,
    handle: directory,
    name: directory.name
  });

  const selectedFilesWithHashes: Array<(typeof selectedFiles)[number] & { fileHash: string }> = [];
  for (const entry of selectedFiles) {
    const fileHash = await hashAudioBlob(entry.file);
    selectedFilesWithHashes.push({ ...entry, fileHash });
    await yieldToBrowser();
  }
  const currentHashes = new Set(selectedFilesWithHashes.map((entry) => entry.fileHash));
  const [existingTracks, existingFiles] = await Promise.all([
    listLocalPlaylistTracks(),
    listLocalAudioFiles("saved")
  ]);
  const staleFileHashes = new Set(
    existingFiles
      .filter((file) => file.sourceDirectoryId === sourceDirectoryId && !currentHashes.has(file.fileHash))
      .map((file) => file.fileHash)
  );
  const sharedStaleFileHashes = new Set(
    existingTracks
      .filter(
        (track) =>
          !!track.fileHash &&
          staleFileHashes.has(track.fileHash) &&
          track.sourceDirectoryId !== sourceDirectoryId
      )
      .map((track) => track.fileHash!)
  );
  await Promise.all([
    ...existingTracks
      .filter(
        (track) =>
          track.sourceDirectoryId === sourceDirectoryId &&
          !!track.fileHash &&
          !currentHashes.has(track.fileHash)
      )
      .map((track) => deleteLocalPlaylistTrack(track.id)),
    ...existingFiles
      .filter(
        (file) =>
          file.sourceDirectoryId === sourceDirectoryId &&
          !currentHashes.has(file.fileHash) &&
          !sharedStaleFileHashes.has(file.fileHash)
      )
      .map((file) => deleteLocalAudioFileRecord(file.fileHash, "saved"))
  ]);

  const importedTracks: LocalPlaylistTrackRecord[] = [];
  for (const { file, fileName, fileHash, lastModified } of selectedFilesWithHashes) {
    const metadata = await readDirectoryTrackMetadata(file);
    const mimeType = file.type || inferAudioMimeType(file.name);
    const now = new Date().toISOString();
    const track: LocalPlaylistTrackRecord = {
      id: `local-file:${sourceDirectoryId}:${fileHash}`,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      durationMs: metadata.durationMs,
      mimeType,
      sizeBytes: file.size,
      artworkUrl: metadata.artworkUrl,
      lyrics: metadata.lyrics,
      provider: "local_upload",
      providerTrackId: null,
      fileHash,
      fileName,
      lastModified,
      sourceDirectoryId,
      availableOffline: true,
      createdAt: now,
      updatedAt: now
    };
    await saveLocalAudioFileRecord({
      fileHash,
      fileName,
      lastModified,
      storageKind: "saved",
      sourceDirectoryId
    });
    await upsertLocalPlaylistTrack(track);
    importedTracks.push(track);
    await yieldToBrowser();
  }
  return {
    sourceDirectoryId,
    directoryName: directory.name,
    tracks: importedTracks
  };
}
