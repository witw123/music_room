import { describe, expect, it, vi } from "vitest";
import { captureAudioStream } from "./audio-utils";

describe("captureAudioStream", () => {
  it("reuses the native captureStream result for the same audio element", () => {
    const stream = {
      getAudioTracks: () => []
    } as unknown as MediaStream;
    const captureStream = vi.fn(() => stream);
    const audio = {
      captureStream
    } as unknown as HTMLAudioElement;

    const first = captureAudioStream(audio);
    const second = captureAudioStream(audio);

    expect(first).toBe(stream);
    expect(second).toBe(stream);
    expect(captureStream).toHaveBeenCalledTimes(1);
  });

  it("falls back to null instead of throwing when media capture APIs fail", () => {
    const audio = {
      captureStream: vi.fn(() => {
        throw new DOMException("capture failed", "InvalidStateError");
      })
    } as unknown as HTMLAudioElement;

    expect(captureAudioStream(audio)).toBeNull();
  });
});
