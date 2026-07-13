"use client";

type PendingEncode = {
  resolve: (payload: ArrayBuffer) => void;
  reject: (error: Error) => void;
};

type EncodeResponse =
  | { id: number; ok: true; payload: ArrayBuffer }
  | { id: number; ok: false; error: string };

export class OpusSegmentEncoder {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingEncode>();
  private sequence = 0;
  private disposed = false;

  constructor() {
    this.worker = new Worker(new URL("./opus-segment-encoder.worker.ts", import.meta.url), {
      type: "module",
      name: "music-room-opus-encoder"
    });
    this.worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) {
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.ok) {
        pending.resolve(event.data.payload);
      } else {
        pending.reject(new Error(event.data.error));
      }
    };
    this.worker.onerror = (event) => {
      this.rejectAll(new Error(event.message || "Opus encoder worker failed."));
    };
  }

  encode(input: {
    sampleRate: number;
    channels: Float32Array[];
    bitrateKbps: 96 | 192;
  }) {
    if (this.disposed) {
      return Promise.reject(new Error("Opus encoder has been disposed."));
    }
    const id = ++this.sequence;
    const transfer = input.channels.map((channel) => channel.buffer);
    return new Promise<ArrayBuffer>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...input }, { transfer });
    });
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.worker.terminate();
    this.rejectAll(new Error("Opus encoding was cancelled."));
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
