const playbackReserveBytesPerSecond = 96_000;
const importBurstBytes = 32_768;
const minYieldMs = 8;

type ImportBandwidthGovernorOptions = {
  reserveBytesPerSecond?: number;
  burstBytes?: number;
};

/**
 * Keeps provider imports from consuming the browser's entire network budget
 * while a room is actively playing. It yields between response chunks so
 * WebRTC RTP and playback scheduling keep getting network/event-loop time.
 */
export class ImportBandwidthGovernor {
  private readonly reserveBytesPerSecond: number;
  private readonly burstBytes: number;
  private windowStartedAt = 0;
  private windowBytes = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: ImportBandwidthGovernorOptions = {}) {
    this.reserveBytesPerSecond = Math.max(8_000, options.reserveBytesPerSecond ?? resolveDefaultImportRate());
    this.burstBytes = Math.max(4_096, options.burstBytes ?? importBurstBytes);
  }

  consume(bytes: number, signal?: AbortSignal) {
    const next = this.queue.then(() => this.consumeQueued(bytes, signal));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async consumeQueued(bytes: number, signal?: AbortSignal) {
    let remaining = Math.max(0, bytes);
    while (remaining > 0) {
      throwIfAborted(signal);
      const now = performance.now();
      if (this.windowStartedAt === 0 || now - this.windowStartedAt >= 1_000) {
        this.windowStartedAt = now;
        this.windowBytes = 0;
      }
      const available = this.reserveBytesPerSecond - this.windowBytes;
      if (available <= 0) {
        await abortableDelay(Math.max(minYieldMs, 1_000 - (now - this.windowStartedAt)), signal);
        continue;
      }
      const granted = Math.min(remaining, available, this.burstBytes);
      this.windowBytes += granted;
      remaining -= granted;
      if (remaining > 0) {
        await abortableDelay(minYieldMs, signal);
      }
    }
  }

  async readResponse(response: Response, signal?: AbortSignal) {
    if (!response.body || typeof response.body.getReader !== "function") {
      const blob = await response.blob();
      await this.consume(blob.size, signal);
      return blob;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        throwIfAborted(signal);
        const next = await reader.read();
        if (next.done) break;
        if (!next.value) continue;
        chunks.push(next.value);
        totalBytes += next.value.byteLength;
        // Delay the next read after accounting for the actual chunk size.
        // ReadableStream backpressure prevents a large provider response from
        // continuously filling the browser buffer while RTP is active.
        await this.consume(next.value.byteLength, signal);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }

    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Blob([output], { type: response.headers.get("content-type") ?? "application/octet-stream" });
  }
}

export const importBandwidthGovernor = new ImportBandwidthGovernor();

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError");
  }
}

function abortableDelay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function resolveDefaultImportRate() {
  const connection = typeof navigator !== "undefined"
    ? (navigator as Navigator & { connection?: { downlink?: number } }).connection
    : undefined;
  const downlinkMbps = connection?.downlink;
  if (!Number.isFinite(downlinkMbps) || !downlinkMbps || downlinkMbps <= 0) {
    return playbackReserveBytesPerSecond;
  }
  // Keep imports around 12% of the estimated link and cap them at 96 KB/s.
  // This leaves headroom for RTP, signaling, and normal room interaction.
  return Math.min(
    playbackReserveBytesPerSecond,
    Math.max(8_000, downlinkMbps * 125_000 * 0.12)
  );
}
