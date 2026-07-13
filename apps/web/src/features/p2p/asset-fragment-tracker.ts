import type { AssetUnitDescriptor } from "@music-room/shared";
import type { DecodedAssetFrame } from "./asset-frame-codec";

type PendingAssetUnit = {
  descriptor: AssetUnitDescriptor | null;
  fragments: Map<number, ArrayBuffer>;
  fragmentCount: number;
  expiresAt: number;
};

export class AssetFragmentTracker {
  private readonly pending = new Map<string, PendingAssetUnit>();

  constructor(private readonly ttlMs = 15_000) {}

  add(peerId: string, frame: DecodedAssetFrame) {
    this.prune();
    const key = `${peerId}:${frame.header.streamId}:${frame.header.generation}:${frame.header.unitIndex}`;
    const current = this.pending.get(key) ?? {
      descriptor: null,
      fragments: new Map<number, ArrayBuffer>(),
      fragmentCount: frame.header.fragmentCount,
      expiresAt: Date.now() + this.ttlMs
    };
    if (current.fragmentCount !== frame.header.fragmentCount) {
      this.pending.delete(key);
      throw new Error("Asset fragment geometry changed mid-transfer.");
    }
    if (frame.header.descriptor) {
      current.descriptor = frame.header.descriptor;
    }
    current.fragments.set(frame.header.fragmentIndex, frame.payload);
    current.expiresAt = Date.now() + this.ttlMs;
    this.pending.set(key, current);

    if (!current.descriptor || current.fragments.size !== current.fragmentCount) {
      return null;
    }
    const byteLength = [...current.fragments.values()].reduce(
      (total, fragment) => total + fragment.byteLength,
      0
    );
    const payload = new Uint8Array(byteLength);
    let offset = 0;
    for (let index = 0; index < current.fragmentCount; index += 1) {
      const fragment = current.fragments.get(index);
      if (!fragment) {
        return null;
      }
      payload.set(new Uint8Array(fragment), offset);
      offset += fragment.byteLength;
    }
    this.pending.delete(key);
    return { descriptor: current.descriptor, payload: payload.buffer };
  }

  clear() {
    this.pending.clear();
  }

  private prune() {
    const now = Date.now();
    for (const [key, pending] of this.pending.entries()) {
      if (pending.expiresAt <= now) {
        this.pending.delete(key);
      }
    }
  }
}
