import { getCachedPiecesForTrack, localCacheOwnerKey } from "@/lib/indexeddb";
import type { ProgressiveTrackManifest } from "./progressive-playback";

type EngineStatus = "idle" | "opening" | "ready" | "failed" | "destroyed";

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

      const pieces = await getCachedPiecesForTrack(this.manifest.trackId, this.peerId, {
        fileHash: this.manifest.fileHash,
        ownerKey: localCacheOwnerKey,
        chunkSize: this.manifest.chunkSize
      });
      const piecesByChunkIndex = new Map(
        pieces.map((piece) => [piece.chunkIndex, piece] as const)
      );
      let nextChunkIndex = this.appendedChunkCount;
      while (nextChunkIndex < this.manifest.totalChunks) {
        const piece = piecesByChunkIndex.get(nextChunkIndex);
        if (!piece) {
          break;
        }

        if (!this.queuedChunkIndexes.has(piece.chunkIndex)) {
          this.appendQueue.push({
            chunkIndex: piece.chunkIndex,
            payload: piece.payload.slice(0)
          });
          this.queuedChunkIndexes.add(piece.chunkIndex);
        }
        nextChunkIndex += 1;
      }

      this.pumpAppendQueue();
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
    } catch {
      this.status = "failed";
    }
  }
}
