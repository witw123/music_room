import { getCachedPiece, localCacheOwnerKey } from "@/lib/indexeddb";
import type { ProgressiveTrackManifest } from "./progressive-playback";

type EngineStatus = "idle" | "opening" | "ready" | "failed" | "destroyed";
const maxCachedPiecesToQueuePerSync = 16;
const maxQueuedCachedPieces = 32;

export class ProgressiveMseEngine {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private objectUrl: string | null = null;
  private status: EngineStatus = "idle";
  private appendQueue: Array<{ chunkIndex: number; payload: ArrayBuffer }> = [];
  private queuedChunkIndexes = new Set<number>();
  private appendedChunkCount = 0;
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
    const estimatedBufferedEndSeconds =
      this.manifest.totalChunks > 0 && this.manifest.durationMs > 0
        ? Math.min(
            this.manifest.durationMs / 1000,
            (this.appendedChunkCount / this.manifest.totalChunks) *
              (this.manifest.durationMs / 1000)
          )
        : 0;
    const bufferedEndSeconds = Math.max(
      mediaBufferedEndSeconds,
      estimatedBufferedEndSeconds
    );

    return Math.max(
      0,
      Math.floor((bufferedEndSeconds - normalizedPositionSeconds) * 1000)
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
      this.sourceBuffer.appendBuffer(nextPiece.payload.slice(0));
      this.appendedChunkCount = Math.max(this.appendedChunkCount, nextPiece.chunkIndex + 1);
      this.queuedChunkIndexes.delete(nextPiece.chunkIndex);
    } catch {
      this.status = "failed";
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
