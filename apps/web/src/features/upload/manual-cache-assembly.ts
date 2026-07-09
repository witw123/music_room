import type { TrackMeta } from "@music-room/shared";
import type { ManualCacheTask } from "./upload-ui-state";

type CachedTrackPiece = {
  chunkIndex: number;
  payload: ArrayBuffer;
};

type ManualCacheTaskPatch =
  | Partial<ManualCacheTask>
  | ((current: ManualCacheTask | null) => Partial<ManualCacheTask> | null);

type AssembleTrackFileResult = {
  file: File;
} | null;

type AssembleManualCacheTrackInput = {
  manualTrackCachingEnabled: boolean;
  assemblingTrackIds: Set<string>;
  trackId: string;
  mimeType: string | null;
  totalChunks: number;
  roomId: string | null | undefined;
  roomTracks: TrackMeta[];
  peerId: string;
  localCacheOwnerKey: string;
  updateManualCacheTask: (trackId: string, patch: ManualCacheTaskPatch) => void;
  getCachedPiecesForTrack: (
    trackId: string,
    peerId: string,
    options?: { fileHash?: string; ownerKey?: string; chunkSize?: number }
  ) => Promise<CachedTrackPiece[]>;
  assembleTrackFileFromPieces: (input: {
    pieces: CachedTrackPiece[];
    totalChunks: number;
    mimeType: string;
    title: string;
    expectedFileHash: string;
  }) => Promise<AssembleTrackFileResult>;
  persistTrackIntoLibrary: (input: {
    track: Pick<
      TrackMeta,
      | "id"
      | "title"
      | "artist"
      | "mimeType"
      | "durationMs"
      | "sizeBytes"
      | "fileHash"
      | "ownerNickname"
    >;
    roomId: string;
    file: File | Blob;
  }) => Promise<void>;
  deleteCachedPiecesForTrack: (trackId: string) => Promise<unknown>;
  onCachedPiecesConsumed: (trackId: string) => void;
  onCachedPiecesRetained?: (trackId: string) => void;
  retainCachedPiecesAfterAssembly?: boolean;
  announceRoomTrackAvailability: (trackId: string) => void;
  setStatusMessage: (message: string) => void;
};

export async function assembleManualCacheTrackFromPieces(
  input: AssembleManualCacheTrackInput
) {
  if (
    !input.manualTrackCachingEnabled ||
    !input.roomId ||
    input.assemblingTrackIds.has(input.trackId)
  ) {
    return;
  }

  input.assemblingTrackIds.add(input.trackId);
  let trackTitle = input.trackId;
  try {
    const track = input.roomTracks.find((entry) => entry.id === input.trackId);
    if (!track) {
      return;
    }
    trackTitle = track.title;

    input.updateManualCacheTask(input.trackId, {
      status: "assembling",
      errorMessage: null,
      blockedReason: null,
      totalChunks: input.totalChunks,
      completedChunks: input.totalChunks,
      mimeType: input.mimeType
    });

    const expectedManifest = track.relayManifest ?? track.pieceManifest ?? null;
    const pieces = await input.getCachedPiecesForTrack(input.trackId, input.peerId, {
      fileHash: track.fileHash,
      ownerKey: input.localCacheOwnerKey,
      chunkSize: expectedManifest?.chunkSize
    });
    if (pieces.length < input.totalChunks) {
      input.updateManualCacheTask(input.trackId, (current) =>
        current && current.status !== "paused"
          ? {
              status: "downloading",
              completedChunks: pieces.length,
              totalChunks: input.totalChunks,
              mimeType: input.mimeType
            }
          : null
      );
      return;
    }

    const assembled = await input.assembleTrackFileFromPieces({
      pieces,
      totalChunks: input.totalChunks,
      mimeType: input.mimeType || track.mimeType || "audio/mpeg",
      title: track.title,
      expectedFileHash: track.fileHash
    });

    if (!assembled) {
      input.updateManualCacheTask(input.trackId, {
        status: "failed-integrity",
        errorMessage: "文件组装或完整性校验失败",
        completedChunks: pieces.length,
        totalChunks: input.totalChunks,
        mimeType: input.mimeType,
        lastError: "integrity-mismatch"
      });
      input.setStatusMessage(
        `曲目 ${track.title} 的缓存完整性校验失败，等待新的可用来源后重试。`
      );
      return;
    }

    await input.persistTrackIntoLibrary({
      track,
      roomId: input.roomId,
      file: assembled.file
    });
    if (input.retainCachedPiecesAfterAssembly) {
      input.onCachedPiecesRetained?.(input.trackId);
    } else {
      await input.deleteCachedPiecesForTrack(input.trackId);
      input.onCachedPiecesConsumed(input.trackId);
    }
    input.updateManualCacheTask(input.trackId, {
      status: "ready",
      errorMessage: null,
      blockedReason: null,
      completedChunks: input.totalChunks,
      totalChunks: input.totalChunks,
      mimeType: input.mimeType || assembled.file.type || track.mimeType || null,
      lastError: null
    });
    input.announceRoomTrackAvailability(input.trackId);
    input.setStatusMessage(`已缓存《${track.title}》。`);
  } catch (error) {
    const errorMessage = `缓存组装失败：${formatAssemblyError(error)}`;
    input.updateManualCacheTask(input.trackId, (current) => {
      if (current?.status === "paused" || current?.status === "ready") {
        return null;
      }

      return {
        status: "failed",
        errorMessage,
        blockedReason: null,
        completedChunks: current?.completedChunks ?? 0,
        totalChunks: Math.max(current?.totalChunks ?? 0, input.totalChunks),
        mimeType: input.mimeType ?? current?.mimeType ?? null,
        lastError: "assembly-failed"
      };
    });
    input.setStatusMessage(`曲目 ${trackTitle} 的缓存组装失败，可稍后重试。`);
  } finally {
    input.assemblingTrackIds.delete(input.trackId);
  }
}

function formatAssemblyError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "unknown-error");
}
