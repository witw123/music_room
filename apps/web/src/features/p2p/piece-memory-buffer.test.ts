import { beforeEach, describe, expect, it } from "vitest";
import { PieceMemoryBuffer, pieceMemoryBuffer } from "./piece-memory-buffer";

describe("PieceMemoryBuffer", () => {
  let buffer: PieceMemoryBuffer;

  beforeEach(() => {
    buffer = new PieceMemoryBuffer();
  });

  it("stores and retrieves a single chunk", () => {
    const payload = new Uint8Array([1, 2, 3]).buffer;
    buffer.put("track_1", 0, payload);
    expect(buffer.get("track_1", 0)).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buffer.get("track_1", 0)!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns undefined for missing chunks", () => {
    expect(buffer.get("track_1", 0)).toBeUndefined();
  });

  it("batch-retrieves multiple chunks", () => {
    buffer.put("track_1", 0, new Uint8Array([1]).buffer);
    buffer.put("track_1", 2, new Uint8Array([3]).buffer);
    // chunk 1 is missing

    const batch = buffer.getBatch("track_1", [0, 1, 2]);
    expect(batch.size).toBe(2);
    expect(batch.get(0)).toBeInstanceOf(ArrayBuffer);
    expect(batch.get(2)).toBeInstanceOf(ArrayBuffer);
    expect(batch.has(1)).toBe(false);
  });

  it("evicts a single chunk", () => {
    buffer.put("track_1", 0, new Uint8Array([1]).buffer);
    buffer.put("track_1", 1, new Uint8Array([2]).buffer);

    buffer.evict("track_1", 0);
    expect(buffer.get("track_1", 0)).toBeUndefined();
    expect(buffer.get("track_1", 1)).toBeInstanceOf(ArrayBuffer);
    expect(buffer.getTrackChunkCount("track_1")).toBe(1);
  });

  it("clears all chunks for a track", () => {
    buffer.put("track_1", 0, new Uint8Array([1]).buffer);
    buffer.put("track_1", 1, new Uint8Array([2]).buffer);
    buffer.put("track_2", 0, new Uint8Array([3]).buffer);

    buffer.clearTrack("track_1");
    expect(buffer.getTrackChunkCount("track_1")).toBe(0);
    expect(buffer.getTrackChunkCount("track_2")).toBe(1);
  });

  it("does not overwrite an existing chunk", () => {
    const payload1 = new Uint8Array([1, 2]).buffer;
    const payload2 = new Uint8Array([3, 4]).buffer;
    buffer.put("track_1", 0, payload1);
    buffer.put("track_1", 0, payload2);

    // Second put is a no-op since chunk 0 already exists.
    expect(new Uint8Array(buffer.get("track_1", 0)!)).toEqual(new Uint8Array([1, 2]));
  });

  it("stores a defensive copy of the payload", () => {
    const original = new Uint8Array([1, 2, 3]);
    buffer.put("track_1", 0, original.buffer);
    // Mutate the original
    original[0] = 99;

    // The stored copy should be unaffected.
    expect(new Uint8Array(buffer.get("track_1", 0)!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("evicting the last chunk removes the track entry", () => {
    buffer.put("track_1", 0, new Uint8Array([1]).buffer);
    buffer.evict("track_1", 0);

    expect(buffer.totalChunkCount).toBe(0);
    // getBatch on a cleared track returns empty
    expect(buffer.getBatch("track_1", [0]).size).toBe(0);
  });

  it("tracks chunk and total counts correctly", () => {
    buffer.put("track_1", 0, new Uint8Array([1]).buffer);
    buffer.put("track_1", 1, new Uint8Array([2]).buffer);
    buffer.put("track_2", 0, new Uint8Array([3]).buffer);

    expect(buffer.getTrackChunkCount("track_1")).toBe(2);
    expect(buffer.getTrackChunkCount("track_2")).toBe(1);
    expect(buffer.totalChunkCount).toBe(3);
  });

  it("evicts non-active chunks first when the capacity is exceeded", () => {
    buffer = new PieceMemoryBuffer({ maxChunks: 3 });
    buffer.setActiveWindow("track_active", [5, 6]);

    buffer.put("track_other", 0, new Uint8Array([10]).buffer);
    buffer.put("track_active", 5, new Uint8Array([5]).buffer);
    buffer.put("track_active", 6, new Uint8Array([6]).buffer);
    buffer.put("track_other", 1, new Uint8Array([11]).buffer);

    expect(buffer.get("track_active", 5)).toBeInstanceOf(ArrayBuffer);
    expect(buffer.get("track_active", 6)).toBeInstanceOf(ArrayBuffer);
    expect(buffer.get("track_other", 0)).toBeUndefined();
    expect(buffer.get("track_other", 1)).toBeInstanceOf(ArrayBuffer);
    expect(buffer.totalChunkCount).toBe(3);
  });

  it("clearTrack on unknown track is a no-op", () => {
    expect(() => buffer.clearTrack("nonexistent")).not.toThrow();
    expect(buffer.totalChunkCount).toBe(0);
  });

  it("evict on unknown chunk is a no-op", () => {
    expect(() => buffer.evict("nonexistent", 0)).not.toThrow();
  });
});

describe("pieceMemoryBuffer singleton", () => {
  it("is a PieceMemoryBuffer instance", () => {
    expect(pieceMemoryBuffer).toBeInstanceOf(PieceMemoryBuffer);
  });

  it("keeps the shared buffer bounded", () => {
    pieceMemoryBuffer.clearTrack("singleton_track");
    for (let chunkIndex = 0; chunkIndex < 513; chunkIndex += 1) {
      pieceMemoryBuffer.put("singleton_track", chunkIndex, new Uint8Array([chunkIndex]).buffer);
    }

    expect(pieceMemoryBuffer.totalChunkCount).toBeLessThanOrEqual(512);
    pieceMemoryBuffer.clearTrack("singleton_track");
  });
});
