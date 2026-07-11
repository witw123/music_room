import { getCachedPiece, localCacheOwnerKey } from "@/lib/indexeddb";
import type { ProgressiveTrackManifest } from "./progressive-playback";

type EngineStatus = "idle" | "opening" | "ready" | "failed" | "destroyed";
const maxCachedPiecesToQueuePerSync = 16;
const maxQueuedCachedPieces = 32;
const retainedPlaybackHistorySeconds = 30;

export class ProgressiveMseEngine {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private objectUrl: string | null = null;
  private status: EngineStatus = "idle";
  private appendQueue: Array<{ chunkIndex: number; payload: ArrayBuffer }> = [];
  private queuedChunkIndexes = new Set<number>();
  private appendedChunkCount = 0;
  private activeAppend: { chunkIndex: number; payload: ArrayBuffer } | null = null;
  private removingOldBuffer = false;
  private quotaRetryChunkIndex: number | null = null;
  private syncing = false;
  private syncRequested = false;
  private readonly handleSourceOpen = () => {
    if (!this.mediaSource || this.mediaSource.readyState !== "open" || this.status === "destroyed") {
      return;
    }

    try {
      this.sourceBuffer = this.mediaSource.addSourceBuffer(this.manifest.mimeType);
      this.sourceBuffer.mode = "sequence";
      if (Number.isFinite(this.manifest.durationMs) && this.manifest.durationMs > 0) {
        this.mediaSource.duration = this.manifest.durationMs / 1000;
      }
      this.sourceBuffer.addEventListener("updateend", this.handleUpdateEnd);
      this.sourceBuffer.addEventListener("error", this.handleSourceBufferError);
      this.status = "ready";
      void this.sync();
    } catch {
      this.status = "failed";
    }
  };
  private readonly handleUpdateEnd = () => {
    if (this.removingOldBuffer) {
      this.removingOldBuffer = false;
    } else if (this.activeAppend) {
      this.appendedChunkCount = Math.max(
        this.appendedChunkCount,
        this.activeAppend.chunkIndex + 1
      );
      this.queuedChunkIndexes.delete(this.activeAppend.chunkIndex);
      this.quotaRetryChunkIndex = null;
      this.activeAppend = null;
    }
    this.pumpAppendQueue();
  };
  private readonly handleSourceBufferError = () => {
    this.status = "failed";
  };

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly peerId: string,
    private readonly manifest: ProgressiveTrackManifest
  ) {}

  get engineStatus() {
    return this.status;
  }

  get ready() {
    return this.status === "ready";
  }

  getBufferedAheadMs(positionSeconds = this.audio.currentTime) {
    const normalizedPositionSeconds = Number.isFinite(positionSeconds)
      ? Math.max(0, positionSeconds)
      : 0;
    const mediaBufferedEndSeconds = getBufferedCoverageEndSeconds(
      this.audio.buffered,
      normalizedPositionSeconds
    );
    return Math.max(
      0,
      Math.floor((mediaBufferedEndSeconds - normalizedPositionSeconds) * 1000)
    );
  }

  isPlaybackReady(positionSeconds = this.audio.currentTime, minimumAheadMs = 1) {
    return (
      this.status === "ready" &&
      this.getBufferedAheadMs(positionSeconds) >= Math.max(0, minimumAheadMs)
    );
  }

  async attach() {
    if (this.status !== "idle") {
      return this.status === "ready";
    }

    try {
      this.status = "opening";
      this.mediaSource = new MediaSource();
      this.objectUrl = URL.createObjectURL(this.mediaSource);
      this.mediaSource.addEventListener("sourceopen", this.handleSourceOpen);
      this.audio.src = this.objectUrl;
      this.audio.load();
      return true;
    } catch {
      this.status = "failed";
      if (this.mediaSource) {
        this.mediaSource.removeEventListener("sourceopen", this.handleSourceOpen);
      }
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
      }
      this.mediaSource = null;
      this.objectUrl = null;
      return false;
    }
  }

  async sync() {
    if (this.status === "destroyed" || this.status === "failed") {
      return;
    }

    if (this.syncing) {
      this.syncRequested = true;
      return;
    }

    this.syncing = true;

    try {
      if (!this.sourceBuffer || this.status !== "ready") {
        return;
      }

      const cacheOptions = {
        fileHash: this.manifest.fileHash,
        ownerKey: localCacheOwnerKey,
        chunkSize: this.manifest.chunkSize
      };
      let nextChunkIndex = this.appendedChunkCount;
      let queuedPiecesThisSync = 0;

      while (
        nextChunkIndex < this.manifest.totalChunks &&
        queuedPiecesThisSync < maxCachedPiecesToQueuePerSync &&
        this.appendQueue.length < maxQueuedCachedPieces
      ) {
        if (this.queuedChunkIndexes.has(nextChunkIndex)) {
          nextChunkIndex += 1;
          continue;
        }

        const piece = await getCachedPiece(
          this.manifest.trackId,
          this.peerId,
          nextChunkIndex,
          cacheOptions
        );
        if (!this.sourceBuffer || this.status !== "ready") {
          return;
        }
        if (!piece) {
          break;
        }

        this.appendQueue.push({
          chunkIndex: piece.chunkIndex,
          payload: piece.payload.slice(0)
        });
        this.queuedChunkIndexes.add(piece.chunkIndex);
        nextChunkIndex += 1;
        queuedPiecesThisSync += 1;
      }

      this.pumpAppendQueue();
    } catch {
      if (!isDestroyedEngineStatus(this.status)) {
        this.status = "failed";
      }
    } finally {
      this.syncing = false;
      if (this.syncRequested) {
        this.syncRequested = false;
        queueMicrotask(() => {
          void this.sync();
        });
      }
    }
  }

  destroy() {
    this.status = "destroyed";
    this.appendQueue = [];
    this.queuedChunkIndexes.clear();
    this.activeAppend = null;
    this.removingOldBuffer = false;
    this.quotaRetryChunkIndex = null;

    if (this.sourceBuffer) {
      this.sourceBuffer.removeEventListener("updateend", this.handleUpdateEnd);
      this.sourceBuffer.removeEventListener("error", this.handleSourceBufferError);
    }

    if (this.mediaSource) {
      this.mediaSource.removeEventListener("sourceopen", this.handleSourceOpen);
    }

    if (this.audio.src && this.objectUrl && this.audio.src === this.objectUrl) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }

    this.sourceBuffer = null;
    this.mediaSource = null;
    this.objectUrl = null;
  }

  private pumpAppendQueue() {
    if (!this.sourceBuffer || this.sourceBuffer.updating) {
      return;
    }

    if (this.removeExpiredBuffer()) {
      return;
    }

    const nextPiece = this.appendQueue.shift();
    if (!nextPiece) {
      if (
        this.mediaSource?.readyState === "open" &&
        this.appendedChunkCount >= this.manifest.totalChunks
      ) {
        try {
          this.mediaSource.endOfStream();
        } catch {
          // noop
        }
      }
      return;
    }

    try {
      this.activeAppend = nextPiece;
      this.sourceBuffer.appendBuffer(nextPiece.payload.slice(0));
    } catch (error) {
      this.activeAppend = null;
      this.appendQueue.unshift(nextPiece);
      if (
        isQuotaExceededError(error) &&
        this.quotaRetryChunkIndex !== nextPiece.chunkIndex
      ) {
        this.quotaRetryChunkIndex = nextPiece.chunkIndex;
        if (this.removeExpiredBuffer(true)) {
          return;
        }
      }
      this.status = "failed";
    }
  }

  private removeExpiredBuffer(force = false) {
    const sourceBuffer = this.sourceBuffer;
    if (!sourceBuffer || sourceBuffer.updating || this.removingOldBuffer) {
      return false;
    }

    const removeBeforeSeconds = Math.max(
      0,
      (Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0) -
        retainedPlaybackHistorySeconds
    );
    const buffered = sourceBuffer.buffered;
    if (removeBeforeSeconds <= 0 || !buffered || buffered.length === 0) {
      return false;
    }

    const bufferedStart = buffered.start(0);
    if (!force && bufferedStart >= removeBeforeSeconds - 1) {
      return false;
    }

    const removeEnd = Math.min(removeBeforeSeconds, buffered.end(0));
    if (!Number.isFinite(removeEnd) || removeEnd <= bufferedStart) {
      return false;
    }

    try {
      this.removingOldBuffer = true;
      sourceBuffer.remove(bufferedStart, removeEnd);
      return true;
    } catch {
      this.removingOldBuffer = false;
      return false;
    }
  }
}

function getBufferedCoverageEndSeconds(
  buffered: TimeRanges | null | undefined,
  positionSeconds: number
) {
  if (!buffered || buffered.length <= 0) {
    return 0;
  }

  let coverageEnd = positionSeconds;
  for (let rangeIndex = 0; rangeIndex < buffered.length; rangeIndex += 1) {
    const start = buffered.start(rangeIndex);
    const end = buffered.end(rangeIndex);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= coverageEnd) {
      continue;
    }

    if (start > coverageEnd + 0.12) {
      continue;
    }

    coverageEnd = Math.max(coverageEnd, end);
  }

  return coverageEnd;
}

function isDestroyedEngineStatus(status: EngineStatus) {
  return status === "destroyed";
}

function isQuotaExceededError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "QuotaExceededError"
    : error instanceof Error && error.name === "QuotaExceededError";
}
