/**
 * In-memory piece buffer that sits between P2P receive and PCM decode.
 *
 * P2P chunks are written to this buffer immediately upon validation (before
 * IndexedDB persistence completes), allowing the PCM engine to read them
 * instantly without an IndexedDB round-trip. This eliminates the primary
 * latency bottleneck for first-time playback.
 *
 * Chunks are evicted after the decoder consumes them or when the track is
 * cleared (engine destroy / track change).
 */
export class PieceMemoryBuffer {
  /** trackKey → chunkIndex → payload bytes (owned copy) */
  private readonly store = new Map<string, Map<number, ArrayBuffer>>();

  /**
   * Store a piece payload in the memory buffer.
   * Creates a defensive copy so the caller can reuse/detach the original buffer.
   */
  put(trackKey: string, chunkIndex: number, payload: ArrayBuffer): void {
    let trackStore = this.store.get(trackKey);
    if (!trackStore) {
      trackStore = new Map();
      this.store.set(trackKey, trackStore);
    }
    // Store a detached copy — the original ArrayBuffer may be transferred or
    // reused by the piece frame decoder on the next message.
    if (!trackStore.has(chunkIndex)) {
      trackStore.set(chunkIndex, payload.slice(0));
    }
  }

  /**
   * Get a single chunk from the buffer. Returns undefined if not found.
   */
  get(trackKey: string, chunkIndex: number): ArrayBuffer | undefined {
    return this.store.get(trackKey)?.get(chunkIndex);
  }

  /**
   * Batch-read multiple chunks. Returns a Map of chunkIndex → payload for
   * chunks that were found in memory. Chunks not in memory are simply absent
   * from the result.
   */
  getBatch(trackKey: string, chunkIndexes: number[]): Map<number, ArrayBuffer> {
    const trackStore = this.store.get(trackKey);
    const result = new Map<number, ArrayBuffer>();
    if (!trackStore) {
      return result;
    }
    for (const chunkIndex of chunkIndexes) {
      const payload = trackStore.get(chunkIndex);
      if (payload) {
        result.set(chunkIndex, payload);
      }
    }
    return result;
  }

  /**
   * Evict a single chunk after the decoder has consumed it.
   */
  evict(trackKey: string, chunkIndex: number): void {
    const trackStore = this.store.get(trackKey);
    if (!trackStore) {
      return;
    }
    trackStore.delete(chunkIndex);
    if (trackStore.size === 0) {
      this.store.delete(trackKey);
    }
  }

  /**
   * Clear all buffered pieces for a track (called on engine destroy / track change).
   */
  clearTrack(trackKey: string): void {
    this.store.delete(trackKey);
  }

  /**
   * Return the number of buffered chunks for a track.
   */
  getTrackChunkCount(trackKey: string): number {
    return this.store.get(trackKey)?.size ?? 0;
  }

  /**
   * Return the total number of buffered chunks across all tracks.
   */
  get totalChunkCount(): number {
    let count = 0;
    for (const trackStore of this.store.values()) {
      count += trackStore.size;
    }
    return count;
  }
}

/** Singleton instance shared across the P2P receive path and PCM decode path. */
export const pieceMemoryBuffer = new PieceMemoryBuffer();
